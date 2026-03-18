// --- DATABASE INITIALIZATION ---
let database = { players: [] };

async function loadDatabase() {
    try {
        const response = await fetch('players.json');
        if (!response.ok) throw new Error("Could not find players.json");
        database.players = await response.json();
        console.log("Success! Loaded " + database.players.length + " players.");
    } catch (err) {
        console.error("Database error:", err);
        database.players = [{ name: "Cristiano Ronaldo", clubs: ["Real Madrid", "Juventus", "Al Nassr"] }];
    }
}

loadDatabase();

const game = {
    mode: 'local', 
    target: "Cristiano Ronaldo", 
    used: [], 
    lockLimit: 10, 
    players: [],
    turnIndex: 0, 
    timer: null, 
    timeLeft: 20,

    updateUI() {
        const activeName = this.players[this.turnIndex] || "WAITING";
        const t = this.timeLeft;
        const pct = (t / 20) * 100;
        
        const nEl = document.querySelector('.turn-name');
        const tEl = document.getElementById('timer');
        const bEl = document.getElementById('timer-bar');
        const input = document.getElementById('user-input');

        if (nEl) nEl.innerText = activeName.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
        if (bEl) {
            bEl.style.width = pct + "%";
            t <= 6 ? bEl.classList.add('urgent') : bEl.classList.remove('urgent');
        }

        // TURN LOCKING: Disable input if it's not your turn
        if (this.mode === 'online') {
            const isMyTurn = (activeName === online.myName);
            input.disabled = !isMyTurn;
            input.placeholder = isMyTurn ? "Your Turn! Type..." : `Waiting for ${activeName}...`;
        }
    },

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timeLeft = 20;
        this.updateUI();
        this.timer = setInterval(() => {
            this.timeLeft--;
            this.updateUI();
            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                if (this.mode === 'online') {
                    if (online.isHost) this.eliminate(); // Only host triggers time-out logic
                } else {
                    this.eliminate();
                }
            }
        }, 1000);
    },

    handleOneClub() {
        // Prevent clicking if not your turn
        if (this.mode === 'online' && this.players[this.turnIndex] !== online.myName) return;

        const targetClean = this.simplify(this.target);
        const pMatch = database.players.find(p => this.simplify(p.name) === targetClean);

        if (pMatch && pMatch.clubs.length === 1) {
            const move = pMatch.clubs[0];
            if (this.mode === 'online') {
                online.sendData({ type: 'MOVE', move: move, user: online.myName, special: 'LOYALTY' });
            } else {
                ui.addLog(this.players[this.turnIndex], `LOYALTY! -> ${move.toUpperCase()}`, "system");
                this.processMove(this.players[this.turnIndex], move);
            }
        } else {
            this.eliminate();
        }
    },

    startLocal() {
        const inputs = document.querySelectorAll('.local-p-name');
        this.players = Array.from(inputs).map(i => i.value.trim()).filter(v => v !== "");
        if (this.players.length < 2) return alert("Please enter at least 2 player names!");
        this.mode = 'local';
        this.init();
    },

    startAI() {
        const n = document.getElementById('player-nickname').value || "You";
        this.players = [n, "AI Bot"];
        this.mode = 'ai';
        this.init();
    },

    init() {
        this.used = [this.simplify(this.target)];
        this.turnIndex = 0;
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.startTimer();
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    handleInput() {
        const input = document.getElementById('user-input');
        if (input.disabled) return; // Locked
        const val = input.value.trim();
        if (!val) return;
        this.submitMove(val);  
        input.value = "";
    },

    submitMove(val) {
        const cleanVal = this.simplify(val);
        if (this.used.includes(cleanVal)) return alert("Already used!");
        
        let linked = false;
        const targetClean = this.simplify(this.target);
        
        const tP = database.players.find(p => this.simplify(p.name) === targetClean);
        if (tP && tP.clubs.some(c => this.simplify(c) === cleanVal)) linked = true;
        
        if (!linked) {
            const iP = database.players.find(p => this.simplify(p.name) === cleanVal);
            if (iP && iP.clubs.some(c => this.simplify(c) === targetClean)) linked = true;
        }

        if (linked) {
            if (this.mode === 'online') {
                online.sendData({ type: 'MOVE', move: val, user: online.myName });
            } else {
                this.processMove(this.players[this.turnIndex], val);
            }
        } else {
            if (this.mode === 'online') {
                online.sendData({ type: 'ELIMINATE', user: online.myName });
            } else {
                this.eliminate();
            }
        }
    },

    processMove(user, move) {
        ui.addLog(user, move, user === "AI Bot" ? "ai" : "player");
        this.target = move;
        this.addToUsed(move);
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.startTimer();
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") setTimeout(() => this.aiThink(), 1200);
    },

    addToUsed(name) {
        this.used.push(this.simplify(name));
        if (this.used.length > this.lockLimit) this.used.shift(); 
    },
        
    aiThink() {
        const targetClean = this.simplify(this.target);
        let possibleMoves = [];

        // RANDOMIZED AI: Find ALL valid clubs from current player
        const player = database.players.find(p => this.simplify(p.name) === targetClean);
        if (player) {
            possibleMoves = player.clubs.filter(c => !this.used.includes(this.simplify(c)));
        }

        // If no clubs, find ALL players who played for the current club target
        if (possibleMoves.length === 0) {
            const linkedPlayers = database.players.filter(p => 
                p.clubs.some(c => this.simplify(c) === targetClean) && 
                !this.used.includes(this.simplify(p.name))
            );
            possibleMoves = linkedPlayers.map(p => p.name);
        }

        if (possibleMoves.length > 0) {
            // Pick a RANDOM index instead of the first one
            const randomIndex = Math.floor(Math.random() * possibleMoves.length);
            this.submitMove(possibleMoves[randomIndex]); 
        } else {
            this.eliminate();
        }
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        ui.addLog(loser, "RED CARD! 🟥", "eliminated");
        
        // Broadcast elimination to keep all screens in sync
        if (this.mode === 'online' && online.isHost) {
            online.broadcast({ type: 'SYNC_ELIMINATE', index: this.turnIndex });
        }

        this.players.splice(this.turnIndex, 1);
        
        if (this.players.length <= 1) {
            const winner = this.players[0] || "Nobody";
            if (this.mode === 'online' && online.isHost) {
                online.broadcast({ type: 'WINNER', name: winner });
            }
            this.win(winner);
        } else {
            if (this.turnIndex >= this.players.length) this.turnIndex = 0;
            this.startTimer();
            if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") setTimeout(() => this.aiThink(), 1000);
        }
    },

    win(name) {
        clearInterval(this.timer);
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
    }
};

// --- ONLINE / MULTIPLAYER LOGIC ---
const online = {
    peer: null, connections: [], myName: "", isHost: false, activeConn: null,
    
    createRoom() {
        this.myName = document.getElementById('player-nickname').value || "Host";
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(code);
        this.isHost = true;
        game.players = [this.myName];
        this.peer.on('open', id => {
            document.getElementById('room-code-display').innerText = id;
            document.getElementById('start-online-btn').style.display = "block";
            ui.updateLobby();
        });
        this.peer.on('connection', c => { 
            this.connections.push(c); 
            this.setup(c); 
        });
    },

    joinRoom() {
        const code = document.getElementById('join-id').value;
        this.myName = document.getElementById('player-nickname').value || "Guest";
        this.peer = new Peer();
        this.peer.on('open', () => { 
            const conn = this.peer.connect(code);
            this.activeConn = conn;
            this.setup(conn); 
        });
    },

    setup(c) {
        c.on('open', () => { 
            if (!this.isHost) c.send({ type: 'JOIN', name: this.myName }); 
        });
        
        c.on('data', data => {
            // Host logic
            if (this.isHost) {
                if (data.type === 'JOIN') {
                    game.players.push(data.name);
                    this.broadcast({ type: 'LOBBY', list: game.players });
                    ui.updateLobby();
                }
                if (data.type === 'MOVE') this.broadcast(data);
                if (data.type === 'ELIMINATE') this.game.eliminate();
            }

            // Global Sync logic
            if (data.type === 'LOBBY') { game.players = data.list; ui.updateLobby(); }
            if (data.type === 'START') { game.mode = 'online'; game.init(); }
            if (data.type === 'MOVE') {
                if (data.special === 'LOYALTY') ui.addLog(data.user, "LOYALTY! -> " + data.move.toUpperCase(), "system");
                game.processMove(data.user, data.move);
            }
            if (data.type === 'SYNC_ELIMINATE') {
                // Spectator Sync: All clients remove the same player
                const loser = game.players[data.index];
                if (loser !== online.myName) ui.addLog(loser, "OUT! 🟥", "eliminated");
                game.players.splice(data.index, 1);
                game.startTimer();
            }
            if (data.type === 'WINNER') game.win(data.name);
        });
    },

    broadcast(d) { this.connections.forEach(c => c.send(d)); },
    sendData(d) { this.isHost ? this.broadcast(d) : this.activeConn.send(d); },
    broadcastStart() { 
        this.broadcast({ type: 'START' }); 
        game.mode = 'online'; 
        game.init(); 
    }
};

// --- UI HELPERS ---
const ui = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },
    addLocalPlayerField() {
        const num = document.querySelectorAll('.local-p-name').length + 1;
        const wrap = document.createElement('div');
        wrap.className = 'player-field-wrap';
        wrap.setAttribute('data-num', 'P' + num);
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'field-input local-p-name';
        input.placeholder = 'Player ' + num + ' Name';
        wrap.appendChild(input);
        document.getElementById('local-player-list').appendChild(wrap);
    },
    addLog(user, msg, type = "player") {
        const feed = document.getElementById('game-feed');
        const div = document.createElement('div');
        div.className = 'log-entry ' + type;
        const color = type === 'ai' ? '#4cc9f0' : type === 'system' ? '#2ecc71' : type === 'eliminated' ? '#e63946' : '#e8f5ee';
        div.innerHTML = `<span class="log-user" style="color:${color}">${user}</span><span class="log-msg">${msg}</span>`;
        feed.appendChild(div);
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    },
    updateLobby() {
        document.getElementById('lobby-list').innerText = "In Lobby: " + game.players.join(", ");
    }
};

// --- SEARCH ENGINE ---
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

inputField.addEventListener('input', (e) => {
    if (inputField.disabled) return;
    const val = e.target.value.toLowerCase().trim();
    suggBox.innerHTML = '';
    if (val.length < 1) { suggBox.style.display = 'none'; return; }

    const cleanSearch = val.replace(/\s+/g, "");
    const matches = [];
    
    for (let p of database.players) {
        if (p.name.toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(p.name);
        for (let c of p.clubs) {
            if (c.toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(c);
        }
        if (matches.length >= 8) break; 
    }

    const uniqueMatches = [...new Set(matches)];
    if (uniqueMatches.length > 0) {
        uniqueMatches.forEach(match => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.innerText = match;
            div.onclick = () => { 
                inputField.value = match; 
                suggBox.style.display = 'none'; 
                game.handleInput(); 
            };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    } else { 
        suggBox.style.display = 'none'; 
    }
});

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.getElementById('screen-game').classList.contains('active')) {
        game.handleInput();
    }
});

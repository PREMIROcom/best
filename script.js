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
        // Minimal fallback for safety
        database.players = [{ name: "Cristiano Ronaldo", clubs: ["Real Madrid", "Juventus", "Al Nassr", "Manchester United"] }];
    }
}

loadDatabase();

const game = {
    mode: 'local', 
    target: "Cristiano Ronaldo", 
    used: [], 
    lockLimit: 12, // Increased for your 20k database
    players: [],
    turnIndex: 0, 
    timer: null, 
    timeLeft: 20,

    // CORE: Determines if the CURRENT user can interact with the screen
    canMove() {
        if (this.players.length === 0) return false;
        const activePlayerName = this.players[this.turnIndex];
        
        if (this.mode === 'local') return true;
        if (this.mode === 'ai') return activePlayerName !== "AI Bot";
        if (this.mode === 'online') return online.myName === activePlayerName;
        return false;
    },

    updateUI() {
        const name = this.players[this.turnIndex] || "MATCH OVER";
        const t = this.timeLeft;
        const pct = (t / 20) * 100;
        
        const nEl = document.getElementById('active-player-display');
        const tEl = document.getElementById('timer');
        const bEl = document.getElementById('timer-bar');
        const input = document.getElementById('user-input');
        const actionBtns = document.querySelectorAll('.submit-btn-row .btn');

        if (nEl) nEl.innerText = name.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
        
        if (bEl) {
            bEl.style.width = pct + "%";
            t <= 6 ? bEl.classList.add('urgent') : bEl.classList.remove('urgent');
        }

        // TURN LOCKING
        const isMyTurn = this.canMove();
        input.disabled = !isMyTurn;
        
        // Visual feedback for locked buttons
        actionBtns.forEach(btn => {
            btn.style.opacity = isMyTurn ? "1" : "0.3";
            btn.style.pointerEvents = isMyTurn ? "auto" : "none";
        });

        if (this.players.length > 0) {
            input.placeholder = isMyTurn ? "Your turn! Type..." : `Waiting for ${name}...`;
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
                // Host handles timing in online mode to ensure everyone is synced
                if (this.mode === 'online') {
                    if (online.isHost) this.eliminate();
                } else {
                    this.eliminate();
                }
            }
        }, 1000);
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    handleInput() {
        const input = document.getElementById('user-input');
        const val = input.value.trim();
        if (!val || !this.canMove()) return;
        this.submitMove(val);  
        input.value = "";
    },

    submitMove(val) {
        const cleanVal = this.simplify(val);
        if (this.used.includes(cleanVal)) return alert("Already used in this chain!");
        
        let linked = false;
        const targetClean = this.simplify(this.target);
        
        // 1. Check if input is a club for current target player
        const tP = database.players.find(p => this.simplify(p.name) === targetClean);
        if (tP && tP.clubs.some(c => this.simplify(c) === cleanVal)) linked = true;
        
        // 2. Check if input is a player for current target club
        if (!linked) {
            const iP = database.players.find(p => this.simplify(p.name) === cleanVal);
            if (iP && iP.clubs.some(c => this.simplify(c) === targetClean)) linked = true;
        }

        if (linked) {
            if (this.mode === 'online') {
                online.sendMove(val);
            } else {
                this.processMove(this.players[this.turnIndex], val);
            }
        } else {
            // Elimination logic
            if (this.mode === 'online' && !online.isHost) {
                online.activeConn.send({ type: 'FAILED_ATTEMPT', user: online.myName });
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
        
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") {
            setTimeout(() => this.aiThink(), 1200);
        }
    },

    // NEW RANDOMIZED AI
    aiThink() {
        const targetClean = this.simplify(this.target);
        const options = [];

        for (const p of database.players) {
            const pNameClean = this.simplify(p.name);
            // If target is player, look for their clubs
            if (pNameClean === targetClean) {
                p.clubs.forEach(c => {
                    if (!this.used.includes(this.simplify(c))) options.push(c);
                });
            }
            // If target is club, look for players in that club
            if (p.clubs.some(c => this.simplify(c) === targetClean)) {
                if (!this.used.includes(pNameClean)) options.push(p.name);
            }
        }

        if (options.length > 0) {
            const randomPick = options[Math.floor(Math.random() * options.length)];
            this.submitMove(randomPick);
        } else {
            this.eliminate();
        }
    },

    handleOneClub() {
        if (!this.canMove()) return;
        const targetClean = this.simplify(this.target);
        const pMatch = database.players.find(p => this.simplify(p.name) === targetClean);

        if (pMatch && pMatch.clubs.length === 1) {
            const move = pMatch.clubs[0];
            if (this.mode === 'online') online.sendMove(move);
            else this.processMove(this.players[this.turnIndex], move);
        } else {
            this.eliminate();
        }
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        ui.addLog(loser, "RED CARD! 🟥", "eliminated");
        
        this.players.splice(this.turnIndex, 1);
        
        if (this.mode === 'online' && online.isHost) {
            if (this.players.length <= 1) {
                const winner = this.players[0] || "Nobody";
                online.broadcast({ type: 'WIN', winner: winner });
                this.win(winner);
            } else {
                if (this.turnIndex >= this.players.length) this.turnIndex = 0;
                online.broadcast({ type: 'SYNC', players: this.players, turn: this.turnIndex, target: this.target });
                this.startTimer();
            }
        } else if (this.mode !== 'online') {
            if (this.players.length <= 1) {
                this.win(this.players[0] || "Nobody");
            } else {
                if (this.turnIndex >= this.players.length) this.turnIndex = 0;
                this.startTimer();
                if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") setTimeout(() => this.aiThink(), 1000);
            }
        }
    },

    addToUsed(name) {
        this.used.push(this.simplify(name));
        if (this.used.length > this.lockLimit) this.used.shift(); 
    },

    win(name) {
        clearInterval(this.timer);
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
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
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Match started! Target: " + this.target, "system");
        this.updateUI();
        this.startTimer();
    }
};

// --- MULTIPLAYER (PEERJS) ---
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
            this.setup(this.peer.connect(code)); 
        });
    },

    setup(c) {
        c.on('open', () => { 
            if (!this.isHost) { 
                this.activeConn = c; 
                c.send({ type: 'JOIN', name: this.myName }); 
            } 
        });
        c.on('data', data => {
            if (this.isHost) {
                if (data.type === 'JOIN') {
                    game.players.push(data.name);
                    this.broadcast({ type: 'LOBBY', list: game.players });
                    ui.updateLobby();
                }
                if (data.type === 'MOVE_TRY') {
                    game.processMove(data.user, data.move);
                    this.broadcast({ type: 'MOVE_SYNC', user: data.user, move: data.move });
                }
                if (data.type === 'FAILED_ATTEMPT') game.eliminate();
            } else {
                if (data.type === 'LOBBY') { game.players = data.list; ui.updateLobby(); }
                if (data.type === 'START') { game.mode = 'online'; game.init(); }
                if (data.type === 'MOVE_SYNC') game.processMove(data.user, data.move);
                if (data.type === 'SYNC') {
                    game.players = data.players;
                    game.turnIndex = data.turn;
                    game.target = data.target;
                    game.startTimer();
                }
                if (data.type === 'WIN') game.win(data.winner);
            }
        });
    },

    broadcast(d) { this.connections.forEach(c => c.send(d)); },
    
    sendMove(val) {
        if (this.isHost) {
            game.processMove(this.myName, val);
            this.broadcast({ type: 'MOVE_SYNC', user: this.myName, move: val });
        } else {
            this.activeConn.send({ type: 'MOVE_TRY', move: val, user: this.myName });
        }
    },

    broadcastStart() {
        this.broadcast({ type: 'START' });
        game.mode = 'online';
        game.init();
    }
};

// --- UI AND EVENT LISTENERS ---
const ui = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id);
        if (target) target.classList.add('active');
    },
    addLocalPlayerField() {
        const num = document.querySelectorAll('.local-p-name').length + 1;
        const wrap = document.createElement('div');
        wrap.className = 'player-field-wrap';
        wrap.setAttribute('data-num', 'P' + num);
        wrap.innerHTML = `<input type="text" class="field-input local-p-name" placeholder="Player ${num} Name">`;
        document.getElementById('local-player-list').appendChild(wrap);
    },
    addLog(user, msg, type = "player") {
        const feed = document.getElementById('game-feed');
        if (!feed) return;
        const div = document.createElement('div');
        div.className = 'log-entry ' + type;
        const color = type === 'ai' ? '#4cc9f0' : type === 'system' ? '#2ecc71' : type === 'eliminated' ? '#e63946' : '#e8f5ee';
        div.innerHTML = `<span class="log-user" style="color:${color}">${user}</span><span class="log-msg">${msg}</span>`;
        feed.appendChild(div);
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    },
    updateLobby() {
        const lb = document.getElementById('lobby-list');
        if (lb) lb.innerText = "In Lobby: " + game.players.join(", ");
    }
};

// --- SUGGESTIONS & INPUT ---
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

if (inputField) {
    inputField.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        suggBox.innerHTML = '';
        if (val.length < 1) { suggBox.style.display = 'none'; return; }

        const cleanSearch = val.replace(/\s+/g, "");
        const matches = [];

        for (const p of database.players) {
            if (p.name.toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(p.name);
            for (const c of p.clubs) {
                if (c.toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(c);
            }
            if (matches.length >= 10) break;
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

    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') game.handleInput();
    });
}

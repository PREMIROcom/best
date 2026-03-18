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
    lockLimit: 10, // Increased for 20k database
    players: [], // Objects: {name: string, id: string, eliminated: boolean}
    turnIndex: 0, 
    timer: null, 
    timeLeft: 20,

    // 2. TURN LOCKING: Check if it is currently this user's turn
    isMyTurn() {
        if (this.mode !== 'online') return true;
        const currentPlayer = this.players[this.turnIndex];
        return currentPlayer && currentPlayer.id === online.peer.id;
    },

    updateUI() {
        const activePlayer = this.players[this.turnIndex];
        const name = activePlayer ? activePlayer.name : "?";
        const t = this.timeLeft;
        const pct = (t / 20) * 100;
        
        const nEl = document.getElementById('active-player-display');
        const tEl = document.getElementById('timer');
        const bEl = document.getElementById('timer-bar');
        const inputEl = document.getElementById('user-input');

        if (nEl) nEl.innerText = name.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
        
        if (bEl) {
            bEl.style.width = pct + "%";
            t <= 6 ? bEl.classList.add('urgent') : bEl.classList.remove('urgent');
        }

        // 2. TURN LOCKING: Disable input if not your turn
        if (inputEl) {
            inputEl.disabled = !this.isMyTurn();
            inputEl.placeholder = this.isMyTurn() ? "Your Turn! Type..." : `Waiting for ${name}...`;
        }
    },

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timeLeft = 20;
        this.updateUI();
        
        // Only the Host manages the "Official" timer in Online mode to prevent de-sync
        if (this.mode === 'online' && !online.isHost) return;

        this.timer = setInterval(() => {
            this.timeLeft--;
            if (this.mode === 'online') {
                online.broadcast({ type: 'TICK', time: this.timeLeft });
            }
            this.updateUI();

            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                this.eliminate();
            }
        }, 1000);
    },

    // 1. RANDOMIZED AI: Picks a random valid link from the whole database
    aiThink() {
        const targetClean = this.simplify(this.target);
        let possibleMoves = [];

        // Find all players linked to current club OR clubs linked to current player
        database.players.forEach(p => {
            const pNameClean = this.simplify(p.name);
            const pClubsClean = p.clubs.map(c => this.simplify(c));

            // If target is a player, look for his clubs
            if (pNameClean === targetClean) {
                p.clubs.forEach(c => {
                    if (!this.used.includes(this.simplify(c))) possibleMoves.push(c);
                });
            }
            // If target is a club, look for players who played there
            if (pClubsClean.includes(targetClean)) {
                if (!this.used.includes(pNameClean)) possibleMoves.push(p.name);
            }
        });

        if (possibleMoves.length > 0) {
            const randomChoice = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            setTimeout(() => this.submitMove(randomChoice), 1500);
        } else {
            this.eliminate();
        }
    },

    startLocal() {
        const inputs = document.querySelectorAll('.local-p-name');
        this.players = Array.from(inputs)
            .map(i => i.value.trim())
            .filter(v => v !== "")
            .map(name => ({ name, id: 'local', eliminated: false }));

        if (this.players.length < 2) return alert("Enter 2+ players!");
        this.mode = 'local';
        this.init();
    },

    startAI() {
        const n = document.getElementById('player-nickname').value || "You";
        this.players = [
            { name: n, id: 'human', eliminated: false },
            { name: "AI Bot", id: 'ai', eliminated: false }
        ];
        this.mode = 'ai';
        this.init();
    },

    init() {
        this.used = [this.simplify(this.target)];
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Kick-off with: " + this.target, "system");
        this.turnIndex = 0;
        this.startTimer();
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    handleInput() {
        if (!this.isMyTurn()) return;
        const input = document.getElementById('user-input');
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
                this.processMove(this.players[this.turnIndex].name, val);
            }
        } else {
            this.eliminate();
        }
    },

    processMove(userName, move) {
        ui.addLog(userName, move, userName === "AI Bot" ? "ai" : "player");
        this.target = move;
        this.used.push(this.simplify(move));
        if (this.used.length > this.lockLimit) this.used.shift();

        this.nextTurn();
    },

    nextTurn() {
        // Skip eliminated players (3. SPECTATOR MODE)
        let attempts = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
            attempts++;
        } while (this.players[this.turnIndex].eliminated && attempts < this.players.length);

        this.startTimer();
        if (this.mode === 'ai' && this.players[this.turnIndex].id === 'ai') this.aiThink();
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        loser.eliminated = true;
        
        ui.addLog(loser.name, "ELIMINATED! 🟥", "eliminated");

        // 4. GAME OVER SYNC: Count remaining active players
        const activePlayers = this.players.filter(p => !p.eliminated);
        
        if (activePlayers.length <= 1) {
            const winner = activePlayers[0] ? activePlayers[0].name : "Nobody";
            if (this.mode === 'online') {
                online.broadcast({ type: 'WIN', winner: winner });
            }
            this.win(winner);
        } else {
            if (this.mode === 'online' && online.isHost) {
                online.broadcast({ type: 'ELIMINATE', index: this.turnIndex });
            }
            this.nextTurn();
        }
    },

    win(name) {
        clearInterval(this.timer);
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
    }
};

// --- 5. NETWORK SYNCHRONIZATION ---
const online = {
    peer: null, connections: [], myName: "", isHost: false,
    
    createRoom() {
        this.myName = document.getElementById('player-nickname').value || "Host";
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(code);
        this.isHost = true;
        
        this.peer.on('open', id => {
            document.getElementById('room-code-display').innerText = id;
            document.getElementById('start-online-btn').style.display = "block";
            game.players = [{ name: this.myName, id: id, eliminated: false }];
            ui.updateLobby();
        });
        this.peer.on('connection', c => { 
            this.connections.push(c); 
            this.setupConnection(c); 
        });
    },

    joinRoom() {
        const code = document.getElementById('join-id').value;
        this.myName = document.getElementById('player-nickname').value || "Guest";
        this.peer = new Peer();
        this.peer.on('open', id => {
            const conn = this.peer.connect(code);
            this.setupConnection(conn);
        });
    },

    setupConnection(c) {
        c.on('open', () => {
            if (!this.isHost) {
                this.activeConn = c;
                c.send({ type: 'JOIN', name: this.myName, id: this.peer.id });
            }
        });

        c.on('data', data => {
            switch(data.type) {
                case 'JOIN':
                    if (this.isHost) {
                        game.players.push({ name: data.name, id: data.id, eliminated: false });
                        this.broadcast({ type: 'LOBBY', list: game.players });
                        ui.updateLobby();
                    }
                    break;
                case 'LOBBY':
                    game.players = data.list;
                    ui.updateLobby();
                    break;
                case 'START':
                    game.mode = 'online';
                    game.init();
                    break;
                case 'MOVE':
                    game.processMove(data.user, data.move);
                    break;
                case 'TICK':
                    game.timeLeft = data.time;
                    game.updateUI();
                    break;
                case 'ELIMINATE':
                    game.players[data.index].eliminated = true;
                    ui.addLog(game.players[data.index].name, "OUT! 🟥", "eliminated");
                    break;
                case 'WIN':
                    game.win(data.winner);
                    break;
            }
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

// --- UI & SEARCH REMAINS SAME ---
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
        wrap.innerHTML = `<input type="text" class="field-input local-p-name" placeholder="Player ${num} Name">`;
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
        const names = game.players.map(p => p.name);
        document.getElementById('lobby-list').innerText = "In Lobby: " + names.join(", ");
    }
};

// Search Logic
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

inputField.addEventListener('input', (e) => {
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
    } else { suggBox.style.display = 'none'; }
});

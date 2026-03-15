// --- DATABASE INITIALIZATION ---
let database = { players: [] };

async function loadDatabase() {
    try {
        const response = await fetch('players.json');
        if (!response.ok) throw new Error("Could not find players.json");
        const data = await response.json();
        database.players = data;
        console.log("Database Loaded: " + database.players.length + " entries.");
    } catch (err) {
        console.error("Database error:", err);
        // Fallback for testing
        database.players = [{ name: "Cristiano Ronaldo", clubs: ["Real Madrid", "Juventus", "Al Nassr"] }];
    }
}
loadDatabase();

const game = {
    mode: 'local', 
    target: "Cristiano Ronaldo", 
    used: [], 
    lockLimit: 5, 
    players: [],
    turnIndex: 0, 
    timer: null, 
    timeLeft: 20,
    isEliminated: false, 

    updateUI() {
        const name = this.players[this.turnIndex] || "?";
        const t = this.timeLeft;
        const pct = (t / 20) * 100;
        const nEl = document.querySelector('.turn-name');
        const tEl = document.getElementById('timer');
        const bEl = document.getElementById('timer-bar');
        const inputField = document.getElementById('user-input');
        const inputArea = document.querySelector('.input-section');

        if (nEl) nEl.innerText = name.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
        
        // TURN & SPECTATOR LOCKING
        if (this.mode === 'online') {
            const isMyTurn = (name === online.myName);
            if (!isMyTurn || this.isEliminated) {
                inputField.disabled = true;
                if (inputArea) {
                    inputArea.style.opacity = "0.5";
                    inputArea.style.pointerEvents = "none";
                }
            } else {
                inputField.disabled = false;
                if (inputArea) {
                    inputArea.style.opacity = "1";
                    inputArea.style.pointerEvents = "all";
                }
            }
        }

        if (bEl) {
            bEl.style.width = pct + "%";
            t <= 6 ? bEl.classList.add('urgent') : bEl.classList.remove('urgent');
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
                // Rule: Only host or current player triggers the out signal
                if (this.mode !== 'online' || online.isHost || online.myName === this.players[this.turnIndex]) {
                    this.eliminate();
                }
            }
        }, 1000);
    },

    init() {
        this.used = [this.simplify(this.target)];
        this.isEliminated = false;
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.updateUI();
        this.startTimer();
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    handleInput() {
        const input = document.getElementById('user-input');
        const val = input.value.trim();
        if (!val) return;
        this.submitMove(val);  
        input.value = "";
    },

    submitMove(val) {
        if (this.mode === 'online' && this.players[this.turnIndex] !== online.myName) return;
        if (this.isEliminated) return;

        const cleanVal = this.simplify(val);
        if (this.used.includes(cleanVal)) return alert("Already used!");
        
        let linked = false;
        const targetClean = this.simplify(this.target);
        
        // Check database
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
            this.eliminate();
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

    aiThink() {
        const targetClean = this.simplify(this.target);
        let pool = [];
        const playerMatch = database.players.find(p => this.simplify(p.name) === targetClean);
        if (playerMatch) {
            playerMatch.clubs.forEach(club => {
                if (!this.used.includes(this.simplify(club))) pool.push(club);
            });
        }
        database.players.forEach(p => {
            if (p.clubs.some(c => this.simplify(c) === targetClean)) {
                if (!this.used.includes(this.simplify(p.name))) pool.push(p.name);
            }
        });
        if (pool.length > 0) {
            this.submitMove(pool[Math.floor(Math.random() * pool.length)]); 
        } else {
            this.eliminate();
        }
    },

    addToUsed(name) {
        const cleanName = this.simplify(name);
        this.used.push(cleanName);
        if (this.used.length > this.lockLimit) this.used.shift(); 
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        if (this.mode === 'online') {
            online.sendData({ type: 'ELIMINATE', user: loser });
        } else {
            this.processElimination(loser);
        }
    },

    processElimination(user) {
        ui.addLog(user, "OUT! 🟥", "eliminated");
        
        // Spectator mode: If it's you, stay in the room but stop playing
        if (this.mode === 'online' && user === online.myName) {
            this.isEliminated = true;
        }

        this.players.splice(this.players.indexOf(user), 1);

        // Check if game is over
        if (this.players.length <= 1) {
            const winner = this.players[0] || "Nobody";
            if (this.mode === 'online' && online.isHost) {
                online.sendData({ type: 'WIN', winner: winner });
            } else if (this.mode !== 'online') {
                this.win(winner);
            }
        } else {
            if (this.turnIndex >= this.players.length) this.turnIndex = 0;
            this.startTimer();
        }
    },

    win(name) {
        clearInterval(this.timer);
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
    }
};

// --- ONLINE MANAGER ---
const online = {
    peer: null, connections: [], activeConn: null, myName: "", isHost: false,

    createRoom() {
        this.myName = document.getElementById('player-nickname').value || "Host";
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(code);
        this.isHost = true;
        game.players = [this.myName];
        this.peer.on('open', id => {
            document.getElementById('room-code-display').innerText = id;
            const startBtn = document.getElementById('start-online-btn');
            if (startBtn) startBtn.style.display = "block";
            ui.updateLobby();
        });
        this.peer.on('connection', c => { this.connections.push(c); this.setup(c); });
    },

    joinRoom() {
        const code = document.getElementById('join-id').value;
        this.myName = document.getElementById('player-nickname').value || "Guest";
        this.peer = new Peer();
        this.peer.on('open', () => { 
            const c = this.peer.connect(code);
            this.activeConn = c;
            this.setup(c); 
        });
    },

    setup(c) {
        c.on('open', () => { if (!this.isHost) c.send({ type: 'JOIN', name: this.myName }); });
        c.on('data', data => {
            if (data.type === 'JOIN' && this.isHost) {
                game.players.push(data.name);
                this.broadcast({ type: 'LOBBY', list: game.players });
                ui.updateLobby();
            }
            if (data.type === 'LOBBY') { game.players = data.list; ui.updateLobby(); }
            if (data.type === 'START') { game.mode = 'online'; game.init(); }
            if (data.type === 'MOVE') { 
                if (this.isHost) this.broadcast(data); 
                game.processMove(data.user, data.move); 
            }
            if (data.type === 'ELIMINATE') { 
                if (this.isHost) this.broadcast(data); 
                game.processElimination(data.user); 
            }
            if (data.type === 'WIN') { game.win(data.winner); }
        });
    },

    broadcast(d) { this.connections.forEach(c => { if (c.open) c.send(d); }); },

    sendData(d) { 
        if (this.isHost) {
            this.broadcast(d); 
            if (d.type === 'MOVE') game.processMove(d.user, d.move);
            if (d.type === 'ELIMINATE') game.processElimination(d.user);
            if (d.type === 'WIN') game.win(d.winner);
        } else if (this.activeConn) {
            this.activeConn.send(d); 
        } 
    },

    broadcastStart() { 
        if (!this.isHost) return;
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
    addLog(user, msg, type = "player") {
        const feed = document.getElementById('game-feed');
        if (!feed) return;
        const div = document.createElement('div');
        div.className = 'log-entry ' + type;
        const color = type==='ai'?'#4cc9f0':type==='system'?'#2ecc71':type==='eliminated'?'#e63946':'#e8f5ee';
        div.innerHTML = `<span class="log-user" style="color:${color}">${user}</span>: ${msg}`;
        feed.appendChild(div);
        feed.scrollTo({ top: feed.scrollHeight });
    },
    updateLobby() { 
        const lb = document.getElementById('lobby-list');
        if (lb) lb.innerText = "Players: " + game.players.join(", "); 
    }
};

// --- SEARCH & INPUT LOGIC ---
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

if (inputField) {
    inputField.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (!suggBox) return;
        suggBox.innerHTML = '';
        if (val.length < 1) { suggBox.style.display = 'none'; return; }
        
        const cleanSearch = val.replace(/\s+/g, "");
        const matches = [];
        for (let i = 0; i < database.players.length; i++) {
            const p = database.players[i];
            if (p.name.toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(p.name);
            for (let j = 0; j < p.clubs.length; j++) {
                if (p.clubs[j].toLowerCase().replace(/\s+/g, "").includes(cleanSearch)) matches.push(p.clubs[j]);
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

    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') game.handleInput();
    });
}

// --- BUTTON ATTACHMENTS ---
document.getElementById('create-room-btn')?.addEventListener('click', () => online.createRoom());
document.getElementById('join-room-btn')?.addEventListener('click', () => online.joinRoom());
document.getElementById('start-online-btn')?.addEventListener('click', () => online.broadcastStart());

// For Local/AI modes
document.getElementById('start-ai-btn')?.addEventListener('click', () => {
    const nick = document.getElementById('player-nickname').value || "You";
    game.players = [nick, "AI Bot"];
    game.mode = 'ai';
    game.init();
});

document.getElementById('start-local-btn')?.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.local-p-name');
    game.players = Array.from(inputs).map(i => i.value.trim()).filter(v => v !== "");
    if (game.players.length < 2) return alert("Enter at least 2 names!");
    game.mode = 'local';
    game.init();
});

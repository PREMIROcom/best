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
        const inputArea = document.querySelector('.input-section');

        if (nEl) nEl.innerText = name.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
        
        // FIX: Turn Lock & Spectator UI Logic
        if (this.mode === 'online') {
            const isMyTurn = (name === online.myName);
            if (!isMyTurn || this.isEliminated) {
                inputArea.style.opacity = "0.5";
                inputArea.style.pointerEvents = "none";
            } else {
                inputArea.style.opacity = "1";
                inputArea.style.pointerEvents = "all";
            }
        }

        if (bEl) {
            bEl.style.width = pct + "%";
            if (t <= 6) bEl.classList.add('urgent');
            else bEl.classList.remove('urgent');
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
                if (this.mode !== 'online' || online.myName === this.players[this.turnIndex]) {
                    this.eliminate();
                }
            }
        }, 1000);
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
        // FIX: Prevent moves if it's not your turn or you are out
        if (this.mode === 'online' && this.players[this.turnIndex] !== online.myName) return;
        if (this.isEliminated) return;

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
        let possibleChoices = [];
        
        // 1. Check all clubs for target player
        const playerMatch = database.players.find(p => this.simplify(p.name) === targetClean);
        if (playerMatch) {
            playerMatch.clubs.forEach(club => {
                if (!this.used.includes(this.simplify(club))) possibleChoices.push(club);
            });
        }
        
        // 2. Check all players for target club
        database.players.forEach(p => {
            if (p.clubs.some(c => this.simplify(c) === targetClean)) {
                if (!this.used.includes(this.simplify(p.name))) possibleChoices.push(p.name);
            }
        });

        // FIX: Pick a random option from the pool
        if (possibleChoices.length > 0) {
            const randomIdx = Math.floor(Math.random() * possibleChoices.length);
            this.submitMove(possibleChoices[randomIdx]); 
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
        const playerOut = this.players[this.turnIndex];
        if (this.mode === 'online') {
            online.sendData({ type: 'ELIMINATE', user: playerOut });
        } else {
            this.processElimination(playerOut);
        }
    },

    processElimination(user) {
        ui.addLog(user, "Eliminated! 🟥", "eliminated");
        
        // FIX: Spectator status check
        if (this.mode === 'online' && user === online.myName) {
            this.isEliminated = true;
            alert("You are out! You can now spectate.");
        }

        this.players.splice(this.players.indexOf(user), 1);

        // FIX: Final win check (if 1 player remains, game over)
        if (this.players.length <= 1) {
            this.win(this.players[0] || "Nobody");
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
    peer: null, connections: [], activeConn: null, myName: "", isHost: false,

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
        });
    },

    broadcast(d) { this.connections.forEach(c => { if (c.open) c.send(d); }); },

    sendData(d) { 
        if (this.isHost) {
            this.broadcast(d); 
            if (d.type === 'MOVE') game.processMove(d.user, d.move);
            if (d.type === 'ELIMINATE') game.processElimination(d.user);
        } else if (this.activeConn) {
            this.activeConn.send(d); 
        } 
    },

    broadcastStart() { this.broadcast({ type: 'START' }); game.mode = 'online'; game.init(); }
};

// --- UI HELPERS ---
const ui = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
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
    updateLobby() { document.getElementById('lobby-list').innerText = "In Lobby: " + game.players.join(", "); }
};

// --- INPUT & SEARCH ---
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

inputField.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
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
            div.onclick = () => { inputField.value = match; suggBox.style.display = 'none'; game.handleInput(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    } else { suggBox.style.display = 'none'; }
});

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.getElementById('screen-game').classList.contains('active')) {
        game.handleInput();
    }
});

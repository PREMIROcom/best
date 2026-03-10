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
        const name = this.players[this.turnIndex] || "?";
        const t = this.timeLeft;
        const pct = (t / 20) * 100;
        const nEl = document.querySelector('.turn-name');
        const tEl = document.getElementById('timer');
        const bEl = document.getElementById('timer-bar');

        if (nEl) nEl.innerText = name.toUpperCase();
        if (tEl) tEl.textContent = `0:${t.toString().padStart(2, '0')}`;
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
                this.eliminate();
            }
        }, 1000);
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    submitMove(val) {
        // Prevent moves if it's not your turn in online mode
        if (this.mode === 'online' && this.players[this.turnIndex] !== online.myName) {
            return console.warn("Not your turn!");
        }

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
                // FIXED: Send to peer AND update local state
                online.sendData({ type: 'MOVE', move: val, user: online.myName });
                this.processMove(online.myName, val);
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
        
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") {
            setTimeout(() => this.aiThink(), 1200);
        }
    },

    addToUsed(name) {
        const cleanName = this.simplify(name);
        this.used.push(cleanName);
        if (this.used.length > this.lockLimit) this.used.shift(); 
    },

    eliminate() {
        const eliminatedPlayer = this.players[this.turnIndex];
        ui.addLog("SYSTEM", `${eliminatedPlayer.toUpperCase()} eliminated! 🟥`, "eliminated");
        
        this.players.splice(this.turnIndex, 1);
        
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
    },

    handleInput() {
        const input = document.getElementById('user-input');
        const val = input.value.trim();
        if (!val) return;
        this.submitMove(val);  
        input.value = "";
    },

    init() {
        this.used = [this.simplify(this.target)];
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.updateUI();
        this.startTimer();
    }
};

// --- ONLINE / MULTIPLAYER LOGIC ---
const online = {
    peer: null, connections: [], myName: "", isHost: false, activeConn: null,

    createRoom() {
        this.myName = document.getElementById('player-nickname').value || "Host";
        const code = "FOOTY-" + Math.floor(1000 + Math.random() * 9000);
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
            if (!this.isHost) { 
                c.send({ type: 'JOIN', name: this.myName }); 
            } 
        });
        c.on('data', data => {
            if (data.type === 'JOIN' && this.isHost) {
                game.players.push(data.name);
                this.broadcast({ type: 'LOBBY', list: game.players });
                ui.updateLobby();
            }
            if (data.type === 'LOBBY') { 
                game.players = data.list; 
                ui.updateLobby(); 
            }
            if (data.type === 'START') { 
                game.mode = 'online'; 
                game.init(); 
            }
            if (data.type === 'MOVE') {
                // FIXED: Receive the move from the other player
                game.processMove(data.user, data.move);
            }
        });
    },

    broadcast(d) { this.connections.forEach(c => c.send(d)); },
    sendData(d) { 
        if (this.isHost) this.broadcast(d); 
        else if (this.activeConn) this.activeConn.send(d); 
    },
    broadcastStart() { 
        this.broadcast({ type: 'START' }); 
        game.mode = 'online'; 
        game.init(); 
    }
};

// --- UI HELPERS & SEARCH ---
const ui = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id);
        if(target) target.classList.add('active');
    },
    addLog(user, msg, type = "player") {
        const feed = document.getElementById('game-feed');
        if(!feed) return;
        const div = document.createElement('div');
        div.className = 'log-entry ' + type;
        const color = type === 'ai' ? '#4cc9f0' : type === 'system' ? '#2ecc71' : type === 'eliminated' ? '#e63946' : '#e8f5ee';
        div.innerHTML = `<span class="log-user" style="color:${color}">${user}:</span> <span class="log-msg">${msg}</span>`;
        feed.appendChild(div);
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    },
    updateLobby() {
        const el = document.getElementById('lobby-list');
        if(el) el.innerText = "In Lobby: " + game.players.join(", ");
    }
};

// Input search logic remains the same as your provided update
const inputField = document.getElementById('user-input');
const suggBox = document.getElementById('custom-suggestions');

if (inputField) {
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
        } else {
            suggBox.style.display = 'none';
        }
    });
}

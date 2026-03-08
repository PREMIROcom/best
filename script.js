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

    handleInput() {
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
                // Send move to server/host
                online.sendData({ type: 'MOVE', move: val, user: online.myName });
                // Process locally so YOU see it immediately
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
        this.used.push(this.simplify(move));
        if (this.used.length > this.lockLimit) this.used.shift(); 
        
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.startTimer(); // This restarts the timer for everyone
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") setTimeout(() => this.aiThink(), 1200);
    },

    init() {
        this.used = [this.simplify(this.target)];
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.updateUI();
        this.startTimer();
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        ui.addLog(loser, "Eliminated! 🟥", "eliminated");
        this.players.splice(this.turnIndex, 1);
        if (this.players.length <= 1) {
            this.win(this.players[0] || "Nobody");
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
            if (data.type === 'JOIN' && this.isHost) {
                game.players.push(data.name);
                this.broadcast({ type: 'LOBBY', list: game.players });
                ui.updateLobby();
            }
            if (data.type === 'LOBBY') { game.players = data.list; ui.updateLobby(); }
            if (data.type === 'START') { game.mode = 'online'; game.init(); }
            
            if (data.type === 'MOVE') {
                // 1. If I'm the Host, I must tell EVERYONE else about this move
                if (this.isHost) {
                    this.broadcast(data); 
                }
                // 2. Only show the move if it's not from me (to prevent double messages)
                if (data.user !== this.myName) {
                    game.processMove(data.user, data.move);
                }
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
    updateLobby() {
        document.getElementById('lobby-list').innerText = "In Lobby: " + game.players.join(", ");
    }
};

// --- INPUT & SEARCH OPTIMIZATION ---
inputField.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    suggBox.innerHTML = '';
    
    if (val.length < 1) { 
        suggBox.style.display = 'none'; 
        return; 
    }

    const cleanSearch = val.replace(/\s+/g, ""); 
    const matches = [];

    for (let i = 0; i < database.players.length; i++) {
        const p = database.players[i];
        const cleanPlayer = p.name.toLowerCase().replace(/\s+/g, "");
        if (cleanPlayer.includes(cleanSearch)) matches.push(p.name);
        
        for (let j = 0; j < p.clubs.length; j++) {
            const cleanClub = p.clubs[j].toLowerCase().replace(/\s+/g, "");
            if (cleanClub.includes(cleanSearch)) matches.push(p.clubs[j]);
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

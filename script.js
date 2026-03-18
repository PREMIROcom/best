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
    players: [], // Format: { name: "string", id: "peerId/local", eliminated: false }
    turnIndex: 0, 
    timer: null, 
    timeLeft: 20,

    updateUI() {
        const activePlayer = this.players[this.turnIndex];
        const isMyTurn = this.checkIfMyTurn();
        
        // 2. TURN LOCKING: Disable input if not your turn
        const input = document.getElementById('user-input');
        if (input) {
            input.disabled = !isMyTurn;
            input.placeholder = isMyTurn ? "Your turn! Type..." : `Waiting for ${activePlayer?.name}...`;
        }

        const name = activePlayer?.name || "?";
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

    checkIfMyTurn() {
        if (this.mode === 'local') return true;
        if (this.mode === 'ai' && this.players[this.turnIndex].name === "AI Bot") return false;
        if (this.mode === 'online') return this.players[this.turnIndex].name === online.myName;
        return true;
    },

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timeLeft = 20;
        this.updateUI();
        
        // Only the Host (or Local/AI mode) runs the master timer logic to prevent de-sync
        if (this.mode === 'online' && !online.isHost) return;

        this.timer = setInterval(() => {
            this.timeLeft--;
            this.updateUI();
            if (this.mode === 'online') online.broadcast({ type: 'TICK', time: this.timeLeft });

            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                this.eliminate();
            }
        }, 1000);
    },

    // 1. RANDOMIZED AI: Scans full DB and picks a random valid answer
    aiThink() {
        const targetClean = this.simplify(this.target);
        let possibleMoves = [];

        // Look for clubs the target player played for
        const playerObj = database.players.find(p => this.simplify(p.name) === targetClean);
        if (playerObj) {
            playerObj.clubs.forEach(c => {
                if (!this.used.includes(this.simplify(c))) possibleMoves.push(c);
            });
        }

        // Look for players who played for the target club
        database.players.forEach(p => {
            if (p.clubs.some(c => this.simplify(c) === targetClean)) {
                if (!this.used.includes(this.simplify(p.name))) possibleMoves.push(p.name);
            }
        });

        if (possibleMoves.length > 0) {
            const randomChoice = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            setTimeout(() => this.submitMove(randomChoice), 1500);
        } else {
            this.eliminate();
        }
    },

    eliminate() {
        const loser = this.players[this.turnIndex];
        
        // 5. NETWORK SYNC: Broadcast elimination
        if (this.mode === 'online' && online.isHost) {
            online.broadcast({ type: 'ELIMINATE', index: this.turnIndex });
        }
        
        this.processElimination(this.turnIndex);
    },

    processElimination(index) {
        const loserName = this.players[index].name;
        ui.addLog("SYSTEM", `${loserName.toUpperCase()} is out! 🟥`, "eliminated");
        
        // 3. SPECTATOR MODE: Mark as eliminated instead of splicing out
        this.players[index].eliminated = true;

        // Check how many players remain active
        const activePlayers = this.players.filter(p => !p.eliminated);

        if (activePlayers.length <= 1) {
            // 4. GAME OVER SYNC: Everyone ends together
            this.win(activePlayers[0]?.name || "Nobody");
        } else {
            this.nextTurn();
        }
    },

    nextTurn() {
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
        } while (this.players[this.turnIndex].eliminated);
        
        this.startTimer();
        if (this.mode === 'ai' && this.players[this.turnIndex].name === "AI Bot") this.aiThink();
    },

    submitMove(val) {
        if (!this.checkIfMyTurn()) return;
        
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
            if (this.mode === 'online') online.sendData({ type: 'MOVE', move: val, user: online.myName });
            else this.processMove(this.players[this.turnIndex].name, val);
        } else {
            this.eliminate();
        }
    },

    processMove(user, move) {
        ui.addLog(user, move, user === "AI Bot" ? "ai" : "player");
        this.target = move;
        const cleanMove = this.simplify(move);
        this.used.push(cleanMove);
        if (this.used.length > this.lockLimit) this.used.shift(); 
        this.nextTurn();
    },

    win(name) {
        if (this.timer) clearInterval(this.timer);
        if (this.mode === 'online' && online.isHost) online.broadcast({ type: 'WIN', winner: name });
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    startLocal() {
        const inputs = document.querySelectorAll('.local-p-name');
        this.players = Array.from(inputs)
            .map(i => ({ name: i.value.trim(), eliminated: false }))
            .filter(p => p.name !== "");
        if (this.players.length < 2) return alert("Please enter at least 2 player names!");
        this.mode = 'local';
        this.init();
    },

    startAI() {
        const n = document.getElementById('player-nickname').value || "You";
        this.players = [{ name: n, eliminated: false }, { name: "AI Bot", eliminated: false }];
        this.mode = 'ai';
        this.init();
    },

    init() {
        this.used = [this.simplify(this.target)];
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.turnIndex = 0;
        this.startTimer();
    }
};

// --- ONLINE / MULTIPLAYER LOGIC ---
const online = {
    peer: null, connections: [], myName: "", isHost: false,
    createRoom() {
        this.myName = document.getElementById('player-nickname').value || "Host";
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(code);
        this.isHost = true;
        game.players = [{ name: this.myName, eliminated: false }];
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
        this.peer.on('open', () => { this.setup(this.peer.connect(code)); });
    },
    setup(c) {
        c.on('open', () => { if (!this.isHost) this.activeConn = c; c.send({ type: 'JOIN', name: this.myName }); });
        c.on('data', data => {
            if (data.type === 'JOIN' && this.isHost) {
                game.players.push({ name: data.name, eliminated: false });
                this.broadcast({ type: 'LOBBY', list: game.players });
                ui.updateLobby();
            }
            // 5. NETWORK SYNC: Handling incoming data
            switch(data.type) {
                case 'LOBBY': game.players = data.list; ui.updateLobby(); break;
                case 'START': game.mode = 'online'; game.init(); break;
                case 'MOVE': game.processMove(data.user, data.move); break;
                case 'TICK': game.timeLeft = data.time; game.updateUI(); break;
                case 'ELIMINATE': game.processElimination(data.index); break;
                case 'WIN': game.win(data.winner); break;
            }
        });
    },
    broadcast(d) { this.connections.forEach(c => c.send(d)); },
    sendData(d) { if (this.isHost) this.broadcast(d); else this.activeConn.send(d); },
    broadcastStart() { this.broadcast({ type: 'START' }); game.mode = 'online'; game.init(); }
};

// UI and Input listeners stay the same as your previous code...
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
        document.getElementById('lobby-list').innerText = "In Lobby: " + game.players.map(p => p.name).join(", ");
    }
};

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
            div.onclick = () => { inputField.value = match; suggBox.style.display = 'none'; game.handleInput(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    } else { suggBox.style.display = 'none'; }
});

game.handleInput = function() {
    const val = inputField.value.trim();
    if (!val) return;
    this.submitMove(val);
    inputField.value = "";
    suggBox.style.display = 'none';
};

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.getElementById('screen-game').classList.contains('active')) {
        game.handleInput();
    }
});

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
    players: [],       // Active (still-in) players
    spectators: [],    // Eliminated players watching
    turnIndex: 0,
    timer: null,
    timeLeft: 20,

    // ─── TURN LOCKING ─────────────────────────────────────────────────────────
    // Returns true if the current human (online: myName, local: turnIndex) can type
    isMyTurn() {
        if (this.mode === 'online') {
            return this.players[this.turnIndex] === online.myName;
        }
        return true; // local / AI: always allow (AI is handled separately)
    },

    lockInput(locked) {
        const input = document.getElementById('user-input');
        const submitBtn = document.querySelector('.submit-btn-row .btn:last-child');
        const oneClubBtn = document.getElementById('one-club-btn');
        if (input)      input.disabled      = locked;
        if (submitBtn)  submitBtn.disabled  = locked;
        if (oneClubBtn) oneClubBtn.disabled = locked;
        if (input) {
            input.placeholder = locked ? "Waiting for opponent…" : "Type a player or club…";
            input.style.opacity = locked ? '0.45' : '1';
        }
    },

    // ─── UI UPDATE ────────────────────────────────────────────────────────────
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
            else        bEl.classList.remove('urgent');
        }

        // Lock input when it's not this player's turn (online) or when AI is thinking
        if (this.mode === 'online') {
            this.lockInput(!this.isMyTurn());
        } else if (this.mode === 'ai') {
            this.lockInput(this.players[this.turnIndex] === "AI Bot");
        } else {
            this.lockInput(false);
        }
    },

    // ─── TIMER ────────────────────────────────────────────────────────────────
    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timeLeft = 20;
        this.updateUI();
        this.timer = setInterval(() => {
            this.timeLeft--;
            this.updateUI();
            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                const loser = this.players[this.turnIndex];
                ui.addLog("SYSTEM", `${loser.toUpperCase()} was too slow! 🟥`, "eliminated");

                // Only host drives timeout eliminations to avoid all clients firing at once
                if (this.mode === 'online' && !online.isHost) return;
                if (this.mode === 'online') {
                    online.broadcast({ type: 'ELIMINATE', player: loser });
                    // Host also applies it to itself via the same path
                    const idx = game.players.indexOf(loser);
                    if (idx !== -1) {
                        game.spectators.push(loser);
                        game.players.splice(idx, 1);
                        ui.updateSpectatorBar(game.spectators);
                        if (game.players.length <= 1) {
                            const winner = game.players[0] || "Nobody";
                            online.broadcast({ type: 'WIN', winner });
                            game.win(winner);
                        } else {
                            if (game.turnIndex >= game.players.length) game.turnIndex = 0;
                            game.startTimer();
                        }
                    }
                    return;
                }
                this.eliminate();
            }
        }, 1000);
    },

    // ─── ONE-CLUB PLAYER ──────────────────────────────────────────────────────
    handleOneClub() {
        if (!this.isMyTurn() && this.mode === 'online') return;
        const targetClean = this.simplify(this.target);
        const pMatch = database.players.find(p => this.simplify(p.name) === targetClean);

        if (pMatch && pMatch.clubs.length === 1) {
            const onlyClub = pMatch.clubs[0];
            if (this.mode === 'online') {
                // Send to host — everyone processes when MOVE_CONFIRM comes back
                online.sendData({ type: 'MOVE', move: onlyClub, user: online.myName, oneClub: true });
            } else {
                ui.addLog(this.players[this.turnIndex], `LOYALTY! -> ${onlyClub.toUpperCase()}`, "system");
                this.target = onlyClub;
                this.addToUsed(onlyClub);
                this.turnIndex = (this.turnIndex + 1) % this.players.length;
                this.startTimer();
                if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") {
                    setTimeout(() => this.aiThink(), 1200);
                }
            }
        } else {
            const loser = this.players[this.turnIndex];
            ui.addLog("SYSTEM", `${loser.toUpperCase()} fake loyalty! 🟥`, "eliminated");
            if (this.mode === 'online') {
                online.sendData({ type: 'ELIMINATE', player: loser });
            } else {
                this.eliminate();
            }
        }
    },

    // ─── START HELPERS ────────────────────────────────────────────────────────
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
        this.spectators = [];
        this.used = [this.simplify(this.target)];
        ui.showScreen('screen-game');
        ui.addLog("SYSTEM", "Chain starts with: " + this.target, "system");
        this.updateUI();
        this.startTimer();
    },

    simplify: (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""),

    // ─── INPUT HANDLING ───────────────────────────────────────────────────────
    handleInput() {
        if (!this.isMyTurn() && this.mode === 'online') return;
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
                // Send to host for validation & relay — do NOT process locally yet.
                // Everyone (including sender) will process when the broadcast comes back.
                online.sendData({ type: 'MOVE', move: val, user: online.myName });
            } else {
                this.processMove(this.players[this.turnIndex], val);
            }
        } else {
            const loser = this.players[this.turnIndex];
            ui.addLog("SYSTEM", `❌ Invalid link! ${loser.toUpperCase()} is eliminated! 🟥`, "eliminated");
            if (this.mode === 'online') {
                // Send to host — everyone (including sender) will process via broadcast
                online.sendData({ type: 'ELIMINATE', player: loser });
            } else {
                this.eliminate();
            }
        }
    },

    addToUsed(name) {
        const cleanName = this.simplify(name);
        this.used.push(cleanName);
        if (this.used.length > this.lockLimit) this.used.shift();
    },

    // applyConfirmedMove: single code path used by ALL clients (including host) for online moves
    // The host stamps nextTurn so every screen uses the identical value — no drift possible.
    applyConfirmedMove(data) {
        const label = data.oneClub ? `LOYALTY! -> ${data.move.toUpperCase()}` : data.move;
        ui.addLog(data.user, label, "player");
        this.target = data.move;
        this.addToUsed(data.move);
        this.turnIndex = data.nextTurn;   // use host's canonical value, never self-compute
        this.startTimer();
    },

    processMove(user, move, isOneClub = false) {
        const label = isOneClub ? `LOYALTY! -> ${move.toUpperCase()}` : move;
        ui.addLog(user, label, user === "AI Bot" ? "ai" : "player");
        this.target = move;
        this.addToUsed(move);
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.startTimer();
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") {
            setTimeout(() => this.aiThink(), 1200);
        }
    },

    // ─── RANDOMIZED AI ────────────────────────────────────────────────────────
    // Collects ALL valid answers, shuffles them, and picks one at random
    aiThink() {
        const targetClean = this.simplify(this.target);
        const candidates = [];

        // Find the current target as a player → collect unused clubs
        const asPlayer = database.players.find(p => this.simplify(p.name) === targetClean);
        if (asPlayer) {
            asPlayer.clubs
                .filter(c => !this.used.includes(this.simplify(c)))
                .forEach(c => candidates.push(c));
        }

        // Find the current target as a club → collect players who played there
        database.players.forEach(p => {
            if (
                p.clubs.some(c => this.simplify(c) === targetClean) &&
                !this.used.includes(this.simplify(p.name))
            ) {
                candidates.push(p.name);
            }
        });

        if (candidates.length === 0) {
            this.eliminate();
            return;
        }

        // Shuffle and pick a random valid answer
        const shuffled = candidates.sort(() => Math.random() - 0.5);
        const choice = shuffled[0];
        this.submitMove(choice);
    },

    // ─── ELIMINATION + SPECTATOR MODE ─────────────────────────────────────────
    eliminate() {
        if (this.timer) clearInterval(this.timer);
        const loserName = this.players[this.turnIndex];

        // Move eliminated player to spectators (Spectator Mode)
        this.spectators.push(loserName);
        this.players.splice(this.turnIndex, 1);

        ui.updateSpectatorBar(this.spectators);

        // ── Game Over Sync: 1 player left = everyone sees the win screen ──
        if (this.players.length <= 1) {
            const winner = this.players[0] || "Nobody";
            if (this.mode === 'online') {
                online.broadcast({ type: 'WIN', winner });
            }
            this.win(winner);
            return;
        }

        if (this.turnIndex >= this.players.length) this.turnIndex = 0;
        this.startTimer();
        if (this.mode === 'ai' && this.players[this.turnIndex] === "AI Bot") {
            setTimeout(() => this.aiThink(), 1000);
        }
    },

    win(name) {
        clearInterval(this.timer);
        this.lockInput(true);
        document.getElementById('winner-name').innerText = name.toUpperCase() + " WINS!";
        document.getElementById('victory-screen').style.display = 'flex';
    }
};

// --- ONLINE / MULTIPLAYER LOGIC ---
const online = {
    peer: null,
    connections: [],
    myName: "",
    isHost: false,
    activeConn: null,

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
        this.peer.on('open', () => { this.setup(this.peer.connect(code)); });
    },

    setup(c) {
        c.on('open', () => {
            if (!this.isHost) {
                this.activeConn = c;
                c.send({ type: 'JOIN', name: this.myName });
            }
        });

        c.on('data', data => {
            // ── Lobby ──
            if (data.type === 'JOIN' && this.isHost) {
                game.players.push(data.name);
                this.broadcast({ type: 'LOBBY', list: game.players });
                ui.updateLobby();
            }
            if (data.type === 'LOBBY') {
                game.players = data.list;
                ui.updateLobby();
            }

            // ── Game Start ──
            if (data.type === 'START') {
                game.mode = 'online';
                game.init();
            }

            // ── Move: host confirms, broadcasts MOVE_CONFIRM to all peers, then applies locally ──
            if (data.type === 'MOVE') {
                if (this.isHost) {
                    const nextTurn = (game.turnIndex + 1) % game.players.length;
                    const confirm = {
                        type: 'MOVE_CONFIRM',
                        move: data.move,
                        user: data.user,
                        oneClub: data.oneClub || false,
                        nextTurn
                    };
                    this.broadcast(confirm);          // send to all non-host peers
                    game.applyConfirmedMove(confirm); // host applies to its own screen
                }
            }

            // ── MOVE_CONFIRM: non-host clients receive and apply ──
            if (data.type === 'MOVE_CONFIRM') {
                game.applyConfirmedMove(data);
            }

            // ── Eliminate: host fans out to peers then applies; clients apply directly ──
            if (data.type === 'ELIMINATE') {
                if (this.isHost) {
                    this.broadcast(data);
                    this._applyEliminate(data);
                } else {
                    this._applyEliminate(data);
                }
            }

            // ── Win ──
            if (data.type === 'WIN') {
                game.win(data.winner);
            }
        });
    },

    broadcast(d) { this.connections.forEach(c => { try { c.send(d); } catch(e) {} }); },
    // sendData: non-hosts send to host. Host feeds the message through its own handler
    // so MOVE→MOVE_CONFIRM logic runs exactly once for everyone including the host.
    sendData(d) {
        if (this.isHost) {
            // Simulate receiving our own message so it goes through the confirm pipeline
            this._handleData(d);
        } else if (this.activeConn) {
            this.activeConn.send(d);
        }
    },
    _handleData(data) {
        // Minimal re-entrant handler for host's own submissions
        if (data.type === 'MOVE') {
            const nextTurn = (game.turnIndex + 1) % game.players.length;
            const confirm = {
                type: 'MOVE_CONFIRM',
                move: data.move,
                user: data.user,
                oneClub: data.oneClub || false,
                nextTurn
            };
            this.broadcast(confirm);
            game.applyConfirmedMove(confirm);
        } else if (data.type === 'ELIMINATE') {
            this.broadcast(data);
            this._applyEliminate(data);
        }
    },
    _applyEliminate(data) {
        const idx = game.players.indexOf(data.player);
        if (idx !== -1) {
            game.spectators.push(data.player);
            game.players.splice(idx, 1);
            ui.addLog("SYSTEM", `${data.player.toUpperCase()} eliminated! 🟥`, "eliminated");
            ui.updateSpectatorBar(game.spectators);
            if (game.players.length <= 1) {
                const winner = game.players[0] || "Nobody";
                this.broadcast({ type: 'WIN', winner });
                game.win(winner);
            } else {
                if (game.turnIndex >= game.players.length) game.turnIndex = 0;
                game.startTimer();
            }
        }
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

    addLocalPlayerField() {
        const num = document.querySelectorAll('.local-p-name').length + 1;
        const wrap = document.createElement('div');
        wrap.className = 'player-field-wrap';
        wrap.setAttribute('data-num', 'P' + num);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-input local-p-name';
        input.placeholder = 'Player ' + num + ' Name';
        wrap.appendChild(input);
        document.getElementById('local-player-list').appendChild(wrap);
    },

    addLog(user, msg, type = "player") {
        const feed = document.getElementById('game-feed');
        const div = document.createElement('div');
        div.className = 'log-entry ' + type;
        const color = type === 'ai' ? '#4cc9f0'
                    : type === 'system' ? '#2ecc71'
                    : type === 'eliminated' ? '#e63946'
                    : '#e8f5ee';
        div.innerHTML = `<span class="log-user" style="color:${color}">${user}</span><span class="log-msg">${msg}</span>`;
        feed.appendChild(div);
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    },

    updateLobby() {
        document.getElementById('lobby-list').innerText = "In Lobby: " + game.players.join(", ");
    },

    // ── Spectator Mode: shows a small strip of who's watching ──
    updateSpectatorBar(spectators) {
        let bar = document.getElementById('spectator-bar');
        if (!spectators || spectators.length === 0) {
            if (bar) bar.style.display = 'none';
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'spectator-bar';
            bar.style.cssText = `
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 0.72rem;
                letter-spacing: 0.18em;
                text-transform: uppercase;
                color: #7aab8a;
                background: rgba(230,57,70,0.08);
                border: 1px solid rgba(230,57,70,0.2);
                border-radius: 8px;
                padding: 6px 12px;
                margin-bottom: 8px;
                text-align: center;
            `;
            const gameScreen = document.getElementById('screen-game');
            const feed = document.getElementById('game-feed');
            gameScreen.insertBefore(bar, feed);
        }
        bar.style.display = 'block';
        bar.innerText = `👀 Spectating: ${spectators.join(", ")}`;
    }
};

// --- INPUT & SEARCH OPTIMIZATION ---
const inputField = document.getElementById('user-input');
const suggBox    = document.getElementById('custom-suggestions');

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

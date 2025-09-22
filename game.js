// === game.js ===

// Utility
function byId(id) { return document.getElementById(id); }

let socket;
let typeInterval = null;
let currentIndex = 0;
let fullText = '';
let typingPaused = false;

let soundEnabled = true;
let correctSound, incorrectSound;
let hostId = null;

// Winners screen control
let winnersCorrectSound = null;
let winnersShown = false;

window.addEventListener('DOMContentLoaded', () => {
  const settingsModal   = byId('settings-modal');
  const settingsButton  = byId('settings-button');
  const lobbyJoinButton = byId('lobby-join-button');
  const nameInput       = byId('lobby-name-input');

  settingsButton.onclick = () => (settingsModal.style.display = 'flex');
  byId('settings-cancel').onclick = () => (settingsModal.style.display = 'none');
  byId('settings-exit').onclick   = () => (settingsModal.style.display = 'none');
  byId('settings-save').onclick   = () => {
    const slider = byId('round-slider');
    if (socket && slider) {
      socket.emit('updateSettings', { roundsSelected: parseInt(slider.value, 10) });
    }
    settingsModal.style.display = 'none';
  };

  const slider = byId('round-slider');
  const sliderValue = byId('round-slider-value');
  if (slider && sliderValue) slider.oninput = () => (sliderValue.textContent = slider.value);

  lobbyJoinButton.onclick = () => {
    const name = (nameInput.value || '').trim() || 'Player ' + Math.floor(Math.random() * 1000);
    initSocketAndGame(name);
    lobbyJoinButton.disabled = true;
    nameInput.disabled = true;
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lobbyJoinButton.click(); });

  const lobbyScreen = byId('lobby-screen');
  const gameScreen  = byId('game-screen');
  if (lobbyScreen) lobbyScreen.style.display = 'block';
  if (gameScreen)  gameScreen.style.display  = 'none';
});

function initSocketAndGame(playerName) {
  socket = io();
  socket.emit('join', playerName);

  correctSound = new Audio('correct.mp3');
  incorrectSound = new Audio('incorrect.mp3');
  correctSound.load();
  incorrectSound.load();
  applySoundSetting();

  socket.on('playSound', (which) => {
    if (!soundEnabled) return;
    if (which === 'correct')  correctSound.play().catch(() => {});
    if (which === 'incorrect') incorrectSound.play().catch(() => {});
  });

  const lobbyScreen      = byId('lobby-screen');
  const gameScreen       = byId('game-screen');
  const winnersScreen    = byId('winners-screen');
  const lobbyPlayersDiv  = byId('lobby-players');
  const startGameButton  = byId('start-game-button');
  const boardDiv         = byId('board');
  const playersDiv       = byId('players');
  const turnDiv          = byId('turn');
  const roundCounter     = byId('round-counter');

  ensureModal();
  const modalAnswerInput = byId('modal-input');
  const modalSubmitBtn   = byId('modal-submit');
  const buzzBtn          = byId('buzz-btn');
  const timerText        = byId('timer-text');
  const timerBar         = byId('timer-bar');

  startGameButton.addEventListener('click', () => socket.emit('startGame'));
  buzzBtn.onclick = () => { if (!buzzBtn.disabled) socket.emit('buzzIn'); };
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== modalAnswerInput) {
      e.preventDefault();
      if (!buzzBtn.disabled) socket.emit('buzzIn');
    }
  });
  modalSubmitBtn.onclick = submitAnswer;
  modalAnswerInput.onkeydown = (e) => { if (e.key === 'Enter') submitAnswer(); };

  socket.on('gameState', (state) => {
    if (state.currentRound > state.roundsSelected) {
      if (!winnersShown) {
        winnersShown = true;
        showWinners(state.players);
      }
      return;
    } else winnersShown = false;

    hostId = state.hostId;

    if (lobbyPlayersDiv) {
      lobbyPlayersDiv.innerHTML =
        Object.values(state.players).map(p => escapeHtml(p.name)).join('<br>') || '(no players yet)';
    }

    if (startGameButton) startGameButton.disabled = Object.keys(state.players).length < 2;

    const slider = byId('round-slider');
    const sliderValue = byId('round-slider-value');
    if (slider && sliderValue) {
      slider.disabled = (state.hostId !== socket.id);
      slider.value = state.roundsSelected;
      sliderValue.textContent = slider.value;
    }

    if (roundCounter) {
      roundCounter.textContent = `Round ${state.currentRound} of ${state.roundsSelected}`;
    }

    if (state.gameStarted) {
      lobbyScreen.style.display   = 'none';
      if (winnersScreen) winnersScreen.style.display = 'none';
      gameScreen.style.display    = 'block';
      renderAll(state);
    } else {
      lobbyScreen.style.display   = 'block';
      gameScreen.style.display    = 'none';
      if (winnersScreen) winnersScreen.style.display = 'none';
    }
  });

  socket.on('showResultToast', (payload) => {
    const banner = byId('toast-banner');
    banner.className = '';
    if (payload.type === 'correct') {
      banner.classList.add('success');
      banner.textContent = `${payload.playerName} answered correctly! The answer was ${payload.correctAnswer}.`;
    } else if (payload.type === 'incorrect') {
      banner.classList.add('failure');
      banner.textContent = `${payload.playerName} answered incorrectly.`;
    } else if (payload.type === 'allWrong') {
      banner.classList.add('failure');
      let t = `No contestants answered correctly. The correct answer was: ${payload.correctAnswer}\n\nHere’s what everyone answered:\n`;
      (payload.answers || []).forEach(a => { t += `${a.name}: "${a.answer}"\n`; });
      banner.textContent = t;
    }
    banner.style.display = 'block';
    setTimeout(() => (banner.style.display = 'none'), 6000);
  });

  function renderAll(state) {
    renderPlayers(state.players);
    renderTurn(state);
    renderBoard(state);
    renderQuestionUI(state);
    renderTimer(state.timer);
  }
  function renderPlayers(players) {
    const list = Object.values(players).map(p => `
      <div class="player-entry">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-score">$${p.score}</span>
      </div>`).join('');
    playersDiv.innerHTML = `<h3>Players</h3>${list}`;
  }
  function renderTurn(state) {
    const { players, currentTurn } = state;
    if (!currentTurn || !players[currentTurn]) {
      turnDiv.innerHTML = `<h3>Waiting for players...</h3>`;
      return;
    }
    turnDiv.innerHTML = `<h3>Current Turn: ${escapeHtml(players[currentTurn].name)}</h3>`;
  }
  function renderBoard(state) {
    const { board, currentTurn, phase } = state;
    const categories = Object.keys(board || {});
    boardDiv.innerHTML = '';
    categories.forEach(cat => {
      const cell = document.createElement('div');
      cell.className = 'cell header-cell';
      cell.innerText = cat;
      boardDiv.appendChild(cell);
    });
    const values = [200, 400, 600, 800, 1000];
    values.forEach(val => {
      categories.forEach(cat => {
        const q = (board[cat] || {})[val];
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (!q) {
          cell.innerText = 'N/A';
          cell.classList.add('used-cell');
        } else if (q.used) {
          cell.innerText = '—';
          cell.classList.add('used-cell');
        } else {
          cell.innerText = '$' + (q.value ?? val);
          const isMyTurn = socket.id === currentTurn;
          const canPick = phase === 'idle' && isMyTurn;
          cell.style.opacity = canPick ? '1.0' : '0.5';
          if (canPick) cell.onclick = () => socket.emit('pickQuestion', { category: cat, value: val });
        }
        boardDiv.appendChild(cell);
      });
    });
  }
  function renderQuestionUI(state) {
    const { phase, currentQuestion, buzzedInPlayer, buzzedPlayers } = state;
    if (!currentQuestion) { hideModal(); stopTyping(); return; }
    showModal();
    const questionText = currentQuestion.question || '';
    if (questionText !== fullText) {
      fullText = questionText;
      currentIndex = 0;
      typingPaused = false;
      byId('modal-question').textContent = '';
      stopTyping();
      startTyping();
    }
    if (phase === 'answering') {
      pauseTyping();
    } else if (phase === 'questionOpen') {
      if (currentIndex < fullText.length && !typeInterval) {
        typingPaused = false;
        startTyping();
      }
    }
    const iAmBuzzed = buzzedInPlayer === socket.id;
    const alreadyBuzzed = buzzedPlayers && buzzedPlayers.includes(socket.id);
    if (phase === 'questionOpen') {
      byId('buzz-btn').disabled = !!alreadyBuzzed;
      byId('modal-input').disabled = true;
      byId('modal-submit').disabled = true;
    } else if (phase === 'answering') {
      byId('buzz-btn').disabled = true;
      byId('modal-input').disabled = !iAmBuzzed;
      byId('modal-submit').disabled = !iAmBuzzed;
      if (iAmBuzzed) byId('modal-input').focus(); else byId('modal-input').value = '';
    }
  }
  function renderTimer(t) {
    if (!t || typeof t.remaining !== 'number' || typeof t.total !== 'number') {
      timerText.textContent = 'Time: —';
      timerBar.style.width = '0%';
      return;
    }
    const pct = Math.max(0, Math.min(100, (t.remaining / t.total) * 100));
    timerText.textContent = `Time left: ${t.remaining}s`;
    timerBar.style.width = pct + '%';
  }

  function startTyping() {
    clearInterval(typeInterval);
    typingPaused = false;
    typeInterval = setInterval(() => {
      if (typingPaused) return;
      if (currentIndex < fullText.length) {
        currentIndex++;
        byId('modal-question').textContent = fullText.substring(0, currentIndex);
      } else {
        stopTyping();
        socket.emit('startBuzzWindow');
      }
    }, 50);
  }
  function pauseTyping() { typingPaused = true; clearInterval(typeInterval); typeInterval = null; }
  function stopTyping()  { typingPaused = true; clearInterval(typeInterval); typeInterval = null; }

  function submitAnswer() {
    const raw = byId('modal-input').value || '';
    const normalized = normalize(raw);
    socket.emit('submitAnswer', { answer: normalized, rawAnswer: raw });
    byId('modal-input').value = '';
    byId('modal-input').blur();
  }

  // ---------- Winners screen ----------
  function showWinners(players) {
    hideModal(); stopTyping();
    byId('lobby-screen').style.display   = 'none';
    byId('game-screen').style.display    = 'none';
    byId('winners-screen').style.display = 'block';

    winnersCorrectSound = new Audio('correct.mp3');
    winnersCorrectSound.load();

    const sorted = Object.values(players)
      .map(p => ({ ...p, correctCount: p.correctCount || 0 }))
      .sort((a,b) => (b.score - a.score) || (b.correctCount - a.correctCount));

    const third  = sorted[2];
    const second = sorted[1];
    const first  = sorted[0];

    ['first','second','third'].forEach(pos => {
      byId(`${pos}-name`).textContent  = '';
      byId(`${pos}-score`).textContent = '';
    });

    const items = [];
    if (third)  items.push({ text: `Coming in third is ${third.name} with $${third.score}!`, player: third,  spot: 'third'  });
    if (second) items.push({ text: `In second place, ${second.name} with $${second.score}!`, player: second, spot: 'second' });
    if (first)  items.push({ text: `And your winner tonight is ${first.name} with $${first.score}!`, player: first,  spot: 'first'  });

    typeOutAnnouncements(items, () => {
      if (window.confetti) confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    });
  }

  // new recursive announcer
  function typeOutAnnouncements(items, onDone) {
    const el = byId('winners-announcement');
    el.textContent = '';
    function showItem(index) {
      if (index >= items.length) {
        if (onDone) onDone();
        return;
      }
      const current = items[index];
      let charIdx = 0;
      el.textContent += '\n';
      function typeChar() {
        if (charIdx < current.text.length) {
          el.textContent += current.text.charAt(charIdx++);
          setTimeout(typeChar, 50);
        } else {
          el.textContent += '\n\n';
          if (soundEnabled && winnersCorrectSound) winnersCorrectSound.play().catch(() => {});
          if (window.confetti) confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
          typePodium(current, () => showItem(index + 1));
        }
      }
      typeChar();
    }
    showItem(0);
  }

  function typePodium(item, cb) {
    const p   = item.player;
    const nEl = byId(item.spot + '-name');
    const sEl = byId(item.spot + '-score');
    if (!nEl || !sEl) { if (cb) cb(); return; }
    nEl.textContent = '';
    sEl.textContent = '';
    typeIntoElement(nEl, p.name, 25, () => {
      typeIntoElement(sEl, `$${p.score}`, 20, cb);
    });
  }
  function typeIntoElement(el, text, delayMs, done) {
    let i = 0;
    const t = setInterval(() => {
      if (i < text.length) el.textContent += text.charAt(i++);
      else { clearInterval(t); if (done) done(); }
    }, delayMs);
  }
}

function showModal() { byId('modal').style.display = 'flex'; }
function hideModal() { const m = byId('modal'); if (m) m.style.display = 'none'; }
function normalize(s) {
  if (!s) return '';
  s = s.toLowerCase().trim();
  s = s.replace(/^(what|who|where|when|why|which|whats|whos|wheres|whens)\s+(is|are|was|were)\s+/, '');
  s = s.replace(/^(an|a|the)\s+/, '');
  s = s.replace(/[^a-z0-9 ]/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function ensureModal() {
  if (document.getElementById('modal')) return;
  const c = document.createElement('div');
  c.id = 'modal';
  c.className = 'modal';
  c.innerHTML = `
    <div class="modal-content">
      <h2 id="modal-question"></h2>
      <div class="controls-row">
        <button id="buzz-btn" class="buzz">Buzz In</button>
      </div>
      <input id="modal-input" type="text" placeholder="Type your answer here">
      <div id="timer-bar-container"><div id="timer-bar"></div></div>
      <div id="timer-text">Time left: 10s</div>
      <button id="modal-submit">Submit</button>
    </div>
  `;
  document.body.appendChild(c);
}
function applySoundSetting() {
  if (correctSound)  correctSound.muted  = !soundEnabled;
  if (incorrectSound) incorrectSound.muted = !soundEnabled;
}

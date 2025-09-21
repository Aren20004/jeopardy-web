(function () {
  const socket = io();

  const playerName = prompt('Enter your player name:') || ('Player ' + Math.floor(Math.random()*1000));
  socket.emit('join', playerName);

  const boardDiv = byId('board');
  const playersDiv = byId('players');
  const turnDiv = byId('turn');
  const statusDiv = ensureStatusBar();
  const modal = ensureModal();

  const modalQuestion = byId('modal-question');
  const modalAnswerInput = byId('modal-input');
  const modalSubmitBtn = byId('modal-submit');
  const buzzBtn = byId('buzz-btn');
  const timerText = byId('timer-text');
  const timerBar = byId('timer-bar');

  socket.on('gameState', (state) => {
    renderAll(state);
  });

  socket.on('toast', ({ text }) => {
    setStatus(text);
  });

  buzzBtn.onclick = () => {
    socket.emit('buzzIn');
  };

  modalSubmitBtn.onclick = () => {
    submitAnswer();
  };

  modalAnswerInput.onkeydown = (e) => {
    if (e.key === 'Enter') submitAnswer();
  };

  function renderAll(state) {
    renderPlayers(state.players);
    renderTurn(state);
    renderBoard(state);
    renderQuestionUI(state);
    renderTimer(state.timer);
  }

  function renderPlayers(players) {
    const list = Object.values(players)
      .map(p => `${escapeHtml(p.name)}: $${p.score}`)
      .join('<br>');
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
    boardDiv.innerHTML = '';

    const categories = Object.keys(board || {});
    categories.forEach(cat => {
      const cell = document.createElement('div');
      cell.className = 'cell header-cell';
      cell.innerText = cat;
      boardDiv.appendChild(cell);
    });

    const values = [200,400,600,800,1000];
    values.forEach(val => {
      categories.forEach(cat => {
        const q = (board[cat] || {})[val];
        const cell = document.createElement('div');
        cell.className='cell';
        if (!q) {
          cell.innerText='N/A';
          cell.classList.add('used-cell');
        } else if (q.used) {
          cell.innerText='—';
          cell.classList.add('used-cell');
        } else {
          cell.innerText='$'+val;
          const isMyTurn = socket.id === currentTurn;
          const canPick = phase==='idle' && isMyTurn;
          cell.style.opacity = canPick ? '1.0' : '0.5';
          if (canPick) {
            cell.onclick = () => {
              socket.emit('pickQuestion', { category: cat, value: val });
            };
          }
        }
        boardDiv.appendChild(cell);
      });
    });
  }

  function renderQuestionUI(state) {
    const { phase, currentQuestion, players, buzzedInPlayer, buzzedPlayers } = state;
    if (!currentQuestion) {
      hideModal();
      return;
    }
    showModal();
    modalQuestion.textContent = currentQuestion.question || '';
    const iAmBuzzed = buzzedInPlayer === socket.id;
    const alreadyBuzzed = buzzedPlayers && buzzedPlayers.includes(socket.id);

    if (phase === 'questionOpen') {
      setStatus('Buzz in now!');
      buzzBtn.disabled = alreadyBuzzed;
      modalAnswerInput.disabled=true;
      modalSubmitBtn.disabled=true;
    } else if (phase === 'answering') {
      const who = players[buzzedInPlayer] ? players[buzzedInPlayer].name : 'Someone';
      setStatus(`${who} is answering...`);
      const amMe = iAmBuzzed;
      buzzBtn.disabled=true;
      modalAnswerInput.disabled=!amMe;
      modalSubmitBtn.disabled=!amMe;
      if (amMe) modalAnswerInput.focus();
      else modalAnswerInput.value='';
    } else if (phase === 'reveal') {
      // NEW show the answer
      setStatus(`Answer: ${currentQuestion.answerRevealed || ''}`);
      buzzBtn.disabled=true;
      modalAnswerInput.disabled=true;
      modalSubmitBtn.disabled=true;
      // NEW hide modal quickly
      setTimeout(() => hideModal(), 500);
    } else {
      hideModal();
    }
  }

  function renderTimer(timer) {
    if (!timer || typeof timer.remaining !== 'number' || typeof timer.total !== 'number') {
      timerText.textContent='Time: —';
      timerBar.style.width='0%';
      return;
    }
    const pct=Math.max(0,Math.min(100,(timer.remaining/timer.total)*100));
    timerText.textContent=`Time left: ${timer.remaining}s`;
    timerBar.style.width=pct+'%';
  }

  function submitAnswer() {
    const raw = modalAnswerInput.value || '';
    const normalized = normalize(raw);
    socket.emit('submitAnswer', { answer: normalized });
    modalAnswerInput.value='';
    modalAnswerInput.blur();
  }

  function byId(id){return document.getElementById(id);}
  function setStatus(msg){statusDiv.textContent=msg;}
  function showModal(){modal.style.display='flex';}
  function hideModal(){modal.style.display='none';}
  function normalize(s){
    if(!s)return'';
    s=s.toLowerCase().trim();
    s=s.replace(/^(what|who|where|when|why|which|whats|whos|wheres|whens)\s+(is|are|was|were)\s+/,'');
    s=s.replace(/^(an|a|the)\s+/,'');
    s=s.replace(/[^a-z0-9 ]/g,'').trim();
    s=s.replace(/\s+/g,' ');
    return s;
  }
  function escapeHtml(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function ensureStatusBar(){
    let el=document.getElementById('status');
    if(!el){
      el=document.createElement('div');
      el.id='status';
      el.style.textAlign='center';
      el.style.margin='10px 0';
      el.style.fontSize='18px';
      document.body.insertBefore(el,document.body.firstChild);
    }
    return el;
  }
  function ensureModal(){
    let m=document.getElementById('modal');
    if(m)return m;
    const c=document.createElement('div');
    c.id='modal';
    c.className='modal';
    c.innerHTML=`
      <div class="modal-content">
        <h2 id="modal-question"></h2>
        <div class="controls-row">
          <button id="buzz-btn" class="buzz">Buzz In</button>
        </div>
        <input id="modal-input" type="text" placeholder="Type your answer here">
        <div id="timer-bar-container">
          <div id="timer-bar"></div>
        </div>
        <div id="timer-text">Time left: 10s</div>
        <button id="modal-submit">Submit</button>
      </div>
    `;
    document.body.appendChild(c);
    return c;
  }
})();


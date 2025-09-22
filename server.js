const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static(__dirname));

// (Optional) silence favicon 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const csvFile = path.join(__dirname, 'questions.csv');
let categories = {};

function loadQuestions() {
  const data = fs.readFileSync(csvFile, 'utf8');
  const lines = data.split('\n');
  categories = {};
  for (let line of lines) {
    if (!line.trim() || line.startsWith('Category')) continue;
    const parts = line.split(',', 4);
    if (parts.length < 4) continue;
    const category = parts[0].trim();
    const value = parseInt(parts[1].trim());
    const question = parts[2].trim();
    const answer = parts[3].trim();

    if (!categories[category]) categories[category] = {};
    if (!categories[category][value]) categories[category][value] = [];
    categories[category][value].push({ question, answer, used: false });
  }
}
loadQuestions();

// === Game State ===
let players = {};
let board = {};
let currentTurn = null;
let currentQuestion = null;
let phase = 'idle';
let buzzedInPlayer = null;
let buzzedPlayers = [];
let attemptedAnswers = [];
let timer = { total: 10, remaining: 0, running: false };
let timerInterval = null;
let gameStarted = false;

// host + rounds
let hostId = null;
let roundsSelected = 1;
let currentRound = 1;

// keep track of used categories across rounds
let usedCategoriesSet = new Set();

function initBoard() {
  const allCats = Object.keys(categories);
  const availableCats = allCats.filter(cat => !usedCategoriesSet.has(cat));

  if (availableCats.length === 0) {
    console.log('No more new categories available.');
    return;
  }

  const shuffled = availableCats.sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, 5);
  chosen.forEach(cat => usedCategoriesSet.add(cat));

  board = {};
  const multiplier = 1 + 0.5 * (currentRound - 1); // value multiplier per round
  for (let cat of chosen) {
    board[cat] = {};
    for (let value of [200, 400, 600, 800, 1000]) {
      const arr = categories[cat][value];
      if (!arr) continue;
      const q = arr[Math.floor(Math.random() * arr.length)];
      const newValue = Math.round((value * multiplier) / 100) * 100; // round to nearest 100
      board[cat][value] = { ...q, used: false, value: newValue };
    }
  }
}
initBoard();

function sendGameState() {
  io.emit('gameState', {
    players,
    board,
    phase,
    currentTurn,
    currentQuestion,
    buzzedInPlayer,
    buzzedPlayers,
    timer,
    gameStarted,
    hostId,
    roundsSelected,
    currentRound
  });
}

function clearTimer() {
  clearInterval(timerInterval);
  timer.running = false;
  timer.remaining = 0;
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  timer.total = seconds;
  timer.remaining = seconds;
  timer.running = true;
  timerInterval = setInterval(() => {
    timer.remaining--;
    if (timer.remaining <= 0) {
      clearInterval(timerInterval);
      timer.running = false;
      handleTimerExpired();
    }
    sendGameState();
  }, 1000);
  sendGameState();
}

function handleTimerExpired() {
  if (!currentQuestion) {
    phase = 'idle';
    sendGameState();
    return;
  }

  if (phase === 'answering' && buzzedInPlayer) {
    const sid = buzzedInPlayer;
    players[sid].score = Math.max(0, players[sid].score - currentQuestion.value);
    if (!buzzedPlayers.includes(sid)) buzzedPlayers.push(sid);
    attemptedAnswers.push({ name: players[sid].name, answer: '(timed out)' });

    buzzedInPlayer = null;
    phase = 'questionOpen';

    const eligible = Object.keys(players).filter(id => !buzzedPlayers.includes(id));
    if (eligible.length > 0) {
      startTimer(10);
    } else {
      endQuestionNoWinner();
    }
  } else if (phase === 'questionOpen') {
    endQuestionNoWinner();
  } else {
    endQuestionNoWinner();
  }
}

function endQuestionNoWinner() {
  if (currentQuestion) {
    const answerWas = currentQuestion.answer; // keep before nulling
    board = markUsed(board, currentQuestion);
    io.emit('showResultToast', {
      type: 'allWrong',
      correctAnswer: answerWas, // <<— now sent to client
      answers: attemptedAnswers.length > 0
        ? attemptedAnswers
        : [{ name: 'No one', answer: '(no answers)' }]
    });
  }

  phase = 'idle';
  currentQuestion = null;
  buzzedInPlayer = null;
  buzzedPlayers = [];
  attemptedAnswers = [];
  clearTimer();

  if (allQuestionsUsed() && currentRound < roundsSelected) {
    currentRound++;
    initBoard();
  } else if (allQuestionsUsed() && currentRound >= roundsSelected) {
    // trigger winners screen
    currentRound = roundsSelected + 1;
  }

  sendGameState();
}

function allQuestionsUsed() {
  for (let cat of Object.keys(board)) {
    for (let val of Object.keys(board[cat])) {
      if (!board[cat][val].used) return false;
    }
  }
  return true;
}

io.on('connection', socket => {
  socket.on('join', name => {
    players[socket.id] = { name, score: 0, correctCount: 0 };
    if (!hostId) hostId = socket.id; // first player is host
    sendGameState();
  });

  socket.on('startGame', () => {
    if (Object.keys(players).length >= 2) {
      gameStarted = true;
      const keys = Object.keys(players);
      if (keys.length > 0) {
        currentTurn = keys[Math.floor(Math.random() * keys.length)];
      }
      sendGameState();
    }
  });

  socket.on('updateSettings', data => {
    if (socket.id !== hostId) return;
    roundsSelected = Math.max(1, Math.min(5, parseInt(data.roundsSelected || 1, 10)));
    sendGameState();
  });

  socket.on('pickQuestion', ({ category, value }) => {
    if (socket.id !== currentTurn) return;
    if (!board[category] || !board[category][value]) return;
    const q = board[category][value];
    if (q.used) return;

    currentQuestion = q;
    phase = 'questionOpen';
    buzzedInPlayer = null;
    buzzedPlayers = [];
    attemptedAnswers = [];
    clearTimer();
    sendGameState();
  });

  socket.on('startBuzzWindow', () => {
    if (phase === 'questionOpen' && currentQuestion && !timer.running && !buzzedInPlayer) {
      startTimer(10);
    }
  });

  socket.on('buzzIn', () => {
    if (phase !== 'questionOpen') return;
    if (!currentQuestion) return;
    if (buzzedPlayers.includes(socket.id)) return;

    buzzedInPlayer = socket.id;
    phase = 'answering';
    startTimer(10);
    sendGameState();
  });

  socket.on('submitAnswer', ({ answer, rawAnswer }) => {
    if (phase !== 'answering') return;
    if (buzzedInPlayer !== socket.id) return;
    if (!currentQuestion) return;

    const correct = normalize(answer) === normalize(currentQuestion.answer);

    if (correct) {
      players[socket.id].score += currentQuestion.value;
      players[socket.id].correctCount += 1;

      const answerWas = currentQuestion.answer;
      board = markUsed(board, currentQuestion);

      phase = 'idle';
      currentTurn = socket.id;
      currentQuestion = null;
      buzzedInPlayer = null;
      buzzedPlayers = [];
      attemptedAnswers = [];
      clearTimer();

      io.emit('playSound', 'correct');
      io.emit('showResultToast', {
        type: 'correct',
        playerName: players[socket.id].name,
        correctAnswer: answerWas
      });

      if (allQuestionsUsed() && currentRound < roundsSelected) {
        currentRound++;
        initBoard();
      } else if (allQuestionsUsed() && currentRound >= roundsSelected) {
        currentRound = roundsSelected + 1; // winners screen trigger
      }

      sendGameState();
    } else {
      attemptedAnswers.push({ name: players[socket.id].name, answer: rawAnswer });
      players[socket.id].score = Math.max(0, players[socket.id].score - currentQuestion.value);
      if (!buzzedPlayers.includes(socket.id)) buzzedPlayers.push(socket.id);
      buzzedInPlayer = null;
      phase = 'questionOpen';

      io.emit('showResultToast', {
        type: 'incorrect',
        playerName: players[socket.id].name,
        answer: rawAnswer
      });

      io.emit('playSound', 'incorrect');

      const eligible = Object.keys(players).filter(id => !buzzedPlayers.includes(id));
      if (eligible.length > 0) {
        startTimer(10);
      } else {
        endQuestionNoWinner();
      }
      sendGameState();
    }
  });

  socket.on('disconnect', () => {
    const wasTurn = currentTurn === socket.id;
    delete players[socket.id];

    if (buzzedInPlayer === socket.id && currentQuestion) {
      attemptedAnswers.push({ name: '(disconnected)', answer: '(left game)' });
      if (!buzzedPlayers.includes(socket.id)) buzzedPlayers.push(socket.id);
      buzzedInPlayer = null;
      phase = 'questionOpen';
      startTimer(10);
    }

    if (wasTurn) {
      currentTurn = Object.keys(players)[0] || null;
    }
    sendGameState();
  });

  sendGameState();
});

function normalize(s) {
  if (!s) return '';
  s = s.toLowerCase().trim();
  s = s.replace(/^(what|who|where|when|why|which|whats|whos|wheres|whens)\s+(is|are|was|were)\s+/, '');
  s = s.replace(/^(an|a|the)\s+/, '');
  s = s.replace(/[^a-z0-9 ]/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}

function markUsed(board, q) {
  for (let cat of Object.keys(board)) {
    for (let val of Object.keys(board[cat])) {
      if (board[cat][val].question === q.question) {
        board[cat][val].used = true;
      }
    }
  }
  return board;
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

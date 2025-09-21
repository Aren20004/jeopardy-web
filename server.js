const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// === Load Questions ===
let categories = {};
const questionsFile = path.join(__dirname, 'questions.csv');
const lines = fs.readFileSync(questionsFile, 'utf8').split('\n');
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
  categories[category][value].push({ question, answer });
}

app.use(express.static(__dirname));

// === Game State ===
let gameState = {
  board: {},
  players: {},
  currentTurn: null,
  phase: 'idle',
  currentQuestion: null,
  buzzedInPlayer: null,
  buzzedPlayers: [],
  timer: { total: 0, remaining: 0 }
};

function newBoard() {
  const cats = Object.keys(categories).sort(() => Math.random() - 0.5).slice(0, 5);
  const board = {};
  for (let cat of cats) {
    board[cat] = {};
    for (let val of [200,400,600,800,1000]) {
      const arr = categories[cat][val] || [];
      if (arr.length > 0) {
        const q = arr[Math.floor(Math.random()*arr.length)];
        board[cat][val] = { question: q.question, answer: q.answer, used: false };
      }
    }
  }
  gameState.board = board;
}
newBoard();

// === Timer ===
let countdownInterval = null;

function startTimer(seconds, onExpire) {
  clearInterval(countdownInterval);
  gameState.timer.total = seconds;
  gameState.timer.remaining = seconds;
  countdownInterval = setInterval(() => {
    gameState.timer.remaining--;
    sendGameState();
    if (gameState.timer.remaining <= 0) {
      clearInterval(countdownInterval);
      onExpire();
    }
  }, 1000);
  sendGameState();
}

function stopTimer() {
  clearInterval(countdownInterval);
  gameState.timer = { total: 0, remaining: 0 };
}

function sendGameState() {
  io.emit('gameState', gameState);
}

// === Socket Events ===
io.on('connection', (socket) => {
  console.log('user connected', socket.id);

  socket.on('join', (name) => {
    gameState.players[socket.id] = { name: name, score: 0 };
    if (!gameState.currentTurn) {
      gameState.currentTurn = socket.id;
    }
    sendGameState();
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    if (gameState.currentTurn === socket.id) {
      const remaining = Object.keys(gameState.players);
      gameState.currentTurn = remaining.length > 0 ? remaining[0] : null;
    }
    sendGameState();
  });

  socket.on('pickQuestion', ({ category, value }) => {
    if (socket.id !== gameState.currentTurn) return;
    const q = gameState.board[category][value];
    if (!q || q.used) return;

    gameState.board[category][value].used = true;
    gameState.currentQuestion = {
      category, value,
      question: q.question,
      answer: q.answer
    };
    gameState.phase = 'questionOpen';
    gameState.buzzedInPlayer = null;
    gameState.buzzedPlayers = [];

    startTimer(10, () => {
      revealAnswer('No one buzzed in. Answer: ' + q.answer);
    });
    sendGameState();
  });

  socket.on('buzzIn', () => {
    if (gameState.phase !== 'questionOpen') return;
    if (gameState.buzzedInPlayer) return;
    if (gameState.buzzedPlayers.includes(socket.id)) return;

    gameState.buzzedInPlayer = socket.id;
    gameState.phase = 'answering';

    startTimer(10, () => {
      handleIncorrect(socket.id);
    });
    sendGameState();
  });

  socket.on('submitAnswer', ({ answer }) => {
    if (gameState.phase !== 'answering') return;
    if (gameState.buzzedInPlayer !== socket.id) return;

    const correct = normalize(answer) === normalize(gameState.currentQuestion.answer);
    if (correct) {
      handleCorrect(socket.id);
    } else {
      handleIncorrect(socket.id);
    }
  });
});

// === Scoring Helpers ===
function handleCorrect(playerId) {
  const val = gameState.currentQuestion.value;
  gameState.players[playerId].score += val;
  gameState.currentTurn = playerId;
  revealAnswer(`${gameState.players[playerId].name} got it correct +$${val}`);
}

function handleIncorrect(playerId) {
  const val = gameState.currentQuestion.value;
  gameState.players[playerId].score = Math.max(0, gameState.players[playerId].score - val);
  if (!gameState.buzzedPlayers.includes(playerId)) {
    gameState.buzzedPlayers.push(playerId);
  }
  gameState.buzzedInPlayer = null;
  gameState.phase = 'questionOpen';
  startTimer(gameState.timer.remaining > 0 ? gameState.timer.remaining : 5, () => {
    revealAnswer('No more buzzes. Answer: ' + gameState.currentQuestion.answer);
  });
  sendGameState();
}

function revealAnswer(msg) {
  stopTimer();
  if (gameState.currentQuestion) {
    gameState.currentQuestion.answerRevealed = gameState.currentQuestion.answer;
  }
  io.emit('toast', { text: msg || `Answer: ${gameState.currentQuestion.answer}` });

  // NEW: immediately reset state
  gameState.phase = 'idle';
  gameState.currentQuestion = null;
  gameState.buzzedInPlayer = null;
  gameState.buzzedPlayers = [];
  stopTimer();
  sendGameState();
}

function normalize(s) {
  if (!s) return '';
  s = s.toLowerCase().trim();
  s = s.replace(/^(what|who|where|when|why|which|whats|whos|wheres|whens)\s+(is|are|was|were)\s+/, '');
  s = s.replace(/^(an|a|the)\s+/, '');
  s = s.replace(/[^a-z0-9 ]/g, '').trim();
  return s;
}

server.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));


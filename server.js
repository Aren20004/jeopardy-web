const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// --- Load Questions ---
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

// Serve static files (index.html, style.css)
app.use(express.static(__dirname));

// Endpoint for /board to send random board each refresh
app.get('/board', (req, res) => {
  const cats = Object.keys(categories).sort(() => Math.random() - 0.5).slice(0, 5);
  const board = {};
  for (let cat of cats) {
    board[cat] = {};
    for (let val of [200, 400, 600, 800, 1000]) {
      const arr = categories[cat][val] || [];
      if (arr.length > 0) {
        const q = arr[Math.floor(Math.random() * arr.length)];
        board[cat][val] = q;
      }
    }
  }
  res.json(board);
});

// Track players and scores
let players = {}; // { socket.id: {name, score} }

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('join', (name) => {
    players[socket.id] = { name: name, score: 0 };
    io.emit('players', players);
  });

  socket.on('updateScore', (delta) => {
    if (players[socket.id]) {
      players[socket.id].score = Math.max(0, players[socket.id].score + delta);
      io.emit('players', players);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('players', players);
  });
});

server.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));


const express = require('express');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

// Load CSV once at startup
const csv = fs.readFileSync('questions.csv', 'utf-8');
const lines = csv.split('\n').filter(l => l && !l.startsWith('Category'));
const questions = {};

lines.forEach(line => {
  const [category, value, question, answer] = line.split(',', 4);
  if (!questions[category]) questions[category] = {};
  if (!questions[category][value]) questions[category][value] = [];
  questions[category][value].push({ question, answer });
});

// Endpoint to get random 5 categories and 1 question per value
app.get('/board', (req, res) => {
  const categories = Object.keys(questions);
  // pick 5 random
  const chosen = categories.sort(() => 0.5 - Math.random()).slice(0, 5);
  const dollarValues = [200, 400, 600, 800, 1000];
  const board = {};

  chosen.forEach(cat => {
    board[cat] = {};
    dollarValues.forEach(val => {
      const arr = questions[cat][val];
      if (arr) {
        const q = arr[Math.floor(Math.random() * arr.length)];
        board[cat][val] = q;
      }
    });
  });

  res.json(board);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));


require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname)); // serves tifabo-v10.html, wrkassist.html, references.html, cli-guide.html

const DATA_FILE = 'data.json';

// Read the saved site content — called by loadSD() on page load
app.get('/data', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(DATA_FILE)));
});

// Save site content — called by saveSD() every time Admin makes a change
app.post('/data', (req, res) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body));
  res.json({ ok: true });
});

// GitHub — public repo data, no API key required
app.get('/api/github/repos', async (req, res) => {
  try {
    const r = await fetch(`https://api.github.com/users/${process.env.GH_USERNAME}/repos?sort=updated&per_page=5`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'GitHub fetch failed' });
  }
});

// YouTube — key stays server-side, never exposed to the browser
app.get('/api/youtube', async (req, res) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/${req.query.path}&key=${process.env.YT_KEY}`;
    const r = await fetch(url);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'YouTube fetch failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TIFABO server running on :${PORT}`));

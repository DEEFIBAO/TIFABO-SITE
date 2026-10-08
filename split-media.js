#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────────────────
   TIFABO — split-media.js
   Pulls base64 media out of an exported index.html and writes it to /assets
   as real files, leaving a small HTML file that Git and GitHub Pages accept.

   USAGE (from the folder that holds index.html):
       node split-media.js index.html

   WHAT IT DOES
     1. finds every  data:<type>;base64,<payload>  in the file
     2. writes each payload to  assets/<kind>-<n>.<ext>
     3. rewrites the HTML to point at  assets/<kind>-<n>.<ext>
     4. saves the original as  index.html.bak  (untouched, never committed)
     5. prints a size report and flags any file GitHub will reject (>100 MB)

   Re-running it is safe: identical media reuses the same file name.
   ─────────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_BYTES   = 8 * 1024;          // leave tiny inline icons alone
const GH_LIMIT    = 100 * 1024 * 1024; // GitHub hard limit per file
const GH_WARN     = 50  * 1024 * 1024; // GitHub starts warning here

const EXT = {
  'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/png':'png', 'image/gif':'gif',
  'image/webp':'webp', 'image/avif':'avif', 'image/svg+xml':'svg',
  'image/x-icon':'ico', 'image/vnd.microsoft.icon':'ico', 'image/bmp':'bmp',
  'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov',
  'video/x-matroska':'mkv', 'video/ogg':'ogv',
  'audio/mpeg':'mp3', 'audio/mp4':'m4a', 'audio/wav':'wav', 'audio/ogg':'ogg',
  'application/pdf':'pdf',
  'font/woff2':'woff2', 'font/woff':'woff', 'font/ttf':'ttf',
};

const kindOf = m => m.startsWith('image/') ? 'img'
                  : m.startsWith('video/') ? 'video'
                  : m.startsWith('audio/') ? 'audio'
                  : m === 'application/pdf' ? 'doc'
                  : m.startsWith('font/')  ? 'font' : 'file';

const human = b => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB'
                 : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(2) + ' MB'
                 : b >= 1024      ? (b / 1024).toFixed(1)      + ' KB'
                 : b + ' B';

// ── input ──────────────────────────────────────────────────────────────────
const file = process.argv[2] || 'index.html';
if (!fs.existsSync(file)) {
  console.error('Cannot find ' + file + '\nRun this from the folder that holds index.html.');
  process.exit(1);
}

const dir    = path.dirname(path.resolve(file));
const assets = path.join(dir, 'assets');
if (!fs.existsSync(assets)) fs.mkdirSync(assets, { recursive: true });

let html = fs.readFileSync(file, 'utf8');
const beforeBytes = Buffer.byteLength(html);
console.log('\nReading  ' + path.basename(file) + '   ' + human(beforeBytes) + '\n');

// ── extract ────────────────────────────────────────────────────────────────
const RE = /data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*);base64,([A-Za-z0-9+/]+={0,2})/gi;

const seen    = new Map();  // sha1 -> relative path (dedupe)
const counter = {};         // kind -> running number
const written = [];
let   skipped = 0;

// name a file after the property it was stored in, when that is visible
function labelFor(src, at) {
  const back = src.slice(Math.max(0, at - 60), at);
  const m = back.match(/["']?([A-Za-z_][A-Za-z0-9_]{1,24})["']?\s*[:=]\s*["'`]?$/);
  if (!m) return null;
  return m[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2')
             .replace(/_(src|url|data)$/i, '')
             .replace(/_/g, '-')
             .toLowerCase();
}

html = html.replace(RE, (match, mime, b64, at, src) => {
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return match; }
  if (buf.length < MIN_BYTES) { skipped++; return match; }

  const sha = crypto.createHash('sha1').update(buf).digest('hex');
  if (seen.has(sha)) return seen.get(sha);

  const lower = mime.toLowerCase();
  const kind  = kindOf(lower);
  const ext   = EXT[lower] || 'bin';
  const base  = labelFor(src, at) || kind;
  counter[base] = (counter[base] || 0) + 1;

  const name = base + '-' + counter[base] + '.' + ext;
  const rel  = 'assets/' + name;
  fs.writeFileSync(path.join(assets, name), buf);

  seen.set(sha, rel);
  written.push({ rel, bytes: buf.length, mime: lower });
  return rel;
});

// ── write ──────────────────────────────────────────────────────────────────
if (!written.length) {
  console.log('No embedded media over ' + human(MIN_BYTES) + ' found — nothing to do.');
  console.log('If the file is still large, the weight is in the text content itself.\n');
  process.exit(0);
}

const bak = file + '.bak';
if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
fs.writeFileSync(file, html, 'utf8');

const afterBytes = Buffer.byteLength(html);

// ── report ─────────────────────────────────────────────────────────────────
written.sort((a, b) => b.bytes - a.bytes);
console.log('Extracted ' + written.length + ' file' + (written.length === 1 ? '' : 's') + ' to assets/\n');
written.forEach(f => {
  const flag = f.bytes > GH_LIMIT ? '  <-- TOO BIG FOR GITHUB'
             : f.bytes > GH_WARN  ? '  <-- large, consider hosting elsewhere' : '';
  console.log('   ' + f.rel.padEnd(22) + human(f.bytes).padStart(10) + flag);
});
if (skipped) console.log('\n   (' + skipped + ' small inline item' + (skipped === 1 ? '' : 's') + ' left in place)');

console.log('\n' + path.basename(file) + ':  ' + human(beforeBytes) + '  ->  ' + human(afterBytes));
console.log('Original kept as ' + path.basename(bak) + ' (add it to .gitignore).\n');

const oversize = written.filter(f => f.bytes > GH_LIMIT);
if (oversize.length) {
  console.log('ACTION NEEDED — GitHub rejects any single file over 100 MB:');
  oversize.forEach(f => console.log('   ' + f.rel + '  (' + human(f.bytes) + ')'));
  console.log('   Upload these to YouTube or your own server, delete them from assets/,');
  console.log('   then point the project at the URL from the admin panel instead.\n');
  process.exit(2);
}
console.log('Safe to commit. Next:  git add -A  &&  git commit -m "slim site + assets"  &&  git push\n');

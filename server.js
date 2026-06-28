// ════════════════════════════════════════════════════════════════
//  Church Live Translator — server.js
//
//  What this does:
//    - Serves the broadcaster page (sound booth PC)
//    - Serves the receiver page (visitor's phone/tablet)
//    - Relays translated phrases from broadcaster → all receivers
//      in real time via WebSockets
//
//  No database. No API keys. Pure Node.js + WebSockets.
// ════════════════════════════════════════════════════════════════

const express = require('express');
const http    = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── Config ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ── Static files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/',            (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/broadcaster', (_, res) => res.sendFile(path.join(__dirname, 'public', 'broadcaster', 'index.html')));
app.get('/receiver',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'receiver',    'index.html')));

// ── WebSocket relay ───────────────────────────────────────────────
// Message types sent by broadcaster:
//   { type: 'interim',  text: '...', lang: 'ne' }  — live partial phrase
//   { type: 'final',    text: '...', lang: 'ne' }  — confirmed phrase
//   { type: 'clear' }                               — clear screen
//
// Server just relays everything to all connected receivers.
// Broadcaster identifies itself with { type: 'hello', role: 'broadcaster' }

const broadcasters = new Set();
const receivers    = new Set();

wss.on('connection', (ws) => {
  let role = 'unknown';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // First message must identify role
    if (msg.type === 'hello') {
      role = msg.role;
      if (role === 'broadcaster') broadcasters.add(ws);
      if (role === 'receiver')    receivers.add(ws);

      // Tell broadcaster how many receivers are connected
      broadcastReceiverCount();
      return;
    }

    // Relay from broadcaster → all receivers
    if (role === 'broadcaster') {
      const payload = JSON.stringify(msg);
      receivers.forEach(r => {
        if (r.readyState === WebSocket.OPEN) r.send(payload);
      });

      // Also update receiver count on certain events
      if (msg.type === 'final') broadcastReceiverCount();
    }
  });

  ws.on('close', () => {
    broadcasters.delete(ws);
    receivers.delete(ws);
    broadcastReceiverCount();
  });

  ws.on('error', () => {
    broadcasters.delete(ws);
    receivers.delete(ws);
  });
});

// Tell all broadcasters how many receivers are listening
function broadcastReceiverCount() {
  const count = receivers.size;
  const msg   = JSON.stringify({ type: 'receivers', count });
  broadcasters.forEach(b => {
    if (b.readyState === WebSocket.OPEN) b.send(msg);
  });
}

// ── Start ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  ✝️  Church Live Translator is running!');
  console.log('');
  console.log('  Sound booth (broadcaster):');
  console.log(`    Local:   http://localhost:${PORT}/broadcaster`);
  console.log('');
  console.log('  Visitor\'s phone (receiver):');
  console.log(`    Local:   http://YOUR_PC_IP:${PORT}/receiver`);
  console.log('    (find your PC IP: run  ipconfig  in a new terminal)');
  console.log('');
  console.log('  If deployed to cloud, replace YOUR_PC_IP with your domain.');
  console.log('');
});

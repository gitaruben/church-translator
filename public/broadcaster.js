// ════════════════════════════════════════════════════════════════
//  broadcaster.js — v4
//  KEY CHANGES:
//  - Aggressive mic keep-alive: restarts on visibility change,
//    on focus, on blur, on a watchdog timer every 4s
//  - "aborted" error handled gracefully — just restarts
//  - Phrases sent with newline separator for display
//  - sentPhrases dedup unchanged
// ════════════════════════════════════════════════════════════════

const BCP47 = {
  ro:'ro-RO', en:'en-US', ne:'ne-NP', hi:'hi-IN',
  fr:'fr-FR', de:'de-DE', es:'es-ES', it:'it-IT',
  pt:'pt-PT', ru:'ru-RU', uk:'uk-UA', pl:'pl-PL',
  hu:'hu-HU', ar:'ar-SA', zh:'zh-CN', ja:'ja-JP', ko:'ko-KR'
};

// ── DOM ──────────────────────────────────────────────────────────
const audioInputEl  = document.getElementById('audio-input');
const refreshBtn    = document.getElementById('refresh-btn');
const srcLangEl     = document.getElementById('src-lang');
const goBtn         = document.getElementById('go-btn');
const goIcon        = document.getElementById('go-icon');
const goLabel       = document.getElementById('go-label');
const liveDot       = document.getElementById('live-dot');
const spinner       = document.getElementById('spinner');
const srcBody       = document.getElementById('src-body');
const tgtBody       = document.getElementById('tgt-body');
const clearBtn      = document.getElementById('clear-btn');
const wsStatusEl    = document.getElementById('ws-status');
const receiverCount = document.getElementById('receiver-count');
const phrasesSent   = document.getElementById('phrases-sent');
const statusEl      = document.getElementById('status');

// ── State ────────────────────────────────────────────────────────
let ws            = null;
let recognition   = null;
let isRunning     = false;
let shouldRestart = false;
let restartTimer  = null;
let watchdogTimer = null;  // fires every 4s to ensure mic is alive

let displaySrcLines = [];  // array of confirmed phrases (shown as lines)
let interimSrc      = '';

// Dedup: normalized phrase → true
const sentPhrases = new Set();
let   phraseCount = 0;

let lastInterimSent = '';
let interimTimer    = null;

// ── Helpers ──────────────────────────────────────────────────────
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}
function renderSrc() {
  let h = displaySrcLines.map(l => `<div class="src-line">${esc(l)}</div>`).join('');
  if (interimSrc) h += `<div class="interim">${esc(interimSrc)}</div>`;
  srcBody.innerHTML = h || '<span class="ph">Waiting for speech…</span>';
  srcBody.scrollTop = srcBody.scrollHeight;
}
function renderTgt(lines) {
  const h = lines.map(l => `<div class="tgt-line">${esc(l)}</div>`).join('');
  tgtBody.innerHTML = h || '<span class="ph">Sent to listeners…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}
function normalizePhrase(t) {
  return t.trim().replace(/\s+/g,' ').toLowerCase();
}

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'broadcaster' }));
    wsStatusEl.textContent = '🟢 Connected';
    setStatus('Connected. Select audio input and tap Start.', 'ok');
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'receivers') receiverCount.textContent = msg.count;
    } catch(_) {}
  };
  ws.onclose = () => {
    wsStatusEl.textContent = '🔴 Disconnected';
    setStatus('Lost server connection. Reconnecting…', 'error');
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
}
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Send final phrase ─────────────────────────────────────────────
let sentLines = [];  // parallel array to displaySrcLines for tgt display

function sendFinal(phrase) {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return;
  if (sentPhrases.has(normalized)) return;
  sentPhrases.add(normalized);

  displaySrcLines.push(phrase.trim());
  sentLines.push(phrase.trim());
  interimSrc = '';
  renderSrc();
  renderTgt(sentLines);

  phraseCount++;
  phrasesSent.textContent = phraseCount;

  // Send raw source — receivers translate themselves
  send({ type: 'final', srcText: phrase.trim(), srcLang: srcLangEl.value });
  setStatus(`✓ Sent: "${phrase.trim().slice(0,60)}${phrase.length>60?'…':''}"`, 'ok');
}

function sendInterimChunk(text) {
  const normalized = normalizePhrase(text);
  if (!normalized) return;
  if (normalized === normalizePhrase(lastInterimSent)) return;
  for (const sent of sentPhrases) {
    if (sent.startsWith(normalized) || normalized.startsWith(sent)) return;
  }
  lastInterimSent = text;
  send({ type: 'interim', srcText: text.trim(), srcLang: srcLangEl.value });
}

// ── Device list ───────────────────────────────────────────────────
async function refreshDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch(e) {
    setStatus('Microphone permission denied.', 'error'); return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === 'audioinput');
  audioInputEl.innerHTML = '';
  inputs.forEach(d => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || 'Input ' + d.deviceId.slice(0, 8);
    audioInputEl.appendChild(o);
  });
  setStatus(`Found ${inputs.length} audio input(s). Ready.`, 'ok');
}
refreshBtn.addEventListener('click', refreshDevices);
window.addEventListener('DOMContentLoaded', () => {
  navigator.mediaDevices.enumerateDevices().then(devices => {
    const inputs = devices.filter(d => d.kind === 'audioinput' && d.label);
    if (inputs.length) {
      audioInputEl.innerHTML = '';
      inputs.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label;
        audioInputEl.appendChild(o);
      });
    }
  }).catch(() => {});
  connectWS();
});

// ── Speech Recognition ────────────────────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  goBtn.disabled = true;
  goLabel.textContent = 'Use Chrome or Edge — speech not supported here';
}

function buildRecognition() {
  const r = new SR();
  r.continuous      = true;
  r.interimResults  = true;
  r.maxAlternatives = 1;
  r.lang = BCP47[srcLangEl.value] || srcLangEl.value;

  r.onstart = () => {
    // Reset watchdog every time recognition actually starts
    resetWatchdog();
  };

  r.onresult = (e) => {
    resetWatchdog();  // mic is alive — reset watchdog
    let currentInterim = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        clearTimeout(interimTimer);
        lastInterimSent = '';
        currentInterim  = '';
        interimSrc      = '';
        sendFinal(transcript);
      } else {
        currentInterim += transcript;
      }
    }

    if (currentInterim !== interimSrc) {
      interimSrc = currentInterim;
      renderSrc();
      const words = currentInterim.trim().split(/\s+/).filter(Boolean);
      if (words.length >= 5) {
        clearTimeout(interimTimer);
        sendInterimChunk(currentInterim);
      } else if (words.length >= 2) {
        clearTimeout(interimTimer);
        interimTimer = setTimeout(() => {
          if (interimSrc.trim()) sendInterimChunk(interimSrc);
        }, 800);
      }
    }
  };

  r.onerror = (e) => {
    // 'aborted' happens when Chrome kills recognition (tab blur, system interrupt)
    // 'no-speech' happens on silence
    // Both are safe to restart from
    const safeErrors = ['no-speech', 'aborted', 'network'];
    if (safeErrors.includes(e.error)) {
      if (shouldRestart) scheduleRestart(300);
      return;
    }
    if (e.error === 'not-allowed') {
      stopAll();
      setStatus('❌ Microphone blocked. Allow mic access in browser.', 'error');
      return;
    }
    setStatus('Mic error: ' + e.error + ' — restarting…', 'error');
    if (shouldRestart) scheduleRestart(500);
  };

  r.onend = () => {
    // Always restart if we're supposed to be running
    if (interimSrc.trim()) sendInterimChunk(interimSrc);
    if (shouldRestart) scheduleRestart(150);
    else stopAll();
  };

  return r;
}

function scheduleRestart(delay) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!shouldRestart) return;
    try {
      if (recognition) { try { recognition.abort(); } catch(_){} }
      recognition = buildRecognition();
      recognition.start();
    } catch(_) {
      // If start() throws (already running), try again shortly
      scheduleRestart(500);
    }
  }, delay);
}

// ── Watchdog — ensures mic never silently dies ────────────────────
// Chrome sometimes stops recognition without firing onend or onerror.
// This timer checks every 4s and restarts if recognition went quiet.
let lastResultTime = 0;

function resetWatchdog() {
  lastResultTime = Date.now();
}

function startWatchdog() {
  clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (!shouldRestart) return;
    const silence = Date.now() - lastResultTime;
    // If no result for 6 seconds AND we're supposed to be running — kick it
    if (silence > 6000) {
      scheduleRestart(100);
    }
  }, 4000);
}

function stopWatchdog() {
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

// ── Page visibility — restart when tab comes back into focus ──────
// Chrome throttles/kills audio capture when the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (!shouldRestart) return;
  if (document.visibilityState === 'visible') {
    setStatus('Tab focused — restarting mic…', 'info');
    scheduleRestart(300);
  }
});

// Also restart on window focus (user switches back to Chrome window)
window.addEventListener('focus', () => {
  if (!shouldRestart) return;
  scheduleRestart(300);
});

// ── Start / Stop ──────────────────────────────────────────────────
function startAll() {
  shouldRestart  = true;
  isRunning      = true;
  lastResultTime = Date.now();
  recognition    = buildRecognition();
  try { recognition.start(); }
  catch(e) { setStatus('Cannot start mic: ' + e.message, 'error'); stopAll(); return; }
  startWatchdog();
  goBtn.classList.add('active');
  goIcon.textContent  = '⏹';
  goLabel.textContent = 'Stop Booth';
  liveDot.classList.add('on');
  setStatus('🎤 Broadcasting live…', 'info');
}

function stopAll() {
  shouldRestart = false;
  isRunning     = false;
  clearTimeout(restartTimer);
  clearTimeout(interimTimer);
  stopWatchdog();
  if (recognition) { try { recognition.abort(); } catch(_){} }
  goBtn.classList.remove('active');
  goIcon.textContent  = '🎤';
  goLabel.textContent = 'Start Booth';
  liveDot.classList.remove('on');
  setStatus('Stopped.', '');
}

goBtn.addEventListener('click', () => { if (isRunning) stopAll(); else startAll(); });

clearBtn.addEventListener('click', () => {
  displaySrcLines = []; sentLines = []; interimSrc = '';
  sentPhrases.clear();
  lastInterimSent = '';
  phraseCount = 0;
  phrasesSent.textContent = '0';
  clearTimeout(interimTimer);
  renderSrc(); renderTgt([]);
  send({ type: 'clear' });
  setStatus('Cleared.', '');
});

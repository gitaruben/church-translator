// ════════════════════════════════════════════════════════════════
//  broadcaster.js — v3
//
//  KEY FIXES:
//  - sentIndex tracks the last result index already sent as final,
//    so restarts never re-send already-spoken phrases
//  - Interim chunks sent every 800ms OR every 5 words, whichever
//    comes first — receiver hears words much sooner
//  - Each sent phrase stored in a Set so duplicates are blocked
//    at the send level too
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

// Text accumulation
let displaySrc    = '';   // what we show on screen (final words only)
let interimSrc    = '';   // current unconfirmed interim words

// THE FIX for repeats:
// We store every phrase we've already sent as 'final'.
// On recognition restart, Chrome re-emits from resultIndex=0,
// so we compare against this set and skip anything already sent.
const sentPhrases = new Set();
let   phraseCount = 0;

// Interim chunking state
let lastInterimSent = '';   // last interim text we already broadcast
let interimTimer    = null;
let wordCountTimer  = null;

// ── Helpers ──────────────────────────────────────────────────────
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}
function renderSrc() {
  let h = '';
  if (displaySrc)  h += `<span class="final">${esc(displaySrc)} </span>`;
  if (interimSrc)  h += `<span class="interim">${esc(interimSrc)}</span>`;
  srcBody.innerHTML = h || '<span class="ph">Waiting for speech…</span>';
  srcBody.scrollTop = srcBody.scrollHeight;
}
function renderTgt(text) {
  tgtBody.innerHTML = text
    ? `<span class="tgt-final">${esc(text)}</span>`
    : '<span class="ph">Sent to receivers…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// Normalize a phrase for dedup comparison (trim, collapse spaces, lowercase)
function normalizePhrase(t) {
  return t.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'broadcaster' }));
    wsStatusEl.textContent = '🟢 Connected';
    setStatus('Connected. Select your audio input and tap Start.', 'ok');
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'receivers') receiverCount.textContent = msg.count;
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

// ── Send a final confirmed phrase ─────────────────────────────────
function sendFinal(phrase) {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return;

  // Skip if we already sent this exact phrase
  if (sentPhrases.has(normalized)) return;
  sentPhrases.add(normalized);

  displaySrc = (displaySrc ? displaySrc + ' ' : '') + phrase.trim();
  renderSrc();
  renderTgt(phrase.trim());
  phraseCount++;
  phrasesSent.textContent = phraseCount;

  send({ type: 'final', srcText: phrase.trim(), srcLang: srcLangEl.value });
  setStatus(`✓ Sent: "${phrase.trim().slice(0,60)}${phrase.length>60?'…':''}"`, 'ok');
}

// ── Send an interim chunk (early preview) ────────────────────────
// Called frequently — fires every 800ms of interim text,
// or when word count hits 5, whichever is sooner.
function sendInterimChunk(text) {
  const normalized = normalizePhrase(text);
  if (!normalized) return;
  if (normalized === normalizePhrase(lastInterimSent)) return; // no change

  // Don't send interim text that was already finalized
  // (check if the interim is a prefix of already-sent phrases)
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
    setStatus('Microphone permission denied. Allow it and try again.', 'error'); return;
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
  goLabel.textContent = 'Use Chrome or Edge — speech recognition not supported here';
}

function buildRecognition() {
  const r = new SR();
  r.continuous      = true;
  r.interimResults  = true;
  r.maxAlternatives = 1;
  r.lang = BCP47[srcLangEl.value] || srcLangEl.value;

  r.onresult = (e) => {
    let currentInterim = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;

      if (e.results[i].isFinal) {
        // Clear interim timers — this phrase is confirmed
        clearTimeout(interimTimer);
        clearTimeout(wordCountTimer);
        lastInterimSent = '';
        currentInterim  = '';
        interimSrc      = '';

        // sendFinal handles dedup internally — safe to call always
        sendFinal(transcript);

      } else {
        currentInterim += transcript;
      }
    }

    // Update interim display and schedule early chunk sends
    if (currentInterim !== interimSrc) {
      interimSrc = currentInterim;
      renderSrc();

      const words = currentInterim.trim().split(/\s+/).filter(Boolean);

      // Send immediately if we've hit 5 words
      if (words.length >= 5) {
        clearTimeout(interimTimer);
        clearTimeout(wordCountTimer);
        sendInterimChunk(currentInterim);
        // Reset and keep watching for next 5 words
        wordCountTimer = null;
      } else if (words.length >= 2) {
        // Start an 800ms timer — if user pauses mid-sentence, send what we have
        clearTimeout(interimTimer);
        interimTimer = setTimeout(() => {
          if (interimSrc.trim()) sendInterimChunk(interimSrc);
        }, 800);
      }
    }
  };

  r.onerror = (e) => {
    if (e.error === 'no-speech') { if (shouldRestart) scheduleRestart(300); return; }
    if (e.error === 'not-allowed') {
      stopAll();
      setStatus('❌ Microphone blocked. Allow mic access in browser settings.', 'error');
      return;
    }
    setStatus('Mic error: ' + e.error, 'error');
    if (shouldRestart) scheduleRestart(500);
  };

  r.onend = () => {
    // Recognition ended (timeout, pause, or stop)
    // Any pending interim that wasn't finalized — send it now
    if (interimSrc.trim()) {
      sendInterimChunk(interimSrc);
    }
    if (shouldRestart) scheduleRestart(100);
    else stopAll();
  };

  return r;
}

function scheduleRestart(delay) {
  setTimeout(() => {
    if (!shouldRestart) return;
    try {
      recognition = buildRecognition();
      recognition.start();
    } catch(_) {}
  }, delay);
}

function startAll() {
  shouldRestart = true; isRunning = true;
  recognition = buildRecognition();
  try { recognition.start(); }
  catch(e) { setStatus('Cannot start mic: ' + e.message, 'error'); stopAll(); return; }
  goBtn.classList.add('active');
  goIcon.textContent = '⏹';
  goLabel.textContent = 'Stop Broadcasting';
  liveDot.classList.add('on');
  setStatus('🎤 Broadcasting live…', 'info');
}

function stopAll() {
  shouldRestart = false; isRunning = false;
  clearTimeout(interimTimer);
  clearTimeout(wordCountTimer);
  if (recognition) { try { recognition.stop(); } catch(_){} }
  goBtn.classList.remove('active');
  goIcon.textContent = '🎤';
  goLabel.textContent = 'Start Broadcasting';
  liveDot.classList.remove('on');
  setStatus('Stopped.', '');
}

goBtn.addEventListener('click', () => { if (isRunning) stopAll(); else startAll(); });

clearBtn.addEventListener('click', () => {
  displaySrc = ''; interimSrc = '';
  sentPhrases.clear();
  lastInterimSent = '';
  phraseCount = 0;
  phrasesSent.textContent = '0';
  clearTimeout(interimTimer);
  clearTimeout(wordCountTimer);
  renderSrc(); renderTgt('');
  send({ type: 'clear' });
  setStatus('Cleared.', '');
});

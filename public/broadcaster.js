// ════════════════════════════════════════════════════════════════
//  broadcaster.js
//
//  FLOW:
//    Microphone (USB interface set as system default)
//    → Web SpeechRecognition (Chrome built-in, free)
//    → MyMemory API translation (free, no key)
//    → WebSocket → server → all receiver clients
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
const tgtLangEl     = document.getElementById('tgt-lang');
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

let finalSrc      = '';
let finalTgt      = '';
let interimSrc    = '';
let phraseCount   = 0;

let translateTimer = null;
let interimTimer   = null;

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
  if (finalSrc)   h += `<span class="final">${esc(finalSrc)} </span>`;
  if (interimSrc) h += `<span class="interim">${esc(interimSrc)}</span>`;
  srcBody.innerHTML = h || '<span class="ph">Waiting for speech…</span>';
  srcBody.scrollTop = srcBody.scrollHeight;
}
function renderTgt() {
  tgtBody.innerHTML = finalTgt
    ? `<span class="tgt-final">${esc(finalTgt)}</span>`
    : '<span class="ph">Translation sent to receivers…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// ── WebSocket connection ──────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'broadcaster' }));
    wsStatusEl.textContent = '🟢 Connected';
    setStatus('Connected to server. Select audio input and tap Start.', 'ok');
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'receivers') {
      receiverCount.textContent = msg.count;
    }
  };

  ws.onclose = () => {
    wsStatusEl.textContent = '🔴 Disconnected';
    setStatus('Lost connection to server. Reconnecting…', 'error');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Device list ───────────────────────────────────────────────────
async function refreshDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch(e) {
    setStatus('Microphone permission denied. Allow it and refresh.', 'error'); return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === 'audioinput');
  audioInputEl.innerHTML = '';
  inputs.forEach(d => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || 'Input ' + d.deviceId.slice(0,8);
    audioInputEl.appendChild(o);
  });
  setStatus(`Found ${inputs.length} audio input(s). Set your USB interface as system default, then Start.`, 'ok');
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

// ── MyMemory translation ──────────────────────────────────────────
async function translate(text, sl, tl) {
  if (!text || sl === tl) return text;
  const url = 'https://api.mymemory.translated.net/get'
    + '?q=' + encodeURIComponent(text.trim())
    + '&langpair=' + sl + '|' + tl;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails);
  return data.responseData.translatedText;
}

async function translateAndSend(phrase) {
  const sl = srcLangEl.value, tl = tgtLangEl.value;
  spinner.classList.remove('hidden');
  try {
    const out = await translate(phrase, sl, tl);
    if (!out) return;
    finalTgt = (finalTgt ? finalTgt + ' ' : '') + out;
    renderTgt();
    phraseCount++;
    phrasesSent.textContent = phraseCount;
    // Send to all receivers
    send({ type: 'final', text: out, lang: tl });
    setStatus(`✓ Sent: "${out.slice(0,50)}${out.length>50?'…':''}"`, 'ok');
  } catch(e) {
    setStatus('Translation error: ' + e.message, 'error');
  } finally {
    spinner.classList.add('hidden');
  }
}

async function translateInterimAndSend(text) {
  const sl = srcLangEl.value, tl = tgtLangEl.value;
  try {
    const out = await translate(text, sl, tl);
    if (out) send({ type: 'interim', text: out, lang: tl });
  } catch(_) {}
}

// ── Speech recognition ────────────────────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  goBtn.disabled = true;
  goLabel.textContent = 'Use Chrome or Edge — speech not supported here';
}

function buildRecognition() {
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.lang = BCP47[srcLangEl.value] || srcLangEl.value;

  r.onresult = e => {
    let newInterim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalSrc  += (finalSrc ? ' ' : '') + t.trim();
        newInterim = ''; interimSrc = '';
        renderSrc();
        clearTimeout(translateTimer);
        translateTimer = setTimeout(() => translateAndSend(t.trim()), 200);
      } else {
        newInterim += t;
      }
    }
    if (newInterim !== interimSrc) {
      interimSrc = newInterim; renderSrc();
      clearTimeout(interimTimer);
      if (newInterim.trim().split(/\s+/).length >= 3) {
        interimTimer = setTimeout(() => translateInterimAndSend(newInterim.trim()), 1400);
      }
    }
  };

  r.onerror = e => {
    if (e.error === 'no-speech') { if (shouldRestart) scheduleRestart(200); return; }
    if (e.error === 'not-allowed') { stop(); setStatus('Microphone blocked. Allow access.', 'error'); return; }
    if (shouldRestart) scheduleRestart(500);
  };
  r.onend = () => { if (shouldRestart) scheduleRestart(150); else stopAll(); };
  return r;
}

function scheduleRestart(delay) {
  setTimeout(() => {
    if (!shouldRestart) return;
    try { recognition = buildRecognition(); recognition.start(); } catch(_) {}
  }, delay);
}

function startAll() {
  shouldRestart = true; isRunning = true;
  recognition = buildRecognition();
  try { recognition.start(); }
  catch(e) { setStatus('Cannot start mic: ' + e.message, 'error'); stopAll(); return; }
  goBtn.classList.add('active');
  goIcon.textContent = '⏹'; goLabel.textContent = 'Stop Broadcasting';
  liveDot.classList.add('on');
  setStatus('🎤 Broadcasting live…', 'info');
}

function stopAll() {
  shouldRestart = false; isRunning = false;
  if (recognition) { try { recognition.stop(); } catch(_){} }
  goBtn.classList.remove('active');
  goIcon.textContent = '🎤'; goLabel.textContent = 'Start Broadcasting';
  liveDot.classList.remove('on');
  setStatus('Stopped.', '');
}

goBtn.addEventListener('click', () => { if (isRunning) stopAll(); else startAll(); });

clearBtn.addEventListener('click', () => {
  finalSrc = ''; finalTgt = ''; interimSrc = ''; phraseCount = 0;
  phrasesSent.textContent = '0';
  renderSrc(); renderTgt();
  send({ type: 'clear' });
  setStatus('Cleared.', '');
});

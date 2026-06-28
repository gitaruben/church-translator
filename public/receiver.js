// ════════════════════════════════════════════════════════════════
//  receiver.js
//
//  Connects to the server via WebSocket, receives translated
//  phrases, displays them, and speaks them aloud via TTS.
//  Works on any device with a browser — phone, tablet, laptop.
// ════════════════════════════════════════════════════════════════

// ── DOM ──────────────────────────────────────────────────────────
const activateBtn    = document.getElementById('activate-btn');
const activateLabel  = document.getElementById('activate-label');
const connStatus     = document.getElementById('conn-status');
const phrasesRecvEl  = document.getElementById('phrases-received');
const speedEl        = document.getElementById('speed');
const speedValEl     = document.getElementById('speed-val');
const volumeEl       = document.getElementById('volume');
const volValEl       = document.getElementById('vol-val');
const showInterimEl  = document.getElementById('show-interim');
const tgtBody        = document.getElementById('tgt-body');
const recvDot        = document.getElementById('recv-dot');
const replayBtn      = document.getElementById('replay-btn');
const clearBtn       = document.getElementById('clear-btn');
const statusEl       = document.getElementById('status');

// ── State ────────────────────────────────────────────────────────
let ws           = null;
let activated    = false;
let finalText    = '';
let lastPhrase   = '';
let phraseCount  = 0;
let speechRate   = 0.85;
let speechVol    = 1.0;

// TTS queue
let ttsQueue = [];
let ttsBusy  = false;

// ── Helpers ──────────────────────────────────────────────────────
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}
function renderTgt(interimText) {
  let h = '';
  if (finalText)   h += `<span class="tgt-final">${esc(finalText)} </span>`;
  if (interimText && showInterimEl.checked)
                   h += `<span class="tgt-interim">${esc(interimText)}…</span>`;
  tgtBody.innerHTML = h || '<span class="ph">Waiting for broadcast…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// ── Sliders ───────────────────────────────────────────────────────
speedEl.addEventListener('input', () => {
  speechRate = parseFloat(speedEl.value);
  speedValEl.textContent = speechRate.toFixed(2) + '×';
});
volumeEl.addEventListener('input', () => {
  speechVol = parseFloat(volumeEl.value);
  volValEl.textContent = Math.round(speechVol * 100) + '%';
});

// ── TTS ───────────────────────────────────────────────────────────
function enqueueSpeech(text, lang, vol, rate) {
  ttsQueue.push({ text, lang, vol, rate });
  if (!ttsBusy) drainQueue();
}
function drainQueue() {
  if (!ttsQueue.length) { ttsBusy = false; return; }
  ttsBusy = true;
  const item = ttsQueue.shift();
  speakNow(item.text, item.lang, item.vol, item.rate, drainQueue);
}
function speakNow(text, lang, vol, rate, onDone) {
  if (!activated || !('speechSynthesis' in window)) { if (onDone) onDone(); return; }
  window.speechSynthesis.cancel();

  const BCP47 = {
    ro:'ro-RO', en:'en-US', ne:'ne-NP', hi:'hi-IN',
    fr:'fr-FR', de:'de-DE', es:'es-ES', it:'it-IT',
    pt:'pt-PT', ru:'ru-RU', uk:'uk-UA', pl:'pl-PL',
    hu:'hu-HU', ar:'ar-SA', zh:'zh-CN', ja:'ja-JP', ko:'ko-KR'
  };

  const utt    = new SpeechSynthesisUtterance(text.trim());
  utt.lang     = BCP47[lang] || lang;
  utt.rate     = rate ?? speechRate;
  utt.volume   = vol  ?? speechVol;
  const voices = window.speechSynthesis.getVoices();
  const match  = voices.find(v => v.lang === utt.lang)
              || voices.find(v => v.lang.startsWith(lang));
  if (match) utt.voice = match;
  utt.onend   = () => { if (onDone) onDone(); };
  utt.onerror = e => { if (e.error !== 'interrupted' && onDone) onDone(); };
  window.speechSynthesis.speak(utt);
}

// ── Activate button ───────────────────────────────────────────────
// Browsers block TTS until the user taps something.
// This button fulfils that requirement.
activateBtn.addEventListener('click', () => {
  if (activated) return;
  activated = true;
  activateBtn.classList.add('green', 'active');
  activateLabel.textContent = 'Receiving — listening for broadcast';
  setStatus('✓ Active. Translation will speak automatically.', 'ok');
  recvDot.classList.add('on');

  // Preload voices
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  connectWS();
});

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'receiver' }));
    connStatus.textContent = '🟢 Connected';
    setStatus('Connected. Waiting for preacher to speak…', 'info');
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'clear') {
      finalText = ''; lastPhrase = ''; phraseCount = 0;
      phrasesRecvEl.textContent = '0';
      window.speechSynthesis.cancel();
      ttsQueue = []; ttsBusy = false;
      renderTgt('');
      setStatus('Screen cleared by broadcaster.', '');
      return;
    }

    if (msg.type === 'interim') {
      // Show interim text softly; whisper it
      renderTgt(msg.text);
      // Whisper at 25% volume so it doesn't interrupt the final
      enqueueSpeech(msg.text, msg.lang, Math.min(speechVol * 0.25, 0.3), Math.min(speechRate + 0.1, 1.5));
      return;
    }

    if (msg.type === 'final') {
      finalText = (finalText ? finalText + ' ' : '') + msg.text;
      lastPhrase = msg.text;
      phraseCount++;
      phrasesRecvEl.textContent = phraseCount;
      renderTgt('');
      // Cancel any whisper and speak the final phrase clearly and loudly
      ttsQueue = []; ttsBusy = false;
      window.speechSynthesis.cancel();
      enqueueSpeech(msg.text, msg.lang, speechVol, speechRate);
      setStatus('🔊 ' + msg.text.slice(0, 70) + (msg.text.length > 70 ? '…' : ''), 'info');
    }
  };

  ws.onclose = () => {
    connStatus.textContent = '🔴 Disconnected';
    setStatus('Lost connection. Reconnecting in 2s…', 'error');
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
}

// ── Controls ──────────────────────────────────────────────────────
replayBtn.addEventListener('click', () => {
  if (!lastPhrase) { setStatus('Nothing to replay yet.', ''); return; }
  ttsQueue = []; ttsBusy = false;
  window.speechSynthesis.cancel();
  speakNow(lastPhrase, null, speechVol, speechRate, null);
  // detect lang from last message — we'll re-speak using whatever voice was last used
  setStatus('🔊 Replaying…', 'info');
});

clearBtn.addEventListener('click', () => {
  finalText = ''; lastPhrase = ''; phraseCount = 0;
  phrasesRecvEl.textContent = '0';
  window.speechSynthesis.cancel();
  ttsQueue = []; ttsBusy = false;
  renderTgt('');
  setStatus('Cleared.', '');
});

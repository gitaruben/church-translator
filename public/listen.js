// ════════════════════════════════════════════════════════════════
//  listen.js — v4
//  KEY CHANGES:
//  - Phrases shown as new lines, not appended inline
//  - Final phrases: displayed + spoken once, never repeated
//  - Interim phrases: displayed only (no TTS) — avoids overlap
//    and clutter; TTS fires only on confirmed final phrases
//  - Dedup by normalized translated text
// ════════════════════════════════════════════════════════════════

const BCP47 = {
  ro:'ro-RO', en:'en-US', ne:'ne-NP', hi:'hi-IN',
  fr:'fr-FR', de:'de-DE', es:'es-ES', it:'it-IT',
  pt:'pt-PT', ru:'ru-RU', uk:'uk-UA', pl:'pl-PL',
  hu:'hu-HU', ar:'ar-SA', zh:'zh-CN', ja:'ja-JP', ko:'ko-KR'
};
const LANG_NAMES = {
  ro:'Romanian', en:'English', ne:'Nepali', hi:'Hindi',
  fr:'French', de:'German', es:'Spanish', it:'Italian',
  pt:'Portuguese', ru:'Russian', uk:'Ukrainian', pl:'Polish',
  hu:'Hungarian', ar:'Arabic', zh:'Chinese', ja:'Japanese', ko:'Korean'
};

// ── DOM ──────────────────────────────────────────────────────────
const activateBtn   = document.getElementById('activate-btn');
const activateLabel = document.getElementById('activate-label');
const stopBtn       = document.getElementById('stop-btn');
const connStatus    = document.getElementById('conn-status');
const phrasesEl     = document.getElementById('phrases-received');
const tgtLangEl     = document.getElementById('tgt-lang');
const tgtLangLabel  = document.getElementById('tgt-lang-label');
const speedEl       = document.getElementById('speed');
const speedValEl    = document.getElementById('speed-val');
const volumeEl      = document.getElementById('volume');
const volValEl      = document.getElementById('vol-val');
const showInterimEl = document.getElementById('show-interim');
const tgtBody       = document.getElementById('tgt-body');
const recvDot       = document.getElementById('recv-dot');
const replayBtn     = document.getElementById('replay-btn');
const clearBtn      = document.getElementById('clear-btn');
const statusEl      = document.getElementById('status');

// ── State ────────────────────────────────────────────────────────
let ws             = null;
let activated      = false;
let isSpeaking     = false;

let displayLines   = [];    // confirmed translated lines shown on screen
let interimDisplay = '';    // current interim text shown (not spoken)
let lastPhrase     = '';
let lastPhraseLang = 'ne';

// Dedup: normalized translated phrase → never spoken twice
const spokenPhrases = new Set();

// In-flight translation cache
const pendingTranslations = new Map();

let speechRate = 0.85;
let speechVol  = 1.0;

// ── Helpers ──────────────────────────────────────────────────────
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}
function normalizePhrase(t) {
  return t.trim().replace(/\s+/g,' ').toLowerCase();
}

function renderDisplay() {
  let h = displayLines.map(l => `<div class="tgt-line">${esc(l)}</div>`).join('');
  if (interimDisplay && showInterimEl.checked) {
    h += `<div class="tgt-interim">${esc(interimDisplay)}…</div>`;
  }
  tgtBody.innerHTML = h || '<span class="ph">Waiting for broadcast…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// ── Sliders — ONLY update variables ──────────────────────────────
speedEl.addEventListener('input', () => {
  speechRate = parseFloat(speedEl.value);
  speedValEl.textContent = speechRate.toFixed(2) + '×';
});
volumeEl.addEventListener('input', () => {
  speechVol = parseFloat(volumeEl.value);
  volValEl.textContent = Math.round(speechVol * 100) + '%';
});

// ── Language change ───────────────────────────────────────────────
tgtLangEl.addEventListener('change', () => {
  const name = LANG_NAMES[tgtLangEl.value] || tgtLangEl.value;
  tgtLangLabel.textContent = name;
  displayLines = []; interimDisplay = ''; lastPhrase = '';
  spokenPhrases.clear();
  pendingTranslations.clear();
  stopSpeaking();
  renderDisplay();
  setStatus('Language: ' + name + '. Ready.', 'ok');
});

// ── TTS ───────────────────────────────────────────────────────────
function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  isSpeaking = false;
  stopBtn.classList.add('hidden');
}

function speakNow(text, langCode, vol, rate) {
  if (!activated || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const utt    = new SpeechSynthesisUtterance(text.trim());
  utt.lang     = BCP47[langCode] || langCode || 'en-US';
  utt.rate     = rate ?? speechRate;
  utt.volume   = vol  ?? speechVol;

  const voices = window.speechSynthesis.getVoices();
  const match  = voices.find(v => v.lang === utt.lang)
              || voices.find(v => v.lang.startsWith(langCode));
  if (match) utt.voice = match;

  utt.onstart = () => { isSpeaking = true;  stopBtn.classList.remove('hidden'); };
  utt.onend   = () => { isSpeaking = false; stopBtn.classList.add('hidden'); };
  utt.onerror = (ev) => {
    if (ev.error !== 'interrupted') setStatus('Speech error: ' + ev.error, 'error');
    isSpeaking = false;
    stopBtn.classList.add('hidden');
  };

  window.speechSynthesis.speak(utt);
}

// ── Translation ───────────────────────────────────────────────────
async function translate(srcText, srcLang, tgtLang) {
  if (!srcText || !srcText.trim()) return null;
  if (srcLang === tgtLang) return srcText;
  const key = srcText + '|' + srcLang + '|' + tgtLang;
  if (pendingTranslations.has(key)) return pendingTranslations.get(key);
  const promise = fetch(
    'https://api.mymemory.translated.net/get'
    + '?q='        + encodeURIComponent(srcText.trim())
    + '&langpair=' + srcLang + '|' + tgtLang
  )
  .then(r => r.json())
  .then(data => {
    pendingTranslations.delete(key);
    if (data.responseStatus !== 200) throw new Error(data.responseDetails);
    return data.responseData.translatedText;
  })
  .catch(e => { pendingTranslations.delete(key); throw e; });
  pendingTranslations.set(key, promise);
  return promise;
}

// ── Handle FINAL phrase ───────────────────────────────────────────
// Translate → add as new line → speak once → never repeat
async function handleFinal(srcText, srcLang) {
  const tl = tgtLangEl.value;
  let out;
  try {
    out = await translate(srcText, srcLang, tl);
  } catch(e) {
    setStatus('Translation error — check internet.', 'error'); return;
  }
  if (!out) return;

  const normalized = normalizePhrase(out);
  if (spokenPhrases.has(normalized)) return;  // already spoken — skip
  spokenPhrases.add(normalized);

  // Clear interim display — final phrase replaces it
  interimDisplay = '';
  displayLines.push(out);
  lastPhrase     = out;
  lastPhraseLang = tl;
  phrasesEl.textContent = spokenPhrases.size;
  renderDisplay();

  // Speak it — this is the only place TTS fires for final phrases
  speakNow(out, tl, speechVol, speechRate);
  setStatus('🔊 ' + out.slice(0, 70) + (out.length > 70 ? '…' : ''), 'info');
}

// ── Handle INTERIM chunk ──────────────────────────────────────────
// Translate → show on screen ONLY — no TTS for interim
// This keeps the listener slightly ahead visually without audio clutter
async function handleInterim(srcText, srcLang) {
  const tl = tgtLangEl.value;
  let out;
  try {
    out = await translate(srcText, srcLang, tl);
  } catch { return; }
  if (!out) return;

  const normalized = normalizePhrase(out);
  if (spokenPhrases.has(normalized)) return;  // already spoken as final — don't re-show

  interimDisplay = out;
  renderDisplay();
  // NO speakNow() here — interim is display-only
}

// ── Activate ──────────────────────────────────────────────────────
activateBtn.addEventListener('click', () => {
  if (activated) return;
  activated = true;
  activateBtn.classList.add('green', 'active');
  activateLabel.textContent = 'Connected — translation plays automatically';
  tgtLangLabel.textContent  = LANG_NAMES[tgtLangEl.value] || tgtLangEl.value;
  recvDot.classList.add('on');
  setStatus('✓ Active. Waiting for preacher to speak…', 'ok');
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  connectWS();
});

stopBtn.addEventListener('click', () => { stopSpeaking(); setStatus('Stopped.', ''); });

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'receiver' }));
    connStatus.textContent = '🟢 Connected';
    setStatus('Connected. Waiting for broadcast…', 'info');
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'clear') {
      displayLines = []; interimDisplay = ''; lastPhrase = '';
      spokenPhrases.clear(); pendingTranslations.clear();
      stopSpeaking();
      phrasesEl.textContent = '0';
      renderDisplay();
      setStatus('Cleared by booth.', '');
      return;
    }
    if (msg.type === 'interim') { handleInterim(msg.srcText, msg.srcLang); return; }
    if (msg.type === 'final')   { handleFinal(msg.srcText, msg.srcLang);   return; }
  };
  ws.onclose = () => {
    connStatus.textContent = '🔴 Disconnected';
    setStatus('Lost connection. Reconnecting…', 'error');
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
}

// ── Controls ──────────────────────────────────────────────────────
replayBtn.addEventListener('click', () => {
  if (!lastPhrase) { setStatus('Nothing to replay yet.', ''); return; }
  speakNow(lastPhrase, lastPhraseLang, speechVol, speechRate);
  setStatus('🔊 Replaying…', 'info');
});
clearBtn.addEventListener('click', () => {
  displayLines = []; interimDisplay = ''; lastPhrase = '';
  spokenPhrases.clear(); pendingTranslations.clear();
  stopSpeaking();
  phrasesEl.textContent = '0';
  renderDisplay();
  setStatus('Cleared.', '');
});

// ════════════════════════════════════════════════════════════════
//  receiver.js — v3
//
//  KEY FIXES:
//  - sentPhrases Set: every spoken phrase tracked — never spoken twice
//  - Interim handled separately from final, never queued on top
//  - Volume/speed sliders only update variables, never retrigger speech
//  - Stop button works immediately
//  - Language change clears state cleanly
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
let ws           = null;
let activated    = false;
let isSpeaking   = false;

let displayText  = '';       // all confirmed text shown on screen
let lastPhrase   = '';       // last final phrase spoken (for replay)
let lastPhraseLang = 'ne';   // language of lastPhrase

// THE FIX: track every phrase we've already spoken
// Key = normalized translated text → prevents any phrase playing twice
const spokenPhrases = new Set();

// In-flight translation requests: srcText → promise
// So if the same interim arrives twice we don't double-translate
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
function renderDisplay(interimText) {
  let h = '';
  if (displayText) h += `<span class="tgt-final">${esc(displayText)} </span>`;
  if (interimText && showInterimEl.checked)
    h += `<span class="tgt-interim">${esc(interimText)}…</span>`;
  tgtBody.innerHTML = h || '<span class="ph">Waiting for broadcast…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// ── Sliders — ONLY update variables, no speech side effects ──────
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
  // Clear everything — new language = fresh session
  displayText = ''; lastPhrase = '';
  spokenPhrases.clear();
  pendingTranslations.clear();
  stopSpeaking();
  renderDisplay('');
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

  utt.onstart = () => { isSpeaking = true; stopBtn.classList.remove('hidden'); };
  utt.onend   = () => { isSpeaking = false; stopBtn.classList.add('hidden'); };
  utt.onerror = (ev) => {
    if (ev.error !== 'interrupted') setStatus('Speech error: ' + ev.error, 'error');
    isSpeaking = false;
    stopBtn.classList.add('hidden');
  };

  window.speechSynthesis.speak(utt);
}

// ── Translation (MyMemory, free, no key) ─────────────────────────
async function translate(srcText, srcLang, tgtLang) {
  if (!srcText || !srcText.trim()) return null;
  if (srcLang === tgtLang) return srcText;

  // Reuse in-flight request for same text (avoids double API calls)
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
  .catch(err => { pendingTranslations.delete(key); throw err; });

  pendingTranslations.set(key, promise);
  return promise;
}

// ── Handle incoming FINAL phrase ──────────────────────────────────
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

  // If we already spoke this exact translated phrase — skip
  if (spokenPhrases.has(normalized)) return;
  spokenPhrases.add(normalized);

  displayText = (displayText ? displayText + ' ' : '') + out;
  lastPhrase  = out;
  lastPhraseLang = tl;
  phrasesEl.textContent = spokenPhrases.size;
  renderDisplay('');

  // Interrupt any interim whisper and speak clearly
  speakNow(out, tl, speechVol, speechRate);
  setStatus('🔊 ' + out.slice(0, 70) + (out.length > 70 ? '…' : ''), 'info');
}

// ── Handle incoming INTERIM chunk ────────────────────────────────
async function handleInterim(srcText, srcLang) {
  // If something final is currently being spoken, don't interrupt
  if (isSpeaking) { renderDisplay(srcText); return; }

  const tl = tgtLangEl.value;
  let out;
  try {
    out = await translate(srcText, srcLang, tl);
  } catch { return; }
  if (!out) return;

  const normalized = normalizePhrase(out);

  // If this interim text was already spoken as a final — skip
  if (spokenPhrases.has(normalized)) return;

  // Show it on screen
  renderDisplay(out);

  // Whisper at 22% volume — soft preview
  speakNow(out, tl, Math.min(speechVol * 0.22, 0.25), Math.min(speechRate + 0.1, 1.5));
}

// ── Activate ─────────────────────────────────────────────────────
activateBtn.addEventListener('click', () => {
  if (activated) return;
  activated = true;
  activateBtn.classList.add('green', 'active');
  activateLabel.textContent = 'Receiving — translation plays automatically';
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
      displayText = ''; lastPhrase = '';
      spokenPhrases.clear();
      pendingTranslations.clear();
      stopSpeaking();
      phrasesEl.textContent = '0';
      renderDisplay('');
      setStatus('Cleared by broadcaster.', '');
      return;
    }

    if (msg.type === 'interim') {
      handleInterim(msg.srcText, msg.srcLang);
      return;
    }

    if (msg.type === 'final') {
      handleFinal(msg.srcText, msg.srcLang);
      return;
    }
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
  displayText = ''; lastPhrase = '';
  spokenPhrases.clear();
  pendingTranslations.clear();
  stopSpeaking();
  phrasesEl.textContent = '0';
  renderDisplay('');
  setStatus('Cleared.', '');
});

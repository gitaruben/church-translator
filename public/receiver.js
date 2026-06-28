// ════════════════════════════════════════════════════════════════
//  receiver.js  — FIXED VERSION
//
//  Bugs fixed vs previous version:
//    1. Visitor can now choose their own language
//    2. Stop button actually cancels TTS immediately
//    3. Phrase deduplication — same phrase never plays twice
//    4. Volume/speed slider changes do NOT re-trigger speech
//    5. Interim whisper no longer queues on top of final speech
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
let ws            = null;
let activated     = false;
let isSpeaking    = false;
let finalText     = '';       // all confirmed translated text shown on screen
let lastPhrase    = '';       // last final translated phrase (for replay)
let lastPhraseId  = '';       // dedup key — hash of srcText to avoid repeats
let phraseCount   = 0;

// Settings — only read when actually speaking, NOT on slider input
// This prevents the slider from triggering re-speech
let speechRate    = 0.85;
let speechVol     = 1.0;

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
  if (finalText)  h += `<span class="tgt-final">${esc(finalText)} </span>`;
  if (interimText && showInterimEl.checked)
                  h += `<span class="tgt-interim">${esc(interimText)}…</span>`;
  tgtBody.innerHTML = h || '<span class="ph">Waiting for broadcast…</span>';
  tgtBody.scrollTop = tgtBody.scrollHeight;
}

// Simple hash to deduplicate identical incoming phrases
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString();
}

// ── Sliders — ONLY update variables, never trigger speech ────────
speedEl.addEventListener('input', () => {
  speechRate = parseFloat(speedEl.value);
  speedValEl.textContent = speechRate.toFixed(2) + '×';
  // No speakNow() call here — that was the bug
});

volumeEl.addEventListener('input', () => {
  speechVol = parseFloat(volumeEl.value);
  volValEl.textContent = Math.round(speechVol * 100) + '%';
  // No speakNow() call here — that was the bug
});

// Language selector — update label, clear old text (new lang = new session)
tgtLangEl.addEventListener('change', () => {
  tgtLangLabel.textContent = LANG_NAMES[tgtLangEl.value] || tgtLangEl.value;
  finalText = ''; lastPhrase = ''; lastPhraseId = '';
  stopSpeaking();
  renderTgt('');
  setStatus('Language changed to ' + (LANG_NAMES[tgtLangEl.value] || tgtLangEl.value) + '. Ready.', 'ok');
});

// ── TTS — simple, no queue (final always interrupts interim) ─────
function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  isSpeaking = false;
  stopBtn.classList.add('hidden');
}

function speakText(text, lang, vol, rate) {
  if (!activated) return;
  if (!('speechSynthesis' in window)) return;

  // Cancel anything currently playing
  window.speechSynthesis.cancel();

  const utt    = new SpeechSynthesisUtterance(text.trim());
  utt.lang     = BCP47[lang] || lang || 'en-US';
  utt.rate     = rate ?? speechRate;
  utt.volume   = vol  ?? speechVol;

  const voices = window.speechSynthesis.getVoices();
  const code   = lang || 'en';
  const match  = voices.find(v => v.lang === utt.lang)
              || voices.find(v => v.lang.startsWith(code));
  if (match) utt.voice = match;

  utt.onstart = () => {
    isSpeaking = true;
    stopBtn.classList.remove('hidden');
  };
  utt.onend = () => {
    isSpeaking = false;
    stopBtn.classList.add('hidden');
  };
  utt.onerror = (e) => {
    if (e.error !== 'interrupted') setStatus('Speech error: ' + e.error, 'error');
    isSpeaking = false;
    stopBtn.classList.add('hidden');
  };

  window.speechSynthesis.speak(utt);
}

// ── MyMemory translation (free, no key) ──────────────────────────
async function translateText(text, srcLang, tgtLang) {
  if (!text || !text.trim()) return null;
  if (srcLang === tgtLang) return text;
  const url = 'https://api.mymemory.translated.net/get'
    + '?q='        + encodeURIComponent(text.trim())
    + '&langpair=' + srcLang + '|' + tgtLang;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'translation error');
  return data.responseData.translatedText;
}

// ── Activate ─────────────────────────────────────────────────────
activateBtn.addEventListener('click', () => {
  if (activated) return;
  activated = true;
  activateBtn.classList.add('green', 'active');
  activateLabel.textContent = 'Receiving — listening for broadcast';
  tgtLangLabel.textContent  = LANG_NAMES[tgtLangEl.value] || tgtLangEl.value;
  recvDot.classList.add('on');
  setStatus('✓ Active. Translation will speak automatically.', 'ok');

  // Preload TTS voices
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  connectWS();
});

// ── Stop button ───────────────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  stopSpeaking();
  setStatus('Stopped.', '');
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

  ws.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    // ── Clear ────────────────────────────────────────────────────
    if (msg.type === 'clear') {
      finalText = ''; lastPhrase = ''; lastPhraseId = ''; phraseCount = 0;
      phrasesEl.textContent = '0';
      stopSpeaking();
      renderTgt('');
      setStatus('Screen cleared by broadcaster.', '');
      return;
    }

    // ── Interim ──────────────────────────────────────────────────
    // Only show/whisper if nothing final is currently speaking
    if (msg.type === 'interim') {
      if (isSpeaking) return;  // don't interrupt a final phrase with a whisper
      const tl = tgtLangEl.value;
      try {
        const out = await translateText(msg.srcText, msg.srcLang, tl);
        if (!out) return;
        renderTgt(out);
        // Whisper softly — 20% of current volume
        speakText(out, tl, Math.min(speechVol * 0.2, 0.25), Math.min(speechRate + 0.1, 1.5));
      } catch(_) { /* silently ignore interim translation errors */ }
      return;
    }

    // ── Final ─────────────────────────────────────────────────────
    if (msg.type === 'final') {
      const tl = tgtLangEl.value;

      // Deduplication — same source phrase must not play twice
      const id = hashStr(msg.srcText + msg.srcLang);
      if (id === lastPhraseId) return;
      lastPhraseId = id;

      try {
        const out = await translateText(msg.srcText, msg.srcLang, tl);
        if (!out) return;

        finalText = (finalText ? finalText + ' ' : '') + out;
        lastPhrase = out;
        phraseCount++;
        phrasesEl.textContent = phraseCount;
        renderTgt('');

        // Speak at full volume — this cancels any interim whisper
        speakText(out, tl, speechVol, speechRate);
        setStatus('🔊 ' + out.slice(0, 70) + (out.length > 70 ? '…' : ''), 'info');
      } catch(err) {
        setStatus('Translation error — check internet.', 'error');
      }
    }
  };

  ws.onclose = () => {
    connStatus.textContent = '🔴 Disconnected';
    setStatus('Lost connection. Reconnecting in 2s…', 'error');
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
}

// ── Replay / Clear ────────────────────────────────────────────────
replayBtn.addEventListener('click', () => {
  if (!lastPhrase) { setStatus('Nothing to replay yet.', ''); return; }
  speakText(lastPhrase, tgtLangEl.value, speechVol, speechRate);
  setStatus('🔊 Replaying…', 'info');
});

clearBtn.addEventListener('click', () => {
  finalText = ''; lastPhrase = ''; lastPhraseId = ''; phraseCount = 0;
  phrasesEl.textContent = '0';
  stopSpeaking();
  renderTgt('');
  setStatus('Cleared.', '');
});

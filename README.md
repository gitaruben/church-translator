# ✝️ Church Live Translator

**Mixing console → USB interface → PC → live translation → visitor's phone/tablet**

Two devices. One broadcasts. Many receive. No app to install on the visitor's phone.

---

## How it works

```
Sound booth PC
  └─ Microphone (USB interface, set as system default)
  └─ Chrome browser → /broadcaster
       └─ Hears the preacher (Web SpeechRecognition — free)
       └─ Translates each phrase (MyMemory API — free)
       └─ Sends via WebSocket to server

Server (local PC or cloud)
  └─ Relays translated phrases to all connected receivers

Visitor's phone/tablet/laptop
  └─ Opens /receiver in any browser
       └─ Receives translated text instantly
       └─ Speaks it aloud (Web SpeechSynthesis — free)
```

---

## Files

```
church-translator/
  server.js              ← Node.js WebSocket server
  package.json           ← dependencies (express + ws)
  Procfile               ← for Railway/Render cloud deploy
  start.bat              ← Windows double-click launcher
  start.sh               ← Mac/Linux launcher
  public/
    index.html           ← home page (choose broadcaster or receiver)
    shared.css           ← shared styles
    broadcaster.js       ← sound booth logic
    broadcaster/
      index.html         ← broadcaster UI
    receiver.js          ← visitor logic
    receiver/
      index.html         ← receiver UI
```

---

## Option A — Local network (church WiFi)

### Requirements
- Node.js installed on the church PC (free: https://nodejs.org)
- Visitor's phone on the same WiFi as the church PC

### Steps

1. **Install Node.js** on the church PC from https://nodejs.org (LTS version)

2. **Double-click `start.bat`** (Windows) or run `./start.sh` (Mac)
   - First run installs packages automatically
   - You'll see the server start with URLs printed in the console

3. **Find your PC's local IP address**
   - Windows: open a new terminal → type `ipconfig` → look for IPv4 Address
   - Example: `192.168.1.45`

4. **Sound booth PC** opens:
   `http://localhost:3000/broadcaster`

5. **Visitor's phone** (on church WiFi) opens:
   `http://192.168.1.45:3000/receiver`
   (replace with your actual PC IP)

6. **Set USB interface as system default microphone**
   - Windows: right-click speaker icon → Sound Settings → Input → select USB interface
   - Mac: System Settings → Sound → Input → select USB interface

7. On broadcaster: click **Refresh**, select your device, click **Start Broadcasting**

8. On receiver: tap **Tap to start receiving** (required by browser for audio)

---

## Option B — Cloud (anyone on any network)

Deploy to Railway (free tier, ~$5/month credit included):

1. Create free account at https://railway.app

2. Install Railway CLI:
   ```
   npm install -g @railway/cli
   ```

3. In the `church-translator/` folder:
   ```
   railway login
   railway init
   railway up
   ```

4. Railway gives you a public URL like `https://church-translator.up.railway.app`

5. Share these links:
   - **Sound booth**: `https://your-app.up.railway.app/broadcaster`
   - **Visitor's phone**: `https://your-app.up.railway.app/receiver`

Alternatively, deploy to **Render** (also free):
1. Push to GitHub
2. Go to https://render.com → New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Done — free public URL

---

## APIs used — all free, no keys

| Step | API | Cost |
|------|-----|------|
| 🎤 Listen | Web SpeechRecognition (Chrome/Edge built-in) | Free |
| 🌐 Translate | MyMemory REST API | Free (~5000 words/day) |
| 🔊 Speak | Web SpeechSynthesis (any browser built-in) | Free |
| 📡 Relay | WebSocket (your own server) | Free |

---

## Tips

- **Broadcaster must use Chrome or Edge** (SpeechRecognition requirement)
- **Receiver works in any browser** on any device — Chrome, Safari, Firefox
- Multiple visitors can open `/receiver` at the same time
- The visitor taps "Tap to start receiving" once — after that it's fully automatic
- Use **Replay last phrase** if the visitor missed something
- **Speed slider** on the receiver — slow down the voice if needed
- To add more languages, just pick from the dropdowns — no code changes needed
- For better Nepali voice on Android: Settings → General Management →
  Language and Input → Text-to-speech → install Google TTS → download Nepali

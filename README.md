# PRAGATI AI — Ask · Align · Act

A voice-first, action-ready, human-controlled AI workspace. Working prototype of the concept deck.

## Run it (30 seconds, zero dependencies)
```bash
node server.js          # Node 18+, no npm install
# open http://localhost:3000   (PORT=4000 node server.js to change)
```
Click **Enter the console** (demo workspace with clearly labelled sample data), then press **▶ Autopilot demo** in the top bar.

Optional live AI (otherwise a fully offline rules engine runs; the UI always shows which engine is active):
```bash
ANTHROPIC_API_KEY=sk-ant-... node server.js     # or OPENAI_API_KEY=...
```
Voice input uses the browser Speech API, so use **Chrome or Edge**. Typing works everywhere.

## What maps to the deck
| Deck slide | In the app |
|---|---|
| Pragati Loop | `POST /api/orchestrate` plans with **no side effects**; steps run only after approval |
| Experience: Intent · Plan · Preview · Approve · Complete | Live 5-node loop tracker + plan theatre; every step has a state, a reason, Skip / Undo / Stop |
| Home console | WebGL voice orb reacting to mic level, voice status, orchestrator, privacy mode, workflow status (real numbers) |
| Five systems | Personal AI (chat), Work AI (email/agenda/report/stand-up), Study AI (your docs: summary, flashcards, grounded explain), Life Manager (board, reminders, notes), Smart Agent (saved workflows) |
| Hindi / Hinglish / English | e.g. `kal physics aur maths padhna hai, notes bana do aur shaam 7 baje yaad dilao` |
| Trust architecture | scrypt passwords, HMAC sessions, rate limits, **hash-chained audit ledger** with Verify, WebAuthn device lock (no biometric stored), transcript opt-out, export/erase, explicit confirm for consequential steps |
| Roadmap | Roadmap view + honest "Not available yet" for calls, social posting, laptop control, hardware |

## Honest limits
- Smart calls, social publishing, connected laptop and hardware are roadmap items, shown as "Not available yet" rather than faked.
- Reminders fire while Pragati is open (SSE + optional browser notification); no background push yet.
- The offline engine handles common patterns; add an API key for open-ended planning.

## Layout
`server.js` HTTP+SSE API · `lib/` engine, NLU, study, LLM, auth, store · `public/` ES-module frontend (no build step) · `test/api.test.js` end-to-end test (`npm test`). `server/` is an older generation kept from the original folder and is not used.

See `PITCH.md` for the 3-minute demo script and likely judge questions.

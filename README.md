# לכבוש את העולם — Conquer the World

Globe trivia conquest game. Static site (no build step) + Supabase (anonymous auth, Realtime rooms, leaderboards, TTS commentator).

## Files
- `index.html`, `app.js` — the game (globe.gl, Web Audio, Canvas poster)
- `online.js` — Supabase layer: auth, rooms (broadcast + presence), players/runs/friends, leaderboard RPC, `tts` edge function client
- `commentator.js` — host-only announcer (recorded voice via `tts`, browser voice fallback)
- `config.js` — `window.CW_CONFIG = { url, anonKey }` (Supabase project URL + publishable key)
- `data/` — countries, borders (simplified world-atlas 50m), bilingual question bank
- `flags/` — flag-icons SVGs
- `supabase/schema.sql` — tables, RLS, leaderboard functions, storage bucket
- `supabase/functions/tts/` — ElevenLabs edge function (secrets: `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`)

## Supabase prerequisites
- Auth → Providers → **Anonymous sign-ins: enabled** (players sign in silently; no email).
- Run `supabase/schema.sql`; deploy `supabase/functions/tts`; set secrets `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`).

## Run locally
Any static server, e.g. `npx serve .` — then open on a phone over the same network (or use `#debug` for 60s questions).

## Invite links
`https://<host>/?room=ABCD` opens the join flow with the code prefilled.

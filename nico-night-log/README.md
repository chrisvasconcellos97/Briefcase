# Nico Night Log

A mobile-first, one-handed baby-sleep event logger for exhausted parents at 3am.
Dark, offline-first PWA. No backend, no auth — everything lives in `localStorage`
on your phone and is written on every single tap.

## Features

- **Contextual primary button** — "Woke up" when asleep, "Back asleep" when awake.
- **Live AWAKE timer** counting up `mm:ss` since the last wake.
- **Auto-computed resettle durations** (asleep − wake) and FEED/RESETTLE tagging.
- **One-tap secondary events** — Check, Rescue, Binky?, and Fed (with size in one extra tap).
- **Copy for Claude** — exports the whole night as clean paste-able text (iOS-Safari safe).
- **Undo last** with no confirm; **New night** with a confirm + export nudge.
- **Installable PWA** — works fully offline, opens fullscreen from the home screen.

## Run locally

```bash
cd nico-night-log
npm install
npm run dev        # http://localhost:5173
```

Build + preview the production bundle:

```bash
npm run build
npm run preview
```

## Deploy to Vercel

The app is a static Vite build. From the `nico-night-log/` directory:

```bash
npm i -g vercel      # once
vercel               # first deploy (accept defaults; framework: Vite)
vercel --prod        # promote to production
```

Vercel auto-detects Vite (build command `vite build`, output `dist`). `vercel.json`
handles SPA routing and keeps the service worker uncached.

### Install on iPhone

Open the deployed URL in Safari → Share → **Add to Home Screen**. It launches
fullscreen and works with no signal.

## Data

Stored under the `localStorage` key `nico-night-log` as an array of events:

```js
{ id, ts, type, feedSource?, feedOz?, note? }
// type: 'bedtime' | 'wake' | 'check' | 'rescue' | 'binky' | 'feed' | 'asleep' | 'wakeforday'
```

Icons are generated dependency-free via `node scripts/gen-icons.mjs`.

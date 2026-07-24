# LocalTube

A YouTube-style front end for the videos already on your device — no
uploading, no accounts, no server. Point it at a folder (or your phone's
video picker) and it turns your own video files into a familiar,
YouTube-like browsing and watching experience: a home feed, Shorts, a
"channel" per folder, playlists, watch history, and a full custom player —
entirely offline, entirely client-side.

## Why

Built as a nicer way to browse and watch a personal video library — think
"replace my phone's gallery app for videos" or "replace opening a random
file explorer folder on my PC" — with a UI people already know how to use.

## Features

- **Home feed** built from your own videos, randomized on every load, with
  folder chips and a shuffle button
- **Shorts**: anything under 60s and portrait-ish gets its own vertical
  swipe/scroll feed (TikTok/Reels-style), separate from the regular player
- **Full custom video player**: scrubbing, volume, fullscreen, mini-player,
  autoplay-with-countdown, keyboard shortcuts
- **Mobile gestures**: double-tap to seek ±10s, swipe for volume/brightness
  in fullscreen, swipe up for a recommendations sheet — all toggleable in
  Settings
- **Multi-folder support** with a cached index per folder — reopening a
  folder loads instantly from cache, then re-scans in the background and
  only re-analyzes what actually changed
- **Channels** (folders), **Playlists** (Liked, Watch later, custom),
  **History** — all backed by IndexedDB, and resilient to a video's folder
  being temporarily unavailable (shows a "not found" state instead of
  breaking)
- **Media Session integration** — proper thumbnail/title on Android's
  media notification and lock screen, with working play/pause/seek/next
- **Installable PWA** with offline app-shell caching (videos themselves are
  always read live from disk, never cached)

## Running it

This needs to be served over `http://localhost` or `https://` — opening
`index.html` directly via `file://` will not work, because the File System
Access API, service workers, and IndexedDB all require a secure context.

```bash
npx serve .
# or any other static file server
```

Then open it in the browser and add a folder.

## Browser support

- **Folder access** (recursive scan of a real folder via the File System
  Access API): Chrome/Edge on desktop work best. Some Android Chrome
  versions support it too; where it's missing, the app automatically falls
  back to a native file/folder picker.
- **Orientation lock / fullscreen gestures**: best-effort. Browsers don't
  give web pages real control over the device's screen brightness or
  orientation lock outside of fullscreen — installing the app to the home
  screen (Add to Home Screen) tends to get the most reliable behavior here.
- Tested working well on desktop Chrome and Samsung Internet (including as
  an installed PWA). Mobile Chrome has had intermittent issues that seem
  tied to stale service worker caching — clearing site data usually
  resolves it.

## Project structure

```
index.html            App shell + markup for every view
css/style.css          All styling (light/dark theme, mobile + desktop layouts)
js/db.js               IndexedDB: folders, cached index, history, playlists
js/scanner.js           Directory scanning, metadata probing, cache diffing
js/player.js            Custom video player + mobile gesture handling
js/app.js               Routing, rendering, and all app logic
manifest.json / service-worker.js   PWA support
```

## Privacy

Nothing about your videos or usage ever leaves your device — there's no
backend. Everything (your folder list, watch history, playlists, cached
thumbnails) is stored locally in the browser's IndexedDB. Clearing site
data removes all of it.

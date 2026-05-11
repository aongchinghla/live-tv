# Single Page Live TV Viewer

A complete single-page live TV viewer built with **Next.js App Router**, **TypeScript**, **Tailwind CSS**, and **HLS.js**.

The layout matches the requested style:

- Big video player on the left
- Category tabs and channel logo grid on the right
- Search filter
- HTTPS-only filter
- Mobile responsive layout
- No login
- No subscription
- No backend
- No database

## Important legal note

Only publish streams you own, have permission to use, or that are officially free/public. Do not deploy copyrighted TV, sports, movie, or paid channel streams without permission.

## Setup

```bash
npm install
npm run dev
```

Open:

```bash
http://localhost:3000
```

## Channel data

The channel data is generated from:

```txt
data/playlist.m3u
```

Generated output:

```txt
lib/channels.ts
```

To update the playlist:

1. Replace `data/playlist.m3u` with your own legal M3U playlist.
2. Run:

```bash
npm run parse:m3u
```

3. Start the site again:

```bash
npm run dev
```

## Common playback issues

Some streams may not play because of:

- The stream is offline
- CORS is blocked by the stream provider
- The stream is region restricted
- The stream uses `http://` and your deployed website uses `https://`
- The M3U8 link has expired

For production deployment, HTTPS `.m3u8` streams are recommended.

## Project structure

```txt
app/
  layout.tsx
  page.tsx
  globals.css
components/
  HlsPlayer.tsx
lib/
  channels.ts
  types.ts
data/
  playlist.m3u
scripts/
  parse-m3u.js
```

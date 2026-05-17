# YouTube Music (IL) — Residential addon

A **separate** addon from the free `torrentio-music-addon`. Same loader.to
flow, but loader.to's per-IP flag is beaten by routing its calls through a
**residential proxy** (the only thing proven this session to clear it).
The free WARP addon is **unchanged** and keeps running independently.

Cost model (verified May 2026): personal music ≈ a few MB/song.
- Default (`PROXY_AUDIO` unset): only the tiny loader.to JSON API calls go
  through the proxy → **pennies/month**, bulk audio served direct.
- `PROXY_AUDIO=1`: all loader/CDN traffic via proxy (~$1–1.5/mo) — use
  only if the CDN byte-fetch is independently flagged.

## Step 0 — Free validation FIRST (spend $0 until proven)

The whole approach is gated on one question: does a residential IP actually
beat loader.to from a server? **Evomi has a free, no-credit-card trial** —
use it to prove it before paying anything.

1. Sign up at evomi.com → Residential product → start the **free trial**
   (no card). Copy the proxy endpoint + user/pass, e.g.
   `http://USER:PASS@rp.evomi.com:1000`.

## Step 1 — Create the new repo + Render service (separate from the free one)

2. New **GitHub repo** (e.g. `torrent-io-meyousic-addon-residential`),
   push this folder to it.
3. New **Render** Web Service from that repo (Node, free tier ok). Build:
   `npm install`; Start: `npm start`.
4. Render → Environment → add secret:
   - `RESIDENTIAL_PROXY_URL` = the Evomi URL from step 0
   - (optional) `PROXY_AUDIO` = `1` only if testing shows the audio
     byte-fetch is also flagged
5. After it deploys, note the new `https://<service>.onrender.com` URL and
   put it into `.github/workflows/keepalive.yml` (replace the placeholder).

## Step 2 — Verify (the decisive test)

- `GET /healthz` → should show `"egress":"residential(api-only)"`.
- Hit `/audio/<id>` for several different songs in a row (the exact test
  that 502'd on the free addon). If residential works, these succeed where
  WARP was intermittent. If the **free trial** can't clear it, **no paid
  residential will** (same pool classes) — stop, don't spend; keep the free
  addon only. That trial is the go/no-go.

## Step 3 — Use it in Meyousic

Install in the app via Add-addon → `https://<service>.onrender.com/manifest.json`.
Its provider id is `torrentio-music-res` (distinct), so it coexists with the
free addon — keep both installed; this one is the reliable mainstream path
once the proxy is set.

## If the trial succeeds

Either stay on Evomi PAYG (~$0.99/GB, no expiry, ~$1/mo worst case) or buy
one IPRoyal 1 GB block (~$7, never expires — likely lasts a year+ at
API-only volume). Same `RESIDENTIAL_PROXY_URL` format, just swap the value.

## Free angle (honest)

There is **no** free residential egress left that isn't already disproven
(WARP/Tor/Invidious/Piped/multi-Render/free-VPS). The free addon stays
best-effort; this one is the small-paid reliable option. If a genuinely
free residential method appears later, it drops in via the same
`RESIDENTIAL_PROXY_URL` seam — nothing else changes.

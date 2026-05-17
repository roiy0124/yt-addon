/**
 * Meyousic music addon — free, account-less, Render-friendly.
 *
 * Why this design (2026 reality):
 *   YouTube hard-blocks datacenter IPs (Render) at the player request, and
 *   the public Invidious/Piped/Cobalt relays all died. Doing extraction on
 *   Render is impossible without cookies. So we DON'T extract here:
 *
 *   /search → scrape youtube.com/results (the search page is NOT
 *             PoToken/bot gated — works fine from a datacenter IP, no auth)
 *   /stream → delegate to loader.to, a maintained public download service
 *             that does its own YouTube extraction on its own infra and
 *             serves the result from its CDN (savenow.to). YouTube never
 *             sees Render; the CDN URL is not IP-bound, so the phone fetches
 *             it directly. No API key, no account, no cookies.
 *
 * Tradeoff (honest): loader.to is third-party — it can rate-limit or change.
 * It's a maintained business though, far more durable than the dead
 * volunteer Invidious instances. /stream has ~5-15s first-play latency
 * (server-side conversion); results are cached so repeats are instant.
 */

import express from "express";
import { ProxyAgent } from "undici";

// Residential egress. Set RESIDENTIAL_PROXY_URL as a Render env-var secret
// (e.g. http://user:pass@rp.evomi.com:1000 — never commit it). loader.to's
// per-IP flag is beaten by a residential IP class, which a datacenter host
// (Render/VPS) can't provide itself; a cheap pay-as-you-go residential
// proxy (Evomi free trial → ~$1/mo) is the only thing proven to clear it.
// If unset, the addon runs DIRECT (datacenter) — same best-effort ceiling
// as the free addon, so it degrades gracefully, never hard-breaks.
const RESIDENTIAL_PROXY_URL = process.env.RESIDENTIAL_PROXY_URL || "";
const resProxy = RESIDENTIAL_PROXY_URL
  ? new ProxyAgent(RESIDENTIAL_PROXY_URL)
  : null;
// Cost lever: route only the tiny loader.to JSON API calls through paid
// residential (~cents/mo); serve the multi-MB audio bytes direct unless
// PROXY_AUDIO=1 (set it if the CDN byte-fetch is independently flagged).
const PROXY_AUDIO = process.env.PROXY_AUDIO === "1";

const app = express();
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const PROVIDER_ID = "torrentio-music-res";
const VERSION = "2.0.0";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MIN_DURATION_S = 30;
const MAX_DURATION_S = 15 * 60;

// --- cache (videoId stream + search) -----------------------------------------
const cache = new Map();
const CACHE_MAX = 400;
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (e.until < Date.now()) {
    cache.delete(k);
    return null;
  }
  return e.data;
}
function cacheSet(k, data, ttlMs) {
  if (cache.size >= CACHE_MAX) {
    const f = cache.keys().next().value;
    if (f !== undefined) cache.delete(f);
  }
  cache.set(k, { data, until: Date.now() + ttlMs });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// --- helpers -----------------------------------------------------------------
const TITLE_NOISE =
  /\s*[([](official(\s+(music\s+)?video)?|music video|lyrics?( video)?|audio|hd|4k|live|visuali[sz]er|prod\.?[^)\]]*|feat\.?[^)\]]*|ft\.?[^)\]]*|remaster(ed)?[^)\]]*|remix|deluxe)\b[^)\]]*[)\]]\s*/gi;
function parseArtistAndTitle(rawTitle, uploader) {
  const cleaned = String(rawTitle || "").replace(TITLE_NOISE, "").trim();
  const m = cleaned.match(/^(.{1,80}?)\s+[-|–—]\s+(.{1,120})$/);
  if (m && m[1].trim() && m[2].trim()) {
    return { artist: m[1].trim(), title: m[2].trim() };
  }
  const up = String(uploader || "")
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s*(?:הערוץ הרשמי|official)\s*$/i, "")
    .trim();
  return {
    artist: up || "Unknown",
    title: cleaned || String(rawTitle || "").trim() || "Untitled",
  };
}
function durMs(text) {
  if (!text) return undefined;
  const p = String(text).split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return undefined;
  let s = 0;
  for (const n of p) s = s * 60 + n;
  return s > 0 ? s * 1000 : undefined;
}
function durSec(text) {
  const ms = durMs(text);
  return ms ? ms / 1000 : null;
}
function baseUrlFor(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

// --- routes ------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    addon: PROVIDER_ID,
    version: VERSION,
    backend: "yt-search + loader.to + residential-proxy egress",
    install_url: `${baseUrlFor(req)}/manifest.json`,
    cacheEntries: cache.size,
  });
});

app.get("/manifest.json", (req, res) => {
  res.json({
    schemaVersion: 1,
    id: PROVIDER_ID,
    version: VERSION,
    name: "YouTube Music (IL) — Residential",
    description:
      "YouTube music via youtube.com search + loader.to, with a residential-proxy egress for reliable mainstream playback. Tuned for Israel; Hebrew works.",
    baseUrl: baseUrlFor(req),
    capabilities: ["metadata", "stream"],
    license: "MIT",
    author: "roiy0124",
    homepageUrl: "https://github.com/roiy0124/-torrent-io-meyousic-addon",
  });
});

// POST /search — scrape the YouTube results page (account-less, datacenter-OK)
app.post("/search", async (req, res) => {
  const { query, limit } = req.body || {};
  if (typeof query !== "string" || !query.trim()) return res.json({ tracks: [] });
  const cap = Math.max(1, Math.min(50, Number(limit) || 20));
  const q = query.trim();
  const key = `s:${cap}:${q}`;
  const hit = cacheGet(key);
  if (hit) return res.json({ tracks: hit });

  const t0 = Date.now();
  const to = withTimeout(15000);
  try {
    const r = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`,
      {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: to.signal,
      }
    );
    const html = await r.text();
    const m =
      html.match(/var ytInitialData = (\{.+?\});<\/script>/s) ||
      html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
    if (!m) {
      console.warn(`[search] no ytInitialData (http ${r.status})`);
      return res.json({ tracks: [] });
    }
    const data = JSON.parse(m[1]);

    const rows = [];
    const seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (o.videoRenderer) {
        const v = o.videoRenderer;
        if (v.videoId && !seen.has(v.videoId)) {
          seen.add(v.videoId);
          rows.push(v);
        }
      }
      for (const k in o) walk(o[k]);
    })(data);

    const tracks = [];
    for (const v of rows) {
      const id = v.videoId;
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
      if (v.badges?.some?.((b) => /LIVE/i.test(JSON.stringify(b)))) continue;
      const lenText = v.lengthText?.simpleText;
      if (!lenText) continue; // live/upcoming have no length
      const ds = durSec(lenText);
      if (ds && (ds < MIN_DURATION_S || ds > MAX_DURATION_S)) continue;
      const rawTitle =
        v.title?.runs?.[0]?.text || v.title?.simpleText || "";
      if (!rawTitle) continue;
      const author =
        v.ownerText?.runs?.[0]?.text ||
        v.longBylineText?.runs?.[0]?.text ||
        v.shortBylineText?.runs?.[0]?.text;
      const thumbs = v.thumbnail?.thumbnails || [];
      const { artist, title } = parseArtistAndTitle(rawTitle, author);
      tracks.push({
        id: `${PROVIDER_ID}:${id}`,
        title,
        artists: [artist],
        durationMs: durMs(lenText),
        artworkUrl: thumbs.length ? thumbs[thumbs.length - 1].url : undefined,
        providerId: PROVIDER_ID,
      });
      if (tracks.length >= cap) break;
    }
    cacheSet(key, tracks, 10 * 60 * 1000);
    console.log(`[search] "${q}" -> ${tracks.length} in ${Date.now() - t0}ms`);
    res.json({ tracks });
  } catch (err) {
    console.error(`[search] failed:`, err.message || err);
    res.json({ tracks: [] });
  } finally {
    to.done();
  }
});

// --- loader.to download flow -------------------------------------------------
// loader.to does its own YouTube extraction and serves the result from its
// CDN (savenow.to). The CDN link is EPHEMERAL and serves an HTML interstitial
// until conversion truly finishes, so we (a) poll until progress is complete,
// (b) probe the link until it actually returns audio bytes, (c) then stream
// it through this host immediately (the link can't be handed to the phone for
// later — it expires). In-flight dedupe so the app's parallel/retry requests
// for one song share ONE loader.to job (its rate-limiter is strict).
const LDR = { headers: { "User-Agent": UA, Referer: "https://loader.to/" } };
const inflight = new Map();

// loader.to JSON API calls (download.php/progress.php) — ALWAYS via the
// residential proxy when configured. Tiny payloads (KB), so ~cents/month.
function ldrApi(url, extra = {}) {
  return fetch(url, {
    ...LDR,
    ...extra,
    ...(resProxy ? { dispatcher: resProxy } : {}),
  });
}
// savenow-CDN audio byte-fetch — direct by default (multi-MB; keep paid
// bandwidth near-zero). Flip PROXY_AUDIO=1 if the CDN independently flags
// Render's datacenter IP on the byte fetch. /search always stays direct.
function ldrCdn(url, extra = {}) {
  const useProxy = resProxy && PROXY_AUDIO;
  return fetch(url, {
    ...LDR,
    ...extra,
    ...(useProxy ? { dispatcher: resProxy } : {}),
  });
}

async function probeAudio(url) {
  const to = withTimeout(15000);
  try {
    const r = await ldrCdn(url, {
      headers: { ...LDR.headers, Range: "bytes=0-1" },
      signal: to.signal,
    });
    const ct = r.headers.get("content-type") || "";
    if (r.body) r.body.cancel?.();
    return /audio|octet-stream|video\/mp4/i.test(ct);
  } catch {
    return false;
  } finally {
    to.done();
  }
}

async function loaderResolve(videoId) {
  if (inflight.has(videoId)) return inflight.get(videoId);
  const job = (async () => {
    const yt = `https://www.youtube.com/watch?v=${videoId}`;
    const a = await (
      await ldrApi(
        `https://loader.to/ajax/download.php?format=mp3&url=${encodeURIComponent(yt)}`
      )
    ).json();
    if (!a || !a.id) throw new Error("loader.to: no job id (rate-limited?)");
    let dl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(2500);
      let p;
      try {
        p = await (
          await ldrApi(`https://loader.to/ajax/progress.php?id=${a.id}`)
        ).json();
      } catch {
        continue;
      }
      if (p && p.download_url && Number(p.progress) >= 1000) {
        dl = p.download_url;
        break;
      }
      if (p && /error|fail/i.test(String(p.text || ""))) {
        throw new Error(`loader.to: ${p.text}`);
      }
    }
    if (!dl) throw new Error("loader.to: timed out / no download_url");
    // The CDN may still serve an interstitial for a few seconds after
    // "finished" — wait until it actually returns audio.
    for (let i = 0; i < 6; i++) {
      if (await probeAudio(dl)) return { url: dl };
      await sleep(2500);
    }
    throw new Error("loader.to: link never served audio");
  })();
  inflight.set(videoId, job);
  job.finally(() => inflight.delete(videoId));
  return job;
}

// POST /stream — return a proxied URL (the loader.to CDN link is ephemeral
// and Referer-gated, so the phone can't use it directly; we proxy it).
app.post("/stream", (req, res) => {
  const { trackId } = req.body || {};
  if (typeof trackId !== "string" || !trackId.startsWith(`${PROVIDER_ID}:`)) {
    return res.json({ stream: null });
  }
  const videoId = trackId.slice(PROVIDER_ID.length + 1).trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.json({ stream: null });
  res.json({
    stream: {
      url: `${baseUrlFor(req)}/audio/${videoId}`,
      mime: "audio/mpeg",
      providerId: PROVIDER_ID,
    },
  });
});

// GET /audio/:id — resolve via loader.to then stream the bytes through here.
app.get("/audio/:videoId", async (req, res) => {
  const videoId = String(req.params.videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).end();
  if (cacheGet(`neg:${videoId}`)) return res.status(502).end();
  const t0 = Date.now();
  try {
    const { url } = await loaderResolve(videoId);
    const range = req.headers.range;
    const up = await ldrCdn(url, {
      headers: { ...LDR.headers, ...(range ? { Range: range } : {}) },
    });
    if (!up.ok && up.status !== 206) throw new Error(`cdn ${up.status}`);
    res.status(up.status === 206 ? 206 : 200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    for (const h of ["content-length", "content-range"]) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    console.log(`[audio] ${videoId} streaming in ${Date.now() - t0}ms`);
    if (!up.body) return res.end();
    const { Readable } = await import("node:stream");
    Readable.fromWeb(up.body).pipe(res);
  } catch (err) {
    console.error(`[audio] ${videoId} failed in ${Date.now() - t0}ms:`, err.message || err);
    cacheSet(`neg:${videoId}`, true, 45 * 1000);
    // Residential proxy rotates IPs on its own (provider-side pool), so no
    // app-side rotation needed; just fail this song and let the next retry.
    if (!res.headersSent) res.status(502).end();
  }
});

// Lightweight liveness — NO loader.to call, so a keep-alive cron can hit
// this every few minutes safely (no rate-limit risk) just to keep Render's
// free instance warm. `?deep=1` additionally probes loader.to.
app.get("/healthz", async (req, res) => {
  const egress = resProxy
    ? PROXY_AUDIO
      ? "residential(all)"
      : "residential(api-only)"
    : "direct(no proxy set)";
  if (req.query.deep !== "1") {
    return res.json({
      ok: true,
      version: VERSION,
      egress,
      cacheEntries: cache.size,
      uptimeS: Math.round(process.uptime()),
    });
  }
  try {
    const r = await ldrApi(
      "https://loader.to/ajax/download.php?format=mp3&url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    );
    const j = await r.json();
    res.json({ ok: true, version: VERSION, egress, loader: !!(j && j.id) });
  } catch (e) {
    res.json({ ok: false, version: VERSION, egress, error: e.message || String(e) });
  }
});

app.use((req, res) =>
  res.status(404).json({ error: "route_not_found", path: req.path })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `Meyousic addon ${VERSION} (residential variant) on ${PORT} — egress: ${
      resProxy ? (PROXY_AUDIO ? "residential(all)" : "residential(api-only)") : "DIRECT (set RESIDENTIAL_PROXY_URL)"
    }`
  );
});

export default app;

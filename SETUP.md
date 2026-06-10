# Setup notes (educational reference)

> Reference notes for self-hosting this learning project. See
> [`DISCLAIMER.md`](DISCLAIMER.md) — this is published for educational and
> research purposes only.

This addon optionally routes its outbound requests through a standard HTTP
proxy. Configuring a proxy can improve connection **reliability and regional
consistency** when reaching third-party services from a datacenter host, in the
same way a proxy is commonly used for any outbound HTTP integration. The proxy
is entirely optional — with no proxy configured, the addon runs with direct
egress.

Cost model (personal use): a few MB per request.
- Default (`PROXY_AUDIO` unset): only the small JSON API calls use the proxy →
  **pennies/month**; bulk byte transfers go direct.
- `PROXY_AUDIO=1`: all traffic uses the proxy (~$1–1.5/mo).

## Step 0 — Try a free trial first (spend $0 to evaluate)

Most residential-proxy providers offer a free, no-credit-card trial. Use one to
evaluate whether a proxy improves reliability for your setup before paying.

1. Sign up at a provider (e.g. evomi.com) → Residential product → start the
   **free trial** (no card). Copy the proxy endpoint + user/pass, e.g.
   `http://USER:PASS@rp.evomi.com:1000`.

## Step 1 — Deploy to Render

2. New **GitHub repo**, push this folder to it.
3. New **Render** Web Service from that repo (Node, free tier ok). Build:
   `npm install`; Start: `npm start`.
4. Render → Environment → add secret:
   - `RESIDENTIAL_PROXY_URL` = the proxy URL from step 0 (optional)
   - (optional) `PROXY_AUDIO` = `1`
5. After it deploys, note the `https://<service>.onrender.com` URL and put it
   into `.github/workflows/keepalive.yml` (replace the placeholder).

## Step 2 — Verify

- `GET /healthz` → reports the current egress mode.
- Make a few requests in a row to confirm the service is responding. If a proxy
  doesn't improve reliability for you, there's no need to pay for one — the
  free, direct-egress mode is the baseline.

## Step 3 — Use it in Meyousic

Install in the app via Add-addon → `https://<service>.onrender.com/manifest.json`.
The provider id is distinct, so it can coexist with other installed addons.

## Cost, if you keep a proxy

Either pay-as-you-go (~$0.99/GB, no expiry, ~$1/mo worst case) or buy a small
1 GB block (~$7, never expires — likely lasts a long time at API-only volume).
Same `RESIDENTIAL_PROXY_URL` format, just swap the value.

## Notes (honest)

A proxy is optional and only affects connection reliability/region. With no
proxy configured the addon still runs, direct egress, as a best-effort
reference implementation. If a different proxy method suits you later, it drops
in via the same `RESIDENTIAL_PROXY_URL` setting — nothing else changes.

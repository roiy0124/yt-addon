# yt-addon

A self-hosted Stremio-style media addon endpoint used by the personal
[Meyousic](https://github.com/roiy0124/meyousic) client. It exposes a small
HTTP API (`/manifest.json`, `/search`, `/stream`, `/healthz`) that the client
queries for metadata.

---

## ⚠️ Disclaimer — Educational / Research Use Only

> **This project is published strictly for educational and research purposes.**
> It is a personal learning exercise in HTTP services, proxying, and client/server
> architecture. **It is not a product, not a service, and is not intended for use.**
>
> - The code is provided **"AS IS"**, without warranty of any kind. See [`LICENSE`](LICENSE).
> - This repository **does not host, store, or distribute any copyrighted media.**
>   It only relays requests to third-party services, which perform their own
>   processing on their own infrastructure.
> - **No endorsement** of any third-party service named in this repo is implied,
>   and the author is not affiliated with any of them.
> - You are **solely responsible** for how you deploy or use this code, and for
>   complying with all applicable laws and with the terms of service of any
>   third-party platform (including, without limitation, YouTube's Terms of
>   Service and any source platform's terms).
> - The author **does not encourage or condone** copyright infringement or any
>   violation of a third party's terms of service. **Only access content you have
>   the right to access** (public-domain, Creative-Commons, or your own content).
>
> If you do not agree with these terms, **do not download, deploy, or use this
> repository.** See [`DISCLAIMER.md`](DISCLAIMER.md) for the full text.

---

## What this is

A thin relay service. It performs no media extraction itself:

- `/search` queries a public search page for metadata only.
- `/stream` delegates to a third-party service that does its own processing on
  its own infrastructure and returns a URL.

See [`SETUP.md`](SETUP.md) for deployment notes (educational reference only).

## License

[MIT](LICENSE) — including its "AS IS", no-warranty, and no-liability terms.

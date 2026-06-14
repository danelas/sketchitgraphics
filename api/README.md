# Color separation API

Turns the **Spot Color Studio** engine (`~/Downloads/color-sep`) into a web
endpoint so the site can do *real* color separation on uploaded artwork — the
"free color separation" offer, actually fulfilled.

## Endpoint

`POST /api/separate` — instant, downscaled preview (pure numpy + Pillow, no scipy).

```jsonc
// request
{ "image": "data:image/png;base64,…", "colors": 4, "garment": "dark" }
// colors: 1–6, "process", or null/omit to auto-detect
// response
{
  "count": 4,                       // distinct colors the engine detected
  "colors": ["#151515", "#db0f18"], // the spot inks it separated into
  "preview": "data:image/png;base64,…", // press-simulation preview
  "recommend": "plastisol"          // or "dtf" when count >= 7
}
```

The frontend (`script.js` → `requestRealSeparation`) calls this on upload and
replaces the instant client-side estimate with the engine's real palette +
preview. If the endpoint is unreachable (e.g. a plain static host with no
functions), the UI silently keeps the client-side estimate — nothing breaks.

## Files

| File | Purpose |
|---|---|
| `separate.py` | Vercel Python function. `run_separation()` is the importable core; `handler` is the HTTP entrypoint. |
| `spot_sep.py` | **Vendored copy** of `color-sep/spot_sep.py`. Source of truth stays in `color-sep` — re-copy after engine changes: `cp ../../color-sep/spot_sep.py api/spot_sep.py`. |
| `dev_server.py` | Local-only: serves the static site + this function on one port for testing. |

## Run locally

```bash
python api/dev_server.py        # http://localhost:8751  (static site + API)
```

Upload artwork in the quote tool — you'll see the live separation panel populate.

## Deploy (Vercel)

The static site + this function deploy together, same origin:

```bash
vercel            # or connect the repo in the Vercel dashboard
```

`vercel.json` sets the function memory/timeout; `requirements.txt` (repo root)
pins `numpy` + `Pillow`. Python is detected automatically for `api/*.py`.

> **Netlify note:** Netlify doesn't run Python functions natively. To host there,
> deploy this API separately (a container or AWS Lambda) and set the full URL in
> `SEP_API` in `script.js` (CORS is already `*`).

## Not built yet (next steps)

- **Full-resolution print files** ("keep your separations") — white underbase,
  trapping/choke, and 1-bit halftone film positives. That path *does* need
  `scipy` (morphology) and runs longer, so it belongs in a separate endpoint or
  background job, not the instant preview. The engine functions already exist
  (`build_underbase`, `apply_trap`, `halftone`, `save_bitmap`).
- **$15 "keep the files" payment** — Stripe Checkout, then unlock the ZIP.
- **Emailing the files** — wire to your email service (e.g. Resend).

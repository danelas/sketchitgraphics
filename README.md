# Sketch It Graphics

Custom heat transfer printing site — one product (custom heat transfers) with an instant online quote calculator, real color separation, and standalone affiliate + reseller pages.

## What's in here

A static multi-page site (HTML/CSS/JS — no build step):

- **Instant quote engine** (homepage) — drag-and-drop upload with real color separation; live pricing across colors / size (exact W×H) / quantity (100–10,000)
- **Real color separation** — uploads hit a Vercel Python function (`api/separate.py`, wraps the Spot Color Studio engine) returning the actual palette + a press-simulation preview
- **Free color separation offer** — free to preview; order with us and it stays free forever. Don't order? Keep the print-ready files for a one-time $15, fully credited back on your first order
- **Affiliate program** — `affiliate.html` — 10% lifetime commission, live earnings calculator, signup form
- **Reseller program** — `reseller.html` — 10% wholesale discount, profit calculator
- **Affiliate referral tracking** — `?ref=` / `/r/code` → 90-day first-touch cookie (runs on every page via `common.js`)
- **Sample pack** — $5 with email capture
- **SEO** — full JSON-LD structured data (Organization, OnlineStore, Product, FAQPage, HowTo, BreadcrumbList), sitemap, robots, OG/Twitter cards, web manifest
- **Mobile perf** — service worker caching, inlined critical CSS, reduced-motion support, passive listeners
- **Quote draft auto-save** to localStorage

## Files

| File | Purpose |
|---|---|
| `index.html` | Homepage — quote engine, single-product marketing, structured data |
| `affiliate.html` / `reseller.html` | Standalone program pages |
| `common.js` | Shared across all pages — `$`/`fmt`, consent defaults, affiliate referral capture, smooth scroll |
| `script.js` | Homepage quote engine, color detection, checkout modal, persistence |
| `affiliate.js` / `reseller.js` | Per-page calculators + forms |
| `styles.css` | Full stylesheet, mobile media queries, reduced-motion |
| `api/` | Vercel Python color-separation function + vendored engine (see `api/README.md`) |
| `sw.js` | Service worker — cache-first static, network-first HTML |
| `site.webmanifest` | PWA manifest with app shortcuts |
| `favicon.svg` | Vector favicon |
| `og-image.svg` | 1200×630 social-share template |
| `robots.txt` | Crawler rules — blocks unconsented AI training bots |
| `sitemap.xml` | XML sitemap |
| `_headers` | Netlify / Cloudflare Pages cache + security headers |
| `.htaccess` | Apache fallback |

## Run locally

```bash
python -m http.server 8765
# open http://localhost:8765/
```

Or any static server — there's no build step.

## Deploy

Drop the folder onto **Netlify**, **Cloudflare Pages**, or **Vercel** — `_headers` is honored on Netlify and Cloudflare Pages out of the box. For Apache hosts, `.htaccess` provides the same directives.

### Before going live

1. Replace `https://sketchitgraphics.com/` placeholders in `index.html` (JSON-LD, canonical, OG) and `sitemap.xml` with your real domain
2. Export `og-image.svg` → `og-image.png` (1200×630) — most social crawlers don't accept SVG OG images
3. Add raster icons: `apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png`
4. Submit `sitemap.xml` in Google Search Console + Bing Webmaster Tools
5. Wire real checkout (Stripe / Shopify) and email service (sample pack form, save-quote form)
6. Connect analytics / marketing pixels inside `loadAnalytics()` / `loadMarketingPixels()` in `script.js` (fired only after consent)

## License

Proprietary — all rights reserved.

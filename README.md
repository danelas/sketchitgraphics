# Sketch It Graphics

Custom heat transfer printing site — plastisol, DTF gang sheets, and screen-print transfers with an instant online quote calculator.

## What's in here

A static single-page site (HTML/CSS/JS — no build step) featuring:

- **Instant quote engine** — drag-and-drop artwork upload with auto-color detection, live pricing across transfer type / colors / size / quantity / rush
- **Flat $30 color separation** (waived on DTF)
- **Affiliate program** — 10% lifetime commission with referral code capture and earnings calculator
- **Reseller program** — 15% wholesale discount with profit calculator
- **Sample pack** — $5 with email capture
- **SEO** — full JSON-LD structured data (Organization, OnlineStore, Product, FAQPage, HowTo, BreadcrumbList), sitemap, robots, OG/Twitter cards, web manifest
- **Mobile perf** — service worker caching, inlined critical CSS, `content-visibility` for below-fold, reduced-motion support, passive listeners
- **GDPR/CCPA cookie consent** — 5-category banner with affiliate referral tracking that respects consent
- **Quote draft auto-save** to localStorage

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup, meta, structured data, inlined critical CSS |
| `styles.css` | Full stylesheet, mobile media queries, cookie banner, reduced-motion |
| `script.js` | Quote engine, color detection, cookie consent, affiliate capture, persistence |
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

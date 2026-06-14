/* ===================================================================
   Sketch It Graphics — shared across all pages
   DOM helpers · consent (banner removed) · affiliate referral capture
   · smooth in-page scroll. Loaded with `defer` BEFORE each page's own
   script, so its globals ($/$$/fmt, cookies, consent) are available.
   =================================================================== */

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmt = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ===================================================================
   CONSENT — cookie banner removed.
   First-party functional + affiliate features run by default; analytics
   and marketing pixels stay OFF until you wire real loaders below.
   =================================================================== */
const CONSENT_VERSION = 1;

function getConsent() {
  return { v: CONSENT_VERSION, ts: Date.now(), func: true, aff: true, ana: false, mkt: false };
}

function applyConsent(c) {
  window.__consent = c;
  if (c.ana) loadAnalytics();
  if (c.mkt) loadMarketingPixels();
  if (!c.aff) clearAffiliateCookie();
}

/* Placeholders — wire to real GTM/Plausible/Meta when ready */
function loadAnalytics() { /* GA4 / Plausible loader goes here */ }
function loadMarketingPixels() { /* Meta + TikTok + GA Ads loaders go here */ }

/* ===================================================================
   AFFILIATE REFERRAL TRACKING (runs on every page)
   Captures ?ref=code or /r/code from URL, stores in a 90-day cookie
   (with SameSite=Lax; Secure). A referral link can land on any page,
   so this lives in the shared script.
   =================================================================== */
const AFFILIATE_COOKIE = 'sketch_ref';
const AFFILIATE_DAYS = 90;

function setCookie(name, value, days, opts = {}) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  const sameSite = opts.sameSite || 'Lax';
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=${sameSite}${secure}`;
}
function getCookie(name) {
  return document.cookie.split('; ').reduce((acc, c) => {
    const [k, v] = c.split('=');
    return k === name ? decodeURIComponent(v || '') : acc;
  }, '');
}
function clearAffiliateCookie() {
  document.cookie = `${AFFILIATE_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function captureAffiliateRef() {
  const consent = getConsent();
  let ref = '';
  const params = new URLSearchParams(location.search);
  if (params.has('ref')) ref = params.get('ref');
  // Path form: /r/code
  const pathMatch = location.pathname.match(/^\/r\/([a-z0-9-]{3,40})/i);
  if (pathMatch) ref = pathMatch[1];

  if (!ref) return;

  // Sanitize
  ref = ref.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!ref) return;

  // Don't overwrite existing attribution (first-touch wins)
  const existing = getCookie(AFFILIATE_COOKIE);
  if (existing) return;

  if (consent && consent.aff) {
    setCookie(AFFILIATE_COOKIE, ref, AFFILIATE_DAYS);
  } else {
    sessionStorage.setItem('pending_ref', ref);
  }

  flashAffiliateBadge(ref);
}

function flashAffiliateBadge(ref) {
  const el = document.createElement('div');
  el.className = 'aff-flash';
  el.innerHTML = `🎯 Referred by <b>${ref}</b> — they'll earn commission on your order`;
  Object.assign(el.style, {
    position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)',
    background: '#171823', border: '1px solid #ff5a1f', color: '#fff',
    padding: '10px 18px', borderRadius: '999px', fontSize: '.85rem',
    zIndex: '95', boxShadow: '0 12px 28px rgba(0,0,0,.5)', maxWidth: '90vw',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* If consent comes through later, promote pending_ref to a real cookie */
const _origApply = applyConsent;
applyConsent = function (c) {
  _origApply(c);
  if (c.aff) {
    const pending = sessionStorage.getItem('pending_ref');
    if (pending && !getCookie(AFFILIATE_COOKIE)) {
      setCookie(AFFILIATE_COOKIE, pending, AFFILIATE_DAYS);
      sessionStorage.removeItem('pending_ref');
    }
  }
};

/* ---------- smooth scroll on in-page anchors ---------- */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', (e) => {
    const tgt = a.getAttribute('href');
    if (tgt.length > 1 && document.querySelector(tgt)) {
      e.preventDefault();
      document.querySelector(tgt).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ---------- run on every page ---------- */
applyConsent(getConsent());
captureAffiliateRef();

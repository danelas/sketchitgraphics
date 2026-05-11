/* ===================================================================
   Sketch It Graphics — quote engine + UX
   =================================================================== */

/* ---------- Pricing model ----------
   Per-transfer base price = basePerColor[type][colorBand] * sizeMult * qtyMult
   - basePerColor scales with color count and method
   - sizeMult: 1.0 at 11", linear from 0.6 (3") to 1.6 (16")
   - qtyMult: volume break curve (qty 25 = 1.4x, 100 = 1.0x, 500 = 0.72x, 1000 = 0.58x)
   - Flat $30 color-sep adder (waived on DTF since no separations)
   - Rush adders: 72hr +$20, 48hr +$35, 24hr +$45
   - SKETCH15 discount: 15% off subtotal
   - Reseller discount: 15% off subtotal (stacks with first-order code? — no, larger applies)
------------------------------------------- */

const PRICING = {
  plastisol: {
    1: 0.85, 2: 1.05, 3: 1.25, 4: 1.42, 5: 1.62, 6: 1.85, process: 2.10,
  },
  dtf: {
    // DTF doesn't really care about color count — flat per size/qty
    1: 1.30, 2: 1.30, 3: 1.30, 4: 1.30, 5: 1.30, 6: 1.30, process: 1.30,
  },
  screen: {
    1: 0.62, 2: 0.84, 3: 1.04, 4: 1.24, 5: 1.46, 6: 1.68, process: 1.95,
  },
};
const RUSH = { standard: 0, r72: 20, r48: 35, r24: 45 };
const SEP_FEE = 30;
const FREE_SHIP_THRESHOLD = 200;

const state = {
  type: 'plastisol',
  colors: '2',
  size: 11,
  qty: 100,
  rush: 'standard',
  firstOrder: false,
  reseller: false,
};

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmt = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function sizeMult(size) {
  // anchor: 11" = 1.0; 3" = 0.6; 16" = 1.6
  if (size <= 11) return 0.6 + ((size - 3) / 8) * 0.4;     // 3→0.6, 11→1.0
  return 1.0 + ((size - 11) / 5) * 0.6;                    // 11→1.0, 16→1.6
}

function qtyMult(qty) {
  if (qty < 50)   return 1.40;
  if (qty < 100)  return 1.15;
  if (qty < 250)  return 1.00;
  if (qty < 500)  return 0.85;
  if (qty < 1000) return 0.72;
  return 0.58;
}

function qtyTierLabel(qty) {
  if (qty < 50)   return '25–49';
  if (qty < 100)  return '50–99';
  if (qty < 250)  return '100–249';
  if (qty < 500)  return '250–499';
  if (qty < 1000) return '500–999';
  return '1000+';
}

/* ---------- core calc ---------- */
function calc() {
  const base = PRICING[state.type][state.colors];
  const per = base * sizeMult(state.size) * qtyMult(state.qty);
  const subtotal = per * state.qty;

  // DTF doesn't charge separation fee (no separations needed)
  const sepFee = state.type === 'dtf' ? 0 : SEP_FEE;
  const rushFee = RUSH[state.rush];

  let discount = 0;
  let discountLabel = '';
  // Reseller wins over SKETCH15 (don't stack)
  if (state.reseller) {
    discount = subtotal * 0.15;
    discountLabel = 'reseller';
  } else if (state.firstOrder) {
    discount = subtotal * 0.15;
    discountLabel = 'first';
  }

  const total = Math.max(0, subtotal + sepFee + rushFee - discount);

  return { per, subtotal, sepFee, rushFee, discount, discountLabel, total };
}

/* ---------- render ---------- */
function render() {
  const r = calc();
  $('#pricePer').textContent = fmt(r.per);
  $('#priceTotal').textContent = fmt(r.total);

  $('#bdQty').textContent = state.qty;
  $('#bdEach').textContent = fmt(r.per);
  $('#bdSub').textContent = fmt(r.subtotal);
  $('#bdTotal').textContent = fmt(r.total);

  // Rush row
  const rushRow = $('#rushRow');
  if (r.rushFee > 0) {
    rushRow.hidden = false;
    $('#bdRush').textContent = '+' + fmt(r.rushFee);
  } else {
    rushRow.hidden = true;
  }

  // Discount rows
  $('#discRow').hidden = r.discountLabel !== 'first';
  $('#resellerRow').hidden = r.discountLabel !== 'reseller';
  if (r.discountLabel === 'first') $('#bdDisc').textContent = '−' + fmt(r.discount);
  if (r.discountLabel === 'reseller') $('#bdReseller').textContent = '−' + fmt(r.discount);

  // Sep-fee row text
  document.querySelectorAll('.bd-row')[1].style.opacity = state.type === 'dtf' ? '0.4' : '1';
  document.querySelectorAll('.bd-row')[1].children[1].textContent = state.type === 'dtf' ? 'Waived (DTF)' : fmt(SEP_FEE);

  // Free shipping progress
  const remaining = Math.max(0, FREE_SHIP_THRESHOLD - r.total);
  const pct = Math.min(100, (r.total / FREE_SHIP_THRESHOLD) * 100);
  $('#shipFill').style.width = pct + '%';
  if (remaining > 0) {
    $('#shipLabel').innerHTML = `🚚 Add <b>${fmt(remaining)}</b> for FREE shipping`;
  } else {
    $('#shipLabel').innerHTML = `✅ <b>FREE shipping unlocked</b>`;
  }

  // Qty tier markers
  const tiers = ['25–49','50–99','100–249','250–499','500–999','1000+'];
  const current = qtyTierLabel(state.qty);
  $('#qtyTiers').innerHTML = tiers.map(t => `<span class="${t === current ? 'hit' : ''}">${t}</span>`).join('');

  // Size label with imperial
  const s = state.size;
  $('#sizeVal').textContent = `${s}" × ${s}"`;
  $('#qtyVal').textContent = state.qty >= 1000 ? '1000+' : state.qty;

  // Color option behavior for DTF
  const colorOpt = $('#colorOpt');
  const colorHint = $('#colorHint');
  if (state.type === 'dtf') {
    colorOpt.style.opacity = '0.45';
    colorHint.textContent = 'DTF supports unlimited colors — color count doesn\'t affect price.';
  } else {
    colorOpt.style.opacity = '1';
    colorHint.textContent = 'Spot color = solid Pantone-style ink. Process = CMYK halftone for photo-real art.';
  }
}

/* ---------- segment buttons ---------- */
function bindSeg(groupAttr, key, transform) {
  $$(`.seg[data-group="${groupAttr}"] .seg-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = transform ? transform(btn.dataset.val) : btn.dataset.val;
      render();
    });
  });
}
bindSeg('type', 'type');
bindSeg('colors', 'colors');
bindSeg('rush', 'rush');

/* sliders */
$('#sizeRange').addEventListener('input', (e) => {
  state.size = parseFloat(e.target.value);
  render();
});
$('#qtyRange').addEventListener('input', (e) => {
  state.qty = parseInt(e.target.value, 10);
  render();
});

/* toggles */
$('#firstOrder').addEventListener('change', (e) => {
  state.firstOrder = e.target.checked;
  render();
});
$('#resellerCheck').addEventListener('change', (e) => {
  state.reseller = e.target.checked;
  render();
});

/* ---------- File upload + color detection ---------- */
const fileInput = $('#fileInput');
const dz = $('#dropzone');
const dzEmpty = $('#dzEmpty');
const dzPreview = $('#dzPreview');
const previewImg = $('#previewImg');
const analysis = $('#analysis');

['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
$('#dzRemove').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetUpload();
});

function resetUpload() {
  fileInput.value = '';
  previewImg.src = '';
  dzEmpty.hidden = false;
  dzPreview.hidden = true;
  analysis.hidden = true;
}

function handleFile(file) {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    // Non-image (PDF/AI/EPS) — show generic preview
    dzEmpty.hidden = true;
    dzPreview.hidden = false;
    previewImg.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="#1f2030" rx="12"/>
        <text x="100" y="95" text-anchor="middle" font-family="Inter" font-size="48" fill="#ffb800">📄</text>
        <text x="100" y="135" text-anchor="middle" font-family="Inter" font-size="14" fill="#fff" font-weight="600">${file.name}</text>
        <text x="100" y="155" text-anchor="middle" font-family="Inter" font-size="11" fill="#9ea0b3">Vector file received</text>
      </svg>
    `);
    analysis.hidden = false;
    $('#detectedColors').textContent = 'Vector (any)';
    $('#palette').innerHTML = '';
    $('#recMethod').textContent = state.type === 'dtf' ? 'DTF' : 'Plastisol';
    $('#tip').innerHTML = '💡 Vector file — we\'ll separate colors after upload review.';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    dzEmpty.hidden = true;
    dzPreview.hidden = false;
    analyzeImage(e.target.result);
  };
  reader.readAsDataURL(file);
}

/* Detect distinct colors via canvas quantization */
function analyzeImage(dataUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    const maxDim = 160;
    const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
    c.width = img.width * ratio;
    c.height = img.height * ratio;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;

    // Bucket colors into reduced color space (quantize to 5-bit per channel)
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i+3];
      if (a < 128) continue; // skip transparent
      const r = data[i]   >> 5;
      const g = data[i+1] >> 5;
      const b = data[i+2] >> 5;
      const key = (r << 10) | (g << 5) | b;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    const sorted = [...buckets.entries()].sort((a,b) => b[1] - a[1]);
    // Filter buckets that are >2% of pixels (noise reduction)
    const totalPx = c.width * c.height;
    const significant = sorted.filter(([,n]) => n / totalPx > 0.02);
    const distinct = Math.min(significant.length, 12);

    // Build palette swatches (top 6)
    const palette = significant.slice(0, 6).map(([key]) => {
      const r = ((key >> 10) & 0x1f) << 3;
      const g = ((key >> 5)  & 0x1f) << 3;
      const b = (key & 0x1f) << 3;
      return `rgb(${r},${g},${b})`;
    });

    // Render analysis
    analysis.hidden = false;
    $('#detectedColors').textContent = distinct === 12 ? '12+ (process color)' : distinct;
    $('#palette').innerHTML = palette.map(c => `<div style="background:${c}"></div>`).join('');

    // Recommendation
    let rec, tip;
    if (distinct >= 7) {
      rec = 'DTF (unlimited color)';
      tip = '💡 7+ colors detected — DTF is cheaper here than process-color plastisol.';
      // auto-suggest DTF
      autoPickType('dtf');
    } else if (distinct >= 5) {
      rec = 'Plastisol (5–6 spot)';
      tip = '💡 Multi-color spot design — plastisol gives the most durable result.';
    } else {
      rec = `Plastisol (${distinct} spot color)`;
      tip = `💡 ${distinct} clean spot color${distinct>1?'s':''} — perfect for plastisol or screen-print.`;
    }
    $('#recMethod').textContent = rec;
    $('#tip').innerHTML = tip;

    // Auto-select detected color count if it differs (for plastisol)
    if (distinct >= 1 && distinct <= 6 && state.type !== 'dtf') {
      autoPickColors(String(distinct));
    } else if (distinct >= 7 && state.type !== 'dtf') {
      autoPickColors('process');
    }
  };
  img.src = dataUrl;
}

function autoPickColors(val) {
  const btn = document.querySelector(`.seg[data-group="colors"] .seg-btn[data-val="${val}"]`);
  if (!btn) return;
  btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.colors = val;
  render();
}
function autoPickType(val) {
  const btn = document.querySelector(`.seg[data-group="type"] .seg-btn[data-val="${val}"]`);
  if (!btn) return;
  btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.type = val;
  render();
}

/* ---------- Quote actions ---------- */
$('#saveQuote').addEventListener('click', () => {
  const email = $('#emailQuote').value.trim();
  if (!email || !email.includes('@')) {
    $('#emailQuote').style.borderColor = '#ef4444';
    return;
  }
  $('#emailQuote').style.borderColor = 'var(--good)';
  $('#saveQuote').textContent = '✓ Quote sent';
  setTimeout(() => { $('#saveQuote').textContent = 'Email me this quote'; }, 2400);
});

$('#checkoutBtn').addEventListener('click', () => {
  const r = calc();
  alert(`Checkout preview\n\nType: ${state.type.toUpperCase()}\nColors: ${state.colors}\nSize: ${state.size}" × ${state.size}"\nQty: ${state.qty}\nRush: ${state.rush}\n\nPer transfer: ${fmt(r.per)}\nTotal: ${fmt(r.total)}\n\n(Real checkout would integrate Stripe + Shopify here.)`);
});

$('#reorderBtn').addEventListener('click', () => {
  const code = prompt('Enter your reorder code (e.g., SKG-7G2K-9X):');
  if (!code) return;
  alert(`Loading order ${code}…\n\n(Real version pulls previous job specs + artwork from the DB and pre-fills this form.)`);
});

/* ---------- Sample pack ---------- */
$('#sampleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.textContent = '✓ Pack on its way!';
  btn.style.background = 'var(--good)';
  btn.style.color = '#fff';
});

/* ---------- Reseller profit calc ---------- */
function calcReseller() {
  const cost = parseFloat($('#rcCost').value) || 0;
  const shirt = parseFloat($('#rcShirt').value) || 0;
  const retail = parseFloat($('#rcRetail').value) || 0;
  const units = parseInt($('#rcUnits').value, 10) || 0;
  const margin = retail - cost - shirt;
  const profit = margin * units;
  const pct = retail > 0 ? Math.round((margin / retail) * 100) : 0;
  $('#rcMargin').textContent = fmt(margin);
  $('#rcProfit').textContent = fmt(profit);
  $('#rcPct').textContent = pct + '%';
}
['rcCost','rcShirt','rcRetail','rcUnits'].forEach(id => {
  $('#' + id).addEventListener('input', calcReseller);
});

/* ---------- Live social proof rotator ---------- */
const proofs = [
  '📍 Maya in Atlanta just ordered 250 DTF transfers · 2 min ago',
  '📍 Devin in Phoenix just reordered 500 plastisol transfers · 4 min ago',
  '📍 Jenna in Brooklyn just upgraded to 24hr rush · 7 min ago',
  '📍 The Hollow Saints just ordered 80 tour-tee transfers · 11 min ago',
  '📍 SignCity in Dallas just signed up for reseller pricing · 14 min ago',
  '📍 Marcus in Tampa just ordered a $5 sample pack · 18 min ago',
];
let proofIdx = 0;
setInterval(() => {
  proofIdx = (proofIdx + 1) % proofs.length;
  const el = $('#liveProof');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = proofs[proofIdx];
    el.style.opacity = '1';
  }, 250);
}, 5500);

/* ---------- Exit intent modal ---------- */
let modalShown = false;
function showModal() {
  if (modalShown) return;
  if (sessionStorage.getItem('sketch_modal_shown')) return;
  modalShown = true;
  sessionStorage.setItem('sketch_modal_shown', '1');
  $('#exitModal').hidden = false;
}
document.addEventListener('mouseleave', (e) => {
  if (e.clientY < 10) showModal();
});
// Mobile fallback: show after 45s
setTimeout(showModal, 45000);
$('#modalClose').addEventListener('click', () => { $('#exitModal').hidden = true; });
$('#exitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const box = $('.modal-box');
  box.innerHTML = `
    <div class="modal-eyebrow">✓ You're in</div>
    <h3>Check your inbox</h3>
    <p>Your <b>SKETCH15</b> code + sample pack offer are on the way. Talk soon.</p>
    <button class="btn btn-primary" onclick="document.getElementById('exitModal').hidden=true">Got it</button>
  `;
});

/* ---------- Chat bubble ---------- */
$('#chatBubble').addEventListener('click', () => {
  alert('Live chat\n\nHi! Real version would open Intercom/Crisp/Tidio.\n\nText us now: (800) 555-1234\nEmail: hello@sketchitgraphics.com');
});

/* ---------- smooth scroll on nav links ---------- */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', (e) => {
    const tgt = a.getAttribute('href');
    if (tgt.length > 1 && document.querySelector(tgt)) {
      e.preventDefault();
      document.querySelector(tgt).scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });
});

/* ===================================================================
   COOKIE CONSENT — GDPR/CCPA compliant
   Categories: necessary (forced), functional, affiliate, analytics, marketing
   Stored in: localStorage 'sketch_consent' = { v, ts, func, aff, ana, mkt }
   =================================================================== */

const CONSENT_KEY = 'sketch_consent';
const CONSENT_VERSION = 1;

function getConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p.v !== CONSENT_VERSION) return null;
    return p;
  } catch { return null; }
}

function saveConsent(prefs) {
  const payload = { v: CONSENT_VERSION, ts: Date.now(), ...prefs };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(payload)); } catch {}
  applyConsent(payload);
  hideCookieBanner();
}

function applyConsent(c) {
  // Surface a global so other scripts can branch on consent
  window.__consent = c;
  // Fire tag managers / pixels only if consented
  if (c.ana) loadAnalytics();
  if (c.mkt) loadMarketingPixels();
  if (!c.aff) clearAffiliateCookie();
}

function showCookieBanner() {
  const b = $('#cookieBanner');
  if (!b) return;
  b.hidden = false;
  requestAnimationFrame(() => b.classList.add('show'));
  document.body.classList.add('cookie-open');
}
function hideCookieBanner() {
  const b = $('#cookieBanner');
  if (!b) return;
  b.classList.remove('show');
  document.body.classList.remove('cookie-open');
  setTimeout(() => { b.hidden = true; }, 320);
}

function bindCookieBanner() {
  if (!$('#cookieBanner')) return;
  $('#cookieAccept')?.addEventListener('click', () => {
    saveConsent({ func:true, aff:true, ana:true, mkt:true });
  });
  $('#cookieReject')?.addEventListener('click', () => {
    saveConsent({ func:false, aff:false, ana:false, mkt:false });
  });
  const openPrefs = () => {
    const p = $('#cookiePrefs');
    if (p) p.hidden = false;
  };
  $('#cookieCustomize')?.addEventListener('click', openPrefs);
  $('#cookieMore')?.addEventListener('click', (e) => { e.preventDefault(); openPrefs(); });
  $('#cookieSavePrefs')?.addEventListener('click', () => {
    saveConsent({
      func: $('#ckFunc').checked,
      aff:  $('#ckAff').checked,
      ana:  $('#ckAna').checked,
      mkt:  $('#ckMkt').checked,
    });
  });
}

/* Placeholders — wire to real GTM/Plausible/Meta when ready */
function loadAnalytics() { /* GA4 / Plausible loader goes here */ }
function loadMarketingPixels() { /* Meta + TikTok + GA Ads loaders go here */ }

/* ===================================================================
   AFFILIATE REFERRAL TRACKING
   Captures ?ref=code or /r/code from URL, stores in a 90-day cookie
   (with SameSite=Lax; Secure) — only if user consented to affiliate.
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
  // If user hasn't consented yet, stash in sessionStorage so we don't lose attribution while banner is up
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
    // Hold in session until consent
    sessionStorage.setItem('pending_ref', ref);
  }

  // Banner so user knows they're attributed
  flashAffiliateBadge(ref);
}

function flashAffiliateBadge(ref) {
  const el = document.createElement('div');
  el.className = 'aff-flash';
  el.innerHTML = `🎯 Referred by <b>${ref}</b> — they'll earn commission on your order`;
  Object.assign(el.style, {
    position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
    background:'#171823', border:'1px solid #ff5a1f', color:'#fff',
    padding:'10px 18px', borderRadius:'999px', fontSize:'.85rem',
    zIndex:'95', boxShadow:'0 12px 28px rgba(0,0,0,.5)', maxWidth:'90vw',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* If consent comes through later, promote pending_ref to a real cookie */
const _origApply = applyConsent;
applyConsent = function(c) {
  _origApply(c);
  if (c.aff) {
    const pending = sessionStorage.getItem('pending_ref');
    if (pending && !getCookie(AFFILIATE_COOKIE)) {
      setCookie(AFFILIATE_COOKIE, pending, AFFILIATE_DAYS);
      sessionStorage.removeItem('pending_ref');
    }
  }
};

/* ===================================================================
   QUOTE STATE PERSISTENCE
   Saves the in-progress quote (type, colors, size, qty, rush, etc.)
   so mobile users don't lose work on refresh / accidental nav-away.
   Only saved if user consented to "functional".
   =================================================================== */

const QUOTE_KEY = 'sketch_quote_draft';

function saveQuoteState() {
  const c = getConsent();
  if (!c || !c.func) return;
  try { localStorage.setItem(QUOTE_KEY, JSON.stringify(state)); } catch {}
}

function restoreQuoteState() {
  const c = getConsent();
  if (!c || !c.func) return;
  try {
    const raw = localStorage.getItem(QUOTE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state, saved);
    // Re-sync UI to saved state
    syncSegFromState('type', state.type);
    syncSegFromState('colors', state.colors);
    syncSegFromState('rush', state.rush);
    $('#sizeRange').value = state.size;
    $('#qtyRange').value = state.qty;
    $('#firstOrder').checked = !!state.firstOrder;
    $('#resellerCheck').checked = !!state.reseller;
    render();
  } catch {}
}

function syncSegFromState(group, val) {
  const wrap = document.querySelector(`.seg[data-group="${group}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
}

// Debounced save on any state change
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveQuoteState, 400);
}

/* ===================================================================
   PERF: passive listeners, idle init
   =================================================================== */

// Promote touch/scroll listeners to passive where present
(function () {
  const _add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (['touchstart','touchmove','wheel','scroll'].includes(type)) {
      if (typeof opts === 'object') opts.passive = opts.passive ?? true;
      else opts = { passive: true };
    }
    return _add.call(this, type, fn, opts);
  };
})();

// Hook into render() to also persist quote state
const _origRender = render;
render = function () {
  _origRender();
  scheduleSave();
};

/* ===================================================================
   INIT
   =================================================================== */

function init() {
  // 1) Restore prior consent (or show banner)
  const existing = getConsent();
  if (existing) {
    applyConsent(existing);
  } else {
    // Defer banner so it doesn't compete with hero render
    requestAnimationFrame(() => setTimeout(showCookieBanner, 800));
  }
  bindCookieBanner();

  // 2) Affiliate ref capture
  captureAffiliateRef();

  // 3) Pre-fill affiliate signup form code if user is signing up
  const refInput = $('#afCode');
  const referredBy = getCookie(AFFILIATE_COOKIE);
  if (refInput && referredBy && !refInput.value) {
    // Don't pre-fill someone else's code — leave empty
  }

  // 4) Restore previous quote draft
  restoreQuoteState();

  // 5) Initial paint
  render();
  calcReseller();
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

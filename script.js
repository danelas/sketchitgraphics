/* ===================================================================
   Sketch It Graphics — quote engine + UX
   =================================================================== */

/* ---------- Pricing model ----------
   Per-transfer base price = basePerColor[colorBand] * sizeMult * qtyMult
   - One transfer/decal product; price scales with color count, size, and quantity
   - sizeMult: 1.0 at an 11" equivalent square; driven by sqrt(width × height)
   - qtyMult: volume break curve from 100 (1.0x) down to 10,000+ (0.42x)
   - Color separation is FREE on every order ($30 value shown struck-through as an anchor)
   - SKETCH10 first-order discount: 10% off subtotal
   - "Not sure" color count → priced as a 4-color estimate until artwork is detected
------------------------------------------- */

const PRICING = { 1: 0.85, 2: 1.05, 3: 1.25, 4: 1.42, 5: 1.62, 6: 1.85, process: 2.10 };
const SEP_VALUE = 30;   // anchor only — separation is free; shown struck-through in the breakdown
const SEP_FEE = 0;      // applied fee: color separation is free on every order
const FREE_SHIP_THRESHOLD = 200;

const state = {
  colors: '2',
  width: 11,
  height: 11,
  qty: 100,
  firstOrder: false,
};

/* helpers ($, $$, fmt) live in common.js, loaded before this file */

function sizeMult(size) {
  // anchor: 11" = 1.0; 3" = 0.6; 16" = 1.6
  if (size <= 11) return 0.6 + ((size - 3) / 8) * 0.4;     // 3→0.6, 11→1.0
  return 1.0 + ((size - 11) / 5) * 0.6;                    // 11→1.0, 16→1.6
}

function qtyMult(qty) {
  if (qty < 250)   return 1.00;
  if (qty < 500)   return 0.85;
  if (qty < 1000)  return 0.72;
  if (qty < 2500)  return 0.62;
  if (qty < 5000)  return 0.55;
  if (qty < 10000) return 0.48;
  return 0.42;   // 10,000+
}

function qtyTierLabel(qty) {
  if (qty < 250)   return '100–249';
  if (qty < 500)   return '250–499';
  if (qty < 1000)  return '500–999';
  if (qty < 2500)  return '1k–2.5k';
  if (qty < 5000)  return '2.5k–5k';
  if (qty < 10000) return '5k–10k';
  return '10k+';
}

/* ---------- core calc ---------- */
function calc() {
  const base = PRICING[state.colors] || PRICING[4];   // "Not sure" → 4-color estimate
  const size = Math.sqrt(Math.max(1, state.width * state.height));  // equivalent square side
  const per = base * sizeMult(size) * qtyMult(state.qty);
  const subtotal = per * state.qty;

  // Color separation is free on every order
  const sepFee = SEP_FEE;

  let discount = 0;
  let discountLabel = '';
  if (state.firstOrder) {
    discount = subtotal * 0.10;
    discountLabel = 'first';
  }

  const total = Math.max(0, subtotal + sepFee - discount);

  return { per, subtotal, sepFee, discount, discountLabel, total };
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

  // Discount row (first-order code)
  $('#discRow').hidden = r.discountLabel !== 'first';
  if (r.discountLabel === 'first') $('#bdDisc').textContent = '−' + fmt(r.discount);

  // Color separation row — always free; show $30 struck-through as an anchor
  const sepRow = document.querySelectorAll('.bd-row')[1];
  sepRow.style.opacity = '1';
  sepRow.children[1].innerHTML = `<s>${fmt(SEP_VALUE)}</s> FREE`;

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
  const tiers = ['100–249','250–499','500–999','1k–2.5k','2.5k–5k','5k–10k','10k+'];
  const current = qtyTierLabel(state.qty);
  $('#qtyTiers').innerHTML = tiers.map(t => `<span class="${t === current ? 'hit' : ''}">${t}</span>`).join('');

  // Size (area) + quantity labels
  $('#sizeVal').textContent = `${(state.width * state.height).toFixed(0)} sq in`;
  $('#qtyVal').textContent = state.qty >= 10000 ? '10,000+' : state.qty.toLocaleString();
  $('#qtyContact').hidden = state.qty < 10000;

  // Color hint — "Not sure" shows an estimate note
  $('#colorHint').textContent = state.colors === 'unsure'
    ? 'Not sure? Upload your art and we\'ll detect the exact colors — the price shown is an estimate.'
    : 'Spot color = solid Pantone-style ink. Process = CMYK halftone for photo-real art.';
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
bindSeg('colors', 'colors');

/* size — exact width × height inputs */
['widthIn', 'heightIn'].forEach(id => {
  $('#' + id).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state[id === 'widthIn' ? 'width' : 'height'] = (isFinite(v) && v > 0) ? v : 0;
    render();
  });
});
/* quantity slider (100 – 10,000) */
$('#qtyRange').addEventListener('input', (e) => {
  state.qty = parseInt(e.target.value, 10);
  render();
});

/* toggles */
$('#firstOrder').addEventListener('change', (e) => {
  state.firstOrder = e.target.checked;
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
    $('#recMethod').textContent = 'Reviewed after upload';
    $('#tip').innerHTML = '💡 Vector file — we\'ll separate colors after upload review.';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    dzEmpty.hidden = true;
    dzPreview.hidden = false;
    analyzeImage(e.target.result);        // instant client-side estimate
    requestRealSeparation(e.target.result); // real engine result replaces it when ready
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
    $('#detectedColors').textContent = distinct >= 7 ? '7+ (process)' : distinct;
    $('#palette').innerHTML = palette.map(c => `<div style="background:${c}"></div>`).join('');

    // Recommendation (color setup only — one transfer product)
    let rec, tip;
    if (distinct >= 7) {
      rec = '4-color process';
      tip = '💡 7+ colors detected — we\'ll print this as full-color process.';
      autoPickColors('process');
    } else {
      rec = `${distinct} spot color${distinct > 1 ? 's' : ''}`;
      tip = `💡 ${distinct} clean spot color${distinct > 1 ? 's' : ''} — perfect for a transfer.`;
      if (distinct >= 1) autoPickColors(String(distinct));
    }
    $('#recMethod').textContent = rec;
    $('#tip').innerHTML = tip;
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

/* ---------- Real color separation via the engine API ---------- */
// Same-origin Vercel Python function (api/separate.py). If you host the API on a
// different domain than the static site, set the full https URL here instead.
const SEP_API = '/api/separate';
let sepReqId = 0;

async function requestRealSeparation(dataUrl) {
  const sp = $('#sepPreview');
  const myId = ++sepReqId;               // ignore stale responses if a new file is dropped
  sp.classList.remove('is-error');
  sp.hidden = false;
  $('#sepStatus').textContent = 'Separating…';
  $('#sepPreviewImg').removeAttribute('src');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(SEP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, colors: null, garment: 'dark' }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('api ' + res.status);
    const data = await res.json();
    if (myId !== sepReqId) return;        // a newer upload superseded this one
    if (data.error) throw new Error(data.error);

    $('#sepPreviewImg').src = data.preview;
    $('#sepStatus').textContent = '✓ ' + data.count + (data.count === 1 ? ' color' : ' colors');
    applyDetection(data.count, data.colors);
  } catch (err) {
    if (myId !== sepReqId) return;
    // No backend reachable (e.g. plain static host) or it errored — keep the
    // instant client-side estimate and hide the live panel quietly.
    sp.hidden = true;
  } finally {
    clearTimeout(timer);
  }
}

/* Apply the engine's real result over the instant estimate. */
function applyDetection(count, colors) {
  $('#detectedColors').textContent = count >= 7 ? '7+ (process)' : count;
  if (Array.isArray(colors) && colors.length) {
    $('#palette').innerHTML = colors.map(c => `<div style="background:${c}"></div>`).join('');
  }
  if (count >= 7) {
    $('#recMethod').textContent = '4-color process';
    $('#tip').innerHTML = '💡 ' + count + '+ colors — we\'ll print this as full-color process.';
    autoPickColors('process');
  } else {
    $('#recMethod').textContent = `${count} spot color${count > 1 ? 's' : ''}`;
    $('#tip').innerHTML = `💡 ${count} clean spot color${count > 1 ? 's' : ''} — perfect for a transfer.`;
    if (count >= 1 && count <= 6) autoPickColors(String(count));
  }
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

/* ---------- Checkout step — order summary + free-separation pitch ---------- */
const checkoutModal = $('#checkoutModal');
const checkoutTemplate = checkoutModal.querySelector('.modal-box').innerHTML;

function closeCheckout() { checkoutModal.hidden = true; }

function colorLabel(c) {
  if (c === 'process') return '4-color process';
  if (c === 'unsure') return 'colors to be confirmed';
  return c + (c === '1' ? ' color' : ' colors');
}

function openCheckout() {
  const r = calc();
  const box = checkoutModal.querySelector('.modal-box');
  box.innerHTML = checkoutTemplate;   // restore the summary view on every open

  box.querySelector('#coSummary').innerHTML = `
    <div class="co-row co-spec"><span>${colorLabel(state.colors)} · ${state.width}"×${state.height}"</span><b>${state.qty.toLocaleString()} pcs</b></div>
    <div class="co-row"><span>Transfers (${state.qty.toLocaleString()} × ${fmt(r.per)})</span><b>${fmt(r.subtotal)}</b></div>
    <div class="co-row"><span>Color separation</span><b class="co-free"><s>${fmt(SEP_VALUE)}</s> FREE</b></div>
    ${r.discount > 0 ? `<div class="co-row co-disc"><span>SKETCH10 discount</span><b>−${fmt(r.discount)}</b></div>` : ''}
    <div class="co-row co-total"><span>Order total</span><b>${fmt(r.total)}</b></div>`;

  box.querySelector('#checkoutClose').addEventListener('click', closeCheckout);

  box.querySelector('#coPlace').addEventListener('click', () => {
    box.innerHTML = `
      <button class="modal-close" onclick="document.getElementById('checkoutModal').hidden=true">✕</button>
      <div class="modal-eyebrow">✓ Order received</div>
      <h3>You're all set</h3>
      <p>We've got your order — your free digital proof lands in your inbox within 4 business hours. <small>(Demo: real checkout wires Stripe + Shopify here.)</small></p>
      <button class="btn btn-primary btn-block" onclick="document.getElementById('checkoutModal').hidden=true">Done</button>`;
  });

  box.querySelector('#coKeepSeps').addEventListener('click', () => {
    box.innerHTML = `
      <button class="modal-close" onclick="document.getElementById('checkoutModal').hidden=true">✕</button>
      <div class="modal-eyebrow">🎨 Free separations</div>
      <h3>We'll separate your art — free</h3>
      <p>Drop your email and we'll send your print-ready separations free to preview. Order and they're yours at no charge. Want the final files without ordering yet? A one-time <b>$15</b> — credited back the moment you place your first order.</p>
      <form id="coSepForm"><input type="email" placeholder="your@email.com" required /><button class="btn btn-primary" type="submit">Send my free separations</button></form>
      <small class="micro">No spam — we'll only email about your separations.</small>`;
    box.querySelector('#coSepForm').addEventListener('submit', (e) => {
      e.preventDefault();
      box.innerHTML = `
        <button class="modal-close" onclick="document.getElementById('checkoutModal').hidden=true">✕</button>
        <div class="modal-eyebrow">✓ On its way</div>
        <h3>Check your inbox</h3>
        <p>Your free proof is being prepared. We'll be in touch within 4 business hours.</p>
        <button class="btn btn-primary btn-block" onclick="document.getElementById('checkoutModal').hidden=true">Got it</button>`;
    });
  });

  checkoutModal.hidden = false;
}

$('#checkoutBtn').addEventListener('click', openCheckout);
checkoutModal.addEventListener('click', (e) => { if (e.target === checkoutModal) closeCheckout(); });

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

/* Reseller program removed from the site */

/* Live social-proof rotator removed (was fabricated order activity) */

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
    <p>Your <b>SKETCH10</b> code + sample pack offer are on the way. Talk soon.</p>
    <button class="btn btn-primary" onclick="document.getElementById('exitModal').hidden=true">Got it</button>
  `;
});

/* ---------- Chat bubble ---------- */
$('#chatBubble').addEventListener('click', () => {
  alert('Live chat\n\nHi! Real version would open Intercom/Crisp/Tidio.\n\nText us now: (800) 555-1234\nEmail: hello@sketchitgraphics.com');
});

/* smooth scroll on nav links moved to common.js */

/* Consent + affiliate referral tracking moved to common.js (runs on every page) */

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
    syncSegFromState('colors', state.colors);
    $('#widthIn').value = state.width;
    $('#heightIn').value = state.height;
    $('#qtyRange').value = state.qty;
    $('#firstOrder').checked = !!state.firstOrder;
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
  // Consent + affiliate referral capture run in common.js (every page).
  restoreQuoteState();   // restore previous quote draft
  render();              // initial paint
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

/* ===================================================================
   affiliate.js — affiliate.html only
   Wires the earnings calculator + signup form (previously template-only).
   Depends on common.js ($, fmt, getCookie) loaded first.
   =================================================================== */
(function () {
  const fmt0 = (n) => '$' + Math.round(n).toLocaleString();
  const RATE = 0.10;

  /* ---- earnings calculator ---- */
  function calcAffiliate() {
    const clients = parseFloat($('#afClients').value) || 0;
    const avg = parseFloat($('#afAvg').value) || 0;
    const reorders = parseFloat($('#afReorders').value) || 0;
    const month1 = clients * avg * RATE;
    const year1 = clients * 12 * reorders * avg * RATE;   // all referred clients, all their orders, year 1
    const year3 = year1 * 3;                               // 3 cohorts still ordering
    $('#afMonth1').textContent = fmt0(month1);
    $('#afYear1').textContent = fmt0(year1);
    $('#afYear3').textContent = fmt0(year3);
  }
  ['afClients', 'afAvg', 'afReorders'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', calcAffiliate);
  });

  /* ---- referral code slug validation ---- */
  const slug = (v) => (v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  const codeInput = $('#afCode');
  const codeStatus = $('#afCodeStatus');
  function validateCode() {
    if (!codeInput) return false;
    const v = slug(codeInput.value);
    if (codeInput.value !== v) codeInput.value = v;   // live-sanitize keystrokes
    const ok = v.length >= 3;
    if (codeStatus) {
      codeStatus.textContent = !v
        ? '3–20 chars, lowercase letters, numbers, dashes.'
        : ok ? `✓ sketchitgraphics.com/r/${v} is available`
             : 'A bit longer — at least 3 characters.';
      codeStatus.classList.toggle('ok', ok && !!v);
      codeStatus.classList.toggle('err', !ok && !!v);
    }
    return ok;
  }
  if (codeInput) codeInput.addEventListener('input', validateCode);

  /* ---- signup form → success state ---- */
  const form = $('#affForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let code = slug($('#afCode').value);
      if (code.length < 3) {
        code = slug($('#afName').value || $('#afEmail').value || 'creator') || 'creator';
      }
      const link = `sketchitgraphics.com/r/${code}`;
      const out = $('#affLinkOut'); if (out) out.textContent = link;
      const dl = $('#dashLink'); if (dl) dl.textContent = link;
      form.hidden = true;
      const success = $('#affSuccess'); if (success) success.hidden = false;
    });
  }

  /* ---- copy buttons ---- */
  function copyText(text, btn) {
    const flash = () => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(flash);
    } else { flash(); }
  }
  const copyLink = $('#copyLink');
  if (copyLink) copyLink.addEventListener('click', () => copyText(($('#affLinkOut') && $('#affLinkOut').textContent) || '', copyLink));
  const dashCopy = $('#dashCopy');
  if (dashCopy) dashCopy.addEventListener('click', () => copyText(($('#dashLink') && $('#dashLink').textContent) || '', dashCopy));

  /* ---- view sample dashboard ---- */
  const viewDash = $('#viewDash');
  if (viewDash) viewDash.addEventListener('click', () => {
    const d = $('#affDash');
    if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if ($('#afMonth1')) calcAffiliate();   // initial paint
})();

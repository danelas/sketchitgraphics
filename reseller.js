/* ===================================================================
   reseller.js — reseller.html only
   Profit calculator (moved from the homepage script).
   Depends on common.js ($, fmt) loaded first.
   =================================================================== */
(function () {
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
  ['rcCost', 'rcShirt', 'rcRetail', 'rcUnits'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', calcReseller);
  });
  if ($('#rcMargin')) calcReseller();   // initial paint
})();

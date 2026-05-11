-- ============================================================================
-- Sketch It Graphics — Seed Data
-- Reference tables + the launch discount code.
-- ============================================================================

-- Transfer types
insert into public.transfer_types (code, name, description, min_qty, unit_label, sort_order) values
  ('plastisol', 'Plastisol Heat Transfers',
   'Screen-printed plastisol ink on release paper. Best for 1–6 spot color designs, bold prints, durable wash life.',
   25, 'transfer', 1),
  ('dtf', 'DTF Gang Sheets',
   'Direct-to-film printing with white underbase and powdered adhesive. Unlimited colors, photo-real artwork, low MOQ.',
   1,  'linear foot', 2),
  ('screen', 'Screen-Print Transfers',
   'True silkscreened ink layers offering the longest wash life. Best for bulk uniform runs of 250 or more.',
   25, 'transfer', 3)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      min_qty = excluded.min_qty,
      unit_label = excluded.unit_label,
      sort_order = excluded.sort_order;

-- Rush tiers
insert into public.rush_tiers (code, name, business_days, flat_fee_cents, sort_order) values
  ('standard', 'Standard',  5, 0,    1),
  ('r72',      '72-hour',   3, 2000, 2),
  ('r48',      '48-hour',   2, 3500, 3),
  ('r24',      '24-hour',   1, 4500, 4)
on conflict (code) do update
  set business_days = excluded.business_days,
      flat_fee_cents = excluded.flat_fee_cents,
      sort_order = excluded.sort_order;

-- Discount codes
insert into public.discount_codes
  (code, description, percent_off, min_order_cents, first_order_only, active)
values
  ('SKETCH15', '15% off first order', 15.00, 5000, true, true)
on conflict (code) do update
  set description = excluded.description,
      percent_off = excluded.percent_off,
      min_order_cents = excluded.min_order_cents,
      first_order_only = excluded.first_order_only,
      active = excluded.active;

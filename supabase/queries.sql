-- ============================================================================
-- Sketch It Graphics — Common Application Queries
-- Reference / docs file. Not executed directly — copy these into your app code
-- or wrap in pg functions / Supabase RPCs as needed.
-- ============================================================================

-- --------------------------------------------------------------------------
-- A) QUOTES
-- --------------------------------------------------------------------------

-- A1. Save a guest quote (no auth) from the instant-quote calculator
-- Params: $1 email, $2 affiliate_code, $3 subtotal, $4 rush_fee, $5 discount, $6 total
insert into quotes (email, affiliate_code, status, subtotal_cents, rush_fee_cents, discount_cents, total_cents)
values ($1, $2, 'emailed', $3, $4, $5, $6)
returning id;

-- A2. Add a line to a quote
insert into quote_items (quote_id, artwork_id, transfer_type, color_mode, width_inches, height_inches, quantity, unit_price_cents)
values ($1, $2, $3, $4, $5, $6, $7, $8)
returning *;

-- A3. Convert a quote into an order (server-side, runs in a transaction)
-- Use a SQL function in production. Pseudocode:
--   1. INSERT into orders (snapshot quote totals)
--   2. INSERT into order_items SELECT FROM quote_items
--   3. UPDATE quotes SET status = 'converted'
--   4. If quote.affiliate_code matches an active affiliate AND customer has no prior attribution → INSERT affiliate_attributions

-- --------------------------------------------------------------------------
-- B) ORDERS
-- --------------------------------------------------------------------------

-- B1. List orders for the signed-in customer (RLS handles the filter)
select
  o.id, o.order_number, o.status, o.payment_status, o.total_cents,
  o.tracking_number, o.created_at, o.shipped_at,
  (select count(*) from order_items where order_id = o.id) as line_count
from orders o
order by created_at desc
limit 50;

-- B2. Look up a reorder by short code (public, via SECURITY DEFINER function)
select * from public.lookup_reorder('SKG-7G2K-9X');

-- B3. Mark an order as paid (called from your Stripe webhook)
update orders
   set payment_status = 'paid',
       paid_at = now()
 where id = $1
   and payment_status in ('unpaid','partial');

-- After marking paid, create the affiliate commission row:
select public.create_commission_for_order($1);

-- B4. Add an event to the order timeline
insert into order_events (order_id, event_type, from_status, to_status, actor_user_id, notes)
values ($1, 'status_changed', $2, $3, auth.uid(), $4);

-- --------------------------------------------------------------------------
-- C) AFFILIATE
-- --------------------------------------------------------------------------

-- C1. Affiliate signup
insert into affiliates (full_name, email, referral_code, channel, audience_info, terms_accepted_at)
values ($1, $2, lower($3), $4, $5, now())
returning *;

-- C2. Log a referral click (called from the /r/:code redirect endpoint)
insert into affiliate_clicks (referral_code, landing_path, user_agent, ip_country, session_id, consented)
values ($1, $2, $3, $4, $5, $6);

-- C3. Attribute a customer to an affiliate on their first order
-- (Idempotent: PK is customer_id, so duplicate inserts no-op)
insert into affiliate_attributions (customer_id, affiliate_id, referral_code)
select $1, a.id, a.referral_code
  from affiliates a
 where a.referral_code = $2
   and a.status = 'approved'
on conflict (customer_id) do nothing;

-- C4. Affiliate dashboard (real-time stats)
select * from affiliate_dashboard_stats where affiliate_id = $1;

-- C5. List an affiliate's recent commissions
select
  c.id, c.amount_cents, c.commission_pct, c.status, c.created_at,
  o.order_number, cust.full_name as client_name
from commissions c
join orders o on o.id = c.order_id
join customers cust on cust.id = c.customer_id
where c.affiliate_id = $1
order by c.created_at desc
limit 50;

-- C6. Earnings by month for the last 12 months
select
  date_trunc('month', created_at)::date as month,
  count(*) as commissions,
  sum(amount_cents) as cents_earned
from commissions
where affiliate_id = $1
  and created_at >= (now() - interval '12 months')
group by 1
order by 1;

-- C7. Generate a payout for everything pending older than 30 days (cron job)
with eligible as (
  select affiliate_id, sum(amount_cents) as total_cents
  from commissions
  where status = 'approved'
    and created_at < (now() - interval '30 days')
  group by affiliate_id
  having sum(amount_cents) >= 2500   -- $25 minimum
), payouts_inserted as (
  insert into payouts (affiliate_id, amount_cents, method, period_start, period_end, status)
  select e.affiliate_id, e.total_cents,
         a.payout_method,
         (now() - interval '30 days')::date,
         now()::date,
         'pending'
    from eligible e
    join affiliates a on a.id = e.affiliate_id
   where a.payout_method is not null
  returning id, affiliate_id
)
update commissions
   set status = 'paid',
       paid_at = now(),
       payout_id = p.id
  from payouts_inserted p
 where commissions.affiliate_id = p.affiliate_id
   and commissions.status = 'approved'
   and commissions.created_at < (now() - interval '30 days');

-- --------------------------------------------------------------------------
-- D) RESELLER
-- --------------------------------------------------------------------------

-- D1. Promote a customer to reseller
update customers
   set is_reseller = true,
       reseller_tier = 'standard'
 where id = $1;

-- D2. Add a reseller's end-client
insert into reseller_clients (reseller_id, client_name, client_email, client_company)
values ($1, $2, $3, $4)
returning *;

-- --------------------------------------------------------------------------
-- E) SAMPLE PACKS
-- --------------------------------------------------------------------------

-- E1. Capture a sample pack request
insert into sample_pack_requests (customer_id, email, full_name, ship_to_address_id, stripe_payment_intent_id)
values ($1, $2, $3, $4, $5)
returning id;

-- E2. Apply sample-pack credit when the customer places their first $50+ order
update sample_pack_requests
   set credit_applied_to_order_id = $2
 where email = $1
   and credit_applied_to_order_id is null
   and exists (select 1 from orders where id = $2 and subtotal_cents >= 5000);

-- --------------------------------------------------------------------------
-- F) ANALYTICS / OPS
-- --------------------------------------------------------------------------

-- F1. Top affiliates this month
select
  a.referral_code,
  a.full_name,
  count(c.id) as orders,
  sum(c.amount_cents) as cents_earned
from affiliates a
join commissions c on c.affiliate_id = a.id
where c.created_at >= date_trunc('month', now())
group by a.id, a.referral_code, a.full_name
order by cents_earned desc
limit 20;

-- F2. Conversion: clicks → orders for an affiliate
select
  (select count(*) from affiliate_clicks where referral_code = $1
    and created_at >= now() - interval '30 days') as clicks_30d,
  (select count(*) from affiliate_attributions where referral_code = $1
    and attributed_at >= now() - interval '30 days') as new_attributions_30d,
  (select count(*) from commissions c
     join affiliates a on a.id = c.affiliate_id
    where a.referral_code = $1
      and c.created_at >= now() - interval '30 days') as orders_30d;

-- F3. Repeat rate (customers with 2+ orders)
select
  count(*) filter (where orders_count >= 2) * 100.0 / count(*) as repeat_pct
from (
  select customer_id, count(*) as orders_count
  from orders
  where payment_status = 'paid'
  group by customer_id
) t;

-- F4. Refund rate by month
select
  date_trunc('month', created_at)::date as month,
  count(*) as total_orders,
  count(*) filter (where status = 'refunded') as refunded,
  round(count(*) filter (where status = 'refunded') * 100.0 / count(*), 2) as refund_pct
from orders
where created_at >= now() - interval '12 months'
group by 1
order by 1 desc;

-- F5. Average order value by transfer type
select
  oi.transfer_type,
  count(distinct o.id) as orders,
  round(avg(o.total_cents) / 100.0, 2) as avg_order_usd
from orders o
join order_items oi on oi.order_id = o.id
where o.payment_status = 'paid'
  and o.created_at >= now() - interval '90 days'
group by oi.transfer_type;

-- ============================================================================
-- Sketch It Graphics — Initial Schema
-- Postgres 15+ / Supabase-compatible
--
-- Conventions:
--   - snake_case for all identifiers
--   - `uuid` primary keys for public-facing entities, `bigint identity` for line items
--   - `timestamptz` for every timestamp (never `timestamp`)
--   - `numeric(10,2)` for money (never `float` or `real`)
--   - `text` for strings (never `varchar(n)`)
--   - `citext` for emails (case-insensitive uniqueness)
--   - RLS enabled on every table with explicit policies
--   - Foreign keys are indexed
--   - `updated_at` maintained by trigger
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text

-- ============================================================================
-- 1. SHARED HELPERS
-- ============================================================================

-- Generic updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Generate a short, readable reorder code: SKG-XXXX-XX (8 alphanumerics)
create or replace function public.gen_reorder_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';  -- no 0/O/1/I confusion
  out text := 'SKG-';
  i int;
begin
  for i in 1..4 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  out := out || '-';
  for i in 1..2 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- ============================================================================
-- 2. ENUMS  (use check constraints + text — easier to evolve than pg ENUMs)
-- ============================================================================

-- transfer_type     : 'plastisol' | 'dtf' | 'screen'
-- color_mode        : '1' | '2' | '3' | '4' | '5' | '6' | 'process'
-- rush_tier         : 'standard' | 'r72' | 'r48' | 'r24'
-- order_status      : 'draft' | 'pending_proof' | 'proof_sent' | 'approved'
--                     | 'in_production' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
-- payment_status    : 'unpaid' | 'paid' | 'partial' | 'refunded' | 'failed'
-- payout_status     : 'pending' | 'processing' | 'paid' | 'failed'
-- commission_status : 'pending' | 'approved' | 'paid' | 'reversed'
-- payout_method     : 'paypal' | 'stripe' | 'ach' | 'check'

-- ============================================================================
-- 3. REFERENCE TABLES (small, mostly-static data)
-- ============================================================================

create table public.transfer_types (
  code              text primary key,
  name              text not null,
  description       text,
  min_qty           int not null default 1,
  unit_label        text not null default 'transfer',
  active            boolean not null default true,
  sort_order        int not null default 0
);

create table public.rush_tiers (
  code              text primary key,
  name              text not null,
  business_days     int not null,
  flat_fee_cents    int not null default 0,
  active            boolean not null default true,
  sort_order        int not null default 0
);

-- Discount codes: SKETCH15, etc.
create table public.discount_codes (
  code              text primary key,
  description       text,
  percent_off       numeric(5,2) check (percent_off between 0 and 100),
  flat_off_cents    int default 0 check (flat_off_cents >= 0),
  min_order_cents   int default 0 check (min_order_cents >= 0),
  max_uses          int,
  uses_count        int not null default 0,
  first_order_only  boolean not null default false,
  starts_at         timestamptz,
  expires_at        timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index discount_codes_active_idx on public.discount_codes (active) where active = true;

-- ============================================================================
-- 4. CUSTOMERS  (linked to Supabase auth.users)
-- ============================================================================

create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users(id) on delete set null,  -- nullable: guests
  email             citext not null,
  full_name         text,
  phone             text,
  company           text,
  is_reseller       boolean not null default false,
  reseller_tier     text check (reseller_tier in ('standard','silver','gold','platinum')),
  marketing_opt_in  boolean not null default false,
  lifetime_value_cents bigint not null default 0,
  first_order_at    timestamptz,
  last_order_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index customers_email_idx on public.customers (email);
create index customers_user_id_idx on public.customers (user_id);
create index customers_reseller_idx on public.customers (is_reseller) where is_reseller = true;
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.tg_set_updated_at();

create table public.addresses (
  id                bigint primary key generated always as identity,
  customer_id       uuid not null references public.customers(id) on delete cascade,
  kind              text not null check (kind in ('shipping','billing')),
  name              text not null,
  line1             text not null,
  line2             text,
  city              text not null,
  region            text not null,
  postal_code       text not null,
  country           text not null default 'US',
  phone             text,
  is_default        boolean not null default false,
  created_at        timestamptz not null default now()
);
create index addresses_customer_idx on public.addresses (customer_id);
create index addresses_default_idx on public.addresses (customer_id, kind) where is_default = true;

-- ============================================================================
-- 5. ARTWORK FILES
-- ============================================================================

create table public.artwork_files (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(id) on delete set null,
  storage_path      text not null,                  -- Supabase Storage path
  original_filename text not null,
  mime_type         text not null,
  file_size_bytes   bigint not null,
  detected_colors   int,                            -- auto-detected color count
  detected_palette  jsonb,                          -- [{hex, pct_coverage}, ...]
  is_vector         boolean not null default false,
  art_prep_required boolean not null default false,
  preview_url       text,
  created_at        timestamptz not null default now()
);
create index artwork_files_customer_idx on public.artwork_files (customer_id);

-- ============================================================================
-- 6. QUOTES   (in-progress / saved quotes; convertible to orders)
-- ============================================================================

create table public.quotes (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(id) on delete set null,
  email             citext,                         -- for guest "email me this quote"
  affiliate_code    text,                           -- captured at quote-time
  status            text not null default 'draft'
                    check (status in ('draft','emailed','converted','expired')),
  subtotal_cents    int not null default 0,
  separation_cents  int not null default 3000,      -- $30 flat
  rush_fee_cents    int not null default 0,
  discount_cents    int not null default 0,
  discount_code     text references public.discount_codes(code),
  total_cents       int not null default 0,
  expires_at        timestamptz default (now() + interval '30 days'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_email_idx on public.quotes (email) where email is not null;
create index quotes_status_idx on public.quotes (status) where status in ('draft','emailed');
create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function public.tg_set_updated_at();

create table public.quote_items (
  id                bigint primary key generated always as identity,
  quote_id          uuid not null references public.quotes(id) on delete cascade,
  artwork_id        uuid references public.artwork_files(id) on delete set null,
  transfer_type     text not null references public.transfer_types(code),
  color_mode        text not null check (color_mode in ('1','2','3','4','5','6','process')),
  width_inches      numeric(5,2) not null check (width_inches > 0),
  height_inches     numeric(5,2) not null check (height_inches > 0),
  quantity          int not null check (quantity > 0),
  unit_price_cents  int not null check (unit_price_cents >= 0),
  line_total_cents  int generated always as (unit_price_cents * quantity) stored,
  notes             text,
  created_at        timestamptz not null default now()
);
create index quote_items_quote_idx on public.quote_items (quote_id);

-- ============================================================================
-- 7. ORDERS
-- ============================================================================

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text not null unique,                 -- human-readable: SKG-2026-00001
  customer_id       uuid not null references public.customers(id) on delete restrict,
  source_quote_id   uuid references public.quotes(id) on delete set null,
  status            text not null default 'pending_proof'
                    check (status in ('draft','pending_proof','proof_sent','approved',
                                      'in_production','shipped','delivered','cancelled','refunded')),
  payment_status    text not null default 'unpaid'
                    check (payment_status in ('unpaid','paid','partial','refunded','failed')),
  rush_tier         text not null default 'standard' references public.rush_tiers(code),

  -- Money (all in integer cents to avoid float errors)
  subtotal_cents    int not null default 0,
  separation_cents  int not null default 0,
  rush_fee_cents    int not null default 0,
  discount_cents    int not null default 0,
  discount_code     text references public.discount_codes(code),
  shipping_cents    int not null default 0,
  tax_cents         int not null default 0,
  total_cents       int not null default 0,
  refunded_cents    int not null default 0,

  -- Attribution
  affiliate_code    text,                                 -- snapshot at order time
  reseller_id       uuid references public.customers(id) on delete set null,

  -- Shipping
  shipping_address_id bigint references public.addresses(id) on delete set null,
  shipping_carrier  text,
  tracking_number   text,

  -- Stripe / payment processor refs
  stripe_payment_intent_id text,
  stripe_charge_id  text,

  -- Reorder
  reorder_code      text unique default public.gen_reorder_code(),

  -- Lifecycle timestamps
  paid_at           timestamptz,
  proof_sent_at     timestamptz,
  approved_at       timestamptz,
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id);
create index orders_status_idx on public.orders (status);
create index orders_payment_status_idx on public.orders (payment_status);
create index orders_affiliate_code_idx on public.orders (affiliate_code) where affiliate_code is not null;
create index orders_reorder_code_idx on public.orders (reorder_code);
create index orders_created_at_idx on public.orders (created_at desc);
-- Partial index for active orders (most queries hit these)
create index orders_active_idx on public.orders (status, created_at desc)
  where status not in ('delivered','cancelled','refunded');
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id                bigint primary key generated always as identity,
  order_id          uuid not null references public.orders(id) on delete cascade,
  artwork_id        uuid references public.artwork_files(id) on delete set null,
  transfer_type     text not null references public.transfer_types(code),
  color_mode        text not null check (color_mode in ('1','2','3','4','5','6','process')),
  width_inches      numeric(5,2) not null,
  height_inches     numeric(5,2) not null,
  quantity          int not null check (quantity > 0),
  unit_price_cents  int not null,
  line_total_cents  int generated always as (unit_price_cents * quantity) stored,
  production_notes  text,
  created_at        timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id                bigint primary key generated always as identity,
  order_id          uuid not null references public.orders(id) on delete cascade,
  event_type        text not null,                  -- 'status_changed','proof_uploaded','note_added', etc.
  from_status       text,
  to_status         text,
  actor_user_id     uuid references auth.users(id) on delete set null,
  notes             text,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at desc);

-- ============================================================================
-- 8. AFFILIATES
-- ============================================================================

create table public.affiliates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users(id) on delete set null,
  customer_id       uuid references public.customers(id) on delete set null,
  referral_code     text not null unique
                    check (referral_code ~ '^[a-z0-9-]{3,40}$'),
  full_name         text not null,
  email             citext not null unique,
  channel           text not null,                  -- 'instagram','tiktok','youtube','blog','community','designer','printshop','other'
  audience_info     text,
  status            text not null default 'pending'
                    check (status in ('pending','approved','suspended','closed')),

  -- Tier ladder: 10% default, 15% after $10k lifetime, 20% after $50k
  commission_pct    numeric(5,2) not null default 10.00 check (commission_pct between 0 and 50),
  lifetime_earnings_cents bigint not null default 0,

  -- Payout
  payout_method     text check (payout_method in ('paypal','stripe','ach','check')),
  payout_email      citext,
  payout_min_cents  int not null default 2500,      -- $25 minimum

  -- Compliance
  w9_on_file        boolean not null default false,
  terms_accepted_at timestamptz,

  approved_at       timestamptz,
  approved_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index affiliates_status_idx on public.affiliates (status);
create index affiliates_user_idx on public.affiliates (user_id);
create trigger affiliates_set_updated_at before update on public.affiliates
  for each row execute function public.tg_set_updated_at();

-- Raw click log — useful for funnel analytics
create table public.affiliate_clicks (
  id                bigint primary key generated always as identity,
  referral_code     text not null,
  landing_path      text,
  user_agent        text,
  ip_country        text,                           -- never store raw IP — GDPR-safer
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  session_id        text,                           -- anonymous session correlation
  consented         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index affiliate_clicks_code_idx on public.affiliate_clicks (referral_code, created_at desc);
create index affiliate_clicks_session_idx on public.affiliate_clicks (session_id) where session_id is not null;

-- First-touch attribution: when a customer places their first order, they get permanently tagged
create table public.affiliate_attributions (
  customer_id       uuid primary key references public.customers(id) on delete cascade,
  affiliate_id      uuid not null references public.affiliates(id) on delete restrict,
  referral_code     text not null,
  attribution_kind  text not null default 'first_touch'
                    check (attribution_kind in ('first_touch','last_touch','manual')),
  attributed_at     timestamptz not null default now()
);
create index affiliate_attributions_affiliate_idx on public.affiliate_attributions (affiliate_id);

-- One commission row per order. Lifetime model = every order from attributed customer creates one.
create table public.commissions (
  id                uuid primary key default gen_random_uuid(),
  affiliate_id      uuid not null references public.affiliates(id) on delete restrict,
  order_id          uuid not null unique references public.orders(id) on delete cascade,
  customer_id       uuid not null references public.customers(id) on delete restrict,
  -- Snapshot of rate at time of order (so future tier changes don't retroactively change history)
  commission_pct    numeric(5,2) not null,
  base_amount_cents int not null,                   -- subtotal (excludes shipping/tax/fees)
  amount_cents      int not null,                   -- base * pct
  status            text not null default 'pending'
                    check (status in ('pending','approved','paid','reversed')),
  payout_id         uuid,                           -- set when included in a payout
  approved_at       timestamptz,
  paid_at           timestamptz,
  reversed_at       timestamptz,
  reversal_reason   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index commissions_affiliate_idx on public.commissions (affiliate_id, status);
create index commissions_status_idx on public.commissions (status);
create index commissions_payout_idx on public.commissions (payout_id) where payout_id is not null;
create trigger commissions_set_updated_at before update on public.commissions
  for each row execute function public.tg_set_updated_at();

-- Payout batches
create table public.payouts (
  id                uuid primary key default gen_random_uuid(),
  affiliate_id      uuid not null references public.affiliates(id) on delete restrict,
  amount_cents      int not null check (amount_cents > 0),
  method            text not null check (method in ('paypal','stripe','ach','check')),
  status            text not null default 'pending'
                    check (status in ('pending','processing','paid','failed')),
  external_ref      text,                           -- PayPal txn id, Stripe transfer id, etc.
  period_start      date not null,
  period_end        date not null,
  paid_at           timestamptz,
  failure_reason    text,
  created_at        timestamptz not null default now()
);
create index payouts_affiliate_idx on public.payouts (affiliate_id, created_at desc);

alter table public.commissions
  add constraint commissions_payout_fk foreign key (payout_id) references public.payouts(id) on delete set null;

-- ============================================================================
-- 9. RESELLER PROGRAM
-- ============================================================================

-- Resellers are just customers with `is_reseller = true`. This table tracks
-- their end-clients (used for blind shipping + their own client management).
create table public.reseller_clients (
  id                bigint primary key generated always as identity,
  reseller_id       uuid not null references public.customers(id) on delete cascade,
  client_name       text not null,
  client_email      citext,
  client_company    text,
  internal_notes    text,
  created_at        timestamptz not null default now()
);
create index reseller_clients_reseller_idx on public.reseller_clients (reseller_id);

-- ============================================================================
-- 10. SAMPLE PACK REQUESTS
-- ============================================================================

create table public.sample_pack_requests (
  id                bigint primary key generated always as identity,
  customer_id       uuid references public.customers(id) on delete set null,
  email             citext not null,
  full_name         text,
  ship_to_address_id bigint references public.addresses(id) on delete set null,
  status            text not null default 'pending'
                    check (status in ('pending','shipped','delivered')),
  stripe_payment_intent_id text,
  credit_applied_to_order_id uuid references public.orders(id) on delete set null,
  shipped_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index sample_pack_requests_email_idx on public.sample_pack_requests (email);
create index sample_pack_requests_status_idx on public.sample_pack_requests (status) where status = 'pending';

-- ============================================================================
-- 11. EMAIL CAPTURES (exit modal, save-quote, newsletter)
-- ============================================================================

create table public.email_captures (
  id                bigint primary key generated always as identity,
  email             citext not null,
  source            text not null,                  -- 'exit_modal','save_quote','samples','newsletter','footer'
  page_path         text,
  affiliate_code    text,
  metadata          jsonb,
  consented         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index email_captures_email_idx on public.email_captures (email);
create index email_captures_source_idx on public.email_captures (source, created_at desc);

-- ============================================================================
-- 12. CONSENT RECORDS  (GDPR/CCPA audit trail)
-- ============================================================================

create table public.consent_records (
  id                bigint primary key generated always as identity,
  customer_id       uuid references public.customers(id) on delete set null,
  session_id        text,
  consent_version   int not null,
  functional        boolean not null,
  affiliate         boolean not null,
  analytics         boolean not null,
  marketing         boolean not null,
  ip_country        text,
  user_agent        text,
  created_at        timestamptz not null default now()
);
create index consent_records_customer_idx on public.consent_records (customer_id, created_at desc);
create index consent_records_session_idx on public.consent_records (session_id, created_at desc);

-- ============================================================================
-- 13. ANALYTICS VIEWS
-- ============================================================================

-- Real-time affiliate dashboard data
create or replace view public.affiliate_dashboard_stats as
select
  a.id                                                    as affiliate_id,
  a.referral_code,
  a.commission_pct,
  a.lifetime_earnings_cents,
  count(distinct att.customer_id)                         as active_clients,
  count(distinct c.order_id)                              as total_orders,
  coalesce(sum(c.amount_cents) filter
    (where c.created_at >= date_trunc('month', now())), 0) as this_month_cents,
  coalesce(sum(c.amount_cents) filter
    (where c.status = 'pending'), 0)                      as pending_cents,
  coalesce(sum(c.amount_cents) filter
    (where c.status = 'paid'), 0)                         as paid_cents
from public.affiliates a
left join public.affiliate_attributions att on att.affiliate_id = a.id
left join public.commissions c on c.affiliate_id = a.id
group by a.id;

-- Monthly revenue summary
create or replace view public.monthly_revenue as
select
  date_trunc('month', created_at)::date as month,
  count(*) as order_count,
  sum(total_cents) as gross_cents,
  sum(refunded_cents) as refunded_cents,
  sum(total_cents - refunded_cents) as net_cents,
  count(*) filter (where customer_id in (
    select customer_id from public.orders o2
    where o2.created_at < public.orders.created_at
  )) as repeat_orders
from public.orders
where payment_status = 'paid'
group by 1
order by 1 desc;

-- ============================================================================
-- 14. ROW-LEVEL SECURITY
-- ============================================================================
-- All tables get RLS enabled. Service role (server-side) bypasses RLS automatically.
-- These policies are for the public/anon role hitting Supabase directly from the browser.

alter table public.customers              enable row level security;
alter table public.addresses              enable row level security;
alter table public.artwork_files          enable row level security;
alter table public.quotes                 enable row level security;
alter table public.quote_items            enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.order_events           enable row level security;
alter table public.affiliates             enable row level security;
alter table public.affiliate_clicks       enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.commissions            enable row level security;
alter table public.payouts                enable row level security;
alter table public.reseller_clients       enable row level security;
alter table public.sample_pack_requests   enable row level security;
alter table public.email_captures         enable row level security;
alter table public.consent_records        enable row level security;
alter table public.transfer_types         enable row level security;
alter table public.rush_tiers             enable row level security;
alter table public.discount_codes         enable row level security;

-- Reference tables: read-only public
create policy "transfer_types public read" on public.transfer_types
  for select to anon, authenticated using (true);
create policy "rush_tiers public read" on public.rush_tiers
  for select to anon, authenticated using (true);
create policy "active discount codes public read" on public.discount_codes
  for select to anon, authenticated using (active = true and (expires_at is null or expires_at > now()));

-- Customers: only their own row
create policy "customers self read" on public.customers
  for select to authenticated using (auth.uid() = user_id);
create policy "customers self update" on public.customers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Addresses: only their own
create policy "addresses self all" on public.addresses
  for all to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()))
  with check (customer_id in (select id from public.customers where user_id = auth.uid()));

-- Artwork: only their own (guests use signed URLs via server-side route)
create policy "artwork self all" on public.artwork_files
  for all to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()))
  with check (customer_id in (select id from public.customers where user_id = auth.uid()));

-- Quotes: read your own; anyone can insert (guest quotes)
create policy "quotes self read" on public.quotes
  for select to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "quotes anyone insert" on public.quotes
  for insert to anon, authenticated with check (true);
create policy "quotes self update" on public.quotes
  for update to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()));

create policy "quote_items via parent" on public.quote_items
  for all to anon, authenticated
  using (quote_id in (select id from public.quotes where customer_id in
        (select id from public.customers where user_id = auth.uid()) or customer_id is null))
  with check (quote_id in (select id from public.quotes));

-- Orders: read-only for the buyer; never inserted by clients directly (server-side only via service role)
create policy "orders self read" on public.orders
  for select to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()));

-- Reorder code lookup: public, but only returns minimal columns via a SECURITY DEFINER function (defined below)
-- (No direct SELECT policy for anon.)

create policy "order_items self read" on public.order_items
  for select to authenticated
  using (order_id in (select id from public.orders where customer_id in
        (select id from public.customers where user_id = auth.uid())));

create policy "order_events self read" on public.order_events
  for select to authenticated
  using (order_id in (select id from public.orders where customer_id in
        (select id from public.customers where user_id = auth.uid())));

-- Affiliates: read their own row; signup is open
create policy "affiliate_signup anyone insert" on public.affiliates
  for insert to anon, authenticated with check (true);
create policy "affiliates self read" on public.affiliates
  for select to authenticated using (auth.uid() = user_id);

-- Clicks: anyone can insert (tracking pixel); reads are server-side only
create policy "clicks anyone insert" on public.affiliate_clicks
  for insert to anon, authenticated with check (true);

-- Commissions: affiliate sees only their own
create policy "commissions self read" on public.commissions
  for select to authenticated
  using (affiliate_id in (select id from public.affiliates where user_id = auth.uid()));

create policy "payouts self read" on public.payouts
  for select to authenticated
  using (affiliate_id in (select id from public.affiliates where user_id = auth.uid()));

-- Sample pack: anyone can insert; only the requester can read (by email match for guests = handled server-side)
create policy "sample_pack anyone insert" on public.sample_pack_requests
  for insert to anon, authenticated with check (true);

-- Email captures: anyone can insert; reads are admin-only (service role)
create policy "email_captures anyone insert" on public.email_captures
  for insert to anon, authenticated with check (true);

-- Consent records: anyone can insert their own; reads are admin-only
create policy "consent anyone insert" on public.consent_records
  for insert to anon, authenticated with check (true);

-- Reseller clients: reseller sees their own
create policy "reseller_clients self all" on public.reseller_clients
  for all to authenticated
  using (reseller_id in (select id from public.customers where user_id = auth.uid()))
  with check (reseller_id in (select id from public.customers where user_id = auth.uid()));

-- ============================================================================
-- 15. SECURITY DEFINER FUNCTIONS (controlled access for public endpoints)
-- ============================================================================

-- Public reorder-code lookup: returns ONLY the minimal info needed to prefill a quote
create or replace function public.lookup_reorder(p_reorder_code text)
returns table (
  reorder_code     text,
  transfer_type    text,
  color_mode       text,
  width_inches     numeric,
  height_inches    numeric,
  quantity         int,
  rush_tier        text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    o.reorder_code,
    oi.transfer_type,
    oi.color_mode,
    oi.width_inches,
    oi.height_inches,
    oi.quantity,
    o.rush_tier
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.reorder_code = p_reorder_code
    and o.status in ('delivered','shipped','approved')
$$;
grant execute on function public.lookup_reorder(text) to anon, authenticated;

-- Create commission row when an order is paid (call from your payment webhook)
create or replace function public.create_commission_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribution record;
  v_order record;
  v_commission_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order is null or v_order.payment_status != 'paid' then
    return null;
  end if;

  -- Find first-touch attribution for this customer
  select aa.affiliate_id, a.commission_pct
    into v_attribution
  from public.affiliate_attributions aa
  join public.affiliates a on a.id = aa.affiliate_id
  where aa.customer_id = v_order.customer_id
    and a.status = 'approved';

  if v_attribution is null then return null; end if;

  -- Idempotent: skip if already exists
  if exists (select 1 from public.commissions where order_id = p_order_id) then
    return null;
  end if;

  insert into public.commissions
    (affiliate_id, order_id, customer_id, commission_pct, base_amount_cents, amount_cents)
  values
    (v_attribution.affiliate_id,
     p_order_id,
     v_order.customer_id,
     v_attribution.commission_pct,
     v_order.subtotal_cents,
     round(v_order.subtotal_cents * v_attribution.commission_pct / 100.0))
  returning id into v_commission_id;

  return v_commission_id;
end;
$$;

-- Tier-bump trigger: bump commission % when affiliate hits lifetime earnings thresholds
create or replace function public.maybe_bump_affiliate_tier(p_affiliate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifetime bigint;
  v_current numeric;
  v_new numeric;
begin
  select lifetime_earnings_cents, commission_pct
    into v_lifetime, v_current
  from public.affiliates where id = p_affiliate_id;

  if v_lifetime >= 5000000 then v_new := 20.00;       -- $50k → 20%
  elsif v_lifetime >= 1000000 then v_new := 15.00;    -- $10k → 15%
  else v_new := 10.00; end if;

  if v_new > v_current then
    update public.affiliates
       set commission_pct = v_new
     where id = p_affiliate_id;
  end if;
end;
$$;

-- ============================================================================
-- Color separation is now FREE (was a $30 flat fee).
-- New offer model: separation is free to preview; free for good when you order.
-- If a customer keeps the print-ready files without ordering, a one-time $15
-- is charged at the application layer and credited back on their first order —
-- so the stored default here is simply 0.
-- ============================================================================

alter table public.quotes alter column separation_cents set default 0;

-- orders.separation_cents was already default 0; kept explicit for clarity.
alter table public.orders alter column separation_cents set default 0;

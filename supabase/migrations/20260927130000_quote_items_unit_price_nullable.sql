-- Market mode refuses parts that are not benchmarked: their unit price is
-- NULL (no number anywhere), not 0. quote_items.unit_price allows null.
-- File path: /supabase/migrations/20260927130000_quote_items_unit_price_nullable.sql
alter table public.quote_items alter column unit_price drop not null;
alter table public.quote_items alter column unit_price drop default;

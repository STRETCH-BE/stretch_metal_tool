-- Rate version 'market-247+10% v3 (28 Sep 2026)' for the StretchMetal quoting tool (Supabase project stretch_metal_tool)
-- Builds on v2 (flat laser, 53 material/thickness rows, copied unchanged) and adds the phase-2 benchmark of 27 Sep 2026:
--   247TailorSteel quotes BE26065456 (threads M4-M20 by thickness), BE26065461 (edge finishing + certificates), BE26065466/63 (bending with flat twins),
--   BE26065460 (quantities), BE26065459 (tubes - documented, not loaded); Laserhub offers 1819449 + recalculation (countersinks, press-in nuts, powder coating,
--   electro zinc, hot-dip); Xometry E-2128509-2059313 (cross-check).  Selling price = benchmark standard tier x 1.10 (247: Standard = Fast x quote ratio;
--   Laserhub: 19+ working-day tier for coatings, 10 working-day tier for features).  Only tested combinations are present; the engine refuses the rest.
-- Idempotent: re-running removes and re-creates v3 (refused only if a quote already references it).  Apply as ONE migration / one transaction.

-- 0. schema additions (no-ops when already present)
alter table public.rate_bend add column if not exists setup_per_bend_line_eur numeric not null default 0;
alter table public.rate_bend add column if not exists family_multipliers jsonb not null default '{}'::jsonb;
alter table public.rate_bend add column if not exists material_codes text[];
alter table public.rate_bend add column if not exists price_per_bend_per_m numeric not null default 0;
alter table public.rate_bend add column if not exists benchmarked_max_length_mm numeric;
comment on column public.rate_bend.price_per_bend_per_m is 'EUR per metre of bend length beyond 200 mm, added to price_per_bend per bend per piece: p(L) = price_per_bend + price_per_bend_per_m x max(0, L - 0.2 m)';
comment on column public.rate_bend.benchmarked_max_length_mm is 'longest bend actually benchmarked for the row; longer bends are priced with the per-metre extension and flagged amber EXTRAPOLATED_RATE';
comment on column public.rate_bend.setup_per_bend_line_eur is 'EUR once per distinct bend line of a part type (tool set-up), on top of setup_per_part_type';
comment on column public.rate_bend.family_multipliers is 'factor on setup_per_bend_line_eur and price_per_bend by material family, e.g. {"stainless": 2.233}; families absent = 1.0 only if listed in material_codes';
comment on column public.rate_bend.material_codes is 'material codes the row was benchmarked for; NULL = any material of the version';
comment on column public.rate_bend.length_class_mm is 'longest bend the row prices at all (our press brake: 4 400 mm); longer -> red flag';
alter table public.rate_thread add column if not exists price_by_thickness jsonb not null default '[]'::jsonb;
alter table public.rate_thread add column if not exists material_codes text[];
comment on column public.rate_thread.price_by_thickness is 'EUR per thread by sheet thickness [{"thicknessMm":3,"priceEach":0.97}] - exact thickness match, no interpolation; price_each = the 3 mm value or the only value';
alter table public.rate_feature add column if not exists setup_per_line_eur numeric not null default 0;
alter table public.rate_feature add column if not exists material_codes text[];
alter table public.rate_feature add column if not exists min_thickness_mm numeric;
alter table public.rate_feature add column if not exists max_thickness_mm numeric;
alter table public.rate_finish add column if not exists material_codes text[];
alter table public.rate_finish add column if not exists min_thickness_mm numeric;
alter table public.rate_finish add column if not exists max_thickness_mm numeric;
alter table public.rate_finish add column if not exists price_per_part_eur numeric not null default 0;
alter table public.rate_finish add column if not exists min_lead_time_days integer not null default 0;
alter table public.rate_finish add column if not exists minimum_scope text not null default 'order';
alter table public.rate_finish add column if not exists tier_multiplier_applies boolean not null default true;
alter table public.rate_finish add column if not exists limits jsonb not null default '{}'::jsonb;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'rate_finish_minimum_scope_check') then alter table public.rate_finish add constraint rate_finish_minimum_scope_check check (minimum_scope in ('order','colour')); end if; end $$;
comment on column public.rate_finish.price_per_part_eur is 'EUR per piece on top of the unit price (handling)';
comment on column public.rate_finish.minimum_scope is 'order = minimum applies once per quote for this finish; colour = once per distinct colour of this finish in the quote';
comment on column public.rate_finish.min_lead_time_days is 'quotes carrying this finish cannot be offered below this lead time (working days)';
comment on column public.rate_finish.tier_multiplier_applies is 'false = the amount is not multiplied by the lead-time multiplier (certificates)';
comment on column public.rate_finish.limits is 'machine-readable limits, e.g. {"maxOrderNetKg": 10}';

-- 1. (re)create the version
delete from public.rate_versions where id = '3b8d1a38-0000-4000-8000-000000000003'
  and not exists (select 1 from public.quotes q where q.rate_version_id = '3b8d1a38-0000-4000-8000-000000000003' or q.cost_rate_version_id = '3b8d1a38-0000-4000-8000-000000000003');
insert into public.rate_versions (id, label, note, active) values ('3b8d1a38-0000-4000-8000-000000000003', 'market-247+10% v3 (28 Sep 2026)', 'Phase-2 market benchmark 27 Sep 2026 on top of v2 (flat laser copied unchanged). New: bending 1.5/2/3/6 mm (247 BE26065466 bent parts minus flat twins), threads M4-M20 priced by sheet thickness (BE26065456), edge breaking refined per material family + certificate 3.1 (BE26065461), countersinks M6/M8 and press-in nuts M6 (Laserhub 10-WD tier), powder coating, electro zinc and hot-dip (Laserhub 19+ WD tier), cross-checked with Xometry E-2128509-2059313. Selling price = benchmark standard tier x 1.10. Still absent on purpose: tube laser (247 BE26065459 documented, no per-metre split), rolling, welding, bends > 1500 mm / 3 m, threads in untested thicknesses, coating on aluminium/stainless, DX51D/S355 threads, features outside the tested thickness range.', false);

-- 2. general, materials, flat laser and lead-time rows: copied 1:1 from v2 (unchanged by phase 2)
insert into public.rate_general (rate_version_id, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct, margin_by_class, blank_margin_mm, slow_contour_factor, default_stitch_bead_mm, default_stitch_pitch_mm, handling_mass_limit_kg, handling_surcharge_eur, weld_handling_per_part, placeholder, order_charge_eur, packaging_box_eur, packaging_pallet_eur, pricing_mode)
  select '3b8d1a38-0000-4000-8000-000000000003', machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct, margin_by_class, blank_margin_mm, slow_contour_factor, default_stitch_bead_mm, default_stitch_pitch_mm, handling_mass_limit_kg, handling_surcharge_eur, weld_handling_per_part, placeholder, order_charge_eur, packaging_box_eur, packaging_pallet_eur, pricing_mode from public.rate_general where rate_version_id = '2a7c0927-0000-4000-8000-000000000002';
insert into public.materials (rate_version_id, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder)
  select '3b8d1a38-0000-4000-8000-000000000003', code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder from public.materials where rate_version_id = '2a7c0927-0000-4000-8000-000000000002';
insert into public.rate_laser (rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder, setup_eur)
  select '3b8d1a38-0000-4000-8000-000000000003', material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder, setup_eur from public.rate_laser where rate_version_id = '2a7c0927-0000-4000-8000-000000000002';
insert into public.rate_leadtime (rate_version_id, working_days, multiplier, placeholder)
  select '3b8d1a38-0000-4000-8000-000000000003', working_days, multiplier, placeholder from public.rate_leadtime where rate_version_id = '2a7c0927-0000-4000-8000-000000000002';

-- 3. finishing: edge breaking split by material family (247 BE26065461), edge rounding and engraving as in v2, coatings from Laserhub, certificate from 247
insert into public.rate_finish (rate_version_id, code, name, unit, price, minimum, placeholder, setup_per_order_eur, min_part_mm, setup_per_line_eur, material_codes, min_thickness_mm, max_thickness_mm, price_per_part_eur, min_lead_time_days, minimum_scope, tier_multiplier_applies, limits) values
  ('3b8d1a38-0000-4000-8000-000000000003', 'deburr', 'Edge breaking both sides (steel)', 'm', 1.2900, 0.00, false, 0, 'steel 250x60 or 600x50', 36.35, '{DC01,DX51D,S235,S355,CortenA}', NULL, NULL, 0.00, 0, 'order', true, '{}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'deburr_nonferrous', 'Edge breaking both sides (aluminium / stainless)', 'm', 9.2200, 0.00, false, 0, 'aluminium/stainless 50x50', 5.65, '{1.4301,1.4404,AlMg3,AlMg4.5}', NULL, NULL, 0.00, 0, 'order', true, '{}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'deburr_one_side', 'Edge breaking burr side only (aluminium / stainless)', 'm', 3.2800, 0.00, false, 0, 'aluminium/stainless 50x50; not available for steel', 5.18, '{1.4301,1.4404,AlMg3,AlMg4.5}', NULL, NULL, 0.00, 0, 'order', true, '{}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'edge_round', 'Edge rounding both sides (hot-rolled steel >= 4 mm)', 'm', 37.0000, 0.00, false, 0, 'steel 250x60 or 600x50', 33.00, '{S235,S355}', 4, NULL, 0.00, 0, 'order', true, '{}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'engrave', 'Engrave part name (text marking)', 'part', 0.6000, 0.00, false, 0, NULL, 0.00, NULL, NULL, NULL, 0.00, 0, 'order', true, '{}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'powder', 'Powder coating, one RAL colour, both sides (incl. two-sided edge breaking)', 'm2', 42.4900, 186.53, false, 0, NULL, 1.91, '{DC01,S235}', 1.5, 3, 6.98, 19, 'colour', true, '{"areaBasis": "net area x 2 (both sides)"}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'zinc', 'Electro zinc plating, blue passivated (incl. one-sided edge breaking)', 'kg', 9.9800, 0.00, false, 0, NULL, 0.00, '{DC01,S235}', 1.5, 3, 0.81, 19, 'order', true, '{"massBasis": "net mass"}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'hot_dip', 'Hot-dip galvanising (flat per-order price; small lots only)', 'kg', 0.0000, 330.78, false, 0, NULL, 0.00, '{DC01,S235}', 1.5, 3, 0.00, 22, 'order', true, '{"maxOrderNetKg": 10}'::jsonb),
  ('3b8d1a38-0000-4000-8000-000000000003', 'cert31', 'Material certificate EN 10204 3.1 (per quote line)', 'each', 0.0000, 0.00, false, 0, NULL, 16.50, NULL, NULL, NULL, 0.00, 0, 'order', false, '{}'::jsonb);

-- 4. threads (247 BE26065456): price per thread depends on the sheet thickness, not on the size; set-up per line; exact thickness match
insert into public.rate_thread (rate_version_id, size, price_each, placeholder, setup_per_line_eur, price_by_thickness, material_codes) values
  ('3b8d1a38-0000-4000-8000-000000000003', 'M4', 0.9688, false, 2.8812, '[{"thicknessMm": 1.5, "priceEach": 0.4938}, {"thicknessMm": 3, "priceEach": 0.9688}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M5', 0.9688, false, 2.8812, '[{"thicknessMm": 1.5, "priceEach": 0.4938}, {"thicknessMm": 3, "priceEach": 0.9688}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M6', 0.9688, false, 2.8812, '[{"thicknessMm": 3, "priceEach": 0.9688}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M8', 0.9688, false, 2.8812, '[{"thicknessMm": 3, "priceEach": 0.9688}, {"thicknessMm": 6, "priceEach": 2.0543}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M10', 0.9688, false, 2.8812, '[{"thicknessMm": 3, "priceEach": 0.9688}, {"thicknessMm": 6, "priceEach": 1.9144}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M12', 0.9688, false, 2.8812, '[{"thicknessMm": 3, "priceEach": 0.9688}, {"thicknessMm": 6, "priceEach": 1.9144}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M16', 1.9144, false, 2.8812, '[{"thicknessMm": 6, "priceEach": 1.9144}]'::jsonb, '{DC01,S235}'),
  ('3b8d1a38-0000-4000-8000-000000000003', 'M20', 1.9144, false, 2.8812, '[{"thicknessMm": 6, "priceEach": 1.9144}]'::jsonb, '{DC01,S235}');

-- 5. features (Laserhub offer 1819449 recalculation, 10 working-day tier x 1.10): countersinks M6 = M8, 3 mm = 5 mm; press-in nuts 5 min set-up + 1 min each
insert into public.rate_feature (rate_version_id, code, name, price_each, placeholder, setup_per_line_eur, material_codes, min_thickness_mm, max_thickness_mm) values
  ('3b8d1a38-0000-4000-8000-000000000003', 'csk_m6', 'Countersink 90 deg for M6 (through hole 6.4 -> 12.6 mm)', 2.1900, false, 6.7600, '{DC01,S235}', 3, 5),
  ('3b8d1a38-0000-4000-8000-000000000003', 'csk_m8', 'Countersink 90 deg for M8 (through hole 9 -> 16.5 mm)', 2.1900, false, 6.7600, '{DC01,S235}', 3, 5),
  ('3b8d1a38-0000-4000-8000-000000000003', 'insert_m6', 'Press-in nut M6 (PEM S-M6 type), per insert', 2.0600, false, 10.3200, '{DC01,S235}', 1.5, 3);

-- 6. bending (247 BE26065466: bent part minus flat twin, 7-point fit for 1.5 mm; one point per other row; per-metre extension from the 2 mm 160/1460 mm pair):
--    line = setup_per_part_type + n x setup_per_bend_line_eur x f + n x (price_per_bend + price_per_bend_per_m x max(0, L_m - 0.2)) x f x qty;  bends > benchmarked_max_length_mm -> amber EXTRAPOLATED_RATE, > length_class_mm -> red
insert into public.rate_bend (rate_version_id, thickness_mm, length_class_mm, price_per_bend, setup_per_part_type, placeholder, setup_per_bend_line_eur, family_multipliers, material_codes, price_per_bend_per_m, benchmarked_max_length_mm) values
  ('3b8d1a38-0000-4000-8000-000000000003', 1.5, 4400, 1.4152, 2.7747, false, 0.8136, '{"stainless": 2.233}'::jsonb, '{DC01,1.4301}', 14.8646, 200),
  ('3b8d1a38-0000-4000-8000-000000000003', 2, 4400, 1.9371, 2.7747, false, 1.1130, '{}'::jsonb, '{DC01}', 14.8646, 1460),
  ('3b8d1a38-0000-4000-8000-000000000003', 3, 4400, 1.4497, 3.3005, false, 0.8338, '{"aluminium": 2.184}'::jsonb, '{S235,AlMg3}', 14.8646, 200),
  ('3b8d1a38-0000-4000-8000-000000000003', 6, 4400, 17.5378, 2.7747, false, 10.0829, '{}'::jsonb, '{S235}', 29.7292, 200);

-- 7. deliberately EMPTY in v3: rate_tube_laser (247 tube prices documented in the benchmark workbook, no per-metre/set-up split possible), rate_roll, rate_weld, bends > 4 400 mm or in untested thicknesses, threads in 2/2.5/4/5 mm, coatings on aluminium/stainless.

-- 8. activate v3; v2 stays (12 quotes reference it, FK RESTRICT), the cost placeholder version stays
update public.rate_versions set active = false where active;
update public.rate_versions set active = true where id = '3b8d1a38-0000-4000-8000-000000000003';

-- 9. sanity checks (abort the transaction if anything is off)
do $$
declare n int;
begin
  select count(*) into n from public.rate_laser where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 53 then raise exception 'rate_laser rows: % (expected 53)', n; end if;
  select count(*) into n from public.materials where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 10 then raise exception 'materials rows: % (expected 10)', n; end if;
  select count(*) into n from public.rate_finish where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 9 then raise exception 'rate_finish rows: % (expected 9)', n; end if;
  select count(*) into n from public.rate_thread where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 8 then raise exception 'rate_thread rows: % (expected 8)', n; end if;
  select count(*) into n from public.rate_feature where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 3 then raise exception 'rate_feature rows: % (expected 3)', n; end if;
  select count(*) into n from public.rate_bend where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 4 then raise exception 'rate_bend rows: % (expected 4)', n; end if;
  select count(*) into n from public.rate_leadtime where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 3 then raise exception 'rate_leadtime rows: % (expected 3)', n; end if;
  select count(*) into n from public.rate_tube_laser where rate_version_id = '3b8d1a38-0000-4000-8000-000000000003'; if n <> 0 then raise exception 'rate_tube_laser must be empty in v3'; end if;
  select count(*) into n from public.rate_versions where active; if n <> 1 then raise exception 'exactly one active version expected, got %', n; end if;
  select count(*) into n from public.rate_versions where id in ('00000000-0000-4000-8000-000000000001', '2a7c0927-0000-4000-8000-000000000002'); if n <> 2 then raise exception 'v2 and the cost placeholder version must remain'; end if;
end $$;

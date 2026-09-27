-- Rate version 'market-247+10% v2 (27 Sep 2026)' for the StretchMetal quoting tool (Supabase project stretch_metal_tool)
-- Source: 247TailorSteel Sophia quotes BE26065420 (139 lines) and BE26065441 (72 lines) of 27 Sep 2026, plus BE26065400/BE26065448 (SMT set) —
-- three test parts per material/thickness (100x100, 400x400, 200x200 with 16 holes Ø10), standard tier = Fast x (Standard total / Fast total),
-- selling price = 247 standard tier x 1.10.  Only tested material/thickness combinations and tested services are present; nothing else.
-- Idempotent: re-running removes and re-creates the v2 version (refused only if a quote already references it).
-- Apply as ONE migration / one transaction (supabase migration or the Supabase MCP apply_migration) so a failed check leaves nothing behind.


-- 0. schema additions needed by the market model (no-ops when already present)
alter table public.rate_finish add column if not exists setup_per_line_eur numeric not null default 0;
alter table public.rate_thread add column if not exists setup_per_line_eur numeric not null default 0;
comment on column public.rate_finish.setup_per_line_eur is 'EUR charged once per quote line (part type) that carries this finish - 247 charges its deburring set-up per edge-finished line, not per order';
comment on column public.rate_thread.setup_per_line_eur is 'EUR charged once per quote line that carries threads of this size';

-- 1. (re)create the version
delete from public.rate_versions where id = '2a7c0927-0000-4000-8000-000000000002'
  and not exists (select 1 from public.quotes q where q.rate_version_id = '2a7c0927-0000-4000-8000-000000000002' or q.cost_rate_version_id = '2a7c0927-0000-4000-8000-000000000002');
insert into public.rate_versions (id, label, note, active) values ('2a7c0927-0000-4000-8000-000000000002', 'market-247+10% v2 (27 Sep 2026)',
  'Market benchmark 27 Sep 2026: 247TailorSteel standard tier x 1.10 (quotes BE26065420, BE26065441, BE26065448, BE26065400). Flat laser only: 53 material/thickness rows from the 100/400/H16 test trios (excluded substitutes: DC01 0.5 & 0.75, DX51D 0.5 & 0.75, S355 12 & 20). Services: edge breaking both sides, edge breaking burr side (Al/stainless), edge rounding both sides, part-name engraving, M12 tapping. Not benchmarked and therefore absent: bending, rolling, welding, tube laser, threads other than M12, features, powder coating, zinc, certificates. Lead time 4/7/11 working days = x1.75 / x1.12 / x1.00.', false);

-- 2. general (market mode: rates are selling prices, margin 0, material on NET area, no blank margin, no scrap)
insert into public.rate_general (rate_version_id, machine_rate_eur_h, labour_rate_eur_h, machining_rate_eur_h, default_margin_pct, margin_by_class,
  blank_margin_mm, slow_contour_factor, default_stitch_bead_mm, default_stitch_pitch_mm, handling_mass_limit_kg, handling_surcharge_eur,
  weld_handling_per_part, placeholder, order_charge_eur, packaging_box_eur, packaging_pallet_eur, pricing_mode) values
  ('2a7c0927-0000-4000-8000-000000000002', 70, 25, 60, 0, '{}'::jsonb, 0, 1.5, 30, 60, 25, 0, 0, false, 17.886, 2.75, 36.78, 'market');

-- 3. materials: one price band per tested thickness; pricePerKg x (t x density) reproduces the benchmark EUR per dm2 of NET area
insert into public.materials (rate_version_id, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder) values
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 'DC01 cold-rolled sheet (247: CRS CR4)', 'mild_steel', 7850, 350, '[{"maxThicknessMm":1,"pricePerKg":5.1767},{"maxThicknessMm":1.25,"pricePerKg":9.4611},{"maxThicknessMm":1.5,"pricePerKg":2.9931},{"maxThicknessMm":2,"pricePerKg":2.9997},{"maxThicknessMm":2.5,"pricePerKg":4.2929},{"maxThicknessMm":3,"pricePerKg":3.0374}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'DX51D', 'DX51D+Z275 hot-dip galvanised sheet', 'mild_steel', 7850, 400, '[{"maxThicknessMm":1,"pricePerKg":5.3040},{"maxThicknessMm":1.5,"pricePerKg":3.9544},{"maxThicknessMm":2,"pricePerKg":3.6571},{"maxThicknessMm":3,"pricePerKg":3.6170}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 'S235JR hot-rolled, pickled & oiled (247: HRS 14 HR)', 'mild_steel', 7850, 400, '[{"maxThicknessMm":3,"pricePerKg":2.9413},{"maxThicknessMm":4,"pricePerKg":2.8739},{"maxThicknessMm":5,"pricePerKg":2.4531},{"maxThicknessMm":6,"pricePerKg":2.4502},{"maxThicknessMm":8,"pricePerKg":2.4509},{"maxThicknessMm":10,"pricePerKg":2.1956},{"maxThicknessMm":12,"pricePerKg":2.7195},{"maxThicknessMm":15,"pricePerKg":2.4690},{"maxThicknessMm":20,"pricePerKg":3.9696},{"maxThicknessMm":25,"pricePerKg":3.5987}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'S355', 'S355MC hot-rolled, pickled & oiled (247: HRS 50F45) - 3, 5, 8 mm only', 'mild_steel', 7850, 510, '[{"maxThicknessMm":3,"pricePerKg":3.4869},{"maxThicknessMm":5,"pricePerKg":5.3250},{"maxThicknessMm":8,"pricePerKg":2.7488}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'CortenA', 'Corten A (S355J2WP) weathering steel', 'mild_steel', 7850, 510, '[{"maxThicknessMm":3,"pricePerKg":4.4256},{"maxThicknessMm":6,"pricePerKg":8.2488}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', '1.4301 / AISI 304 stainless (2B up to 8 mm, 1D hot-rolled 10-12 mm)', 'stainless', 7900, 600, '[{"maxThicknessMm":0.8,"pricePerKg":13.7307},{"maxThicknessMm":1,"pricePerKg":11.5914},{"maxThicknessMm":1.5,"pricePerKg":9.0817},{"maxThicknessMm":2,"pricePerKg":7.7004},{"maxThicknessMm":3,"pricePerKg":7.2546},{"maxThicknessMm":4,"pricePerKg":8.1737},{"maxThicknessMm":5,"pricePerKg":8.5327},{"maxThicknessMm":6,"pricePerKg":9.1265},{"maxThicknessMm":8,"pricePerKg":13.9354},{"maxThicknessMm":10,"pricePerKg":7.7062},{"maxThicknessMm":12,"pricePerKg":10.6983}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4404', '1.4404 / AISI 316L stainless 2B', 'stainless', 8000, 570, '[{"maxThicknessMm":1.5,"pricePerKg":16.4474},{"maxThicknessMm":3,"pricePerKg":13.6917},{"maxThicknessMm":6,"pricePerKg":13.2361}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 'AlMg3 EN AW-5754 H111 aluminium', 'aluminium', 2660, 220, '[{"maxThicknessMm":1,"pricePerKg":17.5968},{"maxThicknessMm":1.5,"pricePerKg":16.7214},{"maxThicknessMm":2,"pricePerKg":14.2751},{"maxThicknessMm":3,"pricePerKg":11.4047},{"maxThicknessMm":4,"pricePerKg":18.3653},{"maxThicknessMm":5,"pricePerKg":15.8736},{"maxThicknessMm":6,"pricePerKg":28.2698},{"maxThicknessMm":8,"pricePerKg":16.4649},{"maxThicknessMm":10,"pricePerKg":27.8024}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg4.5', 'AlMg4.5Mn EN AW-5083 H111 aluminium', 'aluminium', 2660, 290, '[{"maxThicknessMm":3,"pricePerKg":13.6337},{"maxThicknessMm":6,"pricePerKg":83.3241}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false),
  ('2a7c0927-0000-4000-8000-000000000002', 'CuZn37', 'CuZn37 (CW508L) brass', 'brass', 8440, 350, '[{"maxThicknessMm":1,"pricePerKg":56.7228},{"maxThicknessMm":2,"pricePerKg":36.5947},{"maxThicknessMm":3,"pricePerKg":51.1750}]'::jsonb, '[{"widthMm":1500,"lengthMm":3000},{"widthMm":1250,"lengthMm":2500},{"widthMm":1000,"lengthMm":2000}]'::jsonb, 0, false);

-- 4. flat laser: per_m mode; setup_eur = charge per material/thickness present in a quote (shared by the pieces of that group);
--    price_per_m on the total cut length, price_per_pierce per pierce; min_contour_mm = thickness (contours below it get slow_contour_factor)
insert into public.rate_laser (rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s, price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder, setup_eur) values
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 1, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1, true, NULL, false, 43.6116),
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 1.25, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.25, true, NULL, false, 83.0329),
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 1.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.5, true, NULL, false, 36.2530),
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 2, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2, true, NULL, false, 27.7181),
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 2.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2.5, true, NULL, false, 50.8723),
  ('2a7c0927-0000-4000-8000-000000000002', 'DC01', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'O2', 3, true, NULL, false, 32.1984),
  ('2a7c0927-0000-4000-8000-000000000002', 'DX51D', 1, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1, true, NULL, false, 57.6036),
  ('2a7c0927-0000-4000-8000-000000000002', 'DX51D', 1.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.5, true, NULL, false, 49.6359),
  ('2a7c0927-0000-4000-8000-000000000002', 'DX51D', 2, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2, true, NULL, false, 39.6328),
  ('2a7c0927-0000-4000-8000-000000000002', 'DX51D', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 41.4365),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 25.8246),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 4, 'per_m', NULL, NULL, 0.3300, 0.0228, 'N2', 4, true, NULL, false, 25.1754),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 5, 'per_m', NULL, NULL, 0.4400, 0.0228, 'N2', 5, true, NULL, false, 23.0644),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 6, 'per_m', NULL, NULL, 0.6050, 0.0228, 'N2', 6, true, NULL, false, 25.4088),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 8, 'per_m', NULL, NULL, 1.6500, 0.0961, 'O2', 8, true, NULL, false, 23.1690),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 10, 'per_m', NULL, NULL, 2.2000, 0.0244, 'O2', 10, true, NULL, false, 18.5156),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 12, 'per_m', NULL, NULL, 2.7500, 0.0232, 'O2', 12, true, NULL, false, 27.6502),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 15, 'per_m', NULL, NULL, 3.3000, 1.4413, 'O2', 15, false, 'subcontract - priced at the 247TailorSteel/Orderon benchmark +10%', false, 19.3710),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 20, 'per_m', NULL, NULL, 3.8500, 0.8679, 'O2', 20, false, 'subcontract - priced at the 247TailorSteel/Orderon benchmark +10%', false, 26.9051),
  ('2a7c0927-0000-4000-8000-000000000002', 'S235', 25, 'per_m', NULL, NULL, 4.4000, 1.3437, 'O2', 25, false, 'subcontract - priced at the 247TailorSteel/Orderon benchmark +10%', false, 63.6137),
  ('2a7c0927-0000-4000-8000-000000000002', 'S355', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 83.0548),
  ('2a7c0927-0000-4000-8000-000000000002', 'S355', 5, 'per_m', NULL, NULL, 0.4400, 0.0228, 'N2', 5, true, NULL, false, 70.8868),
  ('2a7c0927-0000-4000-8000-000000000002', 'S355', 8, 'per_m', NULL, NULL, 1.6500, 0.0228, 'O2', 8, true, NULL, false, 61.1482),
  ('2a7c0927-0000-4000-8000-000000000002', 'CortenA', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 54.9171),
  ('2a7c0927-0000-4000-8000-000000000002', 'CortenA', 6, 'per_m', NULL, NULL, 0.6050, 0.0937, 'N2', 6, true, NULL, false, 55.3830),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 0.8, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 0.8, true, NULL, false, 47.2909),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 1, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1, true, NULL, false, 32.6458),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 1.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.5, true, NULL, false, 28.5690),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 2, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2, true, NULL, false, 22.5748),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 20.9768),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 4, 'per_m', NULL, NULL, 0.3300, 0.0286, 'N2', 4, true, NULL, false, 23.7418),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 5, 'per_m', NULL, NULL, 0.4400, 0.0295, 'N2', 5, true, NULL, false, 21.9937),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 6, 'per_m', NULL, NULL, 0.6050, 0.0326, 'N2', 6, true, NULL, false, 27.0390),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 8, 'per_m', NULL, NULL, 1.6500, 0.0228, 'N2', 8, true, NULL, false, 23.9961),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 10, 'per_m', NULL, NULL, 2.2000, 0.6904, 'N2', 10, true, NULL, false, 21.3414),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4301', 12, 'per_m', NULL, NULL, 2.7500, 0.6926, 'N2', 12, true, NULL, false, 37.5753),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4404', 1.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.5, true, NULL, false, 52.7818),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4404', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 39.8565),
  ('2a7c0927-0000-4000-8000-000000000002', '1.4404', 6, 'per_m', NULL, NULL, 0.6050, 0.0255, 'N2', 6, true, NULL, false, 46.9849),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 1, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1, true, NULL, false, 45.8795),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 1.5, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1.5, true, NULL, false, 44.3862),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 2, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2, true, NULL, false, 34.1639),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 31.4971),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 4, 'per_m', NULL, NULL, 0.3300, 0.0248, 'N2', 4, true, NULL, false, 40.3498),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 5, 'per_m', NULL, NULL, 0.4400, 0.0259, 'N2', 5, true, NULL, false, 34.9348),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 6, 'per_m', NULL, NULL, 0.6050, 0.0264, 'N2', 6, true, NULL, false, 42.8247),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 8, 'per_m', NULL, NULL, 1.6500, 0.0228, 'N2', 8, false, 'subcontract - priced at the 247TailorSteel/Orderon benchmark +10%', false, 41.7986),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg3', 10, 'per_m', NULL, NULL, 2.2000, 0.0605, 'N2', 10, false, 'subcontract - priced at the 247TailorSteel/Orderon benchmark +10%', false, 40.7591),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg4.5', 3, 'per_m', NULL, NULL, 0.2385, 0.0294, 'N2', 3, true, NULL, false, 83.7221),
  ('2a7c0927-0000-4000-8000-000000000002', 'AlMg4.5', 6, 'per_m', NULL, NULL, 0.6050, 0.0333, 'N2', 6, true, NULL, false, 83.4341),
  ('2a7c0927-0000-4000-8000-000000000002', 'CuZn37', 1, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 1, true, NULL, false, 70.7621),
  ('2a7c0927-0000-4000-8000-000000000002', 'CuZn37', 2, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 2, true, NULL, false, 51.3908),
  ('2a7c0927-0000-4000-8000-000000000002', 'CuZn37', 3, 'per_m', NULL, NULL, 0.2385, 0.0228, 'N2', 3, true, NULL, false, 83.7042);

-- 5. finishing (tested options of quote BE26065441 + SMT19/SMT20). setup_per_line_eur is charged once per quote line carrying the finish.
insert into public.rate_finish (rate_version_id, code, name, unit, price, minimum, placeholder, setup_per_order_eur, min_part_mm, setup_per_line_eur) values
  ('2a7c0927-0000-4000-8000-000000000002', 'deburr', 'Edge breaking both sides', 'm', 1.29, 0, false, 0, 'steel 250x60 or 600x50; aluminium/stainless 50x50', 33.00),
  ('2a7c0927-0000-4000-8000-000000000002', 'deburr_one_side', 'Edge breaking burr side only (aluminium and stainless only - 247 refuses it on steel)', 'm', 0.74, 0, false, 0, 'aluminium/stainless 50x50; not available for mild steel', 21.00),
  ('2a7c0927-0000-4000-8000-000000000002', 'edge_round', 'Edge rounding both sides', 'm', 37.00, 0, false, 0, 'steel 250x60 or 600x50; aluminium/stainless 50x50', 33.00),
  ('2a7c0927-0000-4000-8000-000000000002', 'engrave', 'Engrave part name (text marking)', 'part', 0.60, 0, false, 0, NULL, 0);

-- 6. threads: only M12 was benchmarked (16 x M12 in 3 mm S235: +EUR 14.82; 1 x M12: +EUR 3.36, Fast tier)
insert into public.rate_thread (rate_version_id, size, price_each, placeholder, setup_per_line_eur) values
  ('2a7c0927-0000-4000-8000-000000000002', 'M12', 0.76, false, 2.59);

-- 7. lead time: multiplier of the row with the LARGEST working_days <= requested lead time; requests below 4 working days are refused
insert into public.rate_leadtime (rate_version_id, working_days, multiplier, placeholder) values
  ('2a7c0927-0000-4000-8000-000000000002', 4, 1.75, false),
  ('2a7c0927-0000-4000-8000-000000000002', 7, 1.12, false),
  ('2a7c0927-0000-4000-8000-000000000002', 11, 1.00, false);

-- 8. deliberately EMPTY in v2 (not benchmarked -> the engine must refuse, never fall back): rate_tube_laser, rate_bend, rate_roll, rate_weld, rate_feature,
--    finishes powder/zinc/certificate, threads other than M12, materials Cu-ETP, every thickness not listed above.

-- 9. activate v2, deactivate everything else (the v1 cost placeholder version 00000000-...-0001 stays as the cost reference, inactive)
update public.rate_versions set active = false where active;
update public.rate_versions set active = true where id = '2a7c0927-0000-4000-8000-000000000002';

-- 9b. re-pin the draft quotes from the old market version to v2 (their cost version, the placeholder 00000000-...-0001, stays).
--     The rate tables are immutable while a quote references the version (trigger forbid_rate_edit_if_used), so this must
--     precede step 10; the builder re-prices a draft whose stored pricing version differs from the pinned one on the next open.
insert into public.audit_log (actor, action, entity, entity_id, before, after)
  select null, 'quote.repin_rate_version', 'quotes', q.id,
         jsonb_build_object('rate_version_id', q.rate_version_id, 'status', q.status),
         jsonb_build_object('rate_version_id', '2a7c0927-0000-4000-8000-000000000002', 'reason', 'market-247+10% v2 (27 Sep 2026) activated')
  from public.quotes q where q.rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and q.status = 'draft';
update public.quotes set rate_version_id = '2a7c0927-0000-4000-8000-000000000002', updated_at = now()
  where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and status = 'draft';

-- 10. purge the untested placeholder rows from the old market version so it cannot be re-activated with them
delete from public.materials where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_laser where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_tube_laser where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_bend where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_roll where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_weld where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_thread where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_feature where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_finish where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;
delete from public.rate_leadtime where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and placeholder;

-- 11. sanity checks (abort the transaction if anything is off)
do $$
declare n int;
begin
  select count(*) into n from public.rate_laser where rate_version_id = '2a7c0927-0000-4000-8000-000000000002'; if n <> 53 then raise exception 'rate_laser rows: % (expected 53)', n; end if;
  select count(*) into n from public.materials where rate_version_id = '2a7c0927-0000-4000-8000-000000000002'; if n <> 10 then raise exception 'materials rows: % (expected 10)', n; end if;
  select count(*) into n from public.rate_versions where active; if n <> 1 then raise exception 'exactly one active version expected, got %', n; end if;
  select count(*) into n from public.rate_laser l where l.rate_version_id = '2a7c0927-0000-4000-8000-000000000002' and not exists (select 1 from public.materials m where m.rate_version_id = l.rate_version_id and m.code = l.material_code);
  if n <> 0 then raise exception 'rate_laser rows without material: %', n; end if;
  select count(*) into n from public.rate_bend where rate_version_id = '2a7c0927-0000-4000-8000-000000000002'; if n <> 0 then raise exception 'rate_bend must be empty in v2'; end if;
  select count(*) into n from public.rate_versions where id = '00000000-0000-4000-8000-000000000001'; if n <> 1 then raise exception 'cost placeholder version must remain'; end if;
  select count(*) into n from public.quotes where rate_version_id = '4eecc220-06e5-4807-99ae-b045c51716ab' and status = 'draft'; if n <> 0 then raise exception 'draft quotes still pinned to v1 market: %', n; end if;
end $$;


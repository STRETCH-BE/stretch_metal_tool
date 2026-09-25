-- ============================================================================
-- StretchMetal quoting tool — seed data (machine park + placeholder rates)
-- File path: /supabase/seed.sql
--
-- Applies on top of /supabase/migrations/20260925000000_init.sql. Runs
-- automatically on `supabase db reset` (see /supabase/config.toml) and once
-- by hand in the cloud project's SQL editor (see /supabase/README.md).
--
-- Sources
--   * Machine limits: docs/quoting-tool-build-prompt.md Step 9 "Machine
--     limits" and docs/quoting-tool-spec.md section 8 — confirmed by the
--     owner on 25 Sep 2026. They are data, never constants in code.
--   * Rate values: build prompt Step 9 "Seed rate tables with placeholder
--     values" and spec sections 7 + 13. Every one of them is a placeholder:
--     the line carries `-- [CONFIRM]` (grep for it) and the row has
--     placeholder = true so the admin UI shows the yellow badge until the
--     admin edits it. All money is EUR.
--
-- One statement, on purpose
--   The whole file is a single DO block, i.e. ONE SQL statement. Postgres
--   runs a statement atomically even in autocommit mode, so a typo, a schema
--   drift (a new NOT NULL column) or a bad value anywhere below rolls the
--   entire seed back and the previous rate set stays in place — there is no
--   window in which the version has been deleted but not yet re-inserted.
--   Keep it that way: add rows INSIDE the block, never as statements after
--   it. The psql command in the README adds --single-transaction as a second
--   belt (test/db/seed.test.ts checks both).
--
-- Idempotency (safe to run twice)
--   The rate version has the fixed uuid 00000000-0000-4000-8000-000000000001.
--   1. If a quote references that version, NOTHING is inserted into it: the
--      block raises a NOTICE and skips every rate insert. Rate rows are
--      immutable per version once a quote used them (the quote must re-price
--      identically) and the migration's *_immutable triggers only guard
--      update/delete, so the skip has to happen here. Change rates through
--      the admin UI (clone → edit → activate), not by re-running the seed.
--   2. Otherwise the version row is deleted (cascading to every rate_* row)
--      and re-inserted, so an edited seed lands on re-run. The rate inserts
--      carry no `on conflict` clause: after the delete a conflict can only
--      be a duplicate inside this file, which must fail loudly.
--   3. The version is inserted active only when no other version is active
--      (partial unique index rate_versions_one_active), so it never steals
--      activation from a version the admin activated later.
--   4. Machines are `on conflict (code) do nothing` and independent of the
--      version branch: admin edits made in the machines editor survive a
--      re-run. Change limits in the UI, not here.
--
-- Laser rows and the lookup (lib/pricing/lookup.ts findLaserRate)
--   The engine prices in-house only from an in-house row at EXACTLY the
--   part's thickness; a gauge without one falls back to the nearest
--   SUPPLIER row (subcontract price + flag). So every sheet gauge the shop
--   stocks needs its own in-house row — the ladder below covers the Step 9
--   thicknesses plus the stock gauges 1.5, 2.5 and 12.7 mm (interpolated,
--   [CONFIRM]). When a new gauge enters stock, add its row in the admin
--   rate editor. test/db/seed.test.ts drives the seeded rows through the
--   real findLaserRate for every stock gauge.
--
-- JSON shapes match /lib/pricing/types.ts exactly (camelCase keys):
--   materials.price_per_kg   ThicknessBandPrice[]  [{"maxThicknessMm","pricePerKg"}]
--   materials.sheet_formats  [{"lengthMm","widthMm"}]
--   machines.limits          FlatLaserLimits | TubeLaserLimits |
--                            PressBrakeLimits | RollLimits | WeldLimits
-- ============================================================================

do $seed$
declare
  v_version constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.quotes where rate_version_id = v_version) then
    raise notice 'seed.sql: rate version % is referenced by quotes — rate rows left untouched, nothing inserted', v_version;
  else
    -- ─── 0. Reset the seeded version (nothing depends on it) ──────────────
    -- Cascades to rate_general, materials, rate_laser, rate_tube_laser,
    -- rate_bend, rate_roll, rate_weld, rate_thread, rate_feature, rate_finish.
    delete from public.rate_versions where id = v_version;

    -- ─── 1. Rate version ────────────────────────────────────────────────
    -- Label keeps "[CONFIRM]" on purpose: it is visible in the admin rate
    -- editor until the admin clones the version and gives the copy a real
    -- label.
    insert into public.rate_versions (id, label, note, created_by, active)
    values (
      v_version,
      'v1 — placeholder rates [CONFIRM]',
      'Seeded from docs/quoting-tool-build-prompt.md Step 9. Every value is a placeholder to be confirmed against the machine-hour model, market benchmarks and supplier tariffs (spec section 13).',
      null,
      not exists (select 1 from public.rate_versions where active)
    );

    -- ─── 2. General rates (build prompt Step 9) ─────────────────────────
    insert into public.rate_general (
      rate_version_id,
      machine_rate_eur_h,
      labour_rate_eur_h,
      machining_rate_eur_h,
      default_margin_pct,
      margin_by_class,
      blank_margin_mm,
      slow_contour_factor,
      default_stitch_bead_mm,
      default_stitch_pitch_mm,
      handling_mass_limit_kg,
      handling_surcharge_eur,
      weld_handling_per_part,
      placeholder
    ) values (
      v_version,
      70.00,          -- [CONFIRM] machine rate €/h (replace with the machine-hour calculator result)
      35.00,          -- [CONFIRM] labour rate €/h (masking, manual work)
      60.00,          -- [CONFIRM] machining rate €/h (milled faces, bores)
      30.00,          -- [CONFIRM] default margin on price, %
      '{}'::jsonb,    -- [CONFIRM] margin overrides per customer_class, e.g. {"key_account": 25}
      10.00,          -- [CONFIRM] blank margin mm (added on each side of the bbox)
      1.500,          -- [CONFIRM] slow-contour factor for contours < min_contour_mm
      30.00,          -- [CONFIRM] default stitch bead length mm
      60.00,          -- [CONFIRM] default stitch pitch mm
      25.00,          -- [CONFIRM] single-person handling mass limit kg (spec 8.6)
      5.00,           -- [CONFIRM] handling surcharge € per part above the limit
      3.00,           -- [CONFIRM] welding-only quotes: handling € per customer-supplied part
      true
    );

    -- ─── 3. Materials (spec 7 "materials", build prompt Step 9) ─────────
    -- price_per_kg bands: ascending, each applies to thickness ≤
    -- maxThicknessMm; the last band uses 999 as an open-ended top. Density
    -- kg/m³, Rm N/mm² for the press-brake force check (spec 8.3). Sheet
    -- formats drive the "blank fits a sheet" check; scrap % is the default
    -- the user can override per item.
    insert into public.materials (
      rate_version_id, code, name, family, density_kg_m3, rm_n_mm2, price_per_kg, sheet_formats, scrap_pct_default, placeholder
    ) values
      (v_version, 'S235', 'S235JR structural steel', 'mild_steel', 7850, 400,
        '[{"maxThicknessMm":3,"pricePerKg":1.10},{"maxThicknessMm":8,"pricePerKg":1.15},{"maxThicknessMm":999,"pricePerKg":1.20}]'::jsonb,  -- [CONFIRM] €/kg ≤3 / ≤8 / above
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, 'S355', 'S355J2 structural steel', 'mild_steel', 7850, 510,
        '[{"maxThicknessMm":3,"pricePerKg":1.15},{"maxThicknessMm":8,"pricePerKg":1.20},{"maxThicknessMm":999,"pricePerKg":1.25}]'::jsonb,  -- [CONFIRM] €/kg ≤3 / ≤8 / above
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, 'DC01', 'DC01 cold-rolled sheet', 'mild_steel', 7850, 350,
        '[{"maxThicknessMm":999,"pricePerKg":1.05}]'::jsonb,  -- [CONFIRM] €/kg flat
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, '1.4301', '1.4301 (AISI 304) stainless', 'stainless', 7900, 600,
        '[{"maxThicknessMm":999,"pricePerKg":3.60}]'::jsonb,  -- [CONFIRM] €/kg flat
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, 'AlMg3', 'AlMg3 EN AW-5754 aluminium', 'aluminium', 2660, 220,
        '[{"maxThicknessMm":999,"pricePerKg":4.50}]'::jsonb,  -- [CONFIRM] €/kg flat
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, 'CuZn37', 'CuZn37 (CW508L) brass', 'brass', 8440, 350,
        '[{"maxThicknessMm":999,"pricePerKg":8.50}]'::jsonb,  -- [CONFIRM] €/kg flat — no benchmark yet
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true),  -- [CONFIRM] scrap %
      (v_version, 'Cu-ETP', 'Cu-ETP (CW004A) copper', 'copper', 8940, 250,
        '[{"maxThicknessMm":999,"pricePerKg":9.50}]'::jsonb,  -- [CONFIRM] €/kg flat — no benchmark yet
        '[{"lengthMm":3000,"widthMm":1500},{"lengthMm":2500,"widthMm":1250},{"lengthMm":2000,"widthMm":1000}]'::jsonb,
        25.00, true);  -- [CONFIRM] scrap %

    -- ─── 4. Flat-laser rates (spec 7 "laser_rates", build prompt Step 9) ─
    -- Mode "time": cost = (cutLengthM / speed + pierces × pierce_s / 60) /
    -- 60 × machine_rate + pierces × price_per_pierce. The base table is the
    -- 12 kW mild-steel placeholder from Step 9 ("replace with TRUMPF cutting
    -- data") plus the stock gauges 1.5, 2.5 and 12.7 mm interpolated between
    -- their neighbours (12.7 = the TruFiber limit, extrapolated from 10 and
    -- 12). It applies to all three mild-steel grades. Stainless, aluminium,
    -- brass and copper run at 70 % of those speeds with the same pierce
    -- times, nitrogen, up to the TruFiber 12001 thickness limit per family
    -- (12.7 / 6 / 6 / 6 mm). Gas: mild steel O2 from 3 mm, N2 below; the
    -- other families N2. min_contour_mm = 10 × t: contours below it get the
    -- slow-contour factor.
    with base (thickness_mm, speed_m_min, pierce_s) as (
      values
        ( 1.0, 25.0, 0.20),  -- [CONFIRM]  1 mm: 25   m/min, 0.20 s pierce
        ( 1.5, 20.5, 0.25),  -- [CONFIRM]  1.5 mm: 20.5 m/min, 0.25 s pierce (interpolated 1–2 mm)
        ( 2.0, 16.0, 0.30),  -- [CONFIRM]  2 mm: 16   m/min, 0.30 s pierce
        ( 2.5, 13.5, 0.35),  -- [CONFIRM]  2.5 mm: 13.5 m/min, 0.35 s pierce (interpolated 2–3 mm)
        ( 3.0, 11.0, 0.40),  -- [CONFIRM]  3 mm: 11   m/min, 0.40 s pierce
        ( 4.0,  7.0, 0.60),  -- [CONFIRM]  4 mm:  7   m/min, 0.60 s pierce
        ( 5.0,  5.5, 0.80),  -- [CONFIRM]  5 mm:  5.5 m/min, 0.80 s pierce
        ( 6.0,  4.5, 1.00),  -- [CONFIRM]  6 mm:  4.5 m/min, 1.00 s pierce
        ( 8.0,  3.0, 1.30),  -- [CONFIRM]  8 mm:  3.0 m/min, 1.30 s pierce
        (10.0,  2.2, 1.60),  -- [CONFIRM] 10 mm:  2.2 m/min, 1.60 s pierce
        (12.0,  1.7, 2.00),  -- [CONFIRM] 12 mm:  1.7 m/min, 2.00 s pierce
        (12.7,  1.5, 2.20)   -- [CONFIRM] 12.7 mm: 1.5 m/min, 2.20 s pierce (machine limit, extrapolated 10–12 mm)
    )
    insert into public.rate_laser (
      rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s,
      price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder
    )
    -- 4a. Mild steel S235 / S355 / DC01 — in-house, time mode, 1–12.7 mm.
    select
      v_version,
      m.code,
      b.thickness_mm,
      'time'::public.laser_mode,
      b.speed_m_min,
      b.pierce_s,
      null::numeric,
      0.05::numeric,                                                   -- [CONFIRM] €/pierce in-house
      (case when b.thickness_mm >= 3 then 'O2' else 'N2' end)::text,   -- [CONFIRM] O2 from 3 mm, N2 below
      b.thickness_mm * 10,
      true,
      null::text,
      true
    from base b
    cross join (values ('S235'), ('S355'), ('DC01')) as m (code)
    union all
    -- 4b. Stainless 1.4301 (≤ 12.7 mm), aluminium AlMg3, brass CuZn37,
    --     copper Cu-ETP (≤ 6 mm) — in-house, time mode, 70 % of the
    --     mild-steel speed.
    select
      v_version,
      m.code,
      b.thickness_mm,
      'time'::public.laser_mode,
      round(b.speed_m_min * 0.70, 3),                                  -- [CONFIRM] 70 % of the mild-steel placeholder speed
      b.pierce_s,                                                      -- [CONFIRM] same pierce time as mild steel
      null::numeric,
      0.05::numeric,                                                   -- [CONFIRM] €/pierce in-house
      'N2'::text,
      b.thickness_mm * 10,
      true,
      null::text,
      true
    from base b
    cross join (values ('1.4301', 12.7), ('AlMg3', 6.0), ('CuZn37', 6.0), ('Cu-ETP', 6.0)) as m (code, max_thickness_mm)
    where b.thickness_mm <= m.max_thickness_mm;

    -- 4c. Subcontracted cutting above the TruFiber limit (12.7 mm): S235 /
    --     S355 at 15 and 20 mm, priced per metre from the supplier tariff
    --     (spec 8.1, 13.3). The pricing engine switches to these rows and
    --     flags the part; a thickness between them is priced from the
    --     nearest row and flagged as inexact.
    insert into public.rate_laser (
      rate_version_id, material_code, thickness_mm, mode, speed_m_min, pierce_s,
      price_per_m, price_per_pierce, gas, min_contour_mm, in_house, supplier, placeholder
    ) values
      (v_version, 'S235', 15.0, 'per_m', null, null, 6.00, 0.50, null, null, false, '[CONFIRM] subcontractor', true),  -- [CONFIRM] 6.00 €/m, 0.50 €/pierce
      (v_version, 'S235', 20.0, 'per_m', null, null, 8.00, 0.50, null, null, false, '[CONFIRM] subcontractor', true),  -- [CONFIRM] 8.00 €/m, 0.50 €/pierce
      (v_version, 'S355', 15.0, 'per_m', null, null, 6.00, 0.50, null, null, false, '[CONFIRM] subcontractor', true),  -- [CONFIRM] 6.00 €/m, 0.50 €/pierce
      (v_version, 'S355', 20.0, 'per_m', null, null, 8.00, 0.50, null, null, false, '[CONFIRM] subcontractor', true);  -- [CONFIRM] 8.00 €/m, 0.50 €/pierce

    -- ─── 5. Tube-laser rates (spec 7 "tube_laser_rates", 8.2) ───────────
    -- profile family × wall thickness → €/m of cut + handling per part +
    -- setup. Placeholder ladder 4–10 €/m by wall; "open" profiles are not
    -- seeded.
    insert into public.rate_tube_laser (
      rate_version_id, profile_family, wall_mm, price_per_m_cut, handling_per_part, setup, placeholder
    )
    select
      v_version,
      f.profile_family,
      w.wall_mm,
      w.price_per_m_cut,
      1.50,   -- [CONFIRM] handling € per part
      10.00,  -- [CONFIRM] setup € per part type
      true
    from (values
      (2.0,  4.00),  -- [CONFIRM] wall 2 mm:  4 €/m of cut
      (3.0,  5.00),  -- [CONFIRM] wall 3 mm:  5 €/m of cut
      (4.0,  6.00),  -- [CONFIRM] wall 4 mm:  6 €/m of cut
      (5.0,  7.00),  -- [CONFIRM] wall 5 mm:  7 €/m of cut
      (6.0,  8.00),  -- [CONFIRM] wall 6 mm:  8 €/m of cut
      (8.0, 10.00)   -- [CONFIRM] wall 8 mm: 10 €/m of cut
    ) as w (wall_mm, price_per_m_cut)
    cross join (values
      ('round'::public.tube_profile_family),
      ('square'),
      ('rectangular')
    ) as f (profile_family);

    -- ─── 6. Bending rates (spec 7 "bend_rates", build prompt Step 9) ────
    -- thickness × length class (bend length ≤ class) → € per bend; +50 %
    -- above 6 mm; setup € per part type spread over the quantity.
    insert into public.rate_bend (
      rate_version_id, thickness_mm, length_class_mm, price_per_bend, setup_per_part_type, placeholder
    )
    select
      v_version,
      t.thickness_mm,
      l.length_class_mm,
      round(l.price_per_bend * (case when t.thickness_mm > 6 then 1.5 else 1.0 end), 4),  -- [CONFIRM] +50 % above 6 mm
      8.00,  -- [CONFIRM] setup € per part type
      true
    from (values (1.0), (2.0), (3.0), (4.0), (5.0), (6.0), (8.0), (10.0), (12.0), (15.0)) as t (thickness_mm)
    cross join (values
      ( 500.0, 0.90),  -- [CONFIRM] bend ≤  500 mm: 0.90 €
      (1500.0, 1.60),  -- [CONFIRM] bend ≤ 1500 mm: 1.60 €
      (4420.0, 3.00)   -- [CONFIRM] bend ≤ 4420 mm: 3.00 € (press-brake length limit)
    ) as l (length_class_mm, price_per_bend);

    -- ─── 7. Rolling rates (spec 7 "roll_rates", 8.4) ────────────────────
    -- thickness 1–6 mm (machine limit) × radius class (radius ≤ class) →
    -- €/m of roll axis + setup. One flat placeholder until the admin
    -- differentiates.
    insert into public.rate_roll (
      rate_version_id, thickness_mm, radius_class_mm, price_per_m, setup, placeholder
    )
    select
      v_version,
      t.thickness_mm::numeric,
      r.radius_class_mm,
      12.00,  -- [CONFIRM] €/m of roll axis
      25.00,  -- [CONFIRM] setup € per part type
      true
    from generate_series(1, 6) as t (thickness_mm)
    cross join (values (200.0), (500.0), (1000.0), (3000.0)) as r (radius_class_mm);  -- [CONFIRM] radius classes mm

    -- ─── 8. Welding rates (spec 7 "weld_rates", 8.5) ────────────────────
    -- process × bead → €/mm of effective seam; setup and minimum order for
    -- welding-only quotes. The same price for every bead size for now.
    insert into public.rate_weld (
      rate_version_id, process, bead_mm, price_per_mm, setup, min_order, placeholder
    )
    select
      v_version,
      p.process,
      b.bead_mm,
      p.price_per_mm,
      15.00,  -- [CONFIRM] setup € per part type
      60.00,  -- [CONFIRM] minimum order € (welding-only quotes)
      true
    from (values
      ('mig_mag'::public.weld_process, 0.045),  -- [CONFIRM] MIG/MAG 0.045 €/mm
      ('tig',                          0.090),  -- [CONFIRM] TIG     0.090 €/mm
      ('laser',                        0.060),  -- [CONFIRM] laser   0.060 €/mm
      ('mma',                          0.070)   -- [CONFIRM] MMA     0.070 €/mm
    ) as p (process, price_per_mm)
    cross join (values (3.0), (4.0), (6.0), (8.0)) as b (bead_mm);  -- [CONFIRM] same price per process at bead 3/4/6/8 mm

    -- ─── 9. Thread rates (spec 7 "thread_rates") ────────────────────────
    insert into public.rate_thread (rate_version_id, size, price_each, placeholder) values
      (v_version, 'M3',      0.60, true),  -- [CONFIRM]
      (v_version, 'M4',      0.65, true),  -- [CONFIRM]
      (v_version, 'M5',      0.70, true),  -- [CONFIRM]
      (v_version, 'M6',      0.80, true),  -- [CONFIRM]
      (v_version, 'M8',      0.90, true),  -- [CONFIRM]
      (v_version, 'M10',     1.00, true),  -- [CONFIRM]
      (v_version, 'M10x1',   1.05, true),  -- [CONFIRM]
      (v_version, 'M12',     1.20, true),  -- [CONFIRM]
      (v_version, 'M12x1.5', 1.25, true),  -- [CONFIRM]
      (v_version, 'M16',     1.40, true),  -- [CONFIRM]
      (v_version, 'M20',     1.50, true);  -- [CONFIRM]

    -- ─── 10. Feature rates (spec 7 "feature_rates") ─────────────────────
    insert into public.rate_feature (rate_version_id, code, name, price_each, placeholder) values
      (v_version, 'countersink', 'Countersink',     0.80, true),  -- [CONFIRM]
      (v_version, 'counterbore', 'Counterbore',     1.20, true),  -- [CONFIRM]
      (v_version, 'bore_h7',     'H7 bore',         4.00, true),  -- [CONFIRM]
      (v_version, 'insert',      'Threaded insert', 1.50, true),  -- [CONFIRM]
      (v_version, 'stud',        'Weld stud',       1.00, true);  -- [CONFIRM]

    -- ─── 11. Finishing rates (spec 7 "finishing_rates") ─────────────────
    -- powder: net area × 2 × price + masking minutes × labour_rate, minimum;
    -- zinc: mass × price, minimum; deburr / engrave: length × price.
    insert into public.rate_finish (rate_version_id, code, name, unit, price, minimum, placeholder) values
      (v_version, 'powder',  'Powder coating',      'm2', 14.00, 25.00, true),  -- [CONFIRM] 14 €/m², min 25 €
      (v_version, 'zinc',    'Zinc plating',        'kg',  1.20, 30.00, true),  -- [CONFIRM] 1.20 €/kg, min 30 € (supplier tariff)
      (v_version, 'deburr',  'Deburring',           'm',   0.40,  0.00, true),  -- [CONFIRM] 0.40 €/m of cut
      (v_version, 'engrave', 'Engraving / marking', 'm',   0.50,  0.00, true);  -- [CONFIRM] 0.50 €/m of tagged line
  end if;

  -- ─── 12. Machine park (spec 8, build prompt Step 9 — confirmed 25 Sep 2026)
  -- Independent of the rate version: runs on every seed, never overwrites an
  -- existing row. limits JSON = lib/pricing/types.ts FlatLaserLimits /
  -- TubeLaserLimits / PressBrakeLimits / RollLimits / WeldLimits. Edit in the
  -- admin machines editor.
  insert into public.machines (code, name, kind, limits) values
    (
      'trufiber-12001',
      'TRUMPF TruFiber 12001 (12 kW)',
      'flat_laser',
      jsonb_build_object(
        'bedLengthMm', 3000,
        'bedWidthMm', 1500,
        'zMm', 120,
        'edgeMarginMm', 10,  -- [CONFIRM] edge margin mm kept free around the blank on the sheet
        'maxThicknessMm', jsonb_build_object(
          'mild_steel', 12.7, 'stainless', 12.7, 'aluminium', 6, 'brass', 6, 'copper', 6
        )
      )
    ),
    (
      'tube-laser-12kw',
      'TRUMPF tube laser (12 kW)',
      'tube_laser',
      jsonb_build_object(
        'maxRoundDiameterMm', 273,
        'maxRectSideMm', 254,
        'maxCircumscribedMm', 290,
        'maxLengthMm', 6500,
        'maxKgPerM', 40,
        'maxRawWeightKg', 260,
        -- [mode A, mode B] — 9 kW manufacturer figures; the lower value is used
        -- for the feasibility check until the admin enters the 12 kW data.
        'wallThicknessMm', jsonb_build_object(  -- [CONFIRM] 12 kW wall-thickness limits
          'mild_steel', jsonb_build_array(14, 10),
          'stainless', jsonb_build_array(12.5, 8),
          'aluminium', jsonb_build_array(12.5, 8),
          'copper', jsonb_build_array(5, 5),
          'brass', jsonb_build_array(5, 5)
        )
      )
    ),
    (
      'press-brake-3200',
      'Press brake 3200 kN / 4420 mm',  -- [CONFIRM] make and model for the display name
      'press_brake',
      jsonb_build_object(
        'forceKN', 3200,
        'bendLengthMm', 4420,
        'betweenColumnsMm', 3680,
        'openHeightMm', 615,
        'dieFactor', 8   -- default die opening V = 8 × t (air bending), unless the user picks a die
      )
    ),
    (
      'roll-3200',
      'Plate roll 3200 mm',  -- [CONFIRM] make and model for the display name
      'roll',
      jsonb_build_object(
        'maxWidthMm', 3200,
        'minRadiusMm', 200,
        'maxThicknessMm', 6
      )
    ),
    (
      'welding',
      'Welding (MIG/MAG, TIG, laser, MMA)',
      'weld',
      jsonb_build_object(
        'processes', jsonb_build_array('mig_mag', 'tig', 'laser', 'mma')
      )
    )
  on conflict (code) do nothing;
end
$seed$;

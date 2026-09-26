/**
 * Database types — hand-written in the shape `supabase gen types` emits,
 * kept in sync with /supabase/migrations by hand (no local Supabase CLI in
 * CI). Regenerate with `supabase gen types typescript --local > lib/db/types.ts`
 * once the local stack runs, then re-add the JSON column aliases at the
 * bottom of this file.
 * File path: /lib/db/types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "admin" | "sales" | "viewer";
export type UserLocale = "pl" | "en";
export type QuoteTypeDb = "fabrication" | "welding_only";
export type QuoteStatus = "draft" | "pending_override" | "sent" | "won" | "lost";
export type CurrencyCode = "PLN" | "EUR";
export type PartSourceDb = "dxf" | "pdf" | "step" | "manual" | "welding_drawing";
export type LaserModeDb = "time" | "per_m";
export type WeldProcessDb = "mig_mag" | "tig" | "laser" | "mma";
export type FinishUnitDb = "m2" | "kg" | "m" | "each";
export type MachineKindDb = "flat_laser" | "tube_laser" | "press_brake" | "roll" | "weld";
export type OverrideStatus = "pending" | "approved" | "rejected";
export type MaterialFamilyDb = "mild_steel" | "stainless" | "aluminium" | "brass" | "copper";
export type TubeProfileFamilyDb = "round" | "square" | "rectangular" | "open";
export type FileKind = "dxf" | "pdf" | "step" | "export_dxf" | "thumbnail" | "quote_pdf" | "other";

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  locale: UserLocale;
  created_at: string;
  updated_at: string;
};

export type CustomerRow = {
  id: string;
  name: string;
  vat_id: string | null;
  country: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  customer_class: string;
  preferred_locale: UserLocale | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RateVersionRow = {
  id: string;
  label: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  active: boolean;
};

export type RateGeneralRow = {
  rate_version_id: string;
  machine_rate_eur_h: number;
  labour_rate_eur_h: number;
  machining_rate_eur_h: number;
  default_margin_pct: number;
  margin_by_class: Json;
  blank_margin_mm: number;
  slow_contour_factor: number;
  default_stitch_bead_mm: number;
  default_stitch_pitch_mm: number;
  handling_mass_limit_kg: number;
  handling_surcharge_eur: number;
  weld_handling_per_part: number;
  placeholder: boolean;
};

export type MaterialRow = {
  rate_version_id: string;
  code: string;
  name: string;
  family: MaterialFamilyDb;
  density_kg_m3: number;
  rm_n_mm2: number;
  price_per_kg: Json;
  sheet_formats: Json;
  scrap_pct_default: number;
  placeholder: boolean;
};

export type RateLaserRow = {
  id: string;
  rate_version_id: string;
  material_code: string;
  thickness_mm: number;
  mode: LaserModeDb;
  speed_m_min: number | null;
  pierce_s: number | null;
  price_per_m: number | null;
  price_per_pierce: number;
  gas: string | null;
  min_contour_mm: number | null;
  in_house: boolean;
  supplier: string | null;
  placeholder: boolean;
};

export type RateTubeLaserRow = {
  id: string;
  rate_version_id: string;
  profile_family: TubeProfileFamilyDb;
  wall_mm: number;
  price_per_m_cut: number;
  handling_per_part: number;
  setup: number;
  placeholder: boolean;
};

export type RateBendRow = {
  id: string;
  rate_version_id: string;
  thickness_mm: number;
  length_class_mm: number;
  price_per_bend: number;
  setup_per_part_type: number;
  placeholder: boolean;
};

export type RateRollRow = {
  id: string;
  rate_version_id: string;
  thickness_mm: number;
  radius_class_mm: number;
  price_per_m: number;
  setup: number;
  placeholder: boolean;
};

export type RateWeldRow = {
  id: string;
  rate_version_id: string;
  process: WeldProcessDb;
  bead_mm: number;
  price_per_mm: number;
  setup: number;
  min_order: number;
  placeholder: boolean;
};

export type RateThreadRow = {
  id: string;
  rate_version_id: string;
  size: string;
  price_each: number;
  placeholder: boolean;
};

export type RateFeatureRow = {
  id: string;
  rate_version_id: string;
  code: string;
  name: string;
  price_each: number;
  placeholder: boolean;
};

export type RateFinishRow = {
  id: string;
  rate_version_id: string;
  code: string;
  name: string;
  unit: FinishUnitDb;
  price: number;
  minimum: number;
  placeholder: boolean;
};

export type MachineRow = {
  code: string;
  name: string;
  kind: MachineKindDb;
  limits: Json;
  updated_by: string | null;
  updated_at: string;
};

export type FileRow = {
  id: string;
  storage_path: string;
  original_name: string;
  mime: string;
  size: number;
  sha256: string;
  kind: FileKind;
  uploaded_by: string | null;
  /** Quote the file belongs to (RLS: insert only into quotes the user can edit). */
  quote_id: string | null;
  created_at: string;
};

export type QuoteCounterRow = { year: number; last_number: number };

export type QuoteRow = {
  id: string;
  number: string;
  version: number;
  type: QuoteTypeDb;
  status: QuoteStatus;
  customer_id: string | null;
  currency: CurrencyCode;
  fx_rate: number;
  margin_pct: number;
  validity_days: number;
  lead_time_text: string | null;
  payment_terms_text: string | null;
  rate_version_id: string | null;
  geometry_locked: boolean;
  subtotal_cost: number;
  subtotal_price: number;
  pricing: Json | null;
  flags: Json;
  show_operations_on_pdf: boolean;
  welding_separate: boolean;
  welding_only: Json | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  priced_at: string | null;
  sent_at: string | null;
  decided_at: string | null;
};

export type PartRow = {
  id: string;
  quote_id: string;
  name: string;
  source: PartSourceDb;
  file_id: string | null;
  pdf_file_id: string | null;
  file_hash: string | null;
  material_code: string | null;
  thickness_mm: number | null;
  geometry: Json | null;
  annotations: Json;
  triage: Json | null;
  thumbnail_svg: string | null;
  pdf_text: string | null;
  ai_suggestions: Json | null;
  created_at: string;
  updated_at: string;
};

export type QuoteItemRow = {
  id: string;
  quote_id: string;
  part_id: string;
  position: number;
  qty: number;
  unit_cost: number;
  unit_price: number;
  extras: Json;
  scrap_pct: number | null;
  flags: Json;
  notes: string | null;
  created_at: string;
};

export type OperationRow = {
  id: string;
  quote_item_id: string;
  position: number;
  type: string;
  label: string;
  driver_qty: number;
  driver_unit: string;
  rate_ref: Json;
  unit_cost: number;
  setup_share: number;
  details: Json;
  notes: string | null;
  auto: boolean;
};

export type OverrideRow = {
  id: string;
  quote_id: string;
  part_id: string | null;
  quote_item_id: string | null;
  rule_code: string;
  requested_by: string | null;
  note: string;
  status: OverrideStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

export type AuditLogRow = {
  id: number;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  at: string;
};

/** Insert type: optional for columns with defaults / nullable. */
type Insertable<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Insertable<ProfileRow, "id" | "email">, Partial<ProfileRow>>;
      customers: Table<CustomerRow, Insertable<CustomerRow, "name">, Partial<CustomerRow>>;
      rate_versions: Table<RateVersionRow, Insertable<RateVersionRow, "label">, Partial<RateVersionRow>>;
      rate_general: Table<
        RateGeneralRow,
        Insertable<
          RateGeneralRow,
          | "rate_version_id"
          | "machine_rate_eur_h"
          | "labour_rate_eur_h"
          | "machining_rate_eur_h"
          | "default_margin_pct"
        >,
        Partial<RateGeneralRow>
      >;
      materials: Table<
        MaterialRow,
        Insertable<MaterialRow, "rate_version_id" | "code" | "name" | "family" | "density_kg_m3" | "rm_n_mm2">,
        Partial<MaterialRow>
      >;
      rate_laser: Table<
        RateLaserRow,
        Insertable<RateLaserRow, "rate_version_id" | "material_code" | "thickness_mm">,
        Partial<RateLaserRow>
      >;
      rate_tube_laser: Table<
        RateTubeLaserRow,
        Insertable<RateTubeLaserRow, "rate_version_id" | "profile_family" | "wall_mm" | "price_per_m_cut">,
        Partial<RateTubeLaserRow>
      >;
      rate_bend: Table<
        RateBendRow,
        Insertable<RateBendRow, "rate_version_id" | "thickness_mm" | "length_class_mm" | "price_per_bend">,
        Partial<RateBendRow>
      >;
      rate_roll: Table<
        RateRollRow,
        Insertable<RateRollRow, "rate_version_id" | "thickness_mm" | "radius_class_mm" | "price_per_m">,
        Partial<RateRollRow>
      >;
      rate_weld: Table<
        RateWeldRow,
        Insertable<RateWeldRow, "rate_version_id" | "process" | "bead_mm" | "price_per_mm">,
        Partial<RateWeldRow>
      >;
      rate_thread: Table<
        RateThreadRow,
        Insertable<RateThreadRow, "rate_version_id" | "size" | "price_each">,
        Partial<RateThreadRow>
      >;
      rate_feature: Table<
        RateFeatureRow,
        Insertable<RateFeatureRow, "rate_version_id" | "code" | "name" | "price_each">,
        Partial<RateFeatureRow>
      >;
      rate_finish: Table<
        RateFinishRow,
        Insertable<RateFinishRow, "rate_version_id" | "code" | "name" | "unit" | "price">,
        Partial<RateFinishRow>
      >;
      machines: Table<MachineRow, Insertable<MachineRow, "code" | "name" | "kind">, Partial<MachineRow>>;
      files: Table<
        FileRow,
        Insertable<FileRow, "storage_path" | "original_name" | "mime" | "size" | "sha256">,
        Partial<FileRow>
      >;
      quote_counters: Table<QuoteCounterRow, Insertable<QuoteCounterRow, "year">, Partial<QuoteCounterRow>>;
      quotes: Table<QuoteRow, Insertable<QuoteRow, "number">, Partial<QuoteRow>>;
      parts: Table<PartRow, Insertable<PartRow, "quote_id" | "name" | "source">, Partial<PartRow>>;
      quote_items: Table<
        QuoteItemRow,
        Insertable<QuoteItemRow, "quote_id" | "part_id">,
        Partial<QuoteItemRow>
      >;
      operations: Table<
        OperationRow,
        Insertable<OperationRow, "quote_item_id" | "type" | "label" | "driver_qty" | "driver_unit" | "unit_cost">,
        Partial<OperationRow>
      >;
      overrides: Table<
        OverrideRow,
        Insertable<OverrideRow, "quote_id" | "rule_code" | "note">,
        Partial<OverrideRow>
      >;
      audit_log: Table<AuditLogRow, Insertable<AuditLogRow, "action" | "entity">, Partial<AuditLogRow>>;
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      can_write: { Args: Record<string, never>; Returns: boolean };
      can_edit_quote: { Args: { p_quote: string }; Returns: boolean };
      next_quote_number: { Args: Record<string, never>; Returns: string };
      activate_rate_version: { Args: { p_version: string }; Returns: undefined };
      clone_rate_version: { Args: { p_source: string; p_label: string }; Returns: string };
    };
    Enums: {
      user_role: UserRole;
      user_locale: UserLocale;
      quote_type: QuoteTypeDb;
      quote_status: QuoteStatus;
      currency_code: CurrencyCode;
      part_source: PartSourceDb;
      laser_mode: LaserModeDb;
      weld_process: WeldProcessDb;
      finish_unit: FinishUnitDb;
      machine_kind: MachineKindDb;
      override_status: OverrideStatus;
      material_family: MaterialFamilyDb;
      tube_profile_family: TubeProfileFamilyDb;
      file_kind: FileKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

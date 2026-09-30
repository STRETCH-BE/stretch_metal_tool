/**
 * admin content (PL) — rate-table editor, machines, machine-hour
 * calculator, users, overrides queue, audit log. The EN mirror is
 * /content/en/admin.ts and must keep the same keys (parity test).
 * File path: /content/admin.ts
 *
 * Column labels carry their unit in the text ("Grubość (mm)") so the
 * grid header needs no second lookup. Error and notice values are looked
 * up by CODE from the server actions (never copy in lib/admin). Rule
 * codes of overrides are resolved through content.flags first; these
 * dictionaries only hold the chrome around them.
 */

import type {
  FinishUnitDb,
  JobSetupCodeDb,
  LaserModeDb,
  MachineKindDb,
  MaterialFamilyDb,
  OverrideStatus,
  PricingModeDb,
  TubeProfileFamilyDb,
  WeldProcessDb,
} from "@/lib/db/types";
import type { AssemblyRateField, CompanyTextField, SettingsErrorCode, SettingsTable } from "@/lib/admin/settings-types";

type RateTableKey =
  | "general"
  | "materials"
  | "laser"
  | "tube_laser"
  | "bend"
  | "roll"
  | "weld"
  | "thread"
  | "feature"
  | "finish"
  | "leadtime";

export type RateErrorCode =
  | "forbidden"
  | "locked"
  | "versionActive"
  | "versionHasQuotes"
  | "notFound"
  | "validation"
  | "db"
  | "generic"
  | "required"
  | "invalidNumber"
  | "negative"
  | "invalidOption"
  | "invalidJson"
  | "tooLong"
  | "invalid"
  | "duplicateKey"
  | "noActiveVersion"
  | "unknownTable"
  | "keyChange"
  | "marginTooHigh"
  | "materialInUse";

export type MachineHourFieldKey =
  | "purchasePrice"
  | "residualValue"
  | "usefulLifeYears"
  | "productiveHoursPerYear"
  | "serviceEurPerYear"
  | "otherFixedEurPerYear"
  | "powerKw"
  | "utilisationPct"
  | "energyPriceEurPerKwh"
  | "gasEurPerHour"
  | "operatorEurPerHour"
  | "operatorSharePct"
  | "toolingEurPerYear"
  | "overheadPct";

export type SheetAdminError = "forbidden" | "validation" | "duplicate" | "versionUsed" | "notFound" | "db";

export type AdminContent = {
  title: string;
  index: {
    eyebrow: string;
    title: string;
    subtitle: string;
    cards: {
      rates: { title: string; body: string; active: string; noActive: string; placeholders: string; open: string };
      machines: { title: string; body: string; count: string; open: string };
      overrides: { title: string; body: string; pending: string; open: string };
      users: { title: string; body: string; count: string; open: string };
      calculator: { title: string; body: string; open: string };
      audit: { title: string; body: string; open: string };
      settings: { title: string; body: string; open: string; placeholders: string; missing: string; confirmed: string };
    };
  };
  rates: {
    eyebrow: string;
    title: string;
    subtitle: string;
    versions: {
      columns: {
        label: string;
        created: string;
        createdBy: string;
        status: string;
        usedBy: string;
        placeholders: string;
        actions: string;
      };
      statusActive: string;
      statusDraft: string;
      current: { title: string; body: string; materials: string; services: string; none: string };
      statusUsed: string;
      cloneTitle: string;
      cloneLabel: string;
      cloneLabelPlaceholder: string;
      cloneSubmit: string;
      activate: string;
      activateQuestion: string;
      delete: string;
      deleteQuestion: string;
      deleteBlockedActive: string;
      deleteBlockedUsed: string;
      open: string;
      empty: string;
      emptyBody: string;
      notices: {
        cloned: string;
        activated: string;
        deleted: string;
        cloneFailed: string;
        activateFailed: string;
        activateMissing: string;
        deleteFailed: string;
        labelRequired: string;
      };
    };
    version: {
      eyebrow: string;
      backToList: string;
      diffLink: string;
      csvExport: string;
      csvImport: string;
      tabsLabel: string;
      readOnlyActive: string;
      liveActive: string;
      readOnlyUsed: string;
      cloneToEdit: string;
      cloneToEditLabel: string;
      cloneToEditSubmit: string;
      meta: { created: string; createdBy: string; usedBy: string; placeholders: string; status: string; note: string };
      unknownTable: string;
    };
    tables: Record<RateTableKey, string>;
    columns: {
      general: {
        machine_rate_eur_h: string;
        labour_rate_eur_h: string;
        machining_rate_eur_h: string;
        default_margin_pct: string;
        margin_by_class: string;
        blank_margin_mm: string;
        slow_contour_factor: string;
        default_stitch_bead_mm: string;
        default_stitch_pitch_mm: string;
        handling_mass_limit_kg: string;
        handling_surcharge_eur: string;
        weld_handling_per_part: string;
        pricing_mode: string;
        order_charge_eur: string;
        packaging_box_eur: string;
        packaging_pallet_eur: string;
      };
      materials: {
        code: string;
        name: string;
        family: string;
        density_kg_m3: string;
        rm_n_mm2: string;
        price_per_kg: string;
        sheet_formats: string;
        scrap_pct_default: string;
      };
      laser: {
        material_code: string;
        thickness_mm: string;
        in_house: string;
        mode: string;
        speed_m_min: string;
        pierce_s: string;
        price_per_m: string;
        price_per_pierce: string;
        gas: string;
        min_contour_mm: string;
        supplier: string;
        setup_eur: string;
      };
      tube_laser: {
        profile_family: string;
        wall_mm: string;
        price_per_m_cut: string;
        handling_per_part: string;
        setup: string;
      };
      bend: {
        thickness_mm: string;
        length_class_mm: string;
        price_per_bend: string;
        setup_per_part_type: string;
        setup_per_bend_line_eur: string;
        price_per_bend_per_m: string;
        benchmarked_max_length_mm: string;
        family_multipliers: string;
        material_codes: string;
      };
      roll: { thickness_mm: string; radius_class_mm: string; price_per_m: string; setup: string };
      weld: { process: string; bead_mm: string; price_per_mm: string; setup: string; min_order: string };
      thread: { size: string; price_each: string; setup_per_line_eur: string; price_by_thickness: string; material_codes: string };
      feature: { code: string; name: string; price_each: string; setup_per_line_eur: string; material_codes: string; min_thickness_mm: string; max_thickness_mm: string };
      finish: {
        code: string;
        name: string;
        unit: string;
        price: string;
        minimum: string;
        setup_per_order_eur: string;
        setup_per_line_eur: string;
        min_part_mm: string;
        material_codes: string;
        min_thickness_mm: string;
        max_thickness_mm: string;
        price_per_part_eur: string;
        min_lead_time_days: string;
        minimum_scope: string;
        tier_multiplier_applies: string;
        limits: string;
      };
      leadtime: { working_days: string; multiplier: string };
    };
    options: {
      mode: Record<LaserModeDb, string>;
      gas: { O2: string; N2: string; air: string };
      process: Record<WeldProcessDb, string>;
      unit: Record<FinishUnitDb, string>;
      family: Record<MaterialFamilyDb, string>;
      profileFamily: Record<TubeProfileFamilyDb, string>;
      pricingMode: Record<PricingModeDb, string>;
    };
    grid: {
      addRow: string;
      saveRow: string;
      deleteRow: string;
      deleteRowQuestion: string;
      deleteMaterialQuestion: string;
      revertRow: string;
      saving: string;
      saved: string;
      deleted: string;
      unsaved: string;
      newRow: string;
      keyboardHint: string;
      noRows: string;
      edit: string;
      placeholderColumn: string;
      actionsColumn: string;
      yes: string;
      no: string;
      none: string;
      readOnly: string;
      rowLabel: string;
    };
    json: {
      apply: string;
      cancel: string;
      add: string;
      remove: string;
      empty: string;
      bands: { title: string; maxThickness: string; pricePerKg: string; summary: string };
      formats: { title: string; length: string; width: string; summary: string };
      margins: { title: string; customerClass: string; marginPct: string; summary: string; classPlaceholder: string };
    };
    csv: {
      title: string;
      help: string;
      helpColumns: string;
      file: string;
      submit: string;
      importing: string;
      imported: string;
      errorsTitle: string;
      lineError: string;
      noFile: string;
      tooLarge: string;
      emptyFile: string;
      missingColumns: string;
      download: string;
      delimiterHint: string;
    };
    diff: {
      eyebrow: string;
      title: string;
      subtitle: string;
      backToVersion: string;
      noActive: string;
      isActive: string;
      added: string;
      removed: string;
      changed: string;
      unchanged: string;
      key: string;
      column: string;
      before: string;
      after: string;
      noChanges: string;
      summary: string;
    };
    errors: Record<RateErrorCode, string>;
  };
  /** Sheet-metal import tables: bend table (versioned), press-brake tooling, hardware names. */
  sheet: {
    bendTable: {
      eyebrow: string;
      title: string;
      subtitle: string;
      columns: { label: string; status: string; rows: string; usedBy: string; created: string; actions: string };
      statusActive: string;
      statusDraft: string;
      open: string;
      activate: string;
      activateQuestion: string;
      cloneTitle: string;
      cloneLabel: string;
      cloneSubmit: string;
      empty: string;
      version: {
        eyebrow: string;
        backToList: string;
        /** `{label}` placeholder. */
        title: string;
        immutable: string;
        columns: { family: string; thickness: string; radius: string; vDie: string; angle: string; allowance: string; source: string; note: string; actions: string };
        sources: { din6935: string; test_bend: string };
        addTitle: string;
        addHelp: string;
        fields: { family: string; thickness: string; radius: string; vDie: string; angle: string; allowance: string; flatLength: string; legA: string; legB: string; note: string };
        computedHelp: string;
        save: string;
        delete: string;
        deleteQuestion: string;
        empty: string;
      };
      notices: { saved: string; deleted: string; cloned: string; activated: string };
    };
    tooling: {
      eyebrow: string;
      title: string;
      subtitle: string;
      columns: { code: string; kind: string; name: string; height: string; type: string; tipRadius: string; throat: string; v: string; minFlange: string; placeholder: string; actions: string };
      kinds: { punch: string; die: string };
      types: { straight: string; gooseneck: string };
      placeholderChip: string;
      addTitle: string;
      fields: { code: string; kind: string; name: string; height: string; type: string; tipRadius: string; throat: string; v: string; minFlange: string };
      save: string;
      delete: string;
      deleteQuestion: string;
      empty: string;
      notices: { saved: string; deleted: string };
    };
    hardware: {
      eyebrow: string;
      title: string;
      subtitle: string;
      columns: { pattern: string; kind: string; size: string; featureCode: string; note: string; actions: string };
      kinds: { weld_stud: string; insert: string; unknown: string };
      addTitle: string;
      addHelp: string;
      fields: { pattern: string; kind: string; size: string; featureCode: string; note: string };
      save: string;
      delete: string;
      deleteQuestion: string;
      empty: string;
      notices: { saved: string; deleted: string };
    };
    errors: Record<SheetAdminError, string>;
  };
  machines: {
    eyebrow: string;
    title: string;
    subtitle: string;
    columns: { code: string; name: string; kind: string; updated: string; limits: string };
    kinds: Record<MachineKindDb, string>;
    empty: string;
    edit: {
      eyebrow: string;
      backToList: string;
      name: string;
      sectionLimits: string;
      sectionRaw: string;
      modeTyped: string;
      modeRaw: string;
      rawHelp: string;
      rawLabel: string;
      save: string;
      saved: string;
      issuesTitle: string;
      perFamily: string;
      fields: {
        flat_laser: { bedLengthMm: string; bedWidthMm: string; zMm: string; edgeMarginMm: string; maxThicknessMm: string };
        tube_laser: {
          maxRoundDiameterMm: string;
          maxRectSideMm: string;
          maxCircumscribedMm: string;
          maxLengthMm: string;
          maxKgPerM: string;
          maxRawWeightKg: string;
          wallThicknessMm: string;
          modeA: string;
          modeB: string;
        };
        press_brake: {
          forceKN: string;
          bendLengthMm: string;
          betweenColumnsMm: string;
          openHeightMm: string;
          dieFactor: string;
        };
        roll: { maxWidthMm: string; minRadiusMm: string; maxThicknessMm: string };
        weld: { processes: string };
      };
      families: Record<MaterialFamilyDb, string>;
      processes: Record<WeldProcessDb, string>;
    };
    errors: {
      forbidden: string;
      notFound: string;
      invalidJson: string;
      validation: string;
      db: string;
      generic: string;
      nameRequired: string;
    };
  };
  calculator: {
    eyebrow: string;
    title: string;
    subtitle: string;
    sectionInputs: string;
    sectionResult: string;
    storedHint: string;
    reset: string;
    fields: Record<MachineHourFieldKey, string>;
    help: { utilisation: string; operatorShare: string; overhead: string; depreciation: string };
    breakdown: {
      depreciation: string;
      service: string;
      fixed: string;
      energy: string;
      gas: string;
      operator: string;
      tooling: string;
      subtotal: string;
      overhead: string;
      total: string;
    };
    perHour: string;
    invalidInputs: string;
    useAsRate: {
      title: string;
      body: string;
      label: string;
      labelPlaceholder: string;
      submit: string;
      rateLabel: string;
      noActiveVersion: string;
      failed: string;
      forbidden: string;
      labelRequired: string;
      invalidRate: string;
    };
  };
  users: {
    eyebrow: string;
    title: string;
    subtitle: string;
    columns: { email: string; name: string; role: string; locale: string; created: string; actions: string };
    you: string;
    empty: string;
    invite: {
      title: string;
      body: string;
      email: string;
      fullName: string;
      role: string;
      locale: string;
      submit: string;
      sent: string;
      notConfigured: string;
      errors: {
        invalidEmail: string;
        required: string;
        forbidden: string;
        generic: string;
        exists: string;
        notConfigured: string;
        roleNotSet: string;
      };
    };
    row: { save: string; saved: string; lastAdmin: string; forbidden: string; generic: string; notFound: string; noChange: string };
  };
  overrides: {
    eyebrow: string;
    title: string;
    subtitle: string;
    pending: { title: string; empty: string };
    decided: {
      title: string;
      empty: string;
      filters: {
        status: string;
        all: string;
        approved: string;
        rejected: string;
        search: string;
        searchPlaceholder: string;
        apply: string;
        reset: string;
      };
    };
    columns: {
      quote: string;
      customer: string;
      part: string;
      rule: string;
      requester: string;
      note: string;
      age: string;
      requested: string;
      status: string;
      decidedBy: string;
      decidedAt: string;
      decisionNote: string;
      actions: string;
    };
    decision: {
      note: string;
      notePlaceholder: string;
      approve: string;
      reject: string;
      approved: string;
      rejected: string;
      quoteReverted: string;
    };
    status: Record<OverrideStatus, string>;
    age: { justNow: string; minutes: string; hours: string; days: string };
    errors: { forbidden: string; notFound: string; alreadyDecided: string; noteRequired: string; db: string; generic: string };
    quoteVersion: string;
    unknownQuote: string;
    unknownPart: string;
    unknownUser: string;
    wholeQuote: string;
  };
  audit: {
    eyebrow: string;
    title: string;
    subtitle: string;
    columns: { at: string; actor: string; action: string; entity: string; entityId: string; details: string };
    filters: {
      entity: string;
      action: string;
      actionPlaceholder: string;
      actor: string;
      from: string;
      to: string;
      apply: string;
      reset: string;
      anyEntity: string;
      anyActor: string;
    };
    details: { before: string; after: string; none: string; expand: string };
    empty: string;
    results: string;
    system: string;
    openEntity: string;
  };
  /** Assembly-mode settings tables (docs/assembly-mode-design.md §2, §5). */
  settings: {
    eyebrow: string;
    title: string;
    subtitle: string;
    /** Sub-navigation labels, one per table. */
    nav: Record<SettingsTable, string>;
    navLabel: string;
    /** `{table}` = database table name. */
    migrationMissing: string;
    placeholderChip: string;
    confirmedChip: string;
    placeholderHint: string;
    overview: {
      columns: { table: string; rows: string; placeholders: string; status: string; actions: string };
      open: string;
      statusMissing: string;
      statusOk: string;
      /** `{count}` placeholder rows. */
      statusPlaceholder: string;
      singleRow: string;
    };
    actions: { save: string; delete: string; deleteQuestion: string; add: string; cancel: string };
    columns: { placeholder: string; updated: string; actions: string };
    notices: { saved: string; deleted: string };
    errors: Record<SettingsErrorCode, string>;
    /** `{field}` = the column that failed validation. */
    fieldPrefix: string;
    company: {
      title: string;
      hint: string;
      sections: { identity: string; address: string; contact: string; registry: string; bank: string; pricing: string };
      fields: Record<CompanyTextField | "oss_active" | "assembly_margin_pct" | "subcontract_margin_pct", string>;
      ossHelp: string;
      marginsHelp: string;
      /** `{fields}` = comma-separated field labels still carrying a placeholder marker. */
      placeholderWarning: string;
    };
    vat: {
      title: string;
      hint: string;
      columns: { country: string; rate: string };
    };
    packaging: {
      title: string;
      hint: string;
      columns: { code: string; name: string; maxSide: string; maxMass: string; price: string; position: string };
    };
    shipping: {
      title: string;
      hint: string;
      columns: { country: string; maxKg: string; price: string; carrier: string; position: string };
    };
    setups: {
      title: string;
      hint: string;
      columns: { code: string; name: string; cost: string };
      codes: Record<JobSetupCodeDb, string>;
    };
    assembly: {
      title: string;
      hint: string;
      fields: Record<AssemblyRateField, string>;
      distortionHelp: string;
    };
    weldSpeeds: {
      title: string;
      hint: string;
      columns: { process: string; thickness: string; speed: string };
    };
  };
};

export const admin: AdminContent = {
  title: "Administracja",
  index: {
    eyebrow: "Administracja",
    title: "Panel administratora",
    subtitle: "Cenniki, maszyny, użytkownicy, odstępstwa i dziennik zmian.",
    cards: {
      rates: {
        title: "Cenniki",
        body: "Wersjonowane tabele stawek. Edycja tworzy nową wersję; wyceny zachowują wersję, którą wyceniono.",
        active: "Aktywna wersja: {label}",
        noActive: "Brak aktywnej wersji cennika — aktywuj jedną.",
        placeholders: "{count} wierszy tymczasowych",
        open: "Otwórz cenniki",
      },
      machines: {
        title: "Maszyny",
        body: "Park maszynowy i limity wykonalności (dane, nie kod).",
        count: "{count} maszyn",
        open: "Otwórz maszyny",
      },
      overrides: {
        title: "Odstępstwa",
        body: "Wnioski sprzedaży o odstępstwo od reguł wykonalności.",
        pending: "{count} oczekujących",
        open: "Otwórz kolejkę",
      },
      users: {
        title: "Użytkownicy",
        body: "Zaproszenia, role i język interfejsu.",
        count: "{count} kont",
        open: "Otwórz użytkowników",
      },
      calculator: {
        title: "Kalkulator maszynogodziny",
        body: "Koszt godziny maszyny z ceny zakupu, amortyzacji, energii, gazu, operatora i narzutów.",
        open: "Otwórz kalkulator",
      },
      audit: {
        title: "Dziennik zmian",
        body: "Kto, co i kiedy zmienił — stawki, odstępstwa, statusy, użytkownicy.",
        open: "Otwórz dziennik",
      },
      settings: {
        title: "Ustawienia wyceny",
        body: "Dane firmy na PDF, stawki VAT, opakowania, transport, ustawienia zleceń, robocizna zespołów i prędkości spawania.",
        open: "Otwórz ustawienia",
        placeholders: "{count} wartości do potwierdzenia",
        missing: "Brak tabel — uruchom migrację",
        confirmed: "Potwierdzone",
      },
    },
  },
  rates: {
    eyebrow: "Cenniki",
    title: "Wersje cennika",
    subtitle:
      "Aktywny cennik edytujesz bezpośrednio (wysłane wyceny zachowują swoje ceny, otwarte przeliczają się przy otwarciu). Wersje użyte w wycenach są niezmienne — sklonuj wersję, edytuj kopię, aktywuj.",
    versions: {
      columns: {
        label: "Etykieta",
        created: "Utworzono",
        createdBy: "Autor",
        status: "Status",
        usedBy: "Wyceny",
        placeholders: "Tymczasowe",
        actions: "Akcje",
      },
      statusActive: "Aktywna",
      statusDraft: "Szkic",
      statusUsed: "Użyta",
      current: {
        title: "Aktualne ceny",
        body: "Ceny materiałów i usług aktywnego cennika edytujesz bezpośrednio — zmiana zapisuje się w bazie i działa od następnej kalkulacji. Wersje służą do większych zmian (klon, porównanie, aktywacja).",
        materials: "Edytuj ceny materiałów",
        services: "Edytuj stawki usług",
        none: "Brak aktywnego cennika — aktywuj wersję poniżej.",
      },
      cloneTitle: "Sklonuj tę wersję",
      cloneLabel: "Etykieta nowej wersji",
      cloneLabelPlaceholder: "np. v2 — stawki po kalibracji",
      cloneSubmit: "Sklonuj",
      activate: "Aktywuj",
      activateQuestion: "Aktywować tę wersję? Nowe wyceny będą używać tych stawek.",
      delete: "Usuń",
      deleteQuestion: "Usunąć tę wersję wraz ze wszystkimi wierszami?",
      deleteBlockedActive: "Nie można usunąć aktywnej wersji.",
      deleteBlockedUsed: "Nie można usunąć wersji użytej w wycenach.",
      open: "Otwórz",
      empty: "Brak wersji cennika",
      emptyBody: "Załaduj seed lub utwórz wersję w bazie.",
      notices: {
        cloned: "Utworzono nową wersję. Edytuj wiersze, a następnie aktywuj.",
        activated: "Wersja została aktywowana.",
        deleted: "Wersja została usunięta.",
        cloneFailed: "Nie udało się sklonować wersji.",
        activateFailed: "Nie udało się aktywować wersji.",
        activateMissing: "Ta wersja już nie istnieje — odśwież listę i wybierz inną.",
        deleteFailed: "Nie udało się usunąć wersji (aktywna lub użyta w wycenach).",
        labelRequired: "Podaj etykietę nowej wersji.",
      },
    },
    version: {
      eyebrow: "Wersja cennika",
      backToList: "Wszystkie wersje",
      diffLink: "Porównaj z aktywną",
      csvExport: "Eksport CSV",
      csvImport: "Import CSV",
      tabsLabel: "Tabele cennika",
      readOnlyActive:
        "Ta wersja jest aktywna — jej wiersze są tylko do odczytu. Sklonuj ją, edytuj kopię i aktywuj kopię.",
      liveActive:
        "To jest aktywny cennik. Zapisana zmiana obowiązuje od razu w każdej nowej kalkulacji; {drafts} otwartych wycen przeliczy się przy otwarciu; wysłane i rozstrzygnięte wyceny zachowują swoje ceny.",
      readOnlyUsed:
        "Ta wersja została użyta w wycenach ({count}) — jej wiersze są niezmienne. Sklonuj ją, aby edytować.",
      cloneToEdit: "Sklonuj, aby edytować",
      cloneToEditLabel: "Etykieta kopii",
      cloneToEditSubmit: "Sklonuj i otwórz",
      meta: {
        created: "Utworzono",
        createdBy: "Autor",
        usedBy: "Użyta w wycenach",
        placeholders: "Wiersze tymczasowe",
        status: "Status",
        note: "Notatka",
      },
      unknownTable: "Nieznana tabela cennika.",
    },
    tables: {
      general: "Ogólne",
      materials: "Materiały",
      laser: "Laser",
      tube_laser: "Laser rurowy",
      bend: "Gięcie",
      roll: "Walcowanie",
      weld: "Spawanie",
      thread: "Gwinty",
      feature: "Cechy",
      finish: "Wykończenie",
      leadtime: "Termin realizacji",
    },
    columns: {
      general: {
        machine_rate_eur_h: "Stawka maszyny (€/h)",
        labour_rate_eur_h: "Stawka robocizny (€/h)",
        machining_rate_eur_h: "Stawka obróbki (€/h)",
        default_margin_pct: "Marża domyślna (%)",
        margin_by_class: "Marża wg klasy klienta",
        blank_margin_mm: "Naddatek półfabrykatu (mm)",
        slow_contour_factor: "Współczynnik wolnych konturów",
        default_stitch_bead_mm: "Domyślna spoina przerywana — odcinek (mm)",
        default_stitch_pitch_mm: "Domyślna spoina przerywana — podziałka (mm)",
        handling_mass_limit_kg: "Limit masy dla jednej osoby (kg)",
        handling_surcharge_eur: "Dopłata za manipulację (€/szt.)",
        weld_handling_per_part: "Manipulacja przy spawaniu (€/szt.)",
        pricing_mode: "Tryb cennika",
        order_charge_eur: "Opłata za zamówienie (€)",
        packaging_box_eur: "Opakowanie — karton (€)",
        packaging_pallet_eur: "Opakowanie — paleta (€)",
      },
      materials: {
        code: "Kod",
        name: "Nazwa",
        family: "Rodzina",
        density_kg_m3: "Gęstość (kg/m³)",
        rm_n_mm2: "Rm (N/mm²)",
        price_per_kg: "Cena €/kg wg grubości",
        sheet_formats: "Formaty arkuszy",
        scrap_pct_default: "Odpad domyślny (%)",
      },
      laser: {
        material_code: "Materiał",
        thickness_mm: "Grubość (mm)",
        in_house: "Własny",
        mode: "Tryb",
        speed_m_min: "Prędkość (m/min)",
        pierce_s: "Przebicie (s)",
        price_per_m: "Cena (€/m)",
        price_per_pierce: "Cena przebicia (€)",
        gas: "Gaz",
        min_contour_mm: "Min. kontur (mm)",
        supplier: "Dostawca",
        setup_eur: "Przezbrojenie (€ / materiał+grubość)",
      },
      tube_laser: {
        profile_family: "Profil",
        wall_mm: "Ścianka (mm)",
        price_per_m_cut: "Cena cięcia (€/m)",
        handling_per_part: "Manipulacja (€/szt.)",
        setup: "Przezbrojenie (€)",
      },
      bend: {
        thickness_mm: "Grubość (mm)",
        length_class_mm: "Klasa długości (mm)",
        price_per_bend: "Cena gięcia (€)",
        setup_per_part_type: "Przezbrojenie na typ części (€)",
        setup_per_bend_line_eur: "Przezbrojenie na linię gięcia (€)",
        price_per_bend_per_m: "Dopłata za długość gięcia (€/m ponad 200 mm)",
        benchmarked_max_length_mm: "Zbadana długość gięcia do (mm)",
        family_multipliers: "Mnożniki wg rodziny materiału",
        material_codes: "Materiały",
      },
      roll: {
        thickness_mm: "Grubość (mm)",
        radius_class_mm: "Klasa promienia (mm)",
        price_per_m: "Cena (€/m)",
        setup: "Przezbrojenie (€)",
      },
      weld: {
        process: "Metoda",
        bead_mm: "Spoina (mm)",
        price_per_mm: "Cena (€/mm)",
        setup: "Przezbrojenie (€)",
        min_order: "Minimum zlecenia (€)",
      },
      thread: { size: "Rozmiar", price_each: "Cena (€/szt.)", setup_per_line_eur: "Przezbrojenie na pozycję (€)", price_by_thickness: "Cena wg grubości (€/szt.)", material_codes: "Materiały" },
      feature: {
        code: "Kod",
        name: "Nazwa",
        price_each: "Cena (€/szt.)",
        setup_per_line_eur: "Przezbrojenie na pozycję (€)",
        material_codes: "Materiały",
        min_thickness_mm: "Grubość od (mm)",
        max_thickness_mm: "Grubość do (mm)",
      },
      finish: {
        code: "Kod",
        name: "Nazwa",
        unit: "Jednostka",
        price: "Cena (€/jedn.)",
        minimum: "Minimum (€)",
        setup_per_order_eur: "Przezbrojenie na zamówienie (€)",
        setup_per_line_eur: "Przezbrojenie na pozycję (€)",
        min_part_mm: "Minimalny rozmiar części (mm)",
        material_codes: "Materiały",
        min_thickness_mm: "Grubość od (mm)",
        max_thickness_mm: "Grubość do (mm)",
        price_per_part_eur: "Cena za sztukę (€)",
        min_lead_time_days: "Min. termin (dni rob.)",
        minimum_scope: "Zakres minimum",
        tier_multiplier_applies: "Mnożnik terminu",
        limits: "Limity",
      },
      leadtime: { working_days: "Dni robocze", multiplier: "Mnożnik ceny" },
    },
    options: {
      mode: { time: "czas", per_m: "za metr" },
      gas: { O2: "O₂", N2: "N₂", air: "powietrze" },
      process: { mig_mag: "MIG/MAG", tig: "TIG", laser: "laser", mma: "MMA (elektroda)" },
      unit: { m2: "m²", kg: "kg", m: "m", each: "szt.", part: "za część" },
      family: {
        mild_steel: "stal czarna",
        stainless: "stal nierdzewna",
        aluminium: "aluminium",
        brass: "mosiądz",
        copper: "miedź",
      },
      profileFamily: { round: "okrągły", square: "kwadratowy", rectangular: "prostokątny", open: "otwarty" },
      pricingMode: { cost: "kosztowy (stawki + marża)", market: "rynkowy (ceny sprzedaży)" },
    },
    grid: {
      addRow: "Dodaj wiersz",
      saveRow: "Zapisz",
      deleteRow: "Usuń",
      deleteRowQuestion: "Usunąć ten wiersz?",
      deleteMaterialQuestion: "Usunąć ten materiał razem z jego wierszami cięcia laserem ({count}) w tej wersji?",
      revertRow: "Cofnij",
      saving: "Zapisywanie…",
      saved: "Wiersz zapisany.",
      deleted: "Wiersz usunięty.",
      unsaved: "Niezapisane zmiany",
      newRow: "Nowy",
      keyboardHint: "Tab — następna komórka · Enter — zapisz wiersz · Esc — cofnij zmiany",
      noRows: "Brak wierszy w tej tabeli.",
      edit: "Edytuj",
      placeholderColumn: "Status",
      actionsColumn: "Akcje",
      yes: "tak",
      no: "nie",
      none: "—",
      readOnly: "Tylko do odczytu",
      rowLabel: "Wiersz {key}",
    },
    json: {
      apply: "Zastosuj",
      cancel: "Anuluj",
      add: "Dodaj pozycję",
      remove: "Usuń",
      empty: "Brak pozycji",
      bands: {
        title: "Cena za kg wg grubości",
        maxThickness: "Do grubości (mm)",
        pricePerKg: "Cena (€/kg)",
        summary: "{count} przedz.",
      },
      formats: {
        title: "Formaty arkuszy",
        length: "Długość (mm)",
        width: "Szerokość (mm)",
        summary: "{count} form.",
      },
      margins: {
        title: "Marża wg klasy klienta",
        customerClass: "Klasa klienta",
        marginPct: "Marża (%)",
        summary: "{count} klas",
        classPlaceholder: "np. key",
      },
    },
    csv: {
      title: "Import CSV",
      help:
        "Pierwszy wiersz to nagłówek z nazwami kolumn (jak w eksporcie). Wiersze są dopasowywane po kluczu naturalnym: istniejące są aktualizowane, nowe dodawane. Zaimportowane wiersze przestają być tymczasowe.",
      helpColumns: "Kolumny: {columns}",
      file: "Plik CSV",
      submit: "Importuj",
      importing: "Importowanie…",
      imported: "Zaimportowano {count} wierszy.",
      errorsTitle: "Błędy ({count})",
      lineError: "Wiersz {line}: {message}",
      noFile: "Wybierz plik CSV.",
      tooLarge: "Plik jest za duży (limit 2 MB).",
      emptyFile: "Plik nie zawiera wierszy danych.",
      missingColumns: "Brak kolumn w nagłówku: {columns}",
      download: "Pobierz CSV",
      delimiterHint: "Separator: przecinek lub średnik (wykrywany automatycznie).",
    },
    diff: {
      eyebrow: "Porównanie",
      title: "Różnice względem wersji aktywnej",
      subtitle: "Wiersze dopasowane po kluczu naturalnym (kod materiału, materiał + grubość + własny, profil + ścianka…).",
      backToVersion: "Wróć do wersji",
      noActive: "Brak aktywnej wersji — nie ma z czym porównać.",
      isActive: "To jest wersja aktywna — porównanie z samą sobą nie ma różnic.",
      added: "Dodane",
      removed: "Usunięte",
      changed: "Zmienione",
      unchanged: "bez zmian",
      key: "Klucz",
      column: "Kolumna",
      before: "Aktywna",
      after: "Ta wersja",
      noChanges: "Brak różnic w tej tabeli.",
      summary: "{added} dodanych · {removed} usuniętych · {changed} zmienionych · {unchanged} bez zmian",
    },
    errors: {
      forbidden: "Tylko administrator może zmieniać cenniki.",
      locked: "Ta wersja jest zablokowana do edycji.",
      versionActive: "Tej wersji nie można zmienić — sklonuj ją.",
      versionHasQuotes: "Wersja użyta w wycenach jest niezmienna — sklonuj ją.",
      notFound: "Nie znaleziono wiersza lub wersji.",
      validation: "Popraw zaznaczone komórki.",
      db: "Błąd bazy danych: {message}",
      generic: "Coś poszło nie tak. Spróbuj ponownie.",
      required: "Wymagane",
      invalidNumber: "Nieprawidłowa liczba",
      negative: "Wartość nie może być ujemna",
      invalidOption: "Nieprawidłowa opcja",
      invalidJson: "Nieprawidłowe dane JSON",
      tooLong: "Za długie",
      invalid: "Nieprawidłowa wartość",
      duplicateKey: "Wiersz z tym kluczem już istnieje.",
      noActiveVersion: "Brak aktywnej wersji cennika.",
      unknownTable: "Nieznana tabela.",
      keyChange: "Klucza istniejącego wiersza nie można zmienić — dodaj nowy wiersz.",
      marginTooHigh: "Marża musi być mniejsza niż 100 % (cena = koszt ÷ (1 − marża)).",
      materialInUse:
        "Ten materiał ma wiersze cięcia laserem w tej wersji ({count}) — odśwież stronę i potwierdź usunięcie razem z nimi.",
    },
  },
  sheet: {
    bendTable: {
      eyebrow: "Rozwinięcia STEP",
      title: "Tabela gięć",
      subtitle: "Naddatki gięcia (BA) użyte do rozwinięcia modeli STEP. Wiersze DIN 6935 to wartości ze wzoru — dopiero gięcie próbne zdejmuje flagę „naddatek niezweryfikowany”. Wersja użyta w wycenie jest zamrożona.",
      columns: { label: "Wersja", status: "Status", rows: "Wiersze", usedBy: "Użyta w wycenach", created: "Utworzona", actions: "Akcje" },
      statusActive: "Aktywna",
      statusDraft: "Szkic",
      open: "Otwórz",
      activate: "Aktywuj",
      activateQuestion: "Aktywować tę wersję tabeli gięć? Nowe pliki STEP będą rozwijane jej naddatkami.",
      cloneTitle: "Sklonuj do edycji",
      cloneLabel: "Etykieta nowej wersji",
      cloneSubmit: "Sklonuj",
      empty: "Brak wersji tabeli gięć — uruchom migrację 20260928130000.",
      version: {
        eyebrow: "Tabela gięć",
        backToList: "Wróć do listy wersji",
        title: "Wersja {label}",
        immutable: "Ta wersja jest użyta w wycenie — jest niezmienna. Sklonuj ją, aby edytować.",
        columns: { family: "Rodzina", thickness: "Grubość (mm)", radius: "Promień wewn. (mm)", vDie: "V matrycy (mm)", angle: "Kąt (°)", allowance: "Naddatek BA (mm)", source: "Źródło", note: "Notatka", actions: "Akcje" },
        sources: { din6935: "DIN 6935 (wzór)", test_bend: "Gięcie próbne" },
        addTitle: "Dodaj lub popraw wiersz (gięcie próbne)",
        addHelp: "Podaj naddatek wprost albo wynik gięcia próbnego: długość rozwinięcia paska i zmierzone ramiona zewnętrzne — BA = rozwinięcie − ramię A − ramię B + 2·(r + t).",
        fields: { family: "Rodzina materiału", thickness: "Grubość (mm)", radius: "Promień wewnętrzny (mm)", vDie: "V matrycy (mm)", angle: "Kąt gięcia (°)", allowance: "Naddatek BA (mm)", flatLength: "Rozwinięcie paska (mm)", legA: "Ramię A zmierzone (mm)", legB: "Ramię B zmierzone (mm)", note: "Notatka" },
        computedHelp: "Jeśli pole BA jest puste, naddatek policzymy z pomiaru.",
        save: "Zapisz wiersz",
        delete: "Usuń",
        deleteQuestion: "Usunąć ten wiersz?",
        empty: "Brak wierszy w tej wersji.",
      },
      notices: { saved: "Wiersz zapisany.", deleted: "Wiersz usunięty.", cloned: "Wersja sklonowana.", activated: "Wersja aktywowana." },
    },
    tooling: {
      eyebrow: "Prasa krawędziowa",
      title: "Narzędzia prasy",
      subtitle: "Stemple (wysokość, prosty / łabędzi, promień, gardło) i matryce (V, minimalne ramię) dla kontroli DFM: za krótkie ramię i kolizja stempla. Wiersze oznaczone jako placeholder trzeba zastąpić realnymi narzędziami.",
      columns: { code: "Kod", kind: "Rodzaj", name: "Nazwa", height: "Wys. (mm)", type: "Typ", tipRadius: "R końcówki (mm)", throat: "Gardło (mm)", v: "V (mm)", minFlange: "Min. ramię (mm)", placeholder: "Placeholder", actions: "Akcje" },
      kinds: { punch: "Stempel", die: "Matryca" },
      types: { straight: "prosty", gooseneck: "łabędzi" },
      placeholderChip: "placeholder",
      addTitle: "Dodaj lub popraw narzędzie",
      fields: { code: "Kod", kind: "Rodzaj", name: "Nazwa", height: "Wysokość stempla (mm)", type: "Typ stempla", tipRadius: "Promień końcówki (mm)", throat: "Głębokość gardła (mm)", v: "Rozwarcie V (mm)", minFlange: "Minimalne ramię (mm)" },
      save: "Zapisz narzędzie",
      delete: "Usuń",
      deleteQuestion: "Usunąć to narzędzie?",
      empty: "Brak narzędzi — uruchom migrację 20260928130000.",
      notices: { saved: "Narzędzie zapisane.", deleted: "Narzędzie usunięte." },
    },
    hardware: {
      eyebrow: "Modele STEP",
      title: "Nazwy osprzętu",
      subtitle: "Fragment nazwy PRODUCT w pliku STEP → rodzaj i rozmiar osprzętu oraz kod cechy z cennika, którym jest wyceniany. Bez kodu cechy pozycja pokaże czerwoną flagę „nie wyceniono” z ilością.",
      columns: { pattern: "Fragment nazwy", kind: "Rodzaj", size: "Rozmiar", featureCode: "Kod cechy", note: "Notatka", actions: "Akcje" },
      kinds: { weld_stud: "Kołek spawalniczy", insert: "Nakrętka wciskana", unknown: "Nieznany" },
      addTitle: "Dodaj lub popraw regułę",
      addHelp: "Dopasowanie bez rozróżniania wielkości liter, np. ACAO470ZP → insert M4 → insert_m4.",
      fields: { pattern: "Fragment nazwy", kind: "Rodzaj", size: "Rozmiar (np. M4, M3x8)", featureCode: "Kod cechy (rate_feature)", note: "Notatka" },
      save: "Zapisz regułę",
      delete: "Usuń",
      deleteQuestion: "Usunąć tę regułę?",
      empty: "Brak reguł.",
      notices: { saved: "Reguła zapisana.", deleted: "Reguła usunięta." },
    },
    errors: {
      forbidden: "Tylko administrator może to zmienić.",
      validation: "Sprawdź wartości w formularzu.",
      duplicate: "Taki wiersz już istnieje.",
      versionUsed: "Ta wersja jest użyta w wycenie i jest niezmienna — sklonuj ją.",
      notFound: "Nie znaleziono wiersza.",
      db: "Błąd bazy danych.",
    },
  },
  machines: {
    eyebrow: "Maszyny",
    title: "Park maszynowy",
    subtitle: "Limity wykonalności każdej maszyny jako dane — reguły w silniku czytają je stąd.",
    columns: { code: "Kod", name: "Nazwa", kind: "Rodzaj", updated: "Zmieniono", limits: "Limity" },
    kinds: {
      flat_laser: "Laser płaski",
      tube_laser: "Laser rurowy",
      press_brake: "Prasa krawędziowa",
      roll: "Walcarka",
      weld: "Spawanie",
    },
    empty: "Brak maszyn w bazie.",
    edit: {
      eyebrow: "Maszyna",
      backToList: "Wszystkie maszyny",
      name: "Nazwa wyświetlana",
      sectionLimits: "Limity",
      sectionRaw: "JSON limitów",
      modeTyped: "Formularz",
      modeRaw: "Surowy JSON",
      rawHelp: "Widok zapasowy: ten sam obiekt, który trafia do kolumny limits. Walidowany schematem rodzaju maszyny.",
      rawLabel: "Limity (JSON)",
      save: "Zapisz maszynę",
      saved: "Maszyna zapisana.",
      issuesTitle: "Limity nie przeszły walidacji",
      perFamily: "Wg rodziny materiału",
      fields: {
        flat_laser: {
          bedLengthMm: "Długość stołu X (mm)",
          bedWidthMm: "Szerokość stołu Y (mm)",
          zMm: "Zakres Z (mm)",
          edgeMarginMm: "Margines krawędzi (mm)",
          maxThicknessMm: "Maks. grubość (mm)",
        },
        tube_laser: {
          maxRoundDiameterMm: "Maks. średnica rury (mm)",
          maxRectSideMm: "Maks. bok profilu (mm)",
          maxCircumscribedMm: "Maks. okrąg opisany (mm)",
          maxLengthMm: "Maks. długość (mm)",
          maxKgPerM: "Maks. masa (kg/m)",
          maxRawWeightKg: "Maks. masa pręta (kg)",
          wallThicknessMm: "Maks. ścianka (mm)",
          modeA: "Tryb A",
          modeB: "Tryb B",
        },
        press_brake: {
          forceKN: "Siła (kN)",
          bendLengthMm: "Długość gięcia (mm)",
          betweenColumnsMm: "Prześwit między kolumnami (mm)",
          openHeightMm: "Wysokość otwarcia (mm)",
          dieFactor: "Współczynnik matrycy V = k × t",
        },
        roll: {
          maxWidthMm: "Maks. szerokość (mm)",
          minRadiusMm: "Min. promień (mm)",
          maxThicknessMm: "Maks. grubość (mm)",
        },
        weld: { processes: "Dostępne metody spawania" },
      },
      families: {
        mild_steel: "Stal czarna",
        stainless: "Stal nierdzewna",
        aluminium: "Aluminium",
        brass: "Mosiądz",
        copper: "Miedź",
      },
      processes: { mig_mag: "MIG/MAG", tig: "TIG", laser: "Spawanie laserowe", mma: "MMA (elektroda otulona)" },
    },
    errors: {
      forbidden: "Tylko administrator może zmieniać maszyny.",
      notFound: "Nie znaleziono maszyny.",
      invalidJson: "Nieprawidłowy JSON.",
      validation: "Limity nie przeszły walidacji.",
      db: "Błąd bazy danych: {message}",
      generic: "Coś poszło nie tak. Spróbuj ponownie.",
      nameRequired: "Nazwa jest wymagana.",
    },
  },
  calculator: {
    eyebrow: "Kalkulator",
    title: "Koszt maszynogodziny",
    subtitle:
      "Model z sekcji 13 specyfikacji: amortyzacja, serwis, koszty stałe, energia, gaz, operator, narzędzia i narzut → koszt godziny.",
    sectionInputs: "Dane wejściowe",
    sectionResult: "Wynik",
    storedHint: "Wartości są zapamiętywane w tej przeglądarce (nie w bazie).",
    reset: "Wyczyść",
    fields: {
      purchasePrice: "Cena zakupu (€)",
      residualValue: "Wartość rezydualna (€)",
      usefulLifeYears: "Okres użytkowania (lata)",
      productiveHoursPerYear: "Godziny produktywne rocznie (h)",
      serviceEurPerYear: "Serwis (€/rok)",
      otherFixedEurPerYear: "Inne koszty stałe (€/rok)",
      powerKw: "Moc przyłączeniowa (kW)",
      utilisationPct: "Wykorzystanie mocy (%)",
      energyPriceEurPerKwh: "Cena energii (€/kWh)",
      gasEurPerHour: "Gaz (€/h)",
      operatorEurPerHour: "Koszt operatora (€/h)",
      operatorSharePct: "Udział operatora (%)",
      toolingEurPerYear: "Narzędzia (€/rok)",
      overheadPct: "Narzut (%)",
    },
    help: {
      utilisation: "Część mocy przyłączeniowej faktycznie pobierana w produkcji.",
      operatorShare: "Ile czasu operatora przypada na tę maszynę (100 % = jeden operator na stałe).",
      overhead: "Procent doliczany do sumy pozostałych pozycji (hala, administracja).",
      depreciation: "(cena zakupu − wartość rezydualna) ÷ lata ÷ godziny.",
    },
    breakdown: {
      depreciation: "Amortyzacja",
      service: "Serwis",
      fixed: "Koszty stałe",
      energy: "Energia",
      gas: "Gaz",
      operator: "Operator",
      tooling: "Narzędzia",
      subtotal: "Suma pośrednia",
      overhead: "Narzut",
      total: "Koszt godziny",
    },
    perHour: "€/h",
    invalidInputs: "Podaj dodatnie godziny produktywne i okres użytkowania, aby policzyć koszty roczne na godzinę.",
    useAsRate: {
      title: "Użyj jako stawkę maszyny w nowej wersji cennika",
      body:
        "Klonuje aktywną wersję z podaną etykietą, wpisuje wynik do pola „Stawka maszyny (€/h)” i otwiera nową wersję. Aktywacja pozostaje osobnym krokiem.",
      label: "Etykieta nowej wersji",
      labelPlaceholder: "np. v2 — stawka maszyny z kalkulatora",
      submit: "Utwórz wersję",
      rateLabel: "Stawka do zapisania",
      noActiveVersion: "Brak aktywnej wersji cennika do sklonowania.",
      failed: "Nie udało się utworzyć wersji.",
      forbidden: "Tylko administrator może tworzyć wersje.",
      labelRequired: "Podaj etykietę.",
      invalidRate: "Wynik kalkulatora musi być dodatnią liczbą.",
    },
  },
  users: {
    eyebrow: "Użytkownicy",
    title: "Konta i role",
    subtitle: "Administrator edytuje cenniki i zatwierdza odstępstwa, sprzedaż tworzy wyceny, podgląd tylko czyta.",
    columns: { email: "E-mail", name: "Imię i nazwisko", role: "Rola", locale: "Język", created: "Utworzono", actions: "Akcje" },
    you: "to Ty",
    empty: "Brak użytkowników.",
    invite: {
      title: "Zaproś użytkownika",
      body: "Wysyła e-mail z linkiem aktywacyjnym. Rola i język są ustawiane od razu w profilu.",
      email: "E-mail",
      fullName: "Imię i nazwisko",
      role: "Rola",
      locale: "Język",
      submit: "Wyślij zaproszenie",
      sent: "Zaproszenie wysłane na {email}.",
      notConfigured:
        "Zaproszenia są wyłączone: brak klucza serwisowego Supabase (SUPABASE_SERVICE_ROLE_KEY) na tym środowisku.",
      errors: {
        invalidEmail: "Podaj prawidłowy adres e-mail.",
        required: "Uzupełnij wymagane pola.",
        forbidden: "Tylko administrator może zapraszać użytkowników.",
        generic: "Nie udało się wysłać zaproszenia.",
        exists: "Użytkownik z tym adresem już istnieje.",
        notConfigured: "Brak klucza serwisowego Supabase — zaproszenia są wyłączone.",
        roleNotSet: "Zaproszenie wysłano, ale nie udało się zapisać roli i języka — ustaw je na liście poniżej.",
      },
    },
    row: {
      save: "Zapisz",
      saved: "Zapisano zmiany użytkownika.",
      lastAdmin: "Nie można odebrać roli ostatniemu administratorowi.",
      forbidden: "Tylko administrator może zmieniać role.",
      generic: "Nie udało się zapisać zmian.",
      notFound: "Nie znaleziono użytkownika.",
      noChange: "Brak zmian.",
    },
  },
  overrides: {
    eyebrow: "Odstępstwa",
    title: "Kolejka odstępstw",
    subtitle: "Wnioski o odstępstwo od reguł wykonalności (flagi bursztynowe). Zatwierdzone zdejmują blokadę wysyłki.",
    pending: { title: "Oczekujące", empty: "Brak oczekujących wniosków." },
    decided: {
      title: "Rozpatrzone",
      empty: "Brak rozpatrzonych wniosków.",
      filters: {
        status: "Status",
        all: "Wszystkie",
        approved: "Zatwierdzone",
        rejected: "Odrzucone",
        search: "Szukaj",
        searchPlaceholder: "Numer wyceny, reguła, notatka…",
        apply: "Filtruj",
        reset: "Wyczyść",
      },
    },
    columns: {
      quote: "Wycena",
      customer: "Klient",
      part: "Część",
      rule: "Reguła",
      requester: "Wnioskujący",
      note: "Uzasadnienie",
      age: "Wiek",
      requested: "Złożono",
      status: "Status",
      decidedBy: "Rozpatrzył",
      decidedAt: "Data decyzji",
      decisionNote: "Notatka decyzji",
      actions: "Decyzja",
    },
    decision: {
      note: "Notatka decyzji",
      notePlaceholder: "Warunki, uwagi dla sprzedaży…",
      approve: "Zatwierdź",
      reject: "Odrzuć",
      approved: "Odstępstwo zatwierdzone.",
      rejected: "Odstępstwo odrzucone.",
      quoteReverted: "Wycena wróciła do statusu Szkic.",
    },
    status: { pending: "Oczekuje", approved: "Zatwierdzone", rejected: "Odrzucone" },
    age: { justNow: "przed chwilą", minutes: "{count} min", hours: "{count} h", days: "{count} d" },
    errors: {
      forbidden: "Tylko administrator rozpatruje odstępstwa.",
      notFound: "Nie znaleziono wniosku.",
      alreadyDecided: "Ten wniosek został już rozpatrzony.",
      noteRequired: "Odrzucenie wymaga notatki.",
      db: "Błąd bazy danych: {message}",
      generic: "Nie udało się zapisać decyzji.",
    },
    quoteVersion: "v{version}",
    unknownQuote: "(usunięta wycena)",
    unknownPart: "—",
    unknownUser: "(nieznany)",
    wholeQuote: "cała wycena",
  },
  audit: {
    eyebrow: "Dziennik",
    title: "Dziennik zmian",
    subtitle: "Każda zmiana stawek, decyzja o odstępstwie, zmiana statusu i roli — z wartościami przed i po.",
    columns: { at: "Kiedy", actor: "Kto", action: "Akcja", entity: "Obiekt", entityId: "Id", details: "Szczegóły" },
    filters: {
      entity: "Obiekt",
      action: "Akcja (prefiks)",
      actionPlaceholder: "np. rate_ lub override.",
      actor: "Użytkownik",
      from: "Od",
      to: "Do",
      apply: "Filtruj",
      reset: "Wyczyść",
      anyEntity: "Wszystkie obiekty",
      anyActor: "Wszyscy",
    },
    details: { before: "Przed", after: "Po", none: "brak", expand: "Pokaż przed/po" },
    empty: "Brak wpisów dla tych filtrów.",
    results: "{count} wpisów",
    system: "system",
    openEntity: "Otwórz",
  },
  settings: {
    eyebrow: "Ustawienia",
    title: "Ustawienia wyceny",
    subtitle: "Dane firmy, stawki VAT, opakowania, transport, ustawienia zleceń, robocizna zespołów spawanych i prędkości spawania. Tabele bez wersji — zmiana działa od następnego przeliczenia wyceny.",
    nav: {
      company: "Firma",
      vat: "VAT",
      packaging: "Opakowania",
      shipping: "Transport",
      setups: "Ustawienia zleceń",
      assembly: "Zespoły spawane",
      weldSpeeds: "Prędkości spawania",
    },
    navLabel: "Tabele ustawień",
    migrationMissing: "Tabela {table} nie istnieje w tej bazie — uruchom migrację supabase/migrations/20260930100000_assembly_mode.sql.",
    placeholderChip: "placeholder — potwierdź",
    confirmedChip: "potwierdzone",
    placeholderHint: "Wiersze oznaczone „placeholder” to kalibracyjne wartości zastępcze [CONFIRM] z migracji. Zapisz wiersz (nawet bez zmian), aby potwierdzić jego wartość — wycena przestanie wtedy nosić flagę stawek tymczasowych.",
    overview: {
      columns: { table: "Tabela", rows: "Wiersze", placeholders: "Do potwierdzenia", status: "Status", actions: "Akcje" },
      open: "Otwórz",
      statusMissing: "brak tabeli",
      statusOk: "potwierdzone",
      statusPlaceholder: "{count} do potwierdzenia",
      singleRow: "1 wiersz",
    },
    actions: { save: "Zapisz", delete: "Usuń", deleteQuestion: "Usunąć ten wiersz?", add: "Dodaj wiersz", cancel: "Anuluj" },
    columns: { placeholder: "Status", updated: "Zmieniono", actions: "Akcje" },
    notices: { saved: "Zapisano.", deleted: "Wiersz usunięty." },
    errors: {
      forbidden: "Tylko administrator może zmieniać ustawienia.",
      validation: "Sprawdź wartości w formularzu.",
      duplicate: "Taki wiersz już istnieje (ten sam klucz).",
      notFound: "Nie znaleziono wiersza — odśwież stronę.",
      missingTable: "Tabela nie istnieje — uruchom migrację 20260930100000_assembly_mode.sql.",
      db: "Błąd bazy danych.",
    },
    fieldPrefix: "Pole: {field}",
    company: {
      title: "Dane firmy",
      hint: "Blok nadawcy na PDF wyceny (nazwa, adres, NIP, konto bankowe), przełącznik OSS oraz marże zespołów. Wartości z markerami 000-000, PL00, XXXX lub [CONFIRM] blokują eksport PDF.",
      sections: { identity: "Firma", address: "Adres", contact: "Kontakt", registry: "Rejestry", bank: "Bank", pricing: "Wycena" },
      fields: {
        brand: "Marka (nagłówek PDF)",
        legal_name: "Nazwa prawna",
        street: "Ulica i numer",
        postal_code: "Kod pocztowy",
        city: "Miasto",
        country: "Kraj (ISO-2)",
        phone: "Telefon",
        email: "E-mail",
        website: "Strona WWW",
        nip: "NIP",
        regon: "REGON",
        krs: "KRS",
        bank_name: "Bank",
        iban_pln: "IBAN (PLN)",
        iban_eur: "IBAN (EUR)",
        swift: "SWIFT / BIC",
        oss_active: "OSS aktywny (VAT kraju przeznaczenia dla klientów prywatnych w UE)",
        assembly_margin_pct: "Minimalna marża zespołu (%)",
        subcontract_margin_pct: "Narzut na podwykonawstwo (%)",
      },
      ossHelp: "Przy aktywnym OSS klient prywatny (B2C) z innego kraju UE dostaje stawkę VAT kraju przeznaczenia z tabeli VAT; bez OSS — stawkę polską.",
      marginsHelp: "Zespół spawany jest wyceniany z marżą max(marża wyceny, ta wartość) od przychodu. Narzut na podwykonawstwo dolicza się do kosztu formowania u podwykonawcy. Zakres 0–90 %.",
      placeholderWarning: "Dane firmy zawierają wartości zastępcze: {fields}. Uzupełnij je przed wysłaniem wyceny.",
    },
    vat: {
      title: "Stawki VAT",
      hint: "Stawka VAT wg kraju: PL dla sprzedaży krajowej i dla klientów bez numeru VAT; kraj przeznaczenia dla klientów prywatnych w UE przy aktywnym OSS. Klient z numerem VAT UE poza Polską: 0 % (odwrotne obciążenie).",
      columns: { country: "Kraj", rate: "Stawka VAT (%)" },
    },
    packaging: {
      title: "Opakowania",
      hint: "Pierwszy wiersz w kolejności pozycji, którego limity (największy bok, masa brutto = masa netto + 5 %) mieszczą przesyłkę — inaczej ostatni. Cena doliczana raz na wycenę.",
      columns: { code: "Kod", name: "Nazwa", maxSide: "Maks. bok (mm)", maxMass: "Maks. masa (kg)", price: "Cena (EUR)", position: "Kolejność" },
    },
    shipping: {
      title: "Transport",
      hint: "Progi wagowe wg kraju przeznaczenia: pierwszy próg z maks. kg ≥ masa brutto przesyłki. Brak wiersza dla kraju → transport trzeba wpisać ręcznie w wycenie.",
      columns: { country: "Kraj", maxKg: "Do (kg)", price: "Cena (EUR)", carrier: "Przewoźnik", position: "Kolejność" },
    },
    setups: {
      title: "Ustawienia zleceń",
      hint: "Koszt ustawienia naliczany RAZ na zlecenie i rozkładany na ilość: gniazdo lasera na każdą parę materiał/grubość, prasa gdy jakikolwiek element jest gięty, walce gdy walcowany u nas, spawanie raz na typ zespołu.",
      columns: { code: "Kod", name: "Nazwa", cost: "Koszt (EUR)" },
      codes: {
        laser_nest: "Gniazdo lasera (na materiał / grubość)",
        press_brake: "Ustawienie prasy krawędziowej",
        roll: "Ustawienie walców",
        weld_fitup: "Ustawienie spawania i pasowania (na typ zespołu)",
      },
    },
    assembly: {
      title: "Zespoły spawane",
      hint: "Robocizna zespołu: pasowanie i gratowanie na element, sczepy na sztukę, spawanie z prędkości efektywnych, obsługa na zespół, gięcie krokowe na uderzenie, walcowanie na metr. Minuty pasowania, sczepów i spawania × współczynnik odkształceń → godziny × stawka; godziny łuku × gaz i drut.",
      fields: {
        labour_rate_eur_h: "Stawka robocizny (EUR/h)",
        gas_wire_eur_h: "Gaz i drut (EUR/h łuku)",
        tack_seconds: "Sczep (s/szt.)",
        fitup_min_per_part: "Pasowanie (min/element)",
        deburr_min_per_part: "Gratowanie (min/element)",
        handling_min_per_assembly: "Obsługa (min/zespół)",
        distortion_factor: "Współczynnik odkształceń",
        step_bend_seconds_per_hit: "Gięcie krokowe (s/uderzenie)",
        roll_min_per_m: "Walcowanie (min/m)",
      },
      distortionHelp: "Mnożnik na prostowanie i poprawki po spawaniu (≥ 1), stosowany tylko do pasowania, sczepów i spawania.",
    },
    weldSpeeds: {
      title: "Prędkości spawania",
      hint: "Prędkości EFEKTYWNE (z zatrzymaniami i przestawianiem) w mm/min wg metody i grubości. Wyszukiwanie: wiersze metody, najmniejsza grubość ≥ grubości spoiny, inaczej największa.",
      columns: { process: "Metoda", thickness: "Grubość (mm)", speed: "Prędkość (mm/min)" },
    },
  },
};

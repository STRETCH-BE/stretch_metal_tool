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
  LaserModeDb,
  MachineKindDb,
  MaterialFamilyDb,
  OverrideStatus,
  TubeProfileFamilyDb,
  WeldProcessDb,
} from "@/lib/db/types";

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
  | "finish";

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
  | "keyChange";

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
      };
      tube_laser: {
        profile_family: string;
        wall_mm: string;
        price_per_m_cut: string;
        handling_per_part: string;
        setup: string;
      };
      bend: { thickness_mm: string; length_class_mm: string; price_per_bend: string; setup_per_part_type: string };
      roll: { thickness_mm: string; radius_class_mm: string; price_per_m: string; setup: string };
      weld: { process: string; bead_mm: string; price_per_mm: string; setup: string; min_order: string };
      thread: { size: string; price_each: string };
      feature: { code: string; name: string; price_each: string };
      finish: { code: string; name: string; unit: string; price: string; minimum: string };
    };
    options: {
      mode: Record<LaserModeDb, string>;
      gas: { O2: string; N2: string; air: string };
      process: Record<WeldProcessDb, string>;
      unit: Record<FinishUnitDb, string>;
      family: Record<MaterialFamilyDb, string>;
      profileFamily: Record<TubeProfileFamilyDb, string>;
    };
    grid: {
      addRow: string;
      saveRow: string;
      deleteRow: string;
      deleteRowQuestion: string;
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
      errors: { invalidEmail: string; required: string; forbidden: string; generic: string; exists: string; notConfigured: string };
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
    },
  },
  rates: {
    eyebrow: "Cenniki",
    title: "Wersje cennika",
    subtitle:
      "Wiersze wersji są niezmienne, gdy wersja jest aktywna lub użyta w wycenie. Sklonuj wersję, edytuj kopię, aktywuj.",
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
      thread: { size: "Rozmiar", price_each: "Cena (€/szt.)" },
      feature: { code: "Kod", name: "Nazwa", price_each: "Cena (€/szt.)" },
      finish: {
        code: "Kod",
        name: "Nazwa",
        unit: "Jednostka",
        price: "Cena (€/jedn.)",
        minimum: "Minimum (€)",
      },
    },
    options: {
      mode: { time: "czas", per_m: "za metr" },
      gas: { O2: "O₂", N2: "N₂", air: "powietrze" },
      process: { mig_mag: "MIG/MAG", tig: "TIG", laser: "laser", mma: "MMA (elektroda)" },
      unit: { m2: "m²", kg: "kg", m: "m", each: "szt." },
      family: {
        mild_steel: "stal czarna",
        stainless: "stal nierdzewna",
        aluminium: "aluminium",
        brass: "mosiądz",
        copper: "miedź",
      },
      profileFamily: { round: "okrągły", square: "kwadratowy", rectangular: "prostokątny", open: "otwarty" },
    },
    grid: {
      addRow: "Dodaj wiersz",
      saveRow: "Zapisz",
      deleteRow: "Usuń",
      deleteRowQuestion: "Usunąć ten wiersz?",
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
      versionActive: "Aktywna wersja jest tylko do odczytu — sklonuj ją.",
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
};

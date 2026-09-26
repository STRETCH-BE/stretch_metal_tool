/**
 * quote content (PL) — quote builder + customers. The EN mirror is
 * /content/en/quote.ts and must keep the same keys (parity test).
 * File path: /content/quote.ts
 *
 * `customers` is owned by the customers module (list, form, quote
 * history); the quote builder extends this same file with its own keys.
 * Country labels live here (ISO 3166-1 alpha-2 keys) because the customer
 * country drives the default quote currency (PL → PLN, else EUR). This map
 * is the CURATED list shown first in the country select — any ISO code is
 * a valid customer country; the rest are named via Intl.DisplayNames
 * (lib/customers/countries.ts).
 */

export type CustomerCountryCode =
  | "PL"
  | "DE"
  | "NL"
  | "BE"
  | "CZ"
  | "SK"
  | "AT"
  | "FR"
  | "IT"
  | "ES"
  | "GB"
  | "DK"
  | "SE"
  | "FI"
  | "NO"
  | "CH"
  | "LT"
  | "LV"
  | "EE"
  | "HU"
  | "RO"
  | "UA"
  | "LU"
  | "IE"
  | "PT"
  | "SI"
  | "HR";

export type CustomerClassCode = "standard" | "key" | "new" | "distributor";

export type CustomersContent = {
  eyebrow: string;
  title: string;
  subtitle: string;
  newTitle: string;
  newSubtitle: string;
  editEyebrow: string;
  list: {
    search: string;
    searchPlaceholder: string;
    newCustomer: string;
    columns: {
      name: string;
      country: string;
      customerClass: string;
      vatId: string;
      email: string;
      quotes: string;
      lastQuote: string;
    };
    empty: string;
    emptyBody: string;
    noResults: string;
  };
  form: {
    sectionDetails: string;
    sectionContact: string;
    sectionPreferences: string;
    name: string;
    vatId: string;
    vatIdHelp: string;
    country: string;
    countryGroupPreferred: string;
    countryGroupOther: string;
    address: string;
    email: string;
    phone: string;
    customerClass: string;
    preferredLocale: string;
    preferredLocaleNone: string;
    preferredLocaleHelp: string;
    notes: string;
    currencyHint: string;
    create: string;
    save: string;
    created: string;
    saved: string;
    deleteCustomer: string;
    deleteConfirm: string;
    deleted: string;
    backToList: string;
  };
  classes: Record<CustomerClassCode, string>;
  countries: Record<CustomerCountryCode, string>;
  history: {
    title: string;
    empty: string;
    columns: {
      number: string;
      version: string;
      type: string;
      status: string;
      date: string;
      total: string;
    };
    types: { fabrication: string; welding_only: string };
  };
  errors: {
    required: string;
    tooLong: string;
    invalidEmail: string;
    invalidCountry: string;
    invalidClass: string;
    invalidLocale: string;
    notFound: string;
    forbidden: string;
    generic: string;
  };
};

/* ─── Quote builder (owned by the quote module) ─────────────────────── */

export type QuoteStatusCode = "draft" | "pending_override" | "sent" | "won" | "lost";
export type QuoteTypeCode = "fabrication" | "welding_only";
export type OperationTypeCode =
  | "laser_cut"
  | "subcontract_cutting"
  | "tube_cut"
  | "material"
  | "bend"
  | "roll"
  | "weld"
  | "thread"
  | "feature"
  | "machining"
  | "finish_powder"
  | "finish_zinc"
  | "finish_deburr"
  | "finish_other"
  | "engrave"
  | "handling"
  | "setup"
  | "other";
export type OperationLabelCode =
  | "laser_cut"
  | "subcontract_cutting"
  | "material"
  | "material_tube"
  | "bend"
  | "bend_setup"
  | "roll"
  | "weld"
  | "weld_setup"
  | "weld_handling"
  | "weld_min_order"
  | "thread"
  | "machining"
  | "engrave"
  | "tube_cut"
  | "handling";
export type DriverUnitCode = "m" | "mm" | "pierce" | "kg" | "bend" | "min" | "m2" | "each" | "part" | "lot";
export type WeldProcessCode = "mig_mag" | "tig" | "laser" | "mma";
export type SendReasonCode =
  | "red_flags"
  | "pending_override"
  | "amber_unconfirmed"
  | "no_customer"
  | "no_customer_email"
  | "no_items"
  | "not_priced"
  | "status";
export type QuoteErrorKey =
  | "required"
  | "invalid"
  | "tooLong"
  | "invalidNumber"
  | "invalidQty"
  | "invalidMargin"
  | "invalidFx"
  | "invalidCurrency"
  | "invalidType"
  | "invalidStatus"
  | "notFound"
  | "forbidden"
  | "locked"
  | "noRates"
  | "pricing"
  | "cannotSend"
  | "mail"
  | "generic";

export type QuoteBuilderContent = {
  /** Quote list page. */
  list: {
    eyebrow: string;
    title: string;
    subtitle: string;
    newQuote: string;
    search: string;
    searchPlaceholder: string;
    filterStatus: string;
    filterCustomer: string;
    allStatuses: string;
    allCustomers: string;
    columns: {
      number: string;
      customer: string;
      type: string;
      status: string;
      parts: string;
      total: string;
      flags: string;
      updated: string;
      owner: string;
    };
    empty: string;
    emptyBody: string;
    noResults: string;
    noFlags: string;
    pendingOverrides: string;
  };
  /** New quote form. */
  create: {
    eyebrow: string;
    title: string;
    subtitle: string;
    type: string;
    customer: string;
    noCustomer: string;
    currency: string;
    currencyHelp: string;
    fxRate: string;
    fxRateHelp: string;
    margin: string;
    marginHelp: string;
    validityDays: string;
    leadTime: string;
    paymentTerms: string;
    notes: string;
    submit: string;
    cancel: string;
  };
  types: Record<QuoteTypeCode, string>;
  /** Quote page header + editable header form. */
  header: {
    eyebrow: string;
    version: string;
    created: string;
    sent: string;
    rateVersion: string;
    noRateVersion: string;
    customer: string;
    noCustomer: string;
    currency: string;
    fxRate: string;
    /** Help under the fx field; `{fx}` = the environment default rate. */
    fxRateHelp: string;
    margin: string;
    markup: string;
    validityDays: string;
    validUntil: string;
    leadTime: string;
    paymentTerms: string;
    notes: string;
    showOperationsOnPdf: string;
    weldingSeparate: string;
    save: string;
    saved: string;
    readOnly: string;
    locked: string;
  };
  /** Parts / items table. */
  parts: {
    title: string;
    columns: {
      thumbnail: string;
      name: string;
      material: string;
      qty: string;
      unitCost: string;
      unitPrice: string;
      batch: string;
      flags: string;
    };
    empty: string;
    emptyBody: string;
    uploadParts: string;
    openPart: string;
    breakdown: string;
    hideBreakdown: string;
    extras: string;
    remove: string;
    removeConfirm: string;
    moveUp: string;
    moveDown: string;
    unattached: string;
    addToQuote: string;
    noGeometry: string;
    scrap: string;
    scrapDefault: string;
    itemNotes: string;
    thumbnailAlt: string;
  };
  /** Operation breakdown + totals. */
  operations: {
    title: string;
    columns: {
      operation: string;
      driver: string;
      rate: string;
      unitCost: string;
      setupShare: string;
      batchCost: string;
    };
    types: Record<OperationTypeCode, string>;
    labels: Record<OperationLabelCode, string>;
    units: Record<DriverUnitCode, string>;
    placeholderRate: string;
    manual: string;
  };
  totals: {
    title: string;
    byType: string;
    columns: { type: string; cost: string; price: string };
    subtotalCost: string;
    subtotalPrice: string;
    margin: string;
    marginAmount: string;
    internalOnly: string;
    inEur: string;
    fxNote: string;
    preview: string;
    previewBody: string;
    pricedAt: string;
    notPriced: string;
    recalculate: string;
    placeholderRates: string;
  };
  /** Feasibility flags panel. */
  flags: {
    title: string;
    none: string;
    red: string;
    amber: string;
    green: string;
    redExplanation: string;
    confirm: string;
    confirmed: string;
    requestOverride: string;
    overrideRequested: string;
    overrideApproved: string;
    overrideRejected: string;
    partScope: string;
    quoteScope: string;
    dialogTitle: string;
    dialogNote: string;
    dialogNotePlaceholder: string;
    dialogSubmit: string;
    dialogCancel: string;
    requestSent: string;
    confirmedToast: string;
  };
  /** Override list. */
  overrides: {
    title: string;
    empty: string;
    columns: { rule: string; part: string; requestedBy: string; note: string; status: string; decided: string };
    status: { pending: string; approved: string; rejected: string; confirmed: string };
    confirmationNote: string;
  };
  /** Actions bar + send. */
  actions: {
    title: string;
    upload: string;
    duplicate: string;
    duplicateConfirm: string;
    duplicated: string;
    exportPdf: string;
    exportPdfPl: string;
    exportPdfEn: string;
    withOperations: string;
    send: string;
    sendConfirm: string;
    sendBlocked: string;
    sent: string;
    sentNoMail: string;
    /** Mailer configured but the e-mail failed: quote is sent, PDF stored. */
    sentMailFailed: string;
    mailNotConfigured: string;
    markWon: string;
    markLost: string;
    decisionSaved: string;
    recalculate: string;
    recalculated: string;
  };
  send: {
    reasons: Record<SendReasonCode, string>;
    localePl: string;
    localeEn: string;
    sendLocale: string;
  };
  /** Welding-only seams editor. */
  welding: {
    title: string;
    partsCount: string;
    partsCountHelp: string;
    columns: {
      label: string;
      process: string;
      bead: string;
      length: string;
      pattern: string;
      beadLength: string;
      pitch: string;
      sides: string;
      qty: string;
    };
    patterns: { full: string; stitch: string };
    processes: Record<WeldProcessCode, string>;
    addSeam: string;
    removeSeam: string;
    importFromParts: string;
    importedNone: string;
    imported: string;
    empty: string;
    save: string;
    saved: string;
    blockTitle: string;
    minOrderApplied: string;
    seamDefaultLabel: string;
  };
  /** Extras editor (modal per item). */
  extras: {
    title: string;
    machining: string;
    machiningMinutes: string;
    features: string;
    featureCode: string;
    featureCount: string;
    finish: string;
    finishCode: string;
    maskingMinutes: string;
    other: string;
    otherLabel: string;
    otherCost: string;
    handling: string;
    handlingCost: string;
    add: string;
    remove: string;
    empty: string;
    save: string;
    saved: string;
    costEur: string;
    none: string;
    summary: string;
  };
  audit: {
    title: string;
    empty: string;
    columns: { when: string; who: string; action: string };
    actions: Record<string, string>;
  };
  defaults: {
    paymentTerms: string;
    leadTime: string;
  };
  errors: Record<QuoteErrorKey, string>;
};

export type QuoteContent = {
  title: string;
  customers: CustomersContent;
  builder: QuoteBuilderContent;
};

const builderPl: QuoteBuilderContent = {
  list: {
    eyebrow: "Praca",
    title: "Wyceny",
    subtitle: "Wszystkie oferty: szkice, oczekujące na odstępstwo, wysłane i rozstrzygnięte.",
    newQuote: "Nowa wycena",
    search: "Szukaj wyceny",
    searchPlaceholder: "Numer lub klient…",
    filterStatus: "Status",
    filterCustomer: "Klient",
    allStatuses: "Wszystkie statusy",
    allCustomers: "Wszyscy klienci",
    columns: {
      number: "Numer",
      customer: "Klient",
      type: "Typ",
      status: "Status",
      parts: "Części",
      total: "Wartość netto",
      flags: "Flagi",
      updated: "Zmieniono",
      owner: "Właściciel",
    },
    empty: "Brak wycen",
    emptyBody: "Utwórz pierwszą wycenę albo wgraj pliki DXF — szkic powstanie automatycznie.",
    noResults: "Żadna wycena nie pasuje do filtrów.",
    noFlags: "Brak flag",
    pendingOverrides: "{count} oczekujących odstępstw",
  },
  create: {
    eyebrow: "Wycena",
    title: "Nowa wycena",
    subtitle: "Nagłówek oferty. Części dodasz w następnym kroku (wgrywanie plików).",
    type: "Typ wyceny",
    customer: "Klient",
    noCustomer: "Bez klienta (uzupełnij później)",
    currency: "Waluta",
    currencyHelp: "Domyślnie PLN dla Polski, EUR dla pozostałych krajów — możesz zmienić.",
    fxRate: "Kurs EUR → PLN",
    fxRateHelp: "Cenniki są w EUR; kurs jest zapisywany na wycenie i nie zmienia się sam.",
    margin: "Marża (% ceny)",
    marginHelp: "Domyślna z aktywnego cennika (lub klasy klienta). Marża liczona od ceny.",
    validityDays: "Ważność oferty (dni)",
    leadTime: "Termin realizacji",
    paymentTerms: "Warunki płatności",
    notes: "Uwagi wewnętrzne",
    submit: "Utwórz wycenę",
    cancel: "Anuluj",
  },
  types: { fabrication: "Produkcja", welding_only: "Tylko spawanie" },
  header: {
    eyebrow: "Wycena",
    version: "wersja {version}",
    created: "Utworzono",
    sent: "Wysłano",
    rateVersion: "Cennik",
    noRateVersion: "cennik zostanie przypięty przy pierwszej wycenie",
    customer: "Klient",
    noCustomer: "— bez klienta —",
    currency: "Waluta",
    fxRate: "Kurs EUR→PLN",
    fxRateHelp: "Cennik jest w EUR — kurs przelicza ceny na PLN. Domyślny kurs: {fx}.",
    margin: "Marża (%)",
    markup: "narzut {markup}",
    validityDays: "Ważność (dni)",
    validUntil: "ważna do {date}",
    leadTime: "Termin realizacji",
    paymentTerms: "Warunki płatności",
    notes: "Uwagi wewnętrzne",
    showOperationsOnPdf: "Pokaż operacje na PDF",
    weldingSeparate: "Spawanie jako osobny blok",
    save: "Zapisz nagłówek",
    saved: "Nagłówek zapisany, ceny przeliczone.",
    readOnly: "Tylko podgląd — ta wycena należy do innego użytkownika.",
    locked: "Wycena została wysłana — nagłówek i części są zablokowane. Utwórz nową wersję, aby zmienić.",
  },
  parts: {
    title: "Części",
    columns: {
      thumbnail: "Rysunek",
      name: "Część",
      material: "Materiał / grubość",
      qty: "Ilość",
      unitCost: "Koszt / szt.",
      unitPrice: "Cena / szt.",
      batch: "Wartość partii",
      flags: "Flagi",
    },
    empty: "Brak części",
    emptyBody: "Wgraj pliki DXF lub PDF albo dodaj część ręcznie.",
    uploadParts: "Wgraj części",
    openPart: "Otwórz część",
    breakdown: "Rozbicie operacji",
    hideBreakdown: "Ukryj operacje",
    extras: "Dodatki",
    remove: "Usuń z wyceny",
    removeConfirm: "Usunąć pozycję? Część zostanie usunięta razem z nią.",
    moveUp: "W górę",
    moveDown: "W dół",
    unattached: "Części poza wyceną",
    addToQuote: "Dodaj do wyceny",
    noGeometry: "brak geometrii",
    scrap: "Odpad %",
    scrapDefault: "domyślny",
    itemNotes: "Uwagi do pozycji",
    thumbnailAlt: "Miniatura części {name}",
  },
  operations: {
    title: "Operacje",
    columns: {
      operation: "Operacja",
      driver: "Ilość / jedn.",
      rate: "Stawka",
      unitCost: "Koszt / szt.",
      setupShare: "w tym setup",
      batchCost: "Koszt partii",
    },
    types: {
      laser_cut: "Cięcie laserem",
      subcontract_cutting: "Cięcie — kooperacja",
      tube_cut: "Cięcie rur / profili",
      material: "Materiał",
      bend: "Gięcie",
      roll: "Walcowanie",
      weld: "Spawanie",
      thread: "Gwinty",
      feature: "Obróbka otworów",
      machining: "Obróbka skrawaniem",
      finish_powder: "Malowanie proszkowe",
      finish_zinc: "Cynkowanie",
      finish_deburr: "Gratowanie",
      finish_other: "Wykończenie — inne",
      engrave: "Grawerowanie",
      handling: "Manipulacja",
      setup: "Przezbrojenie",
      other: "Inne",
    },
    labels: {
      laser_cut: "Cięcie laserem",
      subcontract_cutting: "Cięcie w kooperacji",
      material: "Materiał (blacha)",
      material_tube: "Materiał (profil)",
      bend: "Gięcie",
      bend_setup: "Przezbrojenie — gięcie",
      roll: "Walcowanie",
      weld: "Spoina",
      weld_setup: "Przezbrojenie — spawanie",
      weld_handling: "Manipulacja — spawanie",
      weld_min_order: "Minimum zamówienia — spawanie",
      thread: "Gwint",
      machining: "Obróbka skrawaniem",
      engrave: "Grawerowanie",
      tube_cut: "Cięcie profilu",
      handling: "Manipulacja",
    },
    units: {
      m: "m",
      mm: "mm",
      pierce: "przeb.",
      kg: "kg",
      bend: "gięć",
      min: "min",
      m2: "m²",
      each: "szt.",
      part: "cz.",
      lot: "partia",
    },
    placeholderRate: "stawka tymczasowa",
    manual: "ręcznie",
  },
  totals: {
    title: "Podsumowanie",
    byType: "Wg typu operacji",
    columns: { type: "Operacja", cost: "Koszt", price: "Cena" },
    subtotalCost: "Koszt razem",
    subtotalPrice: "Cena netto razem",
    margin: "Marża",
    marginAmount: "Kwota marży",
    internalOnly: "Koszt i marża są widoczne tylko wewnętrznie — nigdy na PDF.",
    inEur: "w EUR",
    fxNote: "Kwoty w {currency} po kursie {fx}.",
    preview: "Podgląd",
    previewBody: "Ceny przeliczone lokalnie po Twoich zmianach. Zapisz, aby serwer je potwierdził.",
    pricedAt: "Wyceniono {date}",
    notPriced: "Jeszcze nie wyceniono — dodaj części lub spoiny.",
    recalculate: "Przelicz",
    placeholderRates: "Użyto stawek tymczasowych [CONFIRM] — administrator musi je potwierdzić.",
  },
  flags: {
    title: "Flagi wykonalności",
    none: "Brak flag — wszystko w limitach maszyn.",
    red: "Blokujące",
    amber: "Wymagają potwierdzenia",
    green: "Informacje",
    redExplanation: "Czerwona flaga blokuje wysyłkę i nie podlega odstępstwu. Zmień część (materiał, grubość, gięcia) albo zleć w kooperacji.",
    confirm: "Potwierdź",
    confirmed: "Potwierdzone",
    requestOverride: "Poproś o odstępstwo",
    overrideRequested: "Odstępstwo oczekuje na decyzję administratora",
    overrideApproved: "Odstępstwo zatwierdzone",
    overrideRejected: "Odstępstwo odrzucone — popraw część lub poproś ponownie",
    partScope: "Część: {name}",
    quoteScope: "Cała wycena",
    dialogTitle: "Prośba o odstępstwo",
    dialogNote: "Uzasadnienie dla administratora",
    dialogNotePlaceholder: "Dlaczego mimo flagi możemy to wykonać…",
    dialogSubmit: "Wyślij prośbę",
    dialogCancel: "Anuluj",
    requestSent: "Prośba o odstępstwo wysłana. Wycena czeka na decyzję.",
    confirmedToast: "Flaga potwierdzona.",
  },
  overrides: {
    title: "Odstępstwa",
    empty: "Brak odstępstw dla tej wyceny.",
    columns: {
      rule: "Reguła",
      part: "Część",
      requestedBy: "Zgłosił",
      note: "Uzasadnienie",
      status: "Status",
      decided: "Decyzja",
    },
    status: {
      pending: "Oczekuje",
      approved: "Zatwierdzone",
      rejected: "Odrzucone",
      confirmed: "Potwierdzone przez sprzedaż",
    },
    confirmationNote: "potwierdzone przez sprzedaż",
  },
  actions: {
    title: "Akcje",
    upload: "Wgraj części",
    duplicate: "Nowa wersja",
    duplicateConfirm: "Utworzyć nową wersję tej wyceny (kopia części i ilości, aktywny cennik)?",
    duplicated: "Utworzono nową wersję.",
    exportPdf: "PDF",
    exportPdfPl: "PDF (PL)",
    exportPdfEn: "PDF (EN)",
    withOperations: "z operacjami",
    send: "Wyślij ofertę",
    sendConfirm: "Wysłać ofertę do klienta? Status zmieni się na „wysłana”.",
    sendBlocked: "Nie można wysłać:",
    sent: "Oferta wysłana e-mailem do klienta.",
    sentNoMail: "Oferta oznaczona jako wysłana. PDF zapisany — wysyłka e-mail nie jest skonfigurowana, pobierz PDF i wyślij ręcznie.",
    sentMailFailed: "Oferta oznaczona jako wysłana, PDF zapisany — wysyłka e-mail nie powiodła się. Pobierz PDF i wyślij ręcznie.",
    mailNotConfigured: "Wysyłka e-mail wyłączona (brak konfiguracji Microsoft Graph) — „Wyślij” zapisze PDF i zmieni status.",
    markWon: "Wygrana",
    markLost: "Przegrana",
    decisionSaved: "Status zapisany.",
    recalculate: "Przelicz ceny",
    recalculated: "Ceny przeliczone na serwerze.",
  },
  send: {
    reasons: {
      red_flags: "wycena ma czerwone flagi",
      pending_override: "odstępstwo czeka na decyzję administratora",
      amber_unconfirmed: "żółte flagi wymagają potwierdzenia lub zatwierdzonego odstępstwa",
      no_customer: "brak klienta",
      no_customer_email: "klient nie ma adresu e-mail",
      no_items: "brak części ani spoin",
      not_priced: "wycena nie została jeszcze policzona",
      status: "wycena została już wysłana lub rozstrzygnięta",
    },
    localePl: "polski",
    localeEn: "angielski",
    sendLocale: "Język oferty",
  },
  welding: {
    title: "Spoiny",
    partsCount: "Liczba części klienta",
    partsCountHelp: "Do manipulacji: koszt za każdą dostarczoną część.",
    columns: {
      label: "Spoina",
      process: "Metoda",
      bead: "Spoina a [mm]",
      length: "Długość [mm]",
      pattern: "Wzór",
      beadLength: "Odcinek [mm]",
      pitch: "Podziałka [mm]",
      sides: "Strony",
      qty: "Ilość",
    },
    patterns: { full: "ciągła", stitch: "przerywana" },
    processes: { mig_mag: "MIG/MAG", tig: "TIG", laser: "Laser", mma: "MMA (elektroda)" },
    addSeam: "Dodaj spoinę",
    removeSeam: "Usuń",
    importFromParts: "Importuj z rysunków",
    importedNone: "Części nie mają zaznaczonych spoin.",
    imported: "Zaimportowano {count} spoin.",
    empty: "Brak spoin. Dodaj wiersz albo zaimportuj spoiny zaznaczone na rysunkach.",
    save: "Zapisz spoiny",
    saved: "Spoiny zapisane, ceny przeliczone.",
    blockTitle: "Spawanie",
    minOrderApplied: "Zastosowano minimum zamówienia.",
    seamDefaultLabel: "Spoina {n}",
  },
  extras: {
    title: "Dodatki — {name}",
    machining: "Obróbka skrawaniem",
    machiningMinutes: "Minuty na sztukę",
    features: "Obróbka otworów",
    featureCode: "Rodzaj",
    featureCount: "Liczba",
    finish: "Wykończenie",
    finishCode: "Rodzaj",
    maskingMinutes: "Maskowanie [min]",
    other: "Inna pozycja",
    otherLabel: "Nazwa",
    otherCost: "Koszt / szt. [EUR]",
    handling: "Manipulacja",
    handlingCost: "Koszt / szt. [EUR]",
    add: "Dodaj",
    remove: "Usuń",
    empty: "Brak dodatków — operacje z geometrii liczą się automatycznie.",
    save: "Zapisz dodatki",
    saved: "Dodatki zapisane, ceny przeliczone.",
    costEur: "Koszty dodatków wpisuj w EUR (waluta cenników).",
    none: "brak",
    summary: "{count} dodatków",
  },
  audit: {
    title: "Historia zmian",
    empty: "Brak wpisów.",
    columns: { when: "Kiedy", who: "Kto", action: "Zdarzenie" },
    actions: {
      "quote.create": "utworzenie wyceny",
      "quote.update": "zmiana nagłówka",
      "quote.item.update": "zmiana pozycji",
      "quote.item.remove": "usunięcie pozycji",
      "quote.item.add": "dodanie pozycji",
      "quote.item.reorder": "zmiana kolejności",
      "quote.welding.update": "zmiana spoin",
      "quote.duplicate": "nowa wersja",
      "quote.reprice": "przeliczenie cen",
      "quote.send": "wysłanie oferty",
      "quote.status": "zmiana statusu",
      "override.request": "prośba o odstępstwo",
      "override.confirm": "potwierdzenie flagi",
      "override.approve": "zatwierdzenie odstępstwa",
      "override.reject": "odrzucenie odstępstwa",
    },
  },
  defaults: {
    // [CONFIRM] default payment terms text
    paymentTerms: "Płatność przelewem 14 dni od daty faktury. Ceny netto, VAT wg obowiązujących przepisów.",
    // [CONFIRM] default lead time
    leadTime: "10–15 dni roboczych od potwierdzenia zamówienia",
  },
  errors: {
    required: "Pole wymagane.",
    invalid: "Nieprawidłowa wartość.",
    tooLong: "Za długa wartość.",
    invalidNumber: "Nieprawidłowa liczba.",
    invalidQty: "Ilość musi być liczbą całkowitą większą od zera.",
    invalidMargin: "Marża musi być w przedziale 0–99,99 %.",
    invalidFx: "Nieprawidłowy kurs.",
    invalidCurrency: "Wybierz walutę PLN lub EUR.",
    invalidType: "Wybierz typ wyceny.",
    invalidStatus: "Nieprawidłowy status.",
    notFound: "Nie znaleziono wyceny.",
    forbidden: "Brak uprawnień do tej wyceny.",
    locked: "Wycena jest zablokowana (wysłana lub rozstrzygnięta).",
    noRates: "Brak aktywnego cennika — administrator musi aktywować wersję cennika.",
    pricing: "Nie udało się policzyć ceny: {message}",
    cannotSend: "Wycena nie spełnia warunków wysyłki.",
    mail: "PDF zapisany, ale e-mail nie został wysłany. Sprawdź konfigurację poczty.",
    generic: "Coś poszło nie tak. Spróbuj ponownie.",
  },
};

export const quote: QuoteContent = {
  title: "Wycena",
  builder: builderPl,
  customers: {
    eyebrow: "Klienci",
    title: "Klienci",
    subtitle: "Baza klientów: dane do wyceny, klasa i historia ofert.",
    newTitle: "Nowy klient",
    newSubtitle: "Kraj klienta ustala domyślną walutę wyceny.",
    editEyebrow: "Klient",
    list: {
      search: "Szukaj klienta",
      searchPlaceholder: "Nazwa, NIP lub e-mail…",
      newCustomer: "Nowy klient",
      columns: {
        name: "Nazwa",
        country: "Kraj",
        customerClass: "Klasa",
        vatId: "NIP / VAT",
        email: "E-mail",
        quotes: "Wyceny",
        lastQuote: "Ostatnia wycena",
      },
      empty: "Brak klientów",
      emptyBody: "Dodaj pierwszego klienta, aby przypisać go do wyceny.",
      noResults: "Żaden klient nie pasuje do wyszukiwania.",
    },
    form: {
      sectionDetails: "Dane firmy",
      sectionContact: "Kontakt",
      sectionPreferences: "Preferencje",
      name: "Nazwa",
      vatId: "NIP / numer VAT",
      vatIdHelp: "Z prefiksem kraju dla firm z UE, np. DE123456789.",
      country: "Kraj",
      countryGroupPreferred: "Najczęstsze kraje",
      countryGroupOther: "Pozostałe kraje",
      address: "Adres",
      email: "E-mail",
      phone: "Telefon",
      customerClass: "Klasa klienta",
      preferredLocale: "Język oferty",
      preferredLocaleNone: "Domyślny (wg kraju)",
      preferredLocaleHelp: "Język PDF oferty i wiadomości do klienta.",
      notes: "Notatki",
      currencyHint: "Domyślna waluta wycen: {currency} (PLN dla Polski, EUR dla pozostałych krajów).",
      create: "Utwórz klienta",
      save: "Zapisz zmiany",
      created: "Klient został utworzony.",
      saved: "Zmiany zapisane.",
      deleteCustomer: "Usuń klienta",
      deleteConfirm: "Usunąć klienta? Wyceny pozostaną, ale stracą powiązanie.",
      deleted: "Klient został usunięty.",
      backToList: "Lista klientów",
    },
    classes: {
      standard: "Standard",
      key: "Kluczowy",
      new: "Nowy",
      distributor: "Dystrybutor",
    },
    countries: {
      PL: "Polska",
      DE: "Niemcy",
      NL: "Holandia",
      BE: "Belgia",
      CZ: "Czechy",
      SK: "Słowacja",
      AT: "Austria",
      FR: "Francja",
      IT: "Włochy",
      ES: "Hiszpania",
      GB: "Wielka Brytania",
      DK: "Dania",
      SE: "Szwecja",
      FI: "Finlandia",
      NO: "Norwegia",
      CH: "Szwajcaria",
      LT: "Litwa",
      LV: "Łotwa",
      EE: "Estonia",
      HU: "Węgry",
      RO: "Rumunia",
      UA: "Ukraina",
      LU: "Luksemburg",
      IE: "Irlandia",
      PT: "Portugalia",
      SI: "Słowenia",
      HR: "Chorwacja",
    },
    history: {
      title: "Historia wycen",
      empty: "Ten klient nie ma jeszcze wycen.",
      columns: {
        number: "Numer",
        version: "Wersja",
        type: "Typ",
        status: "Status",
        date: "Data",
        total: "Wartość",
      },
      types: { fabrication: "Produkcja", welding_only: "Tylko spawanie" },
    },
    errors: {
      required: "Pole wymagane.",
      tooLong: "Za długa wartość.",
      invalidEmail: "Nieprawidłowy adres e-mail.",
      invalidCountry: "Nieprawidłowy kod kraju (ISO 3166-1, np. DE).",
      invalidClass: "Wybierz klasę z listy.",
      invalidLocale: "Wybierz język z listy.",
      notFound: "Nie znaleziono klienta.",
      forbidden: "Brak uprawnień do tej operacji.",
      generic: "Nie udało się zapisać klienta. Spróbuj ponownie.",
    },
  },
};

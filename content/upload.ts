/**
 * upload content (PL) — intake (start a quote, dropzone, results, parts
 * table), quick part form, the part page panels and every error code the
 * intake routes / part actions can return. The EN mirror is
 * /content/en/upload.ts and must keep the same keys (parity test).
 * File path: /content/upload.ts
 *
 * `aiSuggestions` holds every visible string of the PDF-companion panel:
 * field labels for the amber chips, the source badge ("suggested by AI" /
 * "read from PDF"), accept / dismiss buttons, the notice shown without an
 * API key, and the label maps for the CODES the suggestion object carries
 * (lib/ai/types.ts): `notes` by note code (`{param}` placeholders, render
 * with `interpolate`; for "ai_value_dropped" substitute `fields[params.field]`
 * for `{field}` first), `finishCodes` by finish code, `materialFamilies` by
 * material family, `ralLabel` for the RAL number.
 *
 * `errors` is keyed by the codes of lib/files/sniff.ts (UploadRejection),
 * lib/parts/actions.ts (ActionErrorCode) and the route-level codes, so a
 * server answer is always mapped to copy, never shown raw.
 */

import type { FinishCode, MaterialFamily, SuggestionNoteCode } from "@/lib/ai/types";
import type { PartSourceDb } from "@/lib/db/types";
import type { UploadRejection } from "@/lib/files/sniff";
import type { ActionErrorCode } from "@/lib/parts/actions";

export type UploadErrorCode =
  | UploadRejection
  | ActionErrorCode
  | "invalid_body"
  | "invalid_path"
  | "not_uploaded"
  | "network"
  | "upload_failed";

export type UploadContent = {
  title: string;
  aiSuggestions: {
    heading: string;
    sourceAi: string;
    sourceHeuristic: string;
    /** `{model}` placeholder. */
    modelLabel: string;
    confidenceLabel: string;
    confidence: { low: string; medium: string; high: string };
    fields: {
      partNumber: string;
      material: string;
      materialFamily: string;
      thicknessMm: string;
      quantity: string;
      weightKg: string;
      dimensionsMm: string;
      bends: string;
      bendCount: string;
      bendAngles: string;
      bendDirections: string;
      threads: string;
      finish: string;
      tolerances: string;
      notes: string;
    };
    directions: { up: string; down: string };
    materialFamilies: Record<MaterialFamily, string>;
    finishCodes: Record<FinishCode, string>;
    /** `{ral}` placeholder. */
    ralLabel: string;
    /** One template per note code; see lib/ai/types.ts for the params. */
    notes: Record<SuggestionNoteCode, string>;
    accept: string;
    acceptAll: string;
    dismiss: string;
    dismissAll: string;
    matchesCurrent: string;
    /** `{current}` placeholder. */
    differsFromCurrent: string;
    neverAutoApplied: string;
    noApiKey: string;
    extractedText: string;
    noExtractedText: string;
    /** `{pdf}` and `{dxf}` placeholders. */
    companionMatched: string;
    empty: string;
  };
  start: {
    eyebrow: string;
    title: string;
    subtitle: string;
    newQuote: string;
    newQuoteHelp: string;
    recentTitle: string;
    recentEmpty: string;
    continueQuote: string;
    guideLink: string;
    noCustomer: string;
    columns: { number: string; customer: string; parts: string; updated: string; status: string };
  };
  intake: {
    eyebrow: string;
    /** `{number}` placeholder. */
    title: string;
    subtitle: string;
    backToQuote: string;
    openQuote: string;
    addQuickPart: string;
    guideLink: string;
    readOnly: string;
    dropzone: {
      title: string;
      hint: string;
      browse: string;
      formats: string;
      /** `{mb}` placeholder. */
      maxSize: string;
      dropHere: string;
      inputLabel: string;
      queueLabel: string;
    };
    status: { queued: string; signing: string; uploading: string; analysing: string; done: string; error: string };
    results: {
      title: string;
      empty: string;
      openPart: string;
      /** `{pdf}` and `{part}` placeholders. */
      companionMatched: string;
      pdfWaiting: string;
      /** `{part}` placeholder. */
      pdfAttached: string;
      restored: string;
      stepManual: string;
      /** `{count}` placeholder. */
      multiPart: string;
      healingLabel: string;
      suggestionsAi: string;
      suggestionsHeuristic: string;
      remove: string;
      retry: string;
      guideLink: string;
    };
    parts: {
      title: string;
      /** `{count}` placeholder. */
      count: string;
      empty: string;
      columns: { thumbnail: string; name: string; source: string; material: string; qty: string; triage: string; flags: string; actions: string };
      noMaterial: string;
      noTriage: string;
      pdfAttached: string;
      edit: string;
      delete: string;
      deleteConfirm: string;
      deleted: string;
    };
    sources: Record<PartSourceDb, string>;
  };
  quickPart: {
    title: string;
    replaceTitle: string;
    intro: string;
    name: string;
    length: string;
    width: string;
    thickness: string;
    material: string;
    materialNone: string;
    holes: string;
    holeDiameter: string;
    holeCount: string;
    addHole: string;
    removeHole: string;
    bends: string;
    bendLength: string;
    bendAngle: string;
    bendCount: string;
    addBend: string;
    removeBend: string;
    rolled: string;
    rolledToggle: string;
    rollRadius: string;
    rollAxisLength: string;
    submit: string;
    cancel: string;
    created: string;
    manualBadge: string;
  };
  part: {
    eyebrow: string;
    backToQuote: string;
    downloadOriginal: string;
    downloadPdf: string;
    rename: string;
    nameLabel: string;
    saveName: string;
    readOnlyNotice: string;
    noGeometryTitle: string;
    noGeometryBody: string;
    stepBody: string;
    enterQuickPart: string;
    saved: string;
    saveError: string;
    saving: string;
    viewerLabel: string;
    panels: {
      material: string;
      triage: string;
      measures: string;
      holes: string;
      bends: string;
      welds: string;
      roll: string;
      ai: string;
      flags: string;
      quantity: string;
      actions: string;
      pdfText: string;
    };
    material: {
      code: string;
      thickness: string;
      none: string;
      /** `{limitMm}`, `{family}`, `{machine}` placeholders. */
      limitHint: string;
      noLimit: string;
      noRates: string;
      save: string;
      unknownCode: string;
    };
    measures: {
      cutLength: string;
      outerLength: string;
      holesLength: string;
      pierces: string;
      bbox: string;
      blank: string;
      netArea: string;
      mass: string;
      smallestContour: string;
      slowContours: string;
      weldLength: string;
      engraveLength: string;
      bendLines: string;
      partCount: string;
      unknown: string;
      /** `{marginMm}` placeholder. */
      blankMargin: string;
    };
    holes: {
      diameter: string;
      count: string;
      thread: string;
      suggested: string;
      confirmed: string;
      confirm: string;
      noThread: string;
      auto: string;
      empty: string;
      matchedBy: { minor_diameter: string; tap_drill: string };
      circular: string;
      nonCircular: string;
    };
    bends: {
      direction: string;
      length: string;
      angle: string;
      radius: string;
      source: string;
      up: string;
      down: string;
      unknown: string;
      empty: string;
      save: string;
      sources: { layer: string; drawn: string; candidate: string };
      radiusDefault: string;
    };
    welds: {
      process: string;
      bead: string;
      pattern: string;
      sides: string;
      length: string;
      effective: string;
      empty: string;
      patterns: { full: string; stitch: string };
      /** `{bead}` / `{pitch}` placeholders. */
      stitchInfo: string;
    };
    roll: {
      radius: string;
      axis: string;
      arcAngle: string;
      axisLength: string;
      developedWidth: string;
      cone: string;
      /** `{inner}`, `{outer}`, `{sweep}` placeholders. */
      coneInfo: string;
      none: string;
      axes: { x: string; y: string };
    };
    ai: {
      runPrefill: string;
      running: string;
      noPdf: string;
      attachPdfHint: string;
      showText: string;
      hideText: string;
      extractText: string;
      prefillDone: string;
      /** `{count}` placeholder. */
      pending: string;
      allApplied: string;
      applied: string;
      dismissed: string;
    };
    flags: { empty: string; notPriced: string; hint: string };
    quantity: {
      qty: string;
      unitCost: string;
      unitPrice: string;
      batchPrice: string;
      notPriced: string;
      /** `{currency}` placeholder. */
      inCurrency: string;
    };
    actions: {
      reanalyse: string;
      tolerance: string;
      toleranceHelp: string;
      exportDxf: string;
      delete: string;
      deleteConfirm: string;
      reanalysed: string;
      reanalysedCached: string;
    };
    triage: {
      reasons: string;
      healing: string;
      dropped: string;
      confirmUnits: string;
      calibrateHint: string;
      /** `{count}` placeholder. */
      candidatesQuestion: string;
      bendUp: string;
      bendDown: string;
      ignore: string;
      cut: string;
      tagHint: string;
      formingQuestion: string;
      flat: string;
      bent: string;
      rolled: string;
      pickView: string;
      pickViewHelp: string;
      joinTolerance: string;
      joinAndRetry: string;
      quickPart: string;
      answered: string;
    };
  };
  errors: Record<UploadErrorCode, string>;
};

export const upload: UploadContent = {
  title: "Wgraj pliki",
  aiSuggestions: {
    heading: "Podpowiedzi z PDF",
    sourceAi: "zasugerowane przez AI",
    sourceHeuristic: "odczytane z PDF",
    modelLabel: "Model: {model}",
    confidenceLabel: "Pewność",
    confidence: { low: "niska", medium: "średnia", high: "wysoka" },
    fields: {
      partNumber: "Numer części",
      material: "Materiał",
      materialFamily: "Rodzaj materiału",
      thicknessMm: "Grubość [mm]",
      quantity: "Ilość [szt.]",
      weightKg: "Masa [kg]",
      dimensionsMm: "Wymiar półfabrykatu [mm]",
      bends: "Gięcia",
      bendCount: "Liczba gięć",
      bendAngles: "Kąty gięcia",
      bendDirections: "Kierunki gięcia",
      threads: "Gwinty",
      finish: "Wykończenie",
      tolerances: "Tolerancje",
      notes: "Uwagi",
    },
    directions: { up: "w górę", down: "w dół" },
    materialFamilies: {
      mild_steel: "stal czarna",
      stainless: "stal nierdzewna",
      aluminium: "aluminium",
      brass: "mosiądz",
      copper: "miedź",
    },
    finishCodes: {
      powder_coating: "malowanie proszkowe",
      galvanised: "cynkowanie",
      anodised: "anodowanie",
      blasted: "śrutowanie / piaskowanie",
      brushed: "szczotkowanie",
      pickled_passivated: "trawienie / pasywacja",
      painted: "malowanie",
      deburred: "gratowanie",
      none: "bez obróbki (surowe)",
    },
    ralLabel: "RAL {ral}",
    notes: {
      text: "{text}",
      hole: "Otwór {callout}",
      hole_fit: "Otwór {callout} — pasowanie, obróbka skrawaniem",
      chamfer: "Faza {a}×{b}°",
      radii: "Promienie: {list}",
      angles_no_context: "Kąty na rysunku: {list} (brak oznaczenia gięcia)",
      other_materials: "Inne oznaczenia materiału: {list}",
      thread_repeated: "{size}: oznaczenie powtórzone {seen}× — liczby nie zsumowano",
      ai_unavailable: "AI niedostępne — pokazano wartości odczytane z PDF.",
      pdf_too_large: "PDF jest za duży dla AI — przeanalizowano tylko tekst.",
      ai_value_dropped: "{field}: wartość AI „{value}” poza zakresem — pominięto",
    },
    accept: "Zastosuj",
    acceptAll: "Zastosuj wszystkie",
    dismiss: "Odrzuć",
    dismissAll: "Odrzuć wszystkie",
    matchesCurrent: "zgodne z bieżącą wartością",
    differsFromCurrent: "obecnie: {current}",
    neverAutoApplied:
      "Podpowiedzi nigdy nie są stosowane automatycznie — każdą trzeba zatwierdzić.",
    noApiKey: "Brak klucza API — pokazujemy tekst odczytany z PDF.",
    extractedText: "Tekst z PDF",
    noExtractedText: "PDF nie zawiera warstwy tekstowej (skan lub sama grafika).",
    companionMatched: "PDF {pdf} dopasowany do {dxf} po nazwie pliku.",
    empty: "Brak podpowiedzi z tego PDF.",
  },
  start: {
    eyebrow: "Wgraj pliki",
    title: "Nowa wycena z plików",
    subtitle: "Utwórz szkic wyceny i wgraj rozwinięcia DXF, rysunki PDF lub modele STEP. Klienta i dane handlowe uzupełnisz w edytorze wyceny.",
    newQuote: "Rozpocznij nową wycenę",
    newQuoteHelp: "Tworzy szkic z kolejnym numerem SM-RRRR-NNNN i otwiera ekran wgrywania.",
    recentTitle: "Twoje szkice",
    recentEmpty: "Nie masz jeszcze szkiców. Rozpocznij nową wycenę powyżej.",
    continueQuote: "Kontynuuj",
    guideLink: "Instrukcja eksportu DXF",
    noCustomer: "bez klienta",
    columns: { number: "Numer", customer: "Klient", parts: "Części", updated: "Zmieniono", status: "Status" },
  },
  intake: {
    eyebrow: "Wgrywanie plików",
    title: "Wycena {number}",
    subtitle: "Przeciągnij pliki albo wybierz je z dysku. Każdy DXF staje się częścią z miniaturą i wynikiem triage; PDF o tej samej nazwie dołącza się automatycznie.",
    backToQuote: "Wróć do wyceny",
    openQuote: "Otwórz wycenę",
    addQuickPart: "Dodaj szybką część",
    guideLink: "Jak wyeksportować DXF?",
    readOnly: "Ta wycena jest zamknięta do edycji — pliki można tylko przeglądać.",
    dropzone: {
      title: "Upuść pliki tutaj",
      hint: "lub",
      browse: "Wybierz pliki",
      formats: "DXF, PDF, STEP / STP — wiele plików naraz",
      maxSize: "maks. {mb} MB na plik",
      dropHere: "Upuść, aby wgrać",
      inputLabel: "Wybierz pliki do wgrania",
      queueLabel: "Kolejka wgrywania",
    },
    status: {
      queued: "W kolejce",
      signing: "Przygotowanie",
      uploading: "Wgrywanie",
      analysing: "Analiza geometrii",
      done: "Gotowe",
      error: "Błąd",
    },
    results: {
      title: "Wgrane w tej sesji",
      empty: "Wgrane pliki pojawią się tutaj z miniaturą i wynikiem triage.",
      openPart: "Otwórz część",
      companionMatched: "PDF {pdf} dopasowany do części {part}.",
      pdfWaiting: "PDF zapisany — dołączy się do DXF o tej samej nazwie, gdy go wgrasz.",
      pdfAttached: "PDF dołączony do części {part}.",
      restored: "Przywrócono wcześniejsze oznaczenia dla tego pliku.",
      stepManual: "STEP zapisany — geometria nie jest rozwijana. Wprowadź wymiary jako szybką część.",
      multiPart: "Plik zawiera {count} części — wyceniana jest największa.",
      healingLabel: "Naprawa",
      suggestionsAi: "podpowiedzi AI z PDF",
      suggestionsHeuristic: "wartości odczytane z PDF",
      remove: "Usuń z listy",
      retry: "Ponów",
      guideLink: "Zobacz instrukcję eksportu",
    },
    parts: {
      title: "Części w wycenie",
      count: "{count} części",
      empty: "Brak części. Wgraj plik DXF lub dodaj szybką część.",
      columns: {
        thumbnail: "Podgląd",
        name: "Nazwa",
        source: "Źródło",
        material: "Materiał / grubość",
        qty: "Ilość",
        triage: "Triage",
        flags: "Flagi",
        actions: "Akcje",
      },
      noMaterial: "nie wybrano",
      noTriage: "—",
      pdfAttached: "PDF",
      edit: "Edytuj",
      delete: "Usuń",
      deleteConfirm: "Usunąć część z wyceny?",
      deleted: "Część usunięta.",
    },
    sources: {
      dxf: "DXF",
      pdf: "PDF",
      step: "STEP",
      manual: "Ręcznie",
      welding_drawing: "Rysunek spawalniczy",
    },
  },
  quickPart: {
    title: "Szybka część",
    replaceTitle: "Wprowadź część ręcznie",
    intro: "Prostokąt L × W z otworami i gięciami — gdy plik nie nadaje się do wyceny albo klient podał tylko wymiary. Część zostanie oznaczona jako geometria ręczna.",
    name: "Nazwa części",
    length: "Długość L [mm]",
    width: "Szerokość W [mm]",
    thickness: "Grubość [mm]",
    material: "Materiał",
    materialNone: "— wybierz później —",
    holes: "Otwory",
    holeDiameter: "Średnica [mm]",
    holeCount: "Liczba",
    addHole: "Dodaj otwory",
    removeHole: "Usuń wiersz otworów",
    bends: "Gięcia",
    bendLength: "Długość [mm]",
    bendAngle: "Kąt [°]",
    bendCount: "Liczba",
    addBend: "Dodaj gięcia",
    removeBend: "Usuń wiersz gięć",
    rolled: "Walcowanie",
    rolledToggle: "Część jest walcowana",
    rollRadius: "Promień [mm]",
    rollAxisLength: "Długość osi [mm]",
    submit: "Utwórz część",
    cancel: "Anuluj",
    created: "Część utworzona.",
    manualBadge: "Geometria ręczna",
  },
  part: {
    eyebrow: "Część",
    backToQuote: "Wróć do wyceny",
    downloadOriginal: "Pobierz oryginał",
    downloadPdf: "Pobierz PDF",
    rename: "Zmień nazwę",
    nameLabel: "Nazwa części",
    saveName: "Zapisz nazwę",
    readOnlyNotice: "Podgląd — ta wycena nie jest już edytowalna albo nie masz do niej praw zapisu.",
    noGeometryTitle: "Brak geometrii",
    noGeometryBody: "Ten plik nie ma rozwinięcia do wyświetlenia.",
    stepBody: "Pliki STEP nie są rozwijane w tej wersji. Wprowadź wymiary rozwinięcia jako szybką część — nazwa jest już wypełniona.",
    enterQuickPart: "Wprowadź jako szybką część",
    saved: "Zapisano oznaczenia.",
    saveError: "Nie udało się zapisać oznaczeń.",
    saving: "Zapisywanie…",
    viewerLabel: "Podgląd rozwinięcia",
    panels: {
      material: "Materiał i grubość",
      triage: "Triage pliku",
      measures: "Pomiary",
      holes: "Otwory",
      bends: "Gięcia",
      welds: "Spoiny",
      roll: "Walcowanie",
      ai: "PDF i podpowiedzi",
      flags: "Flagi wykonalności",
      quantity: "Ilość i cena",
      actions: "Akcje",
      pdfText: "Tekst z PDF",
    },
    material: {
      code: "Materiał",
      thickness: "Grubość [mm]",
      none: "— nie wybrano —",
      limitHint: "Laser własny tnie {family} do {limitMm} mm ({machine}); grubsze idzie do kooperacji.",
      noLimit: "Brak limitu grubości dla tego materiału w parku maszyn.",
      noRates: "Brak aktywnej wersji cennika — lista materiałów jest pusta. Aktywuj wersję w Administracja → Cenniki.",
      save: "Zapisz materiał",
      unknownCode: "Kod spoza cennika — wycena zgłosi brak materiału.",
    },
    measures: {
      cutLength: "Długość cięcia",
      outerLength: "Obrys zewnętrzny",
      holesLength: "Otwory",
      pierces: "Przebicia",
      bbox: "Gabaryt",
      blank: "Półfabrykat",
      netArea: "Powierzchnia netto",
      mass: "Masa",
      smallestContour: "Najmniejszy kontur",
      slowContours: "Małe kontury",
      weldLength: "Długość spoin",
      engraveLength: "Długość graweru",
      bendLines: "Linie gięcia",
      partCount: "Części w pliku",
      unknown: "— podaj grubość —",
      blankMargin: "margines {marginMm} mm",
    },
    holes: {
      diameter: "Ø [mm]",
      count: "Liczba",
      thread: "Gwint",
      suggested: "sugerowany",
      confirmed: "potwierdzony",
      confirm: "Potwierdź gwint",
      noThread: "bez gwintu",
      auto: "automatycznie",
      empty: "Brak otworów.",
      matchedBy: { minor_diameter: "średnica rdzenia", tap_drill: "wiertło pod gwint" },
      circular: "okrągły",
      nonCircular: "nieokrągły",
    },
    bends: {
      direction: "Kierunek",
      length: "Długość [mm]",
      angle: "Kąt [°]",
      radius: "Promień [mm]",
      source: "Źródło",
      up: "w górę",
      down: "w dół",
      unknown: "nieznany",
      empty: "Brak linii gięcia. Dorysuj je w podglądzie albo odpowiedz w panelu triage.",
      save: "Zapisz",
      sources: { layer: "warstwa", drawn: "dorysowana", candidate: "kandydat" },
      radiusDefault: "= grubość",
    },
    welds: {
      process: "Proces",
      bead: "Spoina [mm]",
      pattern: "Wzór",
      sides: "Strony",
      length: "Długość [mm]",
      effective: "Efektywna [mm]",
      empty: "Brak spoin. Zaznacz krawędź w podglądzie i użyj narzędzia spoiny.",
      patterns: { full: "ciągła", stitch: "przerywana" },
      stitchInfo: "{bead}/{pitch} mm",
    },
    roll: {
      radius: "Promień",
      axis: "Oś",
      arcAngle: "Kąt łuku",
      axisLength: "Długość osi",
      developedWidth: "Szerokość rozwinięcia",
      cone: "Stożek",
      coneInfo: "R {inner}–{outer} mm, {sweep}°",
      none: "Część nie jest walcowana. Walcowanie oznaczysz w podglądzie.",
      axes: { x: "X", y: "Y" },
    },
    ai: {
      runPrefill: "Uruchom odczyt PDF",
      running: "Odczytywanie…",
      noPdf: "Brak dołączonego PDF. Wgraj rysunek o tej samej nazwie co DXF na ekranie wgrywania.",
      attachPdfHint: "Z PDF odczytujemy grubość, materiał, gięcia, gwinty, wykończenie i ilość.",
      showText: "Pokaż tekst z PDF",
      hideText: "Ukryj tekst z PDF",
      extractText: "Odczytaj tekst",
      prefillDone: "Podpowiedzi odświeżone.",
      pending: "{count} podpowiedzi do zatwierdzenia",
      allApplied: "Wszystkie podpowiedzi są zgodne z częścią albo zostały odrzucone.",
      applied: "Zastosowano podpowiedź.",
      dismissed: "Odrzucono.",
    },
    flags: {
      empty: "Brak flag — ostatnia wycena nie zgłosiła zastrzeżeń.",
      notPriced: "Część nie została jeszcze wyceniona. Flagi pojawią się po przeliczeniu wyceny.",
      hint: "Czerwona flaga blokuje wysyłkę; bursztynowa wymaga potwierdzenia lub odstępstwa.",
    },
    quantity: {
      qty: "Ilość [szt.]",
      unitCost: "Koszt / szt.",
      unitPrice: "Cena / szt.",
      batchPrice: "Cena partii",
      notPriced: "nie wyceniono",
      inCurrency: "w {currency}",
    },
    actions: {
      reanalyse: "Przelicz geometrię",
      tolerance: "Tolerancja łączenia [mm]",
      toleranceHelp: "0,01–0,5 mm. Większa tolerancja domyka przerwy między liniami, ale może sklejać sąsiednie krawędzie.",
      exportDxf: "Eksportuj DXF z warstwami",
      delete: "Usuń część",
      deleteConfirm: "Usunąć część i jej pozycję z wyceny?",
      reanalysed: "Geometria przeliczona.",
      reanalysedCached: "Geometria pobrana z pamięci podręcznej (ten sam plik).",
    },
    triage: {
      reasons: "Powody",
      healing: "Naprawa",
      dropped: "Pominięte",
      confirmUnits: "Wymiary są w mm — potwierdzam",
      calibrateHint: "Nie jesteś pewien? Skalibruj w podglądzie: kliknij dwa punkty i wpisz rzeczywistą odległość.",
      candidatesQuestion: "Te {count} linii to:",
      bendUp: "Gięcie w górę",
      bendDown: "Gięcie w dół",
      ignore: "Ignoruj",
      cut: "Cięcie",
      tagHint: "Odpowiedź dotyczy wszystkich linii naraz. Aby oznaczyć je osobno, zaznacz linię w podglądzie i użyj narzędzia oznaczania.",
      formingQuestion: "Czy ta część jest gięta lub walcowana?",
      flat: "Płaska",
      bent: "Gięta",
      rolled: "Walcowana",
      pickView: "Wskaż widok będący rozwinięciem",
      pickViewHelp: "W podglądzie zaznacz lassem widok rozwinięcia, a potem użyj czyszczenia „zostaw największy kontur i otwory”. Reszta rysunku zostanie zignorowana.",
      joinTolerance: "Tolerancja łączenia [mm]",
      joinAndRetry: "Połącz i przelicz",
      quickPart: "Wprowadź jako szybką część",
      answered: "Odpowiedź zapisana.",
    },
  },
  errors: {
    extension: "Nieobsługiwany typ pliku. Dozwolone: DXF, PDF, STEP / STP.",
    size: "Plik jest za duży — limit to 25 MB.",
    dwg: "DWG nie jest obsługiwany. Zapisz plik jako DXF (w AutoCAD: Zapisz jako → DXF) i wgraj ponownie.",
    empty: "Plik jest pusty.",
    binary_dxf: "To binarny DXF. Zapisz plik jako ASCII DXF (AutoCAD 2018 lub R12) i wgraj ponownie.",
    unknown_type: "Nie rozpoznano zawartości pliku — to nie jest DXF, PDF ani STEP.",
    type_mismatch: "Zawartość pliku nie zgadza się z rozszerzeniem.",
    invalid_body: "Nieprawidłowe żądanie.",
    invalid_path: "Nieprawidłowa ścieżka pliku.",
    not_uploaded: "Plik nie dotarł do magazynu. Spróbuj ponownie.",
    network: "Błąd połączenia. Sprawdź sieć i spróbuj ponownie.",
    upload_failed: "Wgrywanie nie powiodło się.",
    unauthenticated: "Sesja wygasła — zaloguj się ponownie.",
    forbidden: "Brak uprawnień do edycji tej wyceny.",
    not_found: "Nie znaleziono wyceny lub części.",
    locked: "Wycena jest zamknięta do edycji.",
    invalid_id: "Nieprawidłowy identyfikator.",
    validation: "Sprawdź wpisane wartości.",
    no_geometry: "Ta część nie ma geometrii do przeliczenia.",
    no_rates: "Brak aktywnej wersji cennika.",
    bend_not_found: "Nie znaleziono tego gięcia.",
    no_bends: "Część nie ma linii gięcia, do których można zastosować kąty.",
    nothing_to_apply: "Ta podpowiedź nie ma nic do zastosowania.",
    no_pdf: "Część nie ma dołączonego PDF.",
    no_item: "Część nie ma pozycji w wycenie.",
    generic: "Coś poszło nie tak. Spróbuj ponownie.",
  },
};

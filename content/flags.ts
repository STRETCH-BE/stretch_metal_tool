/**
 * flags content (PL) — feasibility flags, triage states, healing and
 * dropped-entity messages, all keyed by CODE with `{param}` placeholders.
 * The EN mirror is /content/en/flags.ts (parity test + test/intake/
 * flags-content.test.ts, which also checks that the placeholders match).
 * File path: /content/flags.ts
 *
 * Param names follow lib/pricing/README.md (flag catalogue) and
 * lib/geometry/triage.ts (`triage.details`). Code-valued params (`state`,
 * `family`, `reason`, `what`, `process`) are translated through the label
 * maps below by lib/parts/flag-message.ts before interpolation, so a
 * message never shows a raw enum value. Numbers are formatted per locale
 * by the same helper.
 */

import type { FlagCode, FlagSeverity, MaterialFamily, LaserLookupReason } from "@/lib/pricing";
import type { WeldProcess } from "@/lib/geometry/types";
import type { DroppedEntity, TriageReasonCode, TriageState } from "@/lib/geometry/types";

export type TubeLimitKind = "length" | "wall" | "envelope" | "circumscribed" | "kg_per_m" | "raw_weight";

export type FlagsContent = {
  title: string;
  severity: Record<FlagSeverity, string>;
  /** Per triage state: chip label, explanation and (for amber/red) what to do. */
  triage: Record<TriageState, { label: string; message: string; action?: string }>;
  triageReasons: Record<TriageReasonCode, string>;
  healing: {
    title: string;
    /** Shown when every counter is zero. */
    nothing: string;
    /** `{toleranceMm}` placeholder. */
    tolerance: string;
    /** Each fragment takes `{count}`; non-zero fragments are joined with commas. */
    parts: {
      gaps: string;
      duplicates: string;
      overlaps: string;
      zeroLength: string;
      splines: string;
      ellipses: string;
      blocks: string;
      loopsClosed: string;
    };
  };
  dropped: {
    title: string;
    empty: string;
    /** `{type}`, `{count}`, `{layer}`, `{reason}` placeholders. */
    item: string;
    reasons: Record<DroppedEntity["reason"], string>;
  };
  families: Record<MaterialFamily, string>;
  laserReasons: Record<LaserLookupReason, string>;
  tubeLimits: Record<TubeLimitKind, string>;
  weldProcesses: Record<WeldProcess, string>;
  flags: Record<FlagCode, { label: string; message: string }>;
};

export const flags: FlagsContent = {
  title: "Flagi",
  severity: { green: "OK", amber: "Uwaga", red: "Blokada" },
  triage: {
    green: {
      label: "Zielony",
      message: "Rozwinięcie jest gotowe do wyceny: zamknięty obrys, otwory i linie gięcia rozpoznane automatycznie.",
    },
    amber_bend_candidates: {
      label: "Linie do potwierdzenia",
      message:
        "Wewnątrz obrysu jest {count} otwartych linii bez nazwanej warstwy. Mogą to być linie gięcia, grawer albo cięcie.",
      action: "Oznacz te linie jednym kliknięciem poniżej lub zaznacz je pojedynczo w podglądzie.",
    },
    amber_forming_unknown: {
      label: "Gięta czy walcowana?",
      message:
        "Plik ma tylko obrys i otwory, ale nazwa lub rysunek PDF sugeruje formowanie. Bez linii gięcia wycenimy tylko cięcie.",
      action: "Odpowiedz, czy część jest płaska, gięta czy walcowana. Linie gięcia dorysujesz w podglądzie lub dołącz PDF.",
    },
    amber_units: {
      label: "Jednostki",
      message:
        "Plik nie deklaruje jednostek ($INSUNITS) albo jest w calach. Wymiary {units} zostały przyjęte jako mm.",
      action: "Sprawdź wymiar obrysu i potwierdź, albo skalibruj podgląd dwoma kliknięciami na znanym wymiarze.",
    },
    red_drawing_sheet: {
      label: "Arkusz rysunkowy",
      message:
        "To wygląda na rysunek złożeniowy lub warsztatowy (wiele widoków, wymiary, tabelka), a nie rozwinięcie 1:1.",
      action: "Wskaż widok, który jest rozwinięciem, albo wprowadź część ręcznie. Najlepiej poproś klienta o eksport rozwinięcia zgodnie z instrukcją.",
    },
    red_no_closed_contour: {
      label: "Brak zamkniętego obrysu",
      message:
        "Nie udało się zbudować zamkniętego obrysu zewnętrznego — linie nie łączą się końcami albo plik nie zawiera geometrii.",
      action: "Zwiększ tolerancję łączenia i przelicz ponownie, popraw plik w CAD albo wprowadź część ręcznie.",
    },
  },
  triageReasons: {
    bend_layers_found: "Linie gięcia rozpoznane po nazwie warstwy ({bendLines})",
    no_interior_open_lines: "Brak otwartych linii wewnątrz obrysu",
    interior_open_lines: "{count} otwartych linii wewnątrz obrysu bez roli",
    forming_hint_in_name: "Nazwa części sugeruje gięcie lub walcowanie",
    forming_hint_in_pdf: "Rysunek PDF sugeruje gięcie lub walcowanie",
    units_missing: "Plik nie deklaruje jednostek",
    units_inch: "Plik w calach — przeskalowano ×{scaleApplied}",
    extents_mismatch: "Zakres rysunku ($EXTMAX) {extentsRatio}× większy niż geometria",
    dimension_text_heavy: "{dimensionTextCount} wymiarów i tekstów na rysunku",
    multiple_view_clusters: "{clusterCount} oddzielnych grup obrysów (widoków)",
    no_closed_contour: "Nie znaleziono zamkniętego obrysu",
    multi_part: "Plik zawiera {partCount} oddzielnych części — wyceniana jest największa",
  },
  healing: {
    title: "Naprawa geometrii",
    nothing: "Geometria nie wymagała naprawy.",
    tolerance: "tolerancja {toleranceMm} mm",
    parts: {
      gaps: "połączone przerwy: {count}",
      duplicates: "usunięte duplikaty: {count}",
      overlaps: "usunięte nakładające się odcinki: {count}",
      zeroLength: "usunięte odcinki zerowej długości: {count}",
      splines: "spłaszczone splajny: {count}",
      ellipses: "spłaszczone elipsy: {count}",
      blocks: "rozbite bloki: {count}",
      loopsClosed: "domknięte pętle: {count}",
    },
  },
  dropped: {
    title: "Pominięte elementy",
    empty: "Nic nie pominięto.",
    item: "{type} × {count} (warstwa {layer}) — {reason}",
    reasons: {
      not_geometry: "nie jest geometrią",
      zero_length: "zerowa długość",
      ignored_layer: "warstwa ignorowana",
      unsupported: "typ nieobsługiwany",
    },
  },
  families: {
    mild_steel: "stal czarna",
    stainless: "stal nierdzewna",
    aluminium: "aluminium",
    brass: "mosiądz",
    copper: "miedź",
  },
  laserReasons: {
    in_house: "cięcie własne",
    over_limit: "grubość ponad limit lasera",
    supplier_row: "tylko stawka kooperanta",
    no_machine: "brak lasera płaskiego w parku maszyn",
    none: "brak stawki",
  },
  tubeLimits: {
    length: "długość",
    wall: "grubość ścianki",
    envelope: "wymiar zewnętrzny",
    circumscribed: "okrąg opisany",
    kg_per_m: "masa na metr",
    raw_weight: "masa surówki",
  },
  weldProcesses: {
    mig_mag: "MIG/MAG",
    tig: "TIG",
    laser: "laser",
    mma: "elektroda (MMA)",
  },
  flags: {
    "geometry.manual": {
      label: "Geometria ręczna",
      message: "Część wprowadzona ręcznie (szybka część) — wymiary i otwory nie pochodzą z pliku.",
    },
    "geometry.triage_amber": {
      label: "Triage do potwierdzenia",
      message: "Stan pliku: {state}. Do potwierdzenia: {count}. Odpowiedz na pytanie w panelu triage.",
    },
    "geometry.triage_red": {
      label: "Plik nie nadaje się do wyceny",
      message: "Stan pliku: {state}. Popraw plik, wskaż właściwy widok albo wprowadź część ręcznie.",
    },
    "geometry.units_unconfirmed": {
      label: "Jednostki niepotwierdzone",
      message: "Stan pliku: {state}. Potwierdź, że wymiary są w milimetrach.",
    },
    "geometry.no_material": {
      label: "Brak materiału",
      message: "Nie wybrano materiału albo kod „{code}” nie istnieje w cenniku.",
    },
    "geometry.no_thickness": {
      label: "Brak grubości",
      message: "Podaj grubość blachy — bez niej nie policzymy masy, cięcia ani gięcia.",
    },
    "laser.thickness_over_limit": {
      label: "Kooperacja — ponad limit lasera",
      message:
        "{thicknessMm} mm przekracza limit {limitMm} mm naszego lasera dla materiału {family}. Cięcie wycenione ze stawki kooperanta {supplier} (wiersz {rowThicknessMm} mm).",
    },
    "laser.subcontract": {
      label: "Cięcie w kooperacji",
      message:
        "Grubość {thicknessMm} mm wyceniona ze stawki kooperanta {supplier} (wiersz {rowThicknessMm} mm): {reason}.",
    },
    "laser.no_rate_row": {
      label: "Brak stawki cięcia",
      message:
        "Brak stawki cięcia dla {materialCode} {thicknessMm} mm (limit lasera {limitMm} mm, {family}; {reason}). Dodaj wiersz w cenniku lasera.",
    },
    "laser.blank_exceeds_bed": {
      label: "Półfabrykat nie mieści się na stole",
      message:
        "Półfabrykat {blankLengthMm} × {blankWidthMm} mm nie mieści się na stole {bedLengthMm} × {bedWidthMm} mm maszyny {machine} (margines {edgeMarginMm} mm).",
    },
    "laser.slow_contours": {
      label: "Małe kontury",
      message:
        "{count} małych konturów (< {thresholdMm} mm, łącznie {lengthMm} mm) wyceniono z mnożnikiem {factor} — laser zwalnia na małych otworach.",
    },
    "material.no_price": {
      label: "Brak ceny materiału",
      message: "Materiał {code} nie ma ceny za kg dla grubości {thicknessMm} mm.",
    },
    "material.mass_handling": {
      label: "Ciężka część",
      message:
        "Masa części {massKg} kg przekracza {limitKg} kg — rozważ dopłatę za manipulację {surchargeEur} €.",
    },
    "bend.force_over_limit": {
      label: "Siła gięcia ponad limit prasy",
      message:
        "Gięcie {bendId}: potrzebne {forceKN} kN, prasa ma {limitKN} kN (długość {lengthMm} mm, grubość {thicknessMm} mm, matryca V {dieVMm} mm, Rm {rmNmm2} N/mm²).",
    },
    "bend.length_over_limit": {
      label: "Gięcie za długie",
      message: "Gięcie {bendId}: długość {lengthMm} mm przekracza {limitMm} mm prasy.",
    },
    "bend.hole_crosses_bend": {
      label: "Otwór przecina linię gięcia",
      message: "Gięcie {bendId}: {count} otworów leży na linii gięcia — zdeformują się.",
    },
    "bend.hole_near_bend": {
      label: "Otwór blisko gięcia",
      message:
        "Gięcie {bendId}: {count} otworów w odległości {distanceMm} mm od linii gięcia (minimum {minMm} mm).",
    },
    "bend.short_flange": {
      label: "Krótka półka",
      message:
        "Gięcie {bendId}: półka {flangeMm} mm jest krótsza niż minimum {minMm} mm (matryca V {dieVMm} mm, promień {radiusMm} mm).",
    },
    "bend.no_rate_row": {
      label: "Brak stawki gięcia",
      message: "Gięcie {bendId}: brak stawki dla grubości {thicknessMm} mm i długości {lengthMm} mm.",
    },
    "roll.radius_too_small": {
      label: "Promień walcowania za mały",
      message: "Promień {radiusMm} mm jest mniejszy niż minimum walcarki {minRadiusMm} mm.",
    },
    "roll.axis_too_long": {
      label: "Walcowanie za szerokie",
      message: "Długość osi {axisLengthMm} mm przekracza szerokość walcarki {maxWidthMm} mm.",
    },
    "roll.thickness_over_limit": {
      label: "Walcowanie — grubość ponad limit",
      message: "Grubość {thicknessMm} mm przekracza limit walcarki {maxThicknessMm} mm — walcowanie w kooperacji.",
    },
    "roll.no_rate_row": {
      label: "Brak stawki walcowania",
      message: "Brak stawki walcowania dla grubości {thicknessMm} mm i promienia {radiusMm} mm.",
    },
    "weld.no_rate_row": {
      label: "Brak stawki spawania",
      message: "Spoina {weldId}: brak stawki dla procesu {process} i spoiny {beadMm} mm.",
    },
    "weld.min_order_applied": {
      label: "Minimum zlecenia spawalniczego",
      message: "Wartość spawania {totalBefore} € podniesiono do minimum {minOrder} € (+{shortfall} €).",
    },
    "tube.over_limit": {
      label: "Profil poza zakresem lasera rurowego",
      message:
        "Pozycja {index} ({profileFamily}): {what} = {value} przekracza limit {limit} dla materiału {family}.",
    },
    "tube.no_rate_row": {
      label: "Brak stawki cięcia rur",
      message: "Pozycja {index}: brak stawki dla profilu {profileFamily} o ściance {wallMm} mm.",
    },
    "thread.no_rate_row": {
      label: "Brak stawki gwintu",
      message: "Gwint {size} × {count}: brak ceny w cenniku gwintów.",
    },
    "feature.no_rate_row": {
      label: "Brak stawki operacji",
      message: "Operacja dodatkowa {code} (pozycja {index}): brak ceny w cenniku.",
    },
    "finish.no_rate_row": {
      label: "Brak stawki wykończenia",
      message: "Wykończenie {code} (pozycja {index}): brak ceny w cenniku wykończeń.",
    },
    "finish.minimum_applied": {
      label: "Minimum partii wykończenia",
      message: "Wykończenie {code}: koszt partii {batchBefore} € podniesiono do minimum {minimum} € ({batchCost} €).",
    },
    "rates.placeholder": {
      label: "Stawki tymczasowe",
      message: "{count} użytych stawek to wartości zastępcze [CONFIRM] — potwierdź je w cennikach przed wysyłką.",
    },
  },
};

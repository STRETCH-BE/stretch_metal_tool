/**
 * upload content (PL) — STUB, extended by the upload build step. The EN mirror
 * is /content/en/upload.ts and must keep the same keys (parity test).
 * File path: /content/upload.ts
 *
 * `aiSuggestions` holds every visible string of the PDF-companion panel:
 * field labels for the amber chips, the source badge ("suggested by AI" /
 * "read from PDF"), accept / dismiss buttons, the notice shown without an
 * API key, and the label maps for the CODES the suggestion object carries
 * (lib/ai/types.ts): `notes` by note code (`{param}` placeholders, render
 * with `interpolate`; for "ai_value_dropped" substitute `fields[params.field]`
 * for `{field}` first), `finishCodes` by finish code, `materialFamilies` by
 * material family, `ralLabel` for the RAL number. The intake step adds its
 * own keys beside `title` and `aiSuggestions`.
 */

import type {
  FinishCode,
  MaterialFamily,
  SuggestionNoteCode,
} from "@/lib/ai/types";

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
};

export const upload: UploadContent = {
  title: "upload",
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
};

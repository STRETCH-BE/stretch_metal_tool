/**
 * upload content (PL) — STUB, extended by the upload build step. The EN mirror
 * is /content/en/upload.ts and must keep the same keys (parity test).
 * File path: /content/upload.ts
 *
 * `aiSuggestions` holds every visible string of the PDF-companion panel:
 * field labels for the amber chips, the source badge ("suggested by AI" /
 * "read from PDF"), accept / dismiss buttons and the notices shown when
 * there is no API key or the AI call failed. The intake step adds its
 * own keys beside `title` and `aiSuggestions`.
 */

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
    accept: string;
    acceptAll: string;
    dismiss: string;
    dismissAll: string;
    matchesCurrent: string;
    /** `{current}` placeholder. */
    differsFromCurrent: string;
    neverAutoApplied: string;
    noApiKey: string;
    aiUnavailable: string;
    pdfTooLarge: string;
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
    accept: "Zastosuj",
    acceptAll: "Zastosuj wszystkie",
    dismiss: "Odrzuć",
    dismissAll: "Odrzuć wszystkie",
    matchesCurrent: "zgodne z bieżącą wartością",
    differsFromCurrent: "obecnie: {current}",
    neverAutoApplied:
      "Podpowiedzi nigdy nie są stosowane automatycznie — każdą trzeba zatwierdzić.",
    noApiKey: "Brak klucza API — pokazujemy tekst odczytany z PDF.",
    aiUnavailable: "AI niedostępne — pokazano wartości odczytane z PDF.",
    pdfTooLarge: "PDF jest za duży dla AI — przeanalizowano tylko tekst.",
    extractedText: "Tekst z PDF",
    noExtractedText: "PDF nie zawiera warstwy tekstowej (skan lub sama grafika).",
    companionMatched: "PDF {pdf} dopasowany do {dxf} po nazwie pliku.",
    empty: "Brak podpowiedzi z tego PDF.",
  },
};

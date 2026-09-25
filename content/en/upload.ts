/**
 * upload content (EN) — mirror of /content/upload.ts.
 * File path: /content/en/upload.ts
 */

import type { UploadContent } from "@/content/upload";

export const upload: UploadContent = {
  title: "upload",
  aiSuggestions: {
    heading: "Suggestions from the PDF",
    sourceAi: "suggested by AI",
    sourceHeuristic: "read from PDF",
    modelLabel: "Model: {model}",
    confidenceLabel: "Confidence",
    confidence: { low: "low", medium: "medium", high: "high" },
    fields: {
      partNumber: "Part number",
      material: "Material",
      thicknessMm: "Thickness [mm]",
      quantity: "Quantity [pcs]",
      weightKg: "Weight [kg]",
      dimensionsMm: "Blank size [mm]",
      bends: "Bends",
      bendCount: "Number of bends",
      bendAngles: "Bend angles",
      bendDirections: "Bend directions",
      threads: "Threads",
      finish: "Finish",
      tolerances: "Tolerances",
      notes: "Notes",
    },
    directions: { up: "up", down: "down" },
    accept: "Apply",
    acceptAll: "Apply all",
    dismiss: "Dismiss",
    dismissAll: "Dismiss all",
    matchesCurrent: "matches the current value",
    differsFromCurrent: "current: {current}",
    neverAutoApplied:
      "Suggestions are never applied automatically — each one needs your confirmation.",
    noApiKey: "No API key — showing the text extracted from the PDF.",
    aiUnavailable: "AI unavailable — showing the values read from the PDF.",
    pdfTooLarge: "PDF too large for AI — only the text was analysed.",
    extractedText: "Text from the PDF",
    noExtractedText: "The PDF has no text layer (scan or graphics only).",
    companionMatched: "PDF {pdf} matched to {dxf} by file name.",
    empty: "Nothing to suggest from this PDF.",
  },
};

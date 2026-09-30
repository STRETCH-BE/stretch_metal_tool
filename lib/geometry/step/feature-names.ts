/**
 * Geometry engine — default CAD feature names, the names a body carries
 * when nobody named it: SolidWorks and Inventor call a body after the
 * feature that made it ("Linear austragen6", "Cut-Extrude3", "Boss-Extrude1[2]").
 * A body named like that in an exported IFC / STEP is usually a modelling
 * helper (a cut tool body, an extrude used for a boolean, a window block)
 * — but not always: a real plate can be left with the feature's name too.
 * The engine only reports the match (`bodyHints.featureName`); the
 * decision is made where the machine park is known (lib/pricing).
 * File path: /lib/geometry/step/feature-names.ts
 *
 * Matching (featureNameOf): the name is trimmed of a trailing instance
 * suffix `[n]`, trailing digits and separators, then compared
 * case-insensitively, whitespace and hyphen variants folded. Entries
 * marked [CONFIRM] are default names we could not verify against the
 * localized CAD builds.
 */

export type FeatureNameEntry = {
  /** The default name as the CAD writes it (without the counter). */
  name: string;
  system: "solidworks" | "inventor";
  language: "de" | "en" | "fr" | "pl" | "nl";
};

export const FEATURE_NAMES: readonly FeatureNameEntry[] = [
  // SolidWorks — German
  { name: "Linear austragen", system: "solidworks", language: "de" },
  { name: "Aufsatz-Linear austragen", system: "solidworks", language: "de" },
  { name: "Schnitt-Linear austragen", system: "solidworks", language: "de" },
  { name: "Rotieren", system: "solidworks", language: "de" },
  { name: "Aufsatz-Rotieren", system: "solidworks", language: "de" },
  { name: "Schnitt-Rotieren", system: "solidworks", language: "de" },
  { name: "Aufsatz-Austragung", system: "solidworks", language: "de" }, // [CONFIRM]
  { name: "Schnitt-Austragung", system: "solidworks", language: "de" }, // [CONFIRM]
  { name: "Basis-Blech", system: "solidworks", language: "de" }, // [CONFIRM] sheet-metal base flange
  { name: "Körper-Verschieben/Kopieren", system: "solidworks", language: "de" }, // [CONFIRM]
  // SolidWorks — English
  { name: "Boss-Extrude", system: "solidworks", language: "en" },
  { name: "Cut-Extrude", system: "solidworks", language: "en" },
  { name: "Extrude", system: "solidworks", language: "en" },
  { name: "Revolve", system: "solidworks", language: "en" },
  { name: "Boss-Revolve", system: "solidworks", language: "en" },
  { name: "Cut-Revolve", system: "solidworks", language: "en" },
  { name: "Boss-Sweep", system: "solidworks", language: "en" }, // [CONFIRM]
  { name: "Cut-Sweep", system: "solidworks", language: "en" }, // [CONFIRM]
  { name: "Base-Flange", system: "solidworks", language: "en" }, // [CONFIRM] sheet-metal base flange
  { name: "Body-Move/Copy", system: "solidworks", language: "en" }, // [CONFIRM]
  // SolidWorks — French
  { name: "Bossage-Extrusion", system: "solidworks", language: "fr" },
  { name: "Enlèvement de matière-Extrusion", system: "solidworks", language: "fr" },
  { name: "Bossage-Révolution", system: "solidworks", language: "fr" }, // [CONFIRM]
  { name: "Enlèvement de matière-Révolution", system: "solidworks", language: "fr" }, // [CONFIRM]
  { name: "Extrusion", system: "solidworks", language: "fr" }, // [CONFIRM]
  // SolidWorks — Polish
  { name: "Wyciągnięcie", system: "solidworks", language: "pl" },
  { name: "Wycięcie", system: "solidworks", language: "pl" },
  { name: "Dodanie/baza przez wyciągnięcie", system: "solidworks", language: "pl" }, // [CONFIRM]
  { name: "Wyciągnięcie wycięcia", system: "solidworks", language: "pl" }, // [CONFIRM]
  { name: "Obrót", system: "solidworks", language: "pl" }, // [CONFIRM]
  // SolidWorks — Dutch
  { name: "Extrusie", system: "solidworks", language: "nl" },
  { name: "Extrusie-Snede", system: "solidworks", language: "nl" }, // [CONFIRM]
  { name: "Omwenteling", system: "solidworks", language: "nl" }, // [CONFIRM]
  // Inventor — English
  { name: "Extrusion", system: "inventor", language: "en" },
  { name: "Revolution", system: "inventor", language: "en" },
  { name: "Solid", system: "inventor", language: "en" }, // Inventor's unnamed solid bodies: "Solid1", "Solid2"
  // Inventor — German
  { name: "Extrusion", system: "inventor", language: "de" },
  { name: "Drehung", system: "inventor", language: "de" }, // [CONFIRM]
  { name: "Volumenkörper", system: "inventor", language: "de" }, // [CONFIRM] "Volumenkörper1"
  // Inventor — French
  { name: "Extrusion", system: "inventor", language: "fr" },
  { name: "Révolution", system: "inventor", language: "fr" }, // [CONFIRM]
  { name: "Solide", system: "inventor", language: "fr" }, // [CONFIRM]
  // Inventor — Polish
  { name: "Wyciągnięcie proste", system: "inventor", language: "pl" }, // [CONFIRM]
  { name: "Obrót", system: "inventor", language: "pl" }, // [CONFIRM]
  { name: "Bryła", system: "inventor", language: "pl" }, // [CONFIRM] "Bryła1"
  // Inventor — Dutch
  { name: "Extrusie", system: "inventor", language: "nl" }, // [CONFIRM]
  { name: "Omwenteling", system: "inventor", language: "nl" }, // [CONFIRM]
  { name: "Solide", system: "inventor", language: "nl" }, // [CONFIRM]
];

function fold(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

const FOLDED = new Set(FEATURE_NAMES.map((e) => fold(e.name)));

/**
 * The stem of a body name: trailing instance suffix `[n]`, trailing
 * digits and the separators before them removed ("Aufsatz-Linear
 * austragen6[1]" → "Aufsatz-Linear austragen").
 */
export function featureStem(name: string): string {
  return name
    .trim()
    .replace(/\s*\[\d+\]\s*$/, "")
    .replace(/[\s\-_:.#]*\d+\s*$/, "")
    .trim();
}

/** The matching default feature name (as listed), or null when the body is named after something else. */
export function featureNameOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const stem = fold(featureStem(name));
  if (!stem) return null;
  if (!FOLDED.has(stem)) return null;
  return FEATURE_NAMES.find((e) => fold(e.name) === stem)?.name ?? null;
}

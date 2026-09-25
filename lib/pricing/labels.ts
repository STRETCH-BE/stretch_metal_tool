/**
 * Pricing engine — the stable `label` keys written on auto-generated
 * operation lines. The UI maps these to localized text
 * (content/quote.ts); anything not in this list is free text from the
 * rate table (feature/finish names), the thread size, or the user's own
 * label on an "other" extra.
 * File path: /lib/pricing/labels.ts
 */

export const OPERATION_LABELS = {
  laserCut: "laser_cut",
  subcontractCutting: "subcontract_cutting",
  material: "material",
  materialTube: "material_tube",
  bend: "bend",
  bendSetup: "bend_setup",
  roll: "roll",
  weld: "weld",
  weldSetup: "weld_setup",
  weldHandling: "weld_handling",
  weldMinOrder: "weld_min_order",
  thread: "thread",
  machining: "machining",
  engrave: "engrave",
  tubeCut: "tube_cut",
  handling: "handling",
} as const;

export type OperationLabelKey = (typeof OPERATION_LABELS)[keyof typeof OPERATION_LABELS];

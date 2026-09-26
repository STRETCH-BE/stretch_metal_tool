/**
 * pdf content (EN) — mirror of /content/pdf.ts.
 * File path: /content/en/pdf.ts
 */

import type { PdfContent } from "@/content/pdf";

export const pdf: PdfContent = {
  title: "Quotation",
  documentTitle: "Quotation {number}",
  meta: {
    number: "Quotation no.",
    version: "Version",
    date: "Date",
    validUntil: "Valid until",
    leadTime: "Lead time",
    currency: "Currency",
    preparedBy: "Prepared by",
    customer: "Customer",
    vatId: "VAT id",
    page: "Page {page} of {pages}",
  },
  company: {
    heading: "Supplier",
    nip: "VAT id (NIP)",
    regon: "REGON",
    krs: "KRS",
    phone: "Phone",
    email: "E-mail",
    web: "www",
  },
  parts: {
    heading: "Quoted items",
    columns: {
      position: "No.",
      thumbnail: "Drawing",
      name: "Part",
      material: "Material",
      thickness: "Thickness",
      qty: "Qty",
      unitPrice: "Unit price",
      total: "Total",
    },
    manualGeometry: "dimensions as described",
    noMaterial: "material to be confirmed",
  },
  operations: {
    heading: "Scope of operations",
    columns: { operation: "Operation", count: "Count" },
    types: {
      laser_cut: "Laser cutting",
      subcontract_cutting: "Cutting (subcontracted)",
      tube_cut: "Profile cutting",
      material: "Material",
      bend: "Bending",
      roll: "Rolling",
      weld: "Welding",
      thread: "Tapping",
      feature: "Hole features",
      machining: "Machining",
      finish_powder: "Powder coating",
      finish_zinc: "Zinc plating",
      finish_deburr: "Deburring",
      finish_other: "Finishing",
      engrave: "Engraving",
      handling: "Handling",
      setup: "Production setup",
      other: "Other",
    },
  },
  welding: {
    heading: "Welding",
    columns: { seam: "Seam", process: "Process", length: "Effective length", qty: "Qty" },
    processes: { mig_mag: "MIG/MAG", tig: "TIG", laser: "laser", mma: "MMA" },
    total: "Welding total",
    minOrderNote: "The minimum order value for welding work applies.",
  },
  totals: {
    net: "Total net",
    netNotice: "Prices are net, VAT excluded.", // [CONFIRM] VAT wording (23 % PL)
    partsSubtotal: "Parts subtotal",
    weldingSubtotal: "Welding subtotal",
  },
  terms: {
    heading: "Terms",
    validity: "This quotation is valid until {date}.",
    leadTime: "Lead time: {leadTime}.",
    payment: "Payment terms: {terms}",
    notes: "Notes",
    generic: "This quotation is not a binding offer; the order confirmation is binding.", // [CONFIRM] legal wording
  },
  footer: {
    bank: "Bank",
    iban: "IBAN",
    swift: "SWIFT",
    website: "www",
    generated: "Generated {date} · {app}",
    confirmNote: "Company data awaiting confirmation [CONFIRM]",
  },
  email: {
    subject: "Quotation {number} — {company}",
    greeting: "Dear Sir or Madam,",
    body: "please find attached our quotation {number} for {customer}. The quotation is valid until {validUntil}. Reply to this message with any questions.",
    closing: "Kind regards",
    signature: "{sender}\n{company}",
    attachmentNote: "Attachment: {file}",
  },
};

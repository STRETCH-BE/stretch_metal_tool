/**
 * pdf content (PL) — every string printed on the quote PDF and in the
 * quote e-mail. The EN mirror is /content/en/pdf.ts (parity test).
 * File path: /content/pdf.ts
 *
 * The PDF never prints cost or margin, so this dictionary has no such
 * keys on purpose. E-mail templates interpolate {number}, {customer},
 * {validUntil}, {company}, {sender}. Business wording awaiting the
 * owner's sign-off carries [CONFIRM].
 */

import type { OperationTypeCode, WeldProcessCode } from "@/content/quote";

export type PdfContent = {
  title: string;
  documentTitle: string;
  meta: {
    number: string;
    version: string;
    date: string;
    validUntil: string;
    leadTime: string;
    currency: string;
    preparedBy: string;
    customer: string;
    vatId: string;
    page: string;
  };
  company: {
    heading: string;
    nip: string;
    regon: string;
    krs: string;
    phone: string;
    email: string;
    web: string;
  };
  parts: {
    heading: string;
    columns: {
      position: string;
      thumbnail: string;
      name: string;
      material: string;
      thickness: string;
      qty: string;
      unitPrice: string;
      total: string;
    };
    manualGeometry: string;
    noMaterial: string;
  };
  operations: {
    heading: string;
    columns: { operation: string; count: string };
    types: Record<OperationTypeCode, string>;
  };
  welding: {
    heading: string;
    columns: { seam: string; process: string; length: string; qty: string };
    processes: Record<WeldProcessCode, string>;
    total: string;
    minOrderNote: string;
  };
  totals: {
    net: string;
    netNotice: string;
    partsSubtotal: string;
    weldingSubtotal: string;
  };
  terms: {
    heading: string;
    validity: string;
    leadTime: string;
    payment: string;
    notes: string;
    generic: string;
  };
  footer: {
    bank: string;
    iban: string;
    swift: string;
    website: string;
    generated: string;
    confirmNote: string;
  };
  email: {
    subject: string;
    greeting: string;
    body: string;
    closing: string;
    signature: string;
    attachmentNote: string;
  };
};

export const pdf: PdfContent = {
  title: "Oferta",
  documentTitle: "Oferta {number}",
  meta: {
    number: "Numer oferty",
    version: "Wersja",
    date: "Data",
    validUntil: "Ważna do",
    leadTime: "Termin realizacji",
    currency: "Waluta",
    preparedBy: "Ofertę przygotował",
    customer: "Klient",
    vatId: "NIP / VAT",
    page: "Strona {page} z {pages}",
  },
  company: {
    heading: "Wykonawca",
    nip: "NIP",
    regon: "REGON",
    krs: "KRS",
    phone: "Tel.",
    email: "E-mail",
    web: "www",
  },
  parts: {
    heading: "Pozycje oferty",
    columns: {
      position: "Lp.",
      thumbnail: "Rysunek",
      name: "Część",
      material: "Materiał",
      thickness: "Grubość",
      qty: "Ilość",
      unitPrice: "Cena / szt.",
      total: "Wartość",
    },
    manualGeometry: "wymiary wg opisu",
    noMaterial: "materiał do ustalenia",
  },
  operations: {
    heading: "Zakres operacji",
    columns: { operation: "Operacja", count: "Ilość" },
    types: {
      laser_cut: "Cięcie laserem",
      subcontract_cutting: "Cięcie (kooperacja)",
      tube_cut: "Cięcie profili",
      material: "Materiał",
      bend: "Gięcie",
      roll: "Walcowanie",
      weld: "Spawanie",
      thread: "Gwintowanie",
      feature: "Obróbka otworów",
      machining: "Obróbka skrawaniem",
      finish_powder: "Malowanie proszkowe",
      finish_zinc: "Cynkowanie",
      finish_deburr: "Gratowanie",
      finish_other: "Wykończenie",
      engrave: "Grawerowanie",
      handling: "Manipulacja",
      setup: "Przygotowanie produkcji",
      other: "Inne",
    },
  },
  welding: {
    heading: "Spawanie",
    columns: { seam: "Spoina", process: "Metoda", length: "Długość efektywna", qty: "Ilość" },
    processes: { mig_mag: "MIG/MAG", tig: "TIG", laser: "laser", mma: "MMA" },
    total: "Spawanie razem",
    minOrderNote: "Zastosowano minimalną wartość zlecenia spawalniczego.",
  },
  totals: {
    net: "Razem netto",
    netNotice: "Ceny netto, bez podatku VAT.", // [CONFIRM] VAT wording (23 % PL)
    partsSubtotal: "Części razem",
    weldingSubtotal: "Spawanie razem",
  },
  terms: {
    heading: "Warunki",
    validity: "Oferta ważna do {date}.",
    leadTime: "Termin realizacji: {leadTime}.",
    payment: "Warunki płatności: {terms}",
    notes: "Uwagi",
    generic: "Oferta nie stanowi oferty handlowej w rozumieniu art. 66 Kodeksu cywilnego; wiążące jest potwierdzenie zamówienia.", // [CONFIRM] legal wording
  },
  footer: {
    bank: "Bank",
    iban: "IBAN",
    swift: "SWIFT",
    website: "www",
    generated: "Wygenerowano {date} · {app}",
    confirmNote: "Dane firmy wymagają potwierdzenia [CONFIRM]",
  },
  email: {
    subject: "Oferta {number} — {company}",
    greeting: "Dzień dobry,",
    body: "w załączeniu przesyłamy ofertę {number} dla {customer}. Oferta jest ważna do {validUntil}. W razie pytań prosimy o odpowiedź na tę wiadomość.",
    closing: "Z poważaniem",
    signature: "{sender}\n{company}",
    attachmentNote: "Załącznik: {file}",
  },
};

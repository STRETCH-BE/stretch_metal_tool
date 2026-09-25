/**
 * quote content (PL) — quote builder + customers. The EN mirror is
 * /content/en/quote.ts and must keep the same keys (parity test).
 * File path: /content/quote.ts
 *
 * `customers` is owned by the customers module (list, form, quote
 * history); the quote builder extends this same file with its own keys.
 * Country labels live here (ISO 3166-1 alpha-2 keys) because the customer
 * country drives the default quote currency (PL → PLN, else EUR).
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

export type QuoteContent = {
  title: string;
  customers: CustomersContent;
};

export const quote: QuoteContent = {
  title: "Wycena",
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
      invalidCountry: "Wybierz kraj z listy.",
      invalidClass: "Wybierz klasę z listy.",
      invalidLocale: "Wybierz język z listy.",
      notFound: "Nie znaleziono klienta.",
      forbidden: "Brak uprawnień do tej operacji.",
      generic: "Nie udało się zapisać klienta. Spróbuj ponownie.",
    },
  },
};

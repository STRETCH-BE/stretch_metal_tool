/**
 * Common chrome content (PL) — app shell, navigation, generic actions,
 * statuses, roles, login. The EN mirror is /content/en/common.ts.
 * File path: /content/common.ts
 *
 * Components are copy-free: every visible string is looked up here.
 * Business facts awaiting confirmation carry `// [CONFIRM]`.
 */

export type CommonContent = {
  app: {
    name: string;
    logoAria: string;
    skipToContent: string;
    mainNav: string;
  };
  /** Shell chrome: sidebar menu button, topbar, breadcrumbs. */
  shell: {
    openMenu: string;
    closeMenu: string;
    menu: string;
    signedInAs: string;
    localeSwitcher: string;
    breadcrumbs: string;
    home: string;
    userMenu: string;
  };
  /** Generic UI primitives (modal, toast, confirm step, pagination, tabs). */
  ui: {
    close: string;
    dismiss: string;
    loading: string;
    confirmQuestion: string;
    confirmYes: string;
    confirmCancel: string;
    required: string;
    optional: string;
    dialog: string;
    notifications: string;
    tabs: string;
    emptyTitle: string;
    pagination: {
      label: string;
      prev: string;
      next: string;
      pageOf: string;
    };
    numberFormatHint: string;
  };
  currency: { PLN: string; EUR: string };
  nav: {
    quotes: string;
    newQuote: string;
    upload: string;
    customers: string;
    guide: string;
    admin: string;
    rates: string;
    machines: string;
    calculator: string;
    users: string;
    overrides: string;
    audit: string;
    signOut: string;
    groupWork: string;
    groupAdmin: string;
  };
  roles: { admin: string; sales: string; viewer: string };
  locales: { pl: string; en: string };
  actions: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    create: string;
    close: string;
    confirm: string;
    back: string;
    next: string;
    search: string;
    download: string;
    upload: string;
    apply: string;
    reset: string;
    duplicate: string;
    export: string;
    import: string;
    add: string;
    remove: string;
    yes: string;
    no: string;
    loading: string;
    saving: string;
    saved: string;
    retry: string;
    more: string;
    less: string;
    none: string;
    select: string;
    all: string;
  };
  status: {
    draft: string;
    pending_override: string;
    sent: string;
    won: string;
    lost: string;
  };
  severity: { green: string; amber: string; red: string };
  units: {
    mm: string;
    m: string;
    mm2: string;
    m2: string;
    kg: string;
    min: string;
    pcs: string;
    each: string;
    bend: string;
    pierce: string;
    h: string;
  };
  errors: {
    generic: string;
    notFound: string;
    forbidden: string;
    forbiddenBody: string;
    unauthenticated: string;
    supabaseNotConfigured: string;
    validation: string;
    network: string;
  };
  login: {
    eyebrow: string;
    title: string;
    lead: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    submit: string;
    magicLink: string;
    magicLinkHelp: string;
    magicLinkSent: string;
    invalid: string;
    callbackFailed: string;
    magicLinkFailed: string;
    forgot: string;
    help: string;
    notConfigured: string;
  };
  placeholder: {
    badge: string;
    tooltip: string;
  };
  empty: {
    quotes: string;
    parts: string;
    customers: string;
    generic: string;
  };
  table: {
    rowsPerPage: string;
    of: string;
    noResults: string;
    results: string;
    searchPlaceholder: string;
    page: string;
    actions: string;
  };
};

export const common: CommonContent = {
  app: {
    name: "StretchMetal Quote",
    logoAria: "StretchMetal Quote — strona główna",
    skipToContent: "Przejdź do treści",
    mainNav: "Nawigacja główna",
  },
  shell: {
    openMenu: "Otwórz menu",
    closeMenu: "Zamknij menu",
    menu: "Menu",
    signedInAs: "Zalogowano jako",
    localeSwitcher: "Język interfejsu",
    breadcrumbs: "Ścieżka",
    home: "Start",
    userMenu: "Użytkownik",
  },
  ui: {
    close: "Zamknij",
    dismiss: "Ukryj powiadomienie",
    loading: "Ładowanie",
    confirmQuestion: "Na pewno?",
    confirmYes: "Tak, wykonaj",
    confirmCancel: "Anuluj",
    required: "wymagane",
    optional: "opcjonalnie",
    dialog: "Okno dialogowe",
    notifications: "Powiadomienia",
    tabs: "Zakładki",
    emptyTitle: "Brak danych",
    pagination: {
      label: "Stronicowanie",
      prev: "Poprzednia strona",
      next: "Następna strona",
      pageOf: "Strona {page} z {pageCount}",
    },
    numberFormatHint: "Liczby: 1 234,56 lub 1234.56",
  },
  currency: { PLN: "PLN", EUR: "EUR" },
  nav: {
    quotes: "Wyceny",
    newQuote: "Nowa wycena",
    upload: "Wgraj pliki",
    customers: "Klienci",
    guide: "Instrukcja eksportu",
    admin: "Administracja",
    rates: "Cenniki",
    machines: "Maszyny",
    calculator: "Kalkulator maszynogodziny",
    users: "Użytkownicy",
    overrides: "Odstępstwa",
    audit: "Dziennik zmian",
    signOut: "Wyloguj",
    groupWork: "Praca",
    groupAdmin: "Administracja",
  },
  roles: { admin: "Administrator", sales: "Sprzedaż", viewer: "Podgląd" },
  locales: { pl: "Polski", en: "English" },
  actions: {
    save: "Zapisz",
    cancel: "Anuluj",
    delete: "Usuń",
    edit: "Edytuj",
    create: "Utwórz",
    close: "Zamknij",
    confirm: "Potwierdź",
    back: "Wstecz",
    next: "Dalej",
    search: "Szukaj",
    download: "Pobierz",
    upload: "Wgraj",
    apply: "Zastosuj",
    reset: "Resetuj",
    duplicate: "Duplikuj",
    export: "Eksportuj",
    import: "Importuj",
    add: "Dodaj",
    remove: "Usuń",
    yes: "Tak",
    no: "Nie",
    loading: "Ładowanie…",
    saving: "Zapisywanie…",
    saved: "Zapisano",
    retry: "Spróbuj ponownie",
    more: "Więcej",
    less: "Mniej",
    none: "Brak",
    select: "Wybierz",
    all: "Wszystkie",
  },
  status: {
    draft: "Szkic",
    pending_override: "Oczekuje na odstępstwo",
    sent: "Wysłana",
    won: "Wygrana",
    lost: "Przegrana",
  },
  severity: { green: "OK", amber: "Uwaga", red: "Blokada" },
  units: {
    mm: "mm",
    m: "m",
    mm2: "mm²",
    m2: "m²",
    kg: "kg",
    min: "min",
    pcs: "szt.",
    each: "szt.",
    bend: "gięcie",
    pierce: "przebicie",
    h: "h",
  },
  errors: {
    generic: "Coś poszło nie tak. Spróbuj ponownie.",
    notFound: "Nie znaleziono strony.",
    forbidden: "Brak uprawnień",
    forbiddenBody:
      "Twoje konto nie ma dostępu do tej sekcji. Skontaktuj się z administratorem.",
    unauthenticated: "Zaloguj się, aby kontynuować.",
    supabaseNotConfigured:
      "Brak konfiguracji Supabase — ustaw zmienne środowiskowe (patrz README).",
    validation: "Sprawdź zaznaczone pola.",
    network: "Błąd połączenia. Sprawdź sieć i spróbuj ponownie.",
  },
  login: {
    eyebrow: "Narzędzie wycen",
    title: "Logowanie",
    lead: "Narzędzie wycen StretchMetal. Dostęp tylko dla pracowników.",
    email: "E-mail",
    emailPlaceholder: "imie.nazwisko@stretchmetal.pl",
    password: "Hasło",
    passwordPlaceholder: "Hasło",
    submit: "Zaloguj",
    magicLink: "Wyślij link logowania",
    magicLinkHelp:
      "Bez hasła: podaj e-mail i wyślij link — logowanie jednym kliknięciem z wiadomości.",
    magicLinkSent: "Link logowania został wysłany na podany adres.",
    invalid: "Nieprawidłowy e-mail lub hasło.",
    callbackFailed:
      "Link logowania wygasł lub jest nieprawidłowy. Poproś o nowy.",
    magicLinkFailed: "Nie udało się wysłać linku. Sprawdź adres e-mail.",
    forgot: "Nie pamiętasz hasła?",
    help: "Konto zakłada administrator w sekcji Użytkownicy.",
    notConfigured:
      "Logowanie jest wyłączone: brak konfiguracji Supabase na tym środowisku.",
  },
  placeholder: {
    badge: "Wartość tymczasowa",
    tooltip:
      "Ta stawka jest wartością zastępczą [CONFIRM] — edytuj ją, aby potwierdzić.",
  },
  empty: {
    quotes: "Brak wycen. Utwórz pierwszą wycenę.",
    parts: "Brak części. Wgraj plik DXF lub dodaj część ręcznie.",
    customers: "Brak klientów.",
    generic: "Brak danych.",
  },
  table: {
    rowsPerPage: "Wierszy na stronę",
    of: "z",
    noResults: "Brak wyników.",
    results: "{count} wyników",
    searchPlaceholder: "Szukaj…",
    page: "Strona",
    actions: "Akcje",
  },
};

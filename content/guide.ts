/**
 * guide content (PL) — the public DXF export guide (/guide): why a flat
 * pattern, per-CAD export steps, the recognised layer names, the
 * checklist, the PDF companion and the example DXF. The EN mirror is
 * /content/en/guide.ts and must keep the same keys (parity test).
 * File path: /content/guide.ts
 *
 * The layer table itself is generated from lib/geometry
 * DEFAULT_LAYER_CONVENTIONS in the page — only the role labels live here.
 */

export type CadSystemKey = "inventor" | "solidworks" | "fusion" | "autocad" | "dwg";

export type GuideContent = {
  title: string;
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    lead: string;
    downloadExample: string;
    login: string;
    website: string;
  };
  why: { eyebrow: string; title: string; body: string; points: string[] };
  cad: {
    eyebrow: string;
    title: string;
    intro: string;
    systems: { key: CadSystemKey; name: string; steps: string[]; note: string | null }[];
  };
  layers: {
    eyebrow: string;
    title: string;
    intro: string;
    columns: { role: string; layers: string };
    roles: { bendUp: string; bendDown: string; ignore: string; engrave: string; weld: string; cut: string };
    prefixNote: string;
    caseNote: string;
  };
  checklist: { eyebrow: string; title: string; items: string[] };
  pdf: { eyebrow: string; title: string; body: string; items: string[] };
  example: { eyebrow: string; title: string; body: string; download: string; fileName: string };
  footer: { login: string; loginHelp: string; back: string };
};

export const guide: GuideContent = {
  title: "Instrukcja eksportu DXF",
  meta: {
    title: "Jak przygotować DXF do wyceny",
    description: "Eksport rozwinięcia 1:1 z Inventora, SolidWorks, Fusion 360 i AutoCAD-a, rozpoznawane nazwy warstw, lista kontrolna i przykładowy plik.",
  },
  hero: {
    eyebrow: "Instrukcja",
    title: "Dobry DXF to",
    titleAccent: "wycena w minutę.",
    lead: "Narzędzie wycen StretchMetal czyta rozwinięcie blachy prosto z pliku: obrys, otwory, linie gięcia. Jeden plik = jedna część, skala 1:1 w milimetrach, linie gięcia na nazwanych warstwach — i wycena liczy się sama.",
    downloadExample: "Pobierz przykładowy DXF",
    login: "Zaloguj się do narzędzia",
    website: "stretchmetal.pl",
  },
  why: {
    eyebrow: "Dlaczego rozwinięcie",
    title: "Rozwinięcie, nie rysunek",
    body: "Laser tnie płaską blachę, więc do wyceny potrzebujemy rozwinięcia (flat pattern), a nie rysunku warsztatowego z widokami i wymiarami. Z rozwinięcia liczymy długość cięcia, liczbę przebić, masę i półfabrykat; z linii gięcia — liczbę gięć i siłę na prasie.",
    points: [
      "Skala 1:1 w milimetrach — bez przeskalowanych widoków.",
      "Tylko geometria: bez wymiarów, tabelki rysunkowej, ramki i tekstów.",
      "Jedna część na plik; zestawy wgraj jako osobne pliki.",
      "Linie gięcia na warstwie o nazwie z tabeli poniżej — wtedy rozpoznajemy je automatycznie.",
      "Kąty gięcia, gwinty, wykończenie i ilość podaj w załączonym PDF o tej samej nazwie.",
    ],
  },
  cad: {
    eyebrow: "Eksport z CAD",
    title: "Krok po kroku",
    intro: "Każdy z popularnych systemów CAD eksportuje rozwinięcie do DXF. Poniżej ścieżki, które sprawdziliśmy — po eksporcie otwórz plik w przeglądarce DXF i upewnij się, że widać sam obrys z liniami gięcia.",
    systems: [
      {
        key: "inventor",
        name: "Autodesk Inventor",
        steps: [
          "Otwórz część blaszaną i przejdź do trybu Flat Pattern (Rozwinięcie).",
          "Plik → Save Copy As (Zapisz kopię jako) → format DXF.",
          "W opcjach eksportu zaznacz warstwy Bend Up / Bend Down (IV_BEND, IV_BEND_DOWN) i Outer / Interior Profiles; wyłącz Tangent Lines i Arc Centers albo zostaw je — są ignorowane.",
          "Wersja pliku: AutoCAD 2018 (AC1032) lub 2004; jednostki milimetry.",
        ],
        note: "Inventor zapisuje warstwy IV_OUTER_PROFILE, IV_INTERIOR_PROFILES, IV_BEND i IV_BEND_DOWN — to nasz przypadek wzorcowy, nic nie trzeba zmieniać.",
      },
      {
        key: "solidworks",
        name: "SolidWorks",
        steps: [
          "W drzewie części kliknij prawym na Flat-Pattern (Rozwinięcie) → Export to DXF/DWG.",
          "W oknie DXF/DWG Output wybierz Sheet metal, zaznacz Geometry i Bend lines; odznacz Sketches, Library features i Forming tools.",
          "Output alignment: bez lustrzanego odbicia; jednostki mm; wersja R2013 lub R14.",
          "Zapisz jako .dxf (nie .dwg).",
        ],
        note: "SolidWorks umieszcza linie gięcia na warstwie BEND LINES / BENDLINES — obie nazwy rozpoznajemy.",
      },
      {
        key: "fusion",
        name: "Autodesk Fusion 360",
        steps: [
          "Sheet Metal → Create Flat Pattern (Utwórz rozwinięcie).",
          "W trybie rozwinięcia: Export Flat Pattern as DXF.",
          "W opcjach zaznacz Bend lines (linie gięcia) i Bend extents jeśli dostępne; ustaw jednostki na mm.",
          "Zapisz plik i sprawdź, czy obrys jest zamknięty.",
        ],
        note: "Fusion zapisuje linie gięcia na warstwie BEND / BEND_UP i BEND_DOWN.",
      },
      {
        key: "autocad",
        name: "AutoCAD i inne 2D",
        steps: [
          "Narysuj rozwinięcie w skali 1:1 w milimetrach na warstwie CUT lub 0.",
          "Linie gięcia umieść na warstwie BEND (gięcie w górę) lub BEND_DOWN (gięcie w dół), jako pojedyncze linie od krawędzi do krawędzi.",
          "Usuń ramkę, tabelkę, wymiary i teksty albo zostaw je na warstwach DIM*, TEXT*, FRAME, TITLE* — są pomijane.",
          "Zapisz jako → DXF (AutoCAD 2018 ASCII DXF lub R12/LT2 DXF).",
        ],
        note: "Ustaw zmienną INSUNITS = 4 (milimetry); bez tego zapytamy o potwierdzenie jednostek.",
      },
      {
        key: "dwg",
        name: "Masz tylko DWG?",
        steps: [
          "Otwórz plik w AutoCAD, DraftSight, LibreCAD lub innym edytorze DWG.",
          "Plik → Zapisz jako → typ pliku „AutoCAD DXF” (ASCII).",
          "Wgraj plik .dxf — DWG nie jest czytany przez narzędzie.",
        ],
        note: "Binarny DXF również nie jest obsługiwany — wybierz wariant ASCII.",
      },
    ],
  },
  layers: {
    eyebrow: "Warstwy",
    title: "Rozpoznawane nazwy warstw",
    intro: "Nazwa warstwy decyduje o roli linii, zanim uruchomią się heurystyki geometrii. Wielkość liter nie ma znaczenia. Wszystko, czego nie ma w tabeli, trafia do cięcia (kontury zamknięte) albo do pytania „te linie to gięcie, grawer czy cięcie?” (linie otwarte wewnątrz obrysu).",
    columns: { role: "Rola", layers: "Nazwy warstw" },
    roles: {
      bendUp: "Gięcie w górę",
      bendDown: "Gięcie w dół",
      ignore: "Ignorowane",
      engrave: "Grawer / znakowanie",
      weld: "Spoina",
      cut: "Cięcie",
    },
    prefixNote: "Gwiazdka oznacza prefiks: DIM* pasuje do DIM, DIMENSIONS, DIM_1.",
    caseNote: "Warstwa 0 (domyślna AutoCAD-a) jest traktowana jako cięcie.",
  },
  checklist: {
    eyebrow: "Lista kontrolna",
    title: "Zanim wyślesz plik",
    items: [
      "Skala 1:1, jednostki milimetry ($INSUNITS = 4).",
      "Tylko rozwinięcie — bez widoków złożonych, izometrii i przekrojów.",
      "Bez wymiarów, tabelki, ramki i tekstów (albo na ignorowanych warstwach).",
      "Jedna część na plik; nazwa pliku = numer części.",
      "Obrys zamknięty — linie łączą się końcami (tolerancja 0,01 mm).",
      "Linie gięcia na warstwie BEND / BEND_UP / BEND_DOWN, od krawędzi do krawędzi.",
      "PDF z kątami gięcia, gwintami, wykończeniem i ilością — o tej samej nazwie co DXF.",
    ],
  },
  pdf: {
    eyebrow: "Rysunek PDF",
    title: "Dołącz PDF",
    body: "Z rysunku PDF o tej samej nazwie co DXF (np. 200005.pdf i 200005.dxf) odczytujemy tabelkę i adnotacje. Każda odczytana wartość jest tylko podpowiedzią — handlowiec ją zatwierdza.",
    items: [
      "Materiał i grubość (np. S355, 15 mm) z tabelki rysunkowej.",
      "Kąty i kierunki gięcia.",
      "Gwinty (M8, M10×1) i ich liczba.",
      "Wykończenie: malowanie proszkowe z numerem RAL, cynkowanie, gratowanie.",
      "Ilość sztuk i masa części.",
    ],
  },
  example: {
    eyebrow: "Przykład",
    title: "Przykładowy DXF",
    body: "Wspornik 200 × 120 mm, grubość 3 mm: obrys z promieniami R5 na warstwie CUT, cztery otwory pod M8 na HOLES, jedno gięcie w górę i jedno w dół, linia graweru i spoina. Otwórz go w swoim CAD, żeby zobaczyć, jak powinien wyglądać plik do wyceny.",
    download: "Pobierz stretchmetal-example.dxf",
    fileName: "stretchmetal-example.dxf",
  },
  footer: {
    login: "Zaloguj się",
    loginHelp: "Narzędzie wycen jest dostępne dla pracowników StretchMetal. Klient wysyła pliki mailem lub przez formularz na stronie.",
    back: "Wróć do narzędzia",
  },
};

/**
 * Viewer content (PL) — tool names, tooltips, layer names, role names,
 * form labels, readout labels and hints of the drawing viewer/editor.
 * The EN mirror is /content/en/viewer.ts and must keep the same keys
 * (content/parity.test.ts).
 * File path: /content/viewer.ts
 *
 * Key glyphs shown next to the tools ("V", "Esc") are not copy — they
 * live in lib/viewer/keyboard.ts. Templates use `{name}` placeholders
 * for lib/format interpolate().
 */

import type { EntityRole, WeldProcess } from "@/lib/geometry/types";
import type { ViewerAction } from "@/lib/viewer/keyboard";

export type ViewerLayerKey =
  | "cut"
  | "holes"
  | "bendUp"
  | "bendDown"
  | "weld"
  | "engrave"
  | "ignored"
  | "candidates"
  | "grid"
  | "snap";

export type ViewerContent = {
  title: string;
  /** aria-label of the SVG canvas (role="application"). */
  canvasLabel: string;
  toolbarLabel: string;
  layersLabel: string;
  readOnly: string;
  tools: Record<ViewerAction, string>;
  tooltips: Record<ViewerAction, string>;
  layers: Record<ViewerLayerKey, string>;
  roles: Record<EntityRole, string>;
  readout: {
    x: string;
    y: string;
    zoom: string;
    outside: string;
    /** "{count} elem. · {length} mm" */
    selection: string;
    noSelection: string;
    /** "{count} elem." */
    entities: string;
    gridStep: string;
    /** "Podświetlony {index}/{count}: {role}" — keyboard focus cursor. */
    focused: string;
  };
  measures: {
    title: string;
    cutLength: string;
    pierces: string;
    bends: string;
    weldLength: string;
    bbox: string;
    mass: string;
    unknown: string;
  };
  hints: {
    select: string;
    tag: string;
    bendFirst: string;
    bendSecond: string;
    weldEntities: string;
    weldPoints: string;
    calibrateFirst: string;
    calibrateSecond: string;
    cleanup: string;
    pan: string;
    zoom: string;
    shiftClick: string;
    lasso: string;
    cancel: string;
    deleteKey: string;
    arrows: string;
    /** Keyboard selection / picking on the focused canvas. */
    cycle: string;
    enterSelect: string;
    enterPick: string;
    selectAll: string;
  };
  /** Typed point entry in the point-pick panels (keyboard alternative to clicking). */
  point: { title: string; x: string; y: string; add: string; clear: string };
  snapKinds: { endpoint: string; midpoint: string; center: string; perpendicular: string };
  tag: {
    title: string;
    /** "{count} zaznaczonych" */
    selection: string;
    none: string;
    apply: string;
    clearOverride: string;
  };
  bend: {
    title: string;
    angle: string;
    radius: string;
    direction: string;
    up: string;
    down: string;
    dieV: string;
    dieVHelp: string;
    length: string;
    add: string;
    drawn: string;
    empty: string;
    remove: string;
    picked: string;
  };
  weld: {
    title: string;
    mode: string;
    modeEntities: string;
    modePoints: string;
    process: string;
    processes: Record<WeldProcess, string>;
    bead: string;
    pattern: string;
    full: string;
    stitch: string;
    beadLength: string;
    pitch: string;
    sides: string;
    sidesOne: string;
    sidesTwo: string;
    length: string;
    effective: string;
    add: string;
    list: string;
    empty: string;
    remove: string;
    needSelection: string;
    pitchRequired: string;
  };
  roll: {
    title: string;
    hint: string;
    inputMode: string;
    radius: string;
    diameter: string;
    axis: string;
    axisX: string;
    axisY: string;
    arcAngle: string;
    axisLength: string;
    developedWidth: string;
    coneDetected: string;
    coneNone: string;
    coneInner: string;
    coneOuter: string;
    coneSweep: string;
    apply: string;
    clear: string;
    current: string;
    radiusRequired: string;
  };
  calibrate: {
    title: string;
    measured: string;
    real: string;
    factor: string;
    resultBbox: string;
    apply: string;
    current: string;
    reset: string;
    none: string;
  };
  cleanup: {
    title: string;
    keepLargest: string;
    keepLargestHelp: string;
    deleteSelection: string;
    ignoreSelection: string;
    join: string;
    joinTolerance: string;
    joinApply: string;
    joinHelp: string;
    mirror: string;
    mirrorOn: string;
    split: string;
    splitHelp: string;
    restoreDeleted: string;
    /** "{count} usuniętych" */
    deletedCount: string;
    needSelection: string;
  };
  export: { label: string; tooltip: string };
  units: { mm: string; deg: string; kg: string; percent: string };
  legend: { title: string; shiftClick: string; spaceDrag: string; wheel: string; lasso: string; arrows: string };
};

export const viewer: ViewerContent = {
  title: "Podgląd rysunku",
  canvasLabel: "Rysunek części — obszar roboczy edytora",
  toolbarLabel: "Narzędzia edytora",
  layersLabel: "Warstwy",
  readOnly: "Tylko podgląd",
  tools: {
    select: "Zaznacz",
    tag: "Oznacz",
    bend: "Linia gięcia",
    weld: "Spoina",
    roll: "Zwijanie",
    calibrate: "Kalibruj",
    cleanup: "Porządki",
    export: "Eksport DXF",
    fit: "Dopasuj",
    zoomIn: "Powiększ",
    zoomOut: "Pomniejsz",
    reset: "100 %",
    cancel: "Anuluj",
    delete: "Usuń zaznaczenie",
  },
  tooltips: {
    select: "Zaznaczanie: klik, Shift+klik dodaje, przeciągnięcie zaznacza obszarem",
    tag: "Nadaj zaznaczonym elementom rolę: cięcie, gięcie, spoina, grawer, ignoruj",
    bend: "Narysuj linię gięcia dwoma kliknięciami z przyciąganiem do konturu",
    weld: "Dodaj spoinę na zaznaczonych krawędziach lub między dwoma punktami",
    roll: "Zwijanie całej części: promień, oś, kąt łuku",
    calibrate: "Kalibracja jednostek: dwa punkty i rzeczywista odległość",
    cleanup: "Porządki: zostaw największy kontur, usuń, ignoruj, złącz, lustro, podziel",
    export: "Pobierz DXF z warstwami produkcyjnymi",
    fit: "Dopasuj widok do części",
    zoomIn: "Powiększ",
    zoomOut: "Pomniejsz",
    reset: "Widok 1:1 (100 %)",
    cancel: "Przerwij bieżące narzędzie",
    delete: "Usuń zaznaczone elementy z wyceny",
  },
  layers: {
    cut: "Cięcie",
    holes: "Otwory",
    bendUp: "Gięcie w górę",
    bendDown: "Gięcie w dół",
    weld: "Spoiny",
    engrave: "Grawer",
    ignored: "Ignorowane",
    candidates: "Kandydaci",
    grid: "Siatka",
    snap: "Przyciąganie",
  },
  roles: {
    cut: "Cięcie",
    hole: "Otwór",
    bend_up: "Gięcie w górę",
    bend_down: "Gięcie w dół",
    weld: "Spoina",
    engrave: "Grawer",
    ignore: "Ignoruj",
    unknown: "Kandydat",
  },
  readout: {
    x: "X",
    y: "Y",
    zoom: "Zoom",
    outside: "poza rysunkiem",
    selection: "{count} elem. · {length} mm",
    noSelection: "Brak zaznaczenia",
    entities: "{count} elem.",
    gridStep: "Siatka {step} mm",
    focused: "Podświetlony {index}/{count}: {role}",
  },
  measures: {
    title: "Pomiary",
    cutLength: "Długość cięcia",
    pierces: "Przebicia",
    bends: "Gięcia",
    weldLength: "Spoiny (efekt.)",
    bbox: "Gabaryt",
    mass: "Masa",
    unknown: "—",
  },
  hints: {
    select: "Kliknij element, Shift+klik dodaje do zaznaczenia, przeciągnij, aby zaznaczyć obszar.",
    tag: "Zaznacz elementy, potem wybierz rolę.",
    bendFirst: "Kliknij pierwszy punkt linii gięcia.",
    bendSecond: "Kliknij drugi punkt — przyciąganie do końców, środków i prostopadle do krawędzi.",
    weldEntities: "Kliknij krawędzie tworzące spoinę (Shift+klik dodaje), potem uzupełnij formularz.",
    weldPoints: "Kliknij początek i koniec spoiny.",
    calibrateFirst: "Kliknij pierwszy punkt znanego wymiaru.",
    calibrateSecond: "Kliknij drugi punkt, potem wpisz rzeczywistą odległość.",
    cleanup: "Wybierz operację porządkową. Operacje na zaznaczeniu wymagają zaznaczonych elementów.",
    pan: "Przesuwanie: środkowy przycisk lub Spacja + przeciągnięcie.",
    zoom: "Zoom: kółko myszy, + / −, F dopasowuje.",
    shiftClick: "Shift+klik dodaje do zaznaczenia.",
    lasso: "Przeciągnięcie zaznacza elementy w całości wewnątrz prostokąta.",
    cancel: "Esc przerywa narzędzie.",
    deleteKey: "Delete usuwa zaznaczenie z wyceny.",
    arrows: "Strzałki przesuwają widok (Shift: szybciej).",
    cycle: "przechodzi po elementach.",
    enterSelect: "zaznacza podświetlony element (Shift: dodaje).",
    enterPick: "wstawia oba końce podświetlonego elementu jako punkty.",
    selectAll: "zaznacza wszystkie widoczne.",
  },
  point: {
    title: "Wpisz punkt",
    x: "X",
    y: "Y",
    add: "Dodaj punkt",
    clear: "Wyczyść punkty",
  },
  snapKinds: {
    endpoint: "koniec",
    midpoint: "środek",
    center: "środek okręgu",
    perpendicular: "prostopadle",
  },
  tag: {
    title: "Oznacz zaznaczone",
    selection: "{count} zaznaczonych",
    none: "Najpierw zaznacz elementy na rysunku.",
    apply: "Zastosuj",
    clearOverride: "Cofnij oznaczenie",
  },
  bend: {
    title: "Gięcie",
    angle: "Kąt",
    radius: "Promień wewnętrzny",
    direction: "Kierunek",
    up: "W górę",
    down: "W dół",
    dieV: "Rozwarcie matrycy V",
    dieVHelp: "Opcjonalnie — domyślnie 8 × grubość",
    length: "Długość",
    add: "Dodaj linię gięcia",
    drawn: "Narysowane linie gięcia",
    empty: "Brak narysowanych linii gięcia.",
    remove: "Usuń",
    picked: "Punkty",
  },
  weld: {
    title: "Spoina",
    mode: "Sposób wskazania",
    modeEntities: "Krawędzie",
    modePoints: "Dwa punkty",
    process: "Metoda",
    processes: { mig_mag: "MIG/MAG", tig: "TIG", laser: "Laser", mma: "MMA (elektroda)" },
    bead: "Grubość spoiny",
    pattern: "Rodzaj",
    full: "Ciągła",
    stitch: "Przerywana",
    beadLength: "Długość odcinka",
    pitch: "Podziałka",
    sides: "Strony",
    sidesOne: "1 strona",
    sidesTwo: "2 strony",
    length: "Długość geometryczna",
    effective: "Długość efektywna",
    add: "Dodaj spoinę",
    list: "Spoiny",
    empty: "Brak spoin.",
    remove: "Usuń",
    needSelection: "Zaznacz krawędzie lub wskaż dwa punkty.",
    pitchRequired: "Podziałka musi być większa od zera.",
  },
  roll: {
    title: "Zwijanie części",
    hint: "Zwijanie dotyczy całej części. Oś zwijania to wymiar prosty, szerokość rozwinięcia — wymiar zakrzywiony.",
    inputMode: "Podaj",
    radius: "Promień",
    diameter: "Średnica",
    axis: "Oś zwijania",
    axisX: "X",
    axisY: "Y",
    arcAngle: "Kąt łuku",
    axisLength: "Długość osi",
    developedWidth: "Szerokość rozwinięcia",
    coneDetected: "Wykryto rozwinięcie stożka (wycinek pierścienia)",
    coneNone: "Kontur nie jest wycinkiem pierścienia — wartości z gabarytu.",
    coneInner: "Promień wewnętrzny",
    coneOuter: "Promień zewnętrzny",
    coneSweep: "Kąt wycinka",
    apply: "Zapisz zwijanie",
    clear: "Usuń zwijanie",
    current: "Zwijanie: R {radius} mm, oś {axis}, {angle}°",
    radiusRequired: "Podaj promień lub średnicę większą od zera.",
  },
  calibrate: {
    title: "Kalibracja jednostek",
    measured: "Zmierzono",
    real: "Rzeczywista odległość",
    factor: "Współczynnik",
    resultBbox: "Gabaryt po kalibracji",
    apply: "Zastosuj skalę",
    current: "Skala: × {factor}",
    reset: "Usuń skalę",
    none: "Bez kalibracji (× 1)",
  },
  cleanup: {
    title: "Porządki",
    keepLargest: "Zostaw największy kontur i otwory",
    keepLargestHelp: "Usuwa z wyceny wszystko poza konturem zewnętrznym, jego otworami i liniami wewnątrz.",
    deleteSelection: "Usuń zaznaczenie",
    ignoreSelection: "Ignoruj zaznaczenie",
    join: "Złącz w tolerancji",
    joinTolerance: "Tolerancja",
    joinApply: "Złącz",
    joinHelp: "Łączy końce w podanej tolerancji (0,01–0,5 mm); ponowna analiza na serwerze.",
    mirror: "Lustro (X)",
    mirrorOn: "Część odbita lustrzanie",
    split: "Podziel na części",
    splitHelp: "Każdy zamknięty kontur zewnętrzny staje się osobną częścią.",
    restoreDeleted: "Przywróć usunięte",
    deletedCount: "{count} usuniętych",
    needSelection: "Wymaga zaznaczenia.",
  },
  export: { label: "Eksport DXF", tooltip: "Pobierz DXF z warstwami CUT, HOLES, BEND_UP, BEND_DOWN, WELD, ENGRAVE, IGNORE" },
  units: { mm: "mm", deg: "°", kg: "kg", percent: "%" },
  legend: {
    title: "Skróty",
    shiftClick: "Shift + klik",
    spaceDrag: "Spacja + przeciągnij",
    wheel: "Kółko",
    lasso: "Przeciągnij",
    arrows: "Strzałki",
  },
};

// WORLD GP — dane gry: zespoły, kierowcy, tor, punktacja.
var PG = (typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));

// Wersja gry: widoczna w menu; w multiplayer host przyjmuje tylko graczy z tą samą wersją. Zmieniaj przy każdej
// aktualizacji razem z ?v= w znacznikach <script> w index.html (wtedy przeglądarka nie użyje starych plików z pamięci).
PG.VERSION = '2026.10.13.3';

// Tor Monza: oś toru odczytana z rzeczywistej geometrii (GeoJSON bacinger/f1-circuits, it-1922),
// przeliczona na metry względem linii mety. Kierunek jazdy zgodny z ruchem wskazówek zegara.
PG.MONZA = {
  name: 'Autodromo Nazionale Monza',
  short: 'Monza',
  country: 'IT',
  halfWidth: 6.5,
  points: [[0.0, -0.0], [36.5, -426.4], [53.1, -605.1], [54.9, -612.4], [60.0, -616.6], [66.4, -617.6], [74.3, -616.6], [81.7, -616.0], [88.5, -616.6], [93.2, -620.2], [96.9, -625.4], [97.8, -630.1], [97.8, -635.3], [71.9, -732.8], [68.3, -759.3], [66.9, -783.3], [68.7, -809.4], [78.4, -936.5], [82.1, -957.3], [86.7, -976.6], [93.7, -997.4], [102.9, -1019.8], [113.4, -1041.7], [129.1, -1066.3], [145.2, -1086.5], [166.9, -1109.5], [190.4, -1129.8], [216.7, -1148.5], [244.8, -1164.6], [276.6, -1180.3], [308.4, -1191.3], [343.4, -1201.1], [383.1, -1208.0], [423.6, -1211.6], [581.7, -1225.1], [775.2, -1236.6], [786.8, -1237.6], [792.8, -1240.8], [797.8, -1246.0], [804.2, -1268.4], [807.0, -1274.6], [811.6, -1278.8], [819.5, -1281.4], [845.7, -1286.1], [874.3, -1292.3], [914.8, -1305.4], [1095.9, -1365.8], [1111.6, -1369.5], [1126.4, -1369.5], [1140.6, -1366.8], [1150.8, -1362.7], [1160.5, -1357.0], [1169.7, -1350.7], [1181.2, -1338.2], [1187.7, -1328.4], [1192.3, -1316.3], [1194.6, -1302.8], [1202.4, -1217.4], [1217.2, -1071.5], [1216.7, -1058.4], [1214.4, -1050.0], [1210.7, -1042.7], [1204.7, -1037.5], [1193.7, -1030.2], [1075.2, -966.7], [978.9, -913.1], [919.0, -880.2], [889.9, -863.5], [857.2, -840.7], [833.7, -822.9], [813.5, -805.2], [708.4, -715.5], [633.8, -648.3], [476.1, -510.8], [381.2, -427.9], [368.3, -414.9], [363.2, -406.6], [362.3, -398.3], [362.3, -388.3], [365.5, -366.4], [366.5, -354.5], [366.5, -337.3], [365.1, -327.9], [361.3, -315.9], [355.8, -301.9], [346.6, -287.7], [334.2, -273.1], [319.9, -261.2], [308.4, -252.4], [302.4, -245.5], [297.8, -236.2], [293.6, -219.0], [284.0, -140.3], [273.8, -56.4], [195.5, 696.0], [192.2, 723.0], [189.0, 735.6], [182.6, 748.6], [173.8, 759.1], [163.7, 768.5], [149.4, 777.8], [133.8, 783.5], [115.8, 786.7], [100.5, 785.6], [86.3, 782.5], [69.7, 776.2], [53.6, 768.9], [41.6, 760.6], [27.3, 749.7], [11.1, 732.4], [0.1, 716.9], [-9.6, 700.2], [-17.9, 680.4], [-25.7, 658.5], [-31.7, 636.0], [-34.5, 616.8], [-37.7, 587.6], [-38.2, 558.4], [-38.6, 530.8], [-40.0, 476.1], [-41.0, 428.1], [-40.0, 376.1], [-34.0, 307.9], [-11.4, 92.1]],
  // nazwy zakrętów: indeks punktu, od którego zaczyna się dany fragment
  marks: [
    { name: 'Variante del Rettifilo', p: 2, type: 'A' },
    { name: 'Curva Biassono', p: 17, type: 'A' },
    { name: 'Variante della Roggia', p: 35, type: 'A' },
    { name: 'Curva di Lesmo 1', p: 46, type: 'A' },
    { name: 'Curva di Lesmo 2', p: 58, type: 'A' },
    { name: 'Rettifilo Serraglio', p: 63, type: 'S' },
    { name: 'Variante Ascari', p: 74, type: 'A' },
    { name: 'Rettifilo Centrale', p: 91, type: 'S' },
    { name: 'Curva Alboreto (Parabolica)', p: 94, type: 'A' },
    { name: 'Rettifilo Tribune', p: 117, type: 'S' }
  ],
  // dodatkowe wygładzenie zgrubnych danych w zakrętach: [od punktu, do punktu, liczba przejść]
  smooth: [[2, 13, 12], [16, 34, 40], [34, 45, 14], [45, 57, 120], [57, 64, 220], [73, 91, 140], [93, 118, 160]]
};

PG.POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

PG.NATIONS = {
  PL: { name: 'Polska', flag: ['h', '#ffffff', '#dc143c'] },
  IT: { name: 'Włochy', flag: ['v', '#009246', '#ffffff', '#ce2b37'] },
  GB: { name: 'Wielka Brytania', flag: ['gb'] },
  DE: { name: 'Niemcy', flag: ['h', '#111111', '#dd0000', '#ffce00'] },
  FR: { name: 'Francja', flag: ['v', '#0055a4', '#ffffff', '#ef4135'] },
  ES: { name: 'Hiszpania', flag: ['h', '#aa151b', '#f1bf00', '#f1bf00', '#aa151b'] },
  NL: { name: 'Holandia', flag: ['h', '#ae1c28', '#ffffff', '#21468b'] },
  MX: { name: 'Meksyk', flag: ['v', '#006847', '#ffffff', '#ce1126'] },
  AU: { name: 'Australia', flag: ['dot', '#00247d', '#ffffff'] },
  JP: { name: 'Japonia', flag: ['dot', '#ffffff', '#bc002d'] },
  BR: { name: 'Brazylia', flag: ['diamond', '#009c3b', '#ffdf00'] },
  CA: { name: 'Kanada', flag: ['vdot', '#ff0000', '#ffffff'] },
  DK: { name: 'Dania', flag: ['cross', '#c8102e', '#ffffff'] },
  SE: { name: 'Szwecja', flag: ['cross', '#006aa7', '#fecc00'] },
  FI: { name: 'Finlandia', flag: ['cross', '#ffffff', '#002f6c'] },
  CZ: { name: 'Czechy', flag: ['h', '#ffffff', '#d7141a'] },
  AR: { name: 'Argentyna', flag: ['h', '#74acdf', '#ffffff', '#74acdf'] },
  US: { name: 'USA', flag: ['h', '#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234'] },
  AT: { name: 'Austria', flag: ['h', '#ed2939', '#ffffff', '#ed2939'] },
  BE: { name: 'Belgia', flag: ['v', '#111111', '#fae042', '#ed2939'] },
  CH: { name: 'Szwajcaria', flag: ['plus', '#d52b1e', '#ffffff'] },
  TH: { name: 'Tajlandia', flag: ['h', '#a51931', '#f4f5f8', '#2d2a4a', '#2d2a4a', '#f4f5f8', '#a51931'] },
  CN: { name: 'Chiny', flag: ['dot', '#de2910', '#ffde00'] },
  NZ: { name: 'Nowa Zelandia', flag: ['dot', '#00247d', '#cc142b'] }
};

PG.ENGINES = {
  Ferro: { name: 'Ferro', power: 2 },
  Stella: { name: 'Stella', power: 2 },
  Honta: { name: 'Honta', power: 1 },
  Renova: { name: 'Renova', power: -1 }
};

// Wzory malowań — nazwy widoczne w kreatorze
PG.PATTERNS = [
  { id: 'plain', name: 'Gładkie' },
  { id: 'stripe', name: 'Pas środkowy' },
  { id: 'twin', name: 'Dwa pasy' },
  { id: 'chevron', name: 'Szewron' },
  { id: 'split', name: 'Podział przód/tył' },
  { id: 'pods', name: 'Sekcje boczne' },
  { id: 'tail', name: 'Ogon w akcencie' },
  { id: 'checker', name: 'Szachownica' },
  { id: 'fade', name: 'Pasy przejścia' }
];

PG.HELMET_PATTERNS = [
  { id: 'plain', name: 'Gładki' },
  { id: 'band', name: 'Opaska' },
  { id: 'top', name: 'Pas na górze' },
  { id: 'star', name: 'Gwiazda' },
  { id: 'halves', name: 'Połówki' }
];

// Zespoły inspirowane prawdziwą stawką (nazwy fikcyjne)
PG.DEFAULT_TEAMS = [
  { id: 'rossa', name: 'Scuderia Rossa', short: 'ROS', country: 'IT', engine: 'Ferro', tier: 1,
    livery: { primary: '#d40f1a', secondary: '#1a1a1a', accent: '#ffd400', pattern: 'tail', paint: {} },
    car: { power: 88, aero: 86, tyre: 84 }, budget: 92, inspiredBy: 'Ferrari',
    drivers: [
      { first: 'Carlo', last: 'Benedetti', nat: 'IT', num: 16, pace: 92, start: 86, tyre: 84, wet: 88, helmet: { c1: '#d40f1a', c2: '#ffd400', pattern: 'band' } },
      { first: 'Luis', last: 'Ortega', nat: 'ES', num: 55, pace: 89, start: 85, tyre: 90, wet: 84, helmet: { c1: '#1d3fa8', c2: '#ffffff', pattern: 'top' } }
    ] },
  { id: 'argento', name: 'Stella Argento', short: 'STA', country: 'DE', engine: 'Stella', tier: 1,
    livery: { primary: '#b8bec4', secondary: '#141414', accent: '#00c2b2', pattern: 'fade', paint: {} },
    car: { power: 87, aero: 85, tyre: 86 }, budget: 90, inspiredBy: 'Mercedes',
    drivers: [
      { first: 'James', last: 'Whitfield', nat: 'GB', num: 63, pace: 90, start: 84, tyre: 86, wet: 87, helmet: { c1: '#ffffff', c2: '#00c2b2', pattern: 'halves' } },
      { first: 'Andrea', last: 'Conti', nat: 'IT', num: 12, pace: 87, start: 88, tyre: 82, wet: 80, helmet: { c1: '#1a1a1a', c2: '#00c2b2', pattern: 'star' } }
    ] },
  { id: 'bison', name: 'Bison Energy Racing', short: 'BIS', country: 'AT', engine: 'Honta', tier: 1,
    livery: { primary: '#1c2a6b', secondary: '#d61f2c', accent: '#f6c400', pattern: 'chevron', paint: {} },
    car: { power: 89, aero: 88, tyre: 83 }, budget: 91, inspiredBy: 'Red Bull',
    drivers: [
      { first: 'Maarten', last: 'de Vries', nat: 'NL', num: 1, pace: 96, start: 90, tyre: 88, wet: 95, helmet: { c1: '#1c2a6b', c2: '#f6c400', pattern: 'top' } },
      { first: 'Diego', last: 'Salazar', nat: 'MX', num: 11, pace: 84, start: 87, tyre: 89, wet: 80, helmet: { c1: '#006847', c2: '#ffffff', pattern: 'band' } }
    ] },
  { id: 'papaya', name: 'Papaya GP', short: 'PAP', country: 'GB', engine: 'Stella', tier: 1,
    livery: { primary: '#ff7a00', secondary: '#1b1b1b', accent: '#3fa9f5', pattern: 'split', paint: {} },
    car: { power: 88, aero: 90, tyre: 87 }, budget: 89, inspiredBy: 'McLaren',
    drivers: [
      { first: 'Liam', last: 'Norwood', nat: 'GB', num: 4, pace: 93, start: 84, tyre: 86, wet: 90, helmet: { c1: '#f6e200', c2: '#1b1b1b', pattern: 'halves' } },
      { first: 'Callum', last: 'Reid', nat: 'AU', num: 81, pace: 92, start: 86, tyre: 89, wet: 85, helmet: { c1: '#ffffff', c2: '#ff7a00', pattern: 'top' } }
    ] },
  { id: 'verde', name: 'Verde Britannia', short: 'VER', country: 'GB', engine: 'Stella', tier: 2,
    livery: { primary: '#005c4b', secondary: '#0d1f1a', accent: '#c8e000', pattern: 'twin', paint: {} },
    car: { power: 85, aero: 80, tyre: 82 }, budget: 84, inspiredBy: 'Aston Martin',
    drivers: [
      { first: 'Rafael', last: 'Montes', nat: 'ES', num: 14, pace: 89, start: 92, tyre: 92, wet: 90, helmet: { c1: '#005c4b', c2: '#c8e000', pattern: 'band' } },
      { first: 'Ethan', last: 'Stroud', nat: 'CA', num: 18, pace: 79, start: 82, tyre: 80, wet: 78, helmet: { c1: '#ffffff', c2: '#d61f2c', pattern: 'star' } }
    ] },
  { id: 'alpes', name: 'Alpes Bleu', short: 'ALP', country: 'FR', engine: 'Renova', tier: 3,
    livery: { primary: '#0b62c9', secondary: '#0b1a33', accent: '#ff82bd', pattern: 'pods', paint: {} },
    car: { power: 81, aero: 80, tyre: 81 }, budget: 76, inspiredBy: 'Alpine',
    drivers: [
      { first: 'Pierre', last: 'Garnier', nat: 'FR', num: 10, pace: 84, start: 83, tyre: 82, wet: 88, helmet: { c1: '#0b62c9', c2: '#ffffff', pattern: 'halves' } },
      { first: 'Julien', last: 'Moreau', nat: 'FR', num: 31, pace: 82, start: 80, tyre: 81, wet: 79, helmet: { c1: '#ff82bd', c2: '#0b1a33', pattern: 'top' } }
    ] },
  { id: 'grove', name: 'Grove Racing', short: 'GRV', country: 'GB', engine: 'Stella', tier: 2,
    livery: { primary: '#0a2353', secondary: '#00a3e0', accent: '#ffffff', pattern: 'stripe', paint: {} },
    car: { power: 86, aero: 81, tyre: 80 }, budget: 79, inspiredBy: 'Williams',
    drivers: [
      { first: 'Kamil', last: 'Zieliński', nat: 'PL', num: 23, pace: 86, start: 84, tyre: 83, wet: 85, helmet: { c1: '#ffffff', c2: '#dc143c', pattern: 'halves' } },
      { first: 'Mateo', last: 'Ruiz', nat: 'AR', num: 43, pace: 83, start: 85, tyre: 79, wet: 80, helmet: { c1: '#74acdf', c2: '#ffffff', pattern: 'band' } }
    ] },
  { id: 'faenza', name: 'Faenza Junior', short: 'FAE', country: 'IT', engine: 'Honta', tier: 2,
    livery: { primary: '#f2f4f8', secondary: '#1634cb', accent: '#e4002b', pattern: 'chevron', paint: {} },
    car: { power: 86, aero: 82, tyre: 81 }, budget: 80, inspiredBy: 'Racing Bulls',
    drivers: [
      { first: 'Yuki', last: 'Tanabe', nat: 'JP', num: 22, pace: 85, start: 87, tyre: 80, wet: 82, helmet: { c1: '#ffffff', c2: '#bc002d', pattern: 'star' } },
      { first: 'Hugo', last: 'Delacroix', nat: 'FR', num: 6, pace: 83, start: 81, tyre: 82, wet: 81, helmet: { c1: '#1634cb', c2: '#e4002b', pattern: 'top' } }
    ] },
  { id: 'hinwil', name: 'Hinwil Verde', short: 'HIN', country: 'CH', engine: 'Ferro', tier: 3,
    livery: { primary: '#1b1b1b', secondary: '#2a2a2a', accent: '#52e252', pattern: 'twin', paint: {} },
    car: { power: 83, aero: 78, tyre: 80 }, budget: 72, inspiredBy: 'Sauber',
    drivers: [
      { first: 'Niklas', last: 'Hoffmann', nat: 'DE', num: 27, pace: 85, start: 83, tyre: 84, wet: 83, helmet: { c1: '#ffce00', c2: '#111111', pattern: 'band' } },
      { first: 'Gabriel', last: 'Souza', nat: 'BR', num: 5, pace: 82, start: 84, tyre: 79, wet: 84, helmet: { c1: '#009c3b', c2: '#ffdf00', pattern: 'halves' } }
    ] },
  { id: 'kanna', name: 'Kannapolis Racing', short: 'KAN', country: 'US', engine: 'Ferro', tier: 3,
    livery: { primary: '#f4f4f4', secondary: '#1b1b1b', accent: '#e6002b', pattern: 'split', paint: {} },
    car: { power: 84, aero: 79, tyre: 79 }, budget: 74, inspiredBy: 'Haas',
    drivers: [
      { first: 'Mikkel', last: 'Sørensen', nat: 'DK', num: 20, pace: 83, start: 80, tyre: 81, wet: 82, helmet: { c1: '#c8102e', c2: '#ffffff', pattern: 'top' } },
      { first: 'Tomas', last: 'Novak', nat: 'CZ', num: 87, pace: 81, start: 83, tyre: 80, wet: 79, helmet: { c1: '#111111', c2: '#d7141a', pattern: 'star' } }
    ] }
];

// Kalendarz sezonu — wszystkie rundy na Monzy w MVP, różna pogoda
PG.CALENDAR = [
  { name: 'Gran Premio d\'Apertura', weather: 'sun' },
  { name: 'Trofeo della Brianza', weather: 'cloud' },
  { name: 'Coppa del Parco', weather: 'rain' },
  { name: 'Trofeo Lesmo', weather: 'sun' },
  { name: 'Coppa Lombardia', weather: 'cloud' },
  { name: 'Gran Premio d\'Italia', weather: 'sun' }
];

PG.WEATHER = {
  sun: { name: 'Słonecznie', grip: 1.0 },
  cloud: { name: 'Pochmurno', grip: 0.98 },
  rain: { name: 'Deszcz', grip: 0.78 }
};

PG.TYRES = {
  S: { name: 'Miękkie', color: '#e8262f', grip: 1.035, wear: 1.7 },
  M: { name: 'Pośrednie', color: '#f5c518', grip: 1.0, wear: 1.0 },
  H: { name: 'Twarde', color: '#f2f2f2', grip: 0.97, wear: 0.6 },
  W: { name: 'Deszczowe', color: '#2f7ef0', grip: 1.0, wear: 0.8 }
};

PG.FIRST_NAMES = ['Adam', 'Marco', 'Leo', 'Felix', 'Oskar', 'Jonas', 'Rui', 'Tom', 'Elias', 'Nico', 'Hugo', 'Max', 'Igor', 'Luca', 'Arvid', 'Bruno', 'Dario', 'Emil', 'Filip', 'Jan'];
PG.LAST_NAMES = ['Kowal', 'Ferraro', 'Lindgren', 'Moretti', 'Becker', 'Duval', 'Navarro', 'Okada', 'Price', 'Sandoval', 'Kaczmarek', 'Weber', 'Rossi', 'Bauer', 'Nowicki', 'Laurent', 'Hughes', 'Castro'];

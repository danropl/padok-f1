// Wycinek src/lib/format.ts potrzebny funkcji (funkcja Edge nie widzi plików frontendu).
// Po zmianie nazw krajów lub Grand Prix we frontendzie przenieś je też tutaj.
const TZ = "Europe/Warsaw";

export const fullDate = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(
    new Date(iso),
  );

export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

const NATIONALITY: Record<string, string> = {
  British: "Wielka Brytania",
  Dutch: "Holandia",
  German: "Niemcy",
  Spanish: "Hiszpania",
  French: "Francja",
  Italian: "Włochy",
  Monegasque: "Monako",
  Australian: "Australia",
  Mexican: "Meksyk",
  Canadian: "Kanada",
  Finnish: "Finlandia",
  Japanese: "Japonia",
  Thai: "Tajlandia",
  Chinese: "Chiny",
  Danish: "Dania",
  American: "USA",
  "New Zealander": "Nowa Zelandia",
  Brazilian: "Brazylia",
  Argentinian: "Argentyna",
  Argentine: "Argentyna",
  Austrian: "Austria",
  Swiss: "Szwajcaria",
  Belgian: "Belgia",
  Swedish: "Szwecja",
  Polish: "Polska",
  "South African": "RPA",
  Colombian: "Kolumbia",
  Venezuelan: "Wenezuela",
  Russian: "Rosja",
  Irish: "Irlandia",
  Portuguese: "Portugalia",
  Hungarian: "Węgry",
  Indian: "Indie",
  Indonesian: "Indonezja",
  Malaysian: "Malezja",
  Estonian: "Estonia",
  Rhodesian: "Rodezja",
  Chilean: "Chile",
  Uruguayan: "Urugwaj",
};

export const country = (nationality: string | null) => (nationality ? NATIONALITY[nationality] ?? nationality : "");

// Nazwy Grand Prix z API są po angielsku; tłumaczymy człon z nazwą kraju, resztę zostawiamy.

const GP: Record<string, string> = {
  Australian: "Australii",
  Chinese: "Chin",
  Japanese: "Japonii",
  Miami: "Miami",
  Canadian: "Kanady",
  Monaco: "Monako",
  Barcelona: "Barcelony",
  Spanish: "Hiszpanii",
  Austrian: "Austrii",
  British: "Wielkiej Brytanii",
  Belgian: "Belgii",
  Hungarian: "Węgier",
  Dutch: "Holandii",
  Italian: "Włoch",
  Azerbaijan: "Azerbejdżanu",
  Singapore: "Singapuru",
  "United States": "USA",
  "Mexico City": "Meksyku",
  Brazilian: "Brazylii",
  "São Paulo": "São Paulo",
  "Las Vegas": "Las Vegas",
  Qatar: "Kataru",
  "Abu Dhabi": "Abu Zabi",
  Bahrain: "Bahrajnu",
  "Saudi Arabian": "Arabii Saudyjskiej",
  "Emilia Romagna": "Emilii-Romanii",
  Madrid: "Madrytu",
  German: "Niemiec",
  French: "Francji",
  Malaysian: "Malezji",
  European: "Europy",
  Turkish: "Turcji",
  Russian: "Rosji",
  Korean: "Korei",
  Indian: "Indii",
  "San Marino": "San Marino",
  Portuguese: "Portugalii",
  Argentine: "Argentyny",
  "South African": "RPA",
  Swedish: "Szwecji",
  Mexican: "Meksyku",
  Styrian: "Styrii",
  Tuscan: "Toskanii",
  Eifel: "Eifel",
  Sakhir: "Sakhiru",
  "70th Anniversary": "70-lecia",
  Pacific: "Pacyfiku",
  Luxembourg: "Luksemburga",
  Swiss: "Szwajcarii",
  Moroccan: "Maroka",
  Vietnamese: "Wietnamu",
};

export function raceName(name: string) {
  const m = name.match(/^(.*) Grand Prix$/);
  if (m && GP[m[1]]) return `Grand Prix ${GP[m[1]]}`;
  return name;
}

// Formatowanie dat i nazw. Godziny zawsze pokazujemy w czasie polskim, bo tak planuje się oglądanie.
const TZ = "Europe/Warsaw";

export const dayMonth = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso));

export const weekdayTime = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(
    new Date(iso),
  );

export const fullDate = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(
    new Date(iso),
  );

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));

export function daysUntil(iso: string, now = new Date()) {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

export function inDays(n: number) {
  if (n <= 0) return "dziś";
  if (n === 1) return "jutro";
  return `za ${n} ${plural(n, "dzień", "dni", "dni")}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

export function age(dob: string, now = new Date()) {
  const b = new Date(dob);
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
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

const COUNTRY: Record<string, string> = {
  Australia: "Australia",
  China: "Chiny",
  Japan: "Japonia",
  USA: "USA",
  "United States": "USA",
  Canada: "Kanada",
  Monaco: "Monako",
  Spain: "Hiszpania",
  Austria: "Austria",
  UK: "Wielka Brytania",
  Belgium: "Belgia",
  Hungary: "Węgry",
  Netherlands: "Holandia",
  Italy: "Włochy",
  Azerbaijan: "Azerbejdżan",
  Singapore: "Singapur",
  Mexico: "Meksyk",
  Brazil: "Brazylia",
  Qatar: "Katar",
  UAE: "ZEA",
  Bahrain: "Bahrajn",
  "Saudi Arabia": "Arabia Saudyjska",
  Malaysia: "Malezja",
  Portugal: "Portugalia",
  France: "Francja",
  Germany: "Niemcy",
};
export const countryName = (c: string | null) => (c ? COUNTRY[c] ?? c : "");

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

export const STATUS: Record<string, string> = {
  Finished: "Ukończył",
  Retired: "Nie ukończył",
  Disqualified: "Dyskwalifikacja",
  Accident: "Wypadek",
  Collision: "Kolizja",
  "Did not start": "Nie wystartował",
  Lapped: "Zdublowany",
};
export function statusPl(status: string | null) {
  if (!status) return "";
  if (/^\+\d+ Laps?$/.test(status)) return `${status.replace(/ Laps?/, "")} okr.`;
  return STATUS[status] ?? status;
}

// Jolpica oznacza niesklasyfikowanych literą w position_text: R (nie ukończył), W (wycofany), D (dyskwalifikacja).
export function finishLabel(r: { position: number | null; position_text: string | null; status: string | null }) {
  const t = r.position_text ?? "";
  if (/^\d+$/.test(t)) return { pos: `${t}.`, note: statusPl(r.status) === "Ukończył" ? "" : statusPl(r.status) };
  const reason = r.status && !["Retired", "Lapped", "Did not start"].includes(r.status) ? ` (${statusPl(r.status)})` : "";
  if (t === "W") return { pos: "–", note: "Nie wystartował" };
  if (t === "D") return { pos: "–", note: "Dyskwalifikacja" };
  return { pos: "–", note: `Nie ukończył${reason}` };
}

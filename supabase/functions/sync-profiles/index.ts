// sync-profiles: składa profile kierowców i zespołów bieżącego sezonu.
// - opis kariery generowany z wyników Jolpica-F1 (starty, wygrane, zespoły rok po roku),
// - u zespołów: oficjalna nazwa zgłoszenia, sponsorzy tytularni, siedziba i szef z infoboksu Wikipedii,
// - wstęp z polskiej Wikipedii (CC BY-SA, z linkiem do źródła),
// - zdjęcia i loga tylko z Wikimedia Commons (wolne licencje), kopiowane do Supabase Storage,
//   żeby przeglądarka czytelnika nie łączyła się z serwerami w USA.
// Profil odświeża się po każdym wyścigu, po zmianie zespołu lub składu i najpóźniej co tydzień.
import { createClient } from "npm:@supabase/supabase-js@2";
import { country, fullDate, plural, raceName } from "./pl.ts";

const JOLPICA = "https://api.jolpi.ca/ergast/f1";
const UA = { "User-Agent": "PadokF1/1.0 (https://danropl.github.io/padok-f1/; F1 guide for beginners)" };
const TIME_BUDGET_MS = 100_000;
const MAX_AGE_MS = 7 * 86_400_000;
const BUCKET = "media";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jolpica(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${JOLPICA}${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Jolpica ${path}: HTTP ${res.status}`);
    await sleep(350);
    return (await res.json()).MRData;
  }
  throw new Error(`Jolpica ${path}: limit zapytań`);
}

async function jolpicaAll<T>(path: string, pick: (m: any) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; ) {
    const m = await jolpica(`${path}?limit=100&offset=${offset}`);
    out.push(...pick(m));
    offset += Number(m.limit);
    if (offset >= Number(m.total)) return out;
  }
}

async function wiki(host: string, params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetch(`https://${host}/w/api.php?${q}`, { headers: UA });
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
  return res.json();
}

const titleFromUrl = (url: string | null) =>
  url ? decodeURIComponent(url.split("/wiki/")[1] ?? "").replace(/_/g, " ") : "";

// ---------- Wikipedia: tytuły, polskie odpowiedniki, zdjęcia ----------

type PageInfo = { title: string; plTitle?: string; image?: string };

async function enPages(titles: string[]): Promise<Map<string, PageInfo>> {
  const out = new Map<string, PageInfo>();
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const j = await wiki("en.wikipedia.org", {
      action: "query",
      redirects: "1",
      titles: chunk.join("|"),
      prop: "pageimages|langlinks",
      piprop: "name",
      pilicense: "free",
      lllang: "pl",
      lllimit: "max",
    });
    const alias = new Map<string, string>();
    for (const n of j.query?.normalized ?? []) alias.set(n.to, n.from);
    for (const r of j.query?.redirects ?? []) alias.set(r.to, alias.get(r.from) ?? r.from);
    for (const p of j.query?.pages ?? []) {
      const original = alias.get(p.title) ?? p.title;
      out.set(original, { title: p.title, plTitle: p.langlinks?.[0]?.title, image: p.pageimage });
    }
  }
  return out;
}

type ImageMeta = { thumb: string; page: string; author: string | null; license: string | null; licenseUrl: string | null };

const stripHtml = (s: string | undefined) =>
  s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null : null;

// Tylko pliki z Wikimedia Commons ("shared") i bez oznaczenia NonFree: lokalne pliki angielskiej Wikipedii
// to zwykle loga na zasadzie dozwolonego użytku, którego nie możemy przenieść na naszą stronę.
async function imageMeta(files: string[]): Promise<Map<string, ImageMeta>> {
  const out = new Map<string, ImageMeta>();
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40);
    const j = await wiki("en.wikipedia.org", {
      action: "query",
      titles: chunk.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "480",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|NonFree|AttributionRequired",
    });
    const alias = new Map<string, string>();
    for (const n of j.query?.normalized ?? []) alias.set(n.to, n.from);
    for (const p of j.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (!info || p.imagerepository !== "shared") continue;
      const m = info.extmetadata ?? {};
      if (String(m.NonFree?.value ?? "").toLowerCase() === "true") continue;
      const key = (alias.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(key, {
        thumb: info.thumburl ?? info.url,
        page: info.descriptionurl,
        author: stripHtml(m.Artist?.value),
        license: stripHtml(m.LicenseShortName?.value),
        licenseUrl: m.LicenseUrl?.value ?? null,
      });
    }
  }
  return out;
}

async function plSummary(plTitle: string | undefined) {
  if (!plTitle) return null;
  const res = await fetch(`https://pl.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(plTitle.replace(/ /g, "_"))}`, {
    headers: UA,
  });
  if (!res.ok) return null;
  const j = await res.json();
  if (j.type !== "standard" || !j.extract) return null;
  return { extract: j.extract as string, url: j.content_urls?.desktop?.page as string };
}

// Kopia miniatury do Storage. Nazwa pliku zależy od pliku źródłowego, więc nowa fotografia = nowy adres.
async function storeImage(folder: string, id: string, meta: ImageMeta) {
  const res = await fetch(meta.thumb, { headers: UA });
  if (!res.ok) throw new Error(`obraz ${id}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(meta.page))))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const path = `${folder}/${id}-${hash}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, await res.arrayBuffer(), { contentType: type, upsert: true });
  if (error) throw new Error(`storage ${path}: ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

type ImageFields = {
  image_url: string | null;
  image_page: string | null;
  image_author: string | null;
  image_license: string | null;
  image_license_url: string | null;
};

async function imageFields(folder: string, id: string, meta: ImageMeta | undefined, prev: any): Promise<ImageFields> {
  if (!meta) return { image_url: null, image_page: null, image_author: null, image_license: null, image_license_url: null };
  const url = prev?.image_page === meta.page && prev?.image_url ? prev.image_url : await storeImage(folder, id, meta);
  return {
    image_url: url,
    image_page: meta.page,
    image_author: meta.author,
    image_license: meta.license,
    image_license_url: meta.licenseUrl,
  };
}

// ---------- infoboks zespołu ----------

function infobox(text: string): Record<string, string> {
  const start = text.search(/\{\{\s*Infobox/i);
  if (start < 0) return {};
  const parts: string[] = [];
  let depth = 0, link = 0, cur = "";
  for (let i = start; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === "{{") { depth++; cur += two; i++; continue; }
    if (two === "}}") { depth--; if (depth === 0) break; cur += two; i++; continue; }
    if (two === "[[") { link++; cur += two; i++; continue; }
    if (two === "]]") { link--; cur += two; i++; continue; }
    if (text[i] === "|" && depth === 1 && link === 0) { parts.push(cur); cur = ""; continue; }
    cur += text[i];
  }
  parts.push(cur);
  const out: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    out[p.slice(0, eq).trim().toLowerCase().replace(/\s+/g, "_")] = p.slice(eq + 1).trim();
  }
  return out;
}

function cleanWiki(v: string | undefined, sep = ", "): string {
  if (!v) return "";
  let s = v
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "");
  // Szablony od najgłębszych: nowrap/plainlist zostawiają treść, reszta (flagi, przypisy) znika.
  for (let k = 0; k < 6 && /\{\{/.test(s); k++) {
    s = s.replace(/\{\{\s*(nowrap|plainlist|ubl|unbulleted list)\s*\|([^{}]*)\}\}/gi, (_m, _n, body) => body.replace(/\|/g, "\n"));
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  }
  s = s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*\*\s*/gm, "");
  return s
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(sep);
}

const PLACE: Record<string, string> = {
  England: "Anglia",
  "United Kingdom": "Wielka Brytania",
  UK: "Wielka Brytania",
  Italy: "Włochy",
  Switzerland: "Szwajcaria",
  Germany: "Niemcy",
  France: "Francja",
  Austria: "Austria",
  "U.S.": "USA",
  "United States": "USA",
  US: "USA",
};

function baseText(raw: string | undefined) {
  const items = cleanWiki(raw, "\n").split("\n");
  const current = items.filter((x) => !/\(\d{4}\s*[–-]\s*\d{4}\)/.test(x));
  return current
    .map((x) =>
      x
        .replace(/\([^)]*\)/g, "")
        .split(",")
        .map((p) => PLACE[p.trim()] ?? p.trim())
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean)
    .join("; ") || null;
}

// Szef zespołu: osoba opisana jako "Team Principal", a jeśli takiej nie ma, pierwsza wymieniona.
function principalText(raw: string | undefined) {
  if (!raw) return null;
  const s = raw.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  const links = [...s.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)].map((m) => ({ at: m.index!, name: (m[2] ?? m[1]).trim() }));
  // Pomijamy zastępców ("Deputy Team Principal"); bez wskazania roli bierzemy pierwszą osobę.
  const tp = s.search(/(?<!(deputy|vice)[\s-]*)team principal/i);
  const pick = tp >= 0 ? links.filter((l) => l.at < tp).at(-1) : links[0];
  return pick?.name ?? (cleanWiki(s).split(",")[0] || null);
}

function logoFile(raw: string | undefined) {
  if (!raw) return null;
  const m = raw.replace(/^\[\[/, "").replace(/^(File|Image):/i, "").split("|")[0].replace(/\]\]$/, "").trim();
  return m || null;
}

const STOP = new Set(["f1", "formula", "one", "1", "team", "racing", "scuderia", "in", "the", "amg", "motorsport", "gp", "grand", "prix"]);

// Sponsorzy tytularni = to, co w oficjalnej nazwie zgłoszenia nie jest nazwą zespołu ani słowem typu "F1 Team".
function titleSponsors(officialName: string, teamNames: string[]) {
  const teamWords = new Set(teamNames.flatMap((n) => n.toLowerCase().split(/[\s-]+/)).filter((w) => w && !STOP.has(w)));
  const groups: string[] = [];
  let cur: string[] = [];
  for (const token of officialName.split(/\s+/)) {
    const parts = token.toLowerCase().split("-");
    const isTeam = parts.some((p) => teamWords.has(p)) || STOP.has(token.toLowerCase());
    if (isTeam) {
      if (cur.length) groups.push(cur.join(" "));
      cur = [];
    } else cur.push(token);
  }
  if (cur.length) groups.push(cur.join(" "));
  return groups.filter((g) => g.length > 1);
}

// ---------- teksty ----------

const n = (k: number, one: string, few: string, many: string) => `${k} ${plural(k, one, few, many)}`;
const gp = (r: { raceName: string; season: string | number }) => `${raceName(r.raceName)} ${r.season}`;

function listPl(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} i ${items.at(-1)}`;
}

type Stint = { team: string; from: number; to: number };

function stints(races: any[]): Stint[] {
  const out: Stint[] = [];
  for (const r of races) {
    const team = r.Results?.[0]?.Constructor?.name;
    const y = Number(r.season);
    if (!team) continue;
    const last = out.at(-1);
    if (last && last.team === team && y - last.to <= 1) last.to = y;
    else out.push({ team, from: y, to: y });
  }
  return out;
}
const stintText = (s: Stint) => (s.from === s.to ? `${s.team} (${s.from})` : `${s.team} (${s.from}–${s.to})`);

async function driverProfile(d: any, ctx: Ctx, page: PageInfo | undefined, img: ImageMeta | undefined, prev: any) {
  const races = await jolpicaAll<any>(`/drivers/${d.driver_id}/results.json`, (m) => m.RaceTable.Races);
  const poles = Number((await jolpica(`/drivers/${d.driver_id}/qualifying/1.json?limit=1`)).total);
  const finishes = races.map((r) => ({ r, pos: Number(r.Results?.[0]?.position), text: r.Results?.[0]?.positionText }));
  const classified = finishes.filter((f) => /^\d+$/.test(f.text ?? ""));
  const wins = classified.filter((f) => f.pos === 1);
  const podiums = classified.filter((f) => f.pos <= 3).length;
  const best = classified.reduce<typeof classified[number] | null>((b, f) => (!b || f.pos < b.pos ? f : b), null);
  const seasons = [...new Set(races.map((r) => Number(r.season)))];
  const titles = ctx.champions.filter((c) => c.driver_wiki_url && c.driver_wiki_url === d.wiki_url).map((c) => c.season).sort();
  const career = stints(races);
  const team = ctx.teamOf.get(d.driver_id);
  const name = `${d.given_name} ${d.family_name}`;

  const s: string[] = [];
  const origin = [country(d.nationality), d.date_of_birth ? `ur. ${fullDate(d.date_of_birth)}` : ""].filter(Boolean).join(", ");
  s.push(
    `${name}${origin ? ` (${origin})` : ""}` +
      (team ? ` w sezonie ${ctx.season} jeździ w zespole ${team.name}${d.permanent_number ? ` z numerem ${d.permanent_number}` : ""}.` : "."),
  );
  if (races.length === 0) {
    s.push("Na pierwszy start w Grand Prix jeszcze czeka.");
  } else {
    const first = races[0];
    s.push(
      seasons.length === 1 && seasons[0] === ctx.season
        ? `To debiutancki sezon w Formule 1: pierwszy start to ${gp(first)}.`
        : `Debiut w Formule 1: ${gp(first)} w barwach ${first.Results[0].Constructor.name}.`,
    );
    s.push(
      `Bilans: ${n(seasons.length, "sezon", "sezony", "sezonów")}, ${n(races.length, "start", "starty", "startów")}, ` +
        `${n(wins.length, "zwycięstwo", "zwycięstwa", "zwycięstw")}, ${n(podiums, "podium", "podia", "podiów")} ` +
        `i ${poles} pole position.`,
    );
    if (wins.length === 1) s.push(`Jedyne zwycięstwo: ${gp(wins[0].r)}.`);
    else if (wins.length > 1) s.push(`Pierwsze zwycięstwo: ${gp(wins[0].r)}, ostatnie: ${gp(wins.at(-1)!.r)}.`);
    else if (best) s.push(`Najlepszy wynik w wyścigu: ${best.pos}. miejsce (${gp(best.r)}).`);
    if (titles.length) s.push(`Mistrzostwo świata: ${listPl(titles.map(String))}.`);
    if (career.length > 1) s.push(`Zespoły w karierze: ${career.map(stintText).join(", ")}.`);
  }

  const wikiText = await plSummary(page?.plTitle);
  return {
    driver_id: d.driver_id,
    summary: s.join(" "),
    stats: {
      starts: races.length,
      wins: wins.length,
      podiums,
      poles,
      seasons: seasons.length,
      titles,
      first_race: races[0] ? { season: Number(races[0].season), name: races[0].raceName } : null,
      first_win: wins[0] ? { season: Number(wins[0].r.season), name: wins[0].r.raceName } : null,
      career,
    },
    current_team: team?.constructor_id ?? null,
    wiki_extract: wikiText?.extract ?? null,
    wiki_url: wikiText?.url ?? null,
    wiki_lang: wikiText ? "pl" : null,
    ...(await imageFields("drivers", d.driver_id, img, prev)),
    updated_at: new Date().toISOString(),
  };
}

async function teamProfile(c: any, ctx: Ctx, page: PageInfo | undefined, prev: any) {
  const id = c.constructor_id;
  const total = async (p: string) => Number((await jolpica(`${p}?limit=1`)).total);
  const firstM = await jolpica(`/constructors/${id}/races.json?limit=1`);
  const entries = Number(firstM.total);
  const first = firstM.RaceTable.Races[0];
  const wins = await total(`/constructors/${id}/results/1.json`);
  const second = await total(`/constructors/${id}/results/2.json`);
  const third = await total(`/constructors/${id}/results/3.json`);
  const poles = await total(`/constructors/${id}/qualifying/1.json`);

  // Infoboks z angielskiej Wikipedii: oficjalna nazwa, siedziba, szef, logo, poprzednie nazwy.
  let box: Record<string, string> = {};
  if (page?.title) {
    const j = await wiki("en.wikipedia.org", {
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      rvsection: "0",
      titles: page.title,
    });
    box = infobox(j.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? "");
  }
  const official = cleanWiki(box.long_name).split(",")[0] || null;
  const sponsors = official ? titleSponsors(official, [c.name, page?.title?.replace(/ in Formula One$/, "") ?? ""]) : [];
  const previous = cleanWiki(box.previous_name, "\n")
    .split(/\n|\//)
    .map((x) => x.trim())
    .filter((x) => x && x.toLowerCase() !== c.name.toLowerCase());
  const base = baseText(box.base);
  const principal = principalText(box.principal);
  const logo = logoFile(box.logo);
  const img = logo ? (await imageMeta([logo])).get(logo) : undefined;

  const cTitles = ctx.champions.filter((x) => x.constructor_name === c.name).map((x) => x.season).sort();
  const dTitles = ctx.champions.filter((x) => (x.driver_team ?? "").split(" / ").includes(c.name)).length;
  const lineup = ctx.lineup.get(id) ?? [];

  const s: string[] = [];
  s.push(`${c.name}${c.nationality ? ` (${country(c.nationality)})` : ""}${official && official !== c.name ? `, w oficjalnym zgłoszeniu: ${official}` : ""}.`);
  if (lineup.length) s.push(`W sezonie ${ctx.season} jeżdżą: ${listPl(lineup)}.`);
  if (principal) s.push(`Zespołem kieruje ${principal}.`);
  if (base) s.push(`Siedziba: ${base}.`);
  if (first) {
    s.push(
      `Pod nazwą ${c.name} w statystykach od ${gp(first)}: ${n(entries, "Grand Prix", "Grand Prix", "Grand Prix")}, ` +
        `${n(wins, "zwycięstwo", "zwycięstwa", "zwycięstw")}, ${n(wins + second + third, "podium", "podia", "podiów")} ` +
        `i ${poles} pole position.`,
    );
  }
  if (previous.length) s.push(`Wcześniejsze wcielenia zespołu: ${listPl(previous)}.`);
  if (cTitles.length) s.push(`Tytuły mistrza świata konstruktorów: ${cTitles.length} (ostatni w ${cTitles.at(-1)}).`);
  if (dTitles) s.push(`Kierowcy tego zespołu zdobyli ${n(dTitles, "tytuł", "tytuły", "tytułów")} mistrza świata.`);
  s.push(
    sponsors.length
      ? `Sponsorzy tytularni, czyli firmy w oficjalnej nazwie: ${listPl(sponsors)}.`
      : "W oficjalnej nazwie zespołu nie ma sponsora tytularnego.",
  );

  const wikiText = await plSummary(page?.plTitle);
  return {
    constructor_id: id,
    summary: s.join(" "),
    stats: {
      entries,
      wins,
      podiums: wins + second + third,
      poles,
      first_race: first ? { season: Number(first.season), name: first.raceName } : null,
      constructor_titles: cTitles,
      driver_titles: dTitles,
    },
    official_name: official,
    sponsors,
    base,
    principal,
    previous_names: previous,
    lineup: [...(ctx.lineupIds.get(id) ?? [])].sort().join(","),
    wiki_extract: wikiText?.extract ?? null,
    wiki_url: wikiText?.url ?? null,
    wiki_lang: wikiText ? "pl" : null,
    ...(await imageFields("teams", id, img, prev)),
    updated_at: new Date().toISOString(),
  };
}

// ---------- przebieg ----------

type Ctx = {
  season: number;
  champions: any[];
  teamOf: Map<string, any>;
  lineup: Map<string, string[]>;
  lineupIds: Map<string, string[]>;
};

async function run() {
  const started = Date.now();
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
  const { data: seasonRow } = await db.from("races").select("season").order("season", { ascending: false }).limit(1).single();
  const season = seasonRow!.season as number;
  const [{ data: ds }, { data: cs }, { data: drivers }, { data: constructors }, { data: champions }, { data: results }, { data: races }] =
    await Promise.all([
      db.from("driver_standings").select("driver_id,constructor_id,points").eq("season", season),
      db.from("constructor_standings").select("constructor_id").eq("season", season),
      db.from("drivers").select("*"),
      db.from("constructors").select("*"),
      db.from("champions").select("season,driver_wiki_url,driver_team,constructor_name"),
      db.from("race_results").select("round,driver_id,constructor_id").eq("season", season),
      db.from("races").select("round,race_start").eq("season", season),
    ]);
  const cMap = new Map((constructors ?? []).map((c) => [c.constructor_id, c]));
  const dMap = new Map((drivers ?? []).map((d) => [d.driver_id, d]));

  // Zespół kierowcy = zespół z ostatniego wyścigu, w którym startował; bez wyników bierzemy klasyfikację.
  const teamOf = new Map<string, any>();
  for (const s of ds ?? []) if (s.constructor_id) teamOf.set(s.driver_id, cMap.get(s.constructor_id));
  for (const r of [...(results ?? [])].sort((a, b) => a.round - b.round)) if (r.constructor_id) teamOf.set(r.driver_id, cMap.get(r.constructor_id));

  // Skład = kierowcy, którzy jechali dla zespołu w ostatniej rundzie z wynikami.
  const lastRound = Math.max(0, ...(results ?? []).map((r) => r.round));
  const lineupIds = new Map<string, string[]>();
  for (const r of (results ?? []).filter((x) => x.round === lastRound)) {
    if (!r.constructor_id) continue;
    lineupIds.set(r.constructor_id, [...(lineupIds.get(r.constructor_id) ?? []), r.driver_id]);
  }
  const lineup = new Map(
    [...lineupIds].map(([k, ids]) => [k, ids.map((i) => dMap.get(i)).filter(Boolean).map((d) => `${d.given_name} ${d.family_name}`)]),
  );
  const ctx: Ctx = { season, champions: champions ?? [], teamOf, lineup, lineupIds };

  const lastRaceAt = Math.max(
    0,
    ...(races ?? []).filter((r) => r.round <= lastRound && r.race_start).map((r) => new Date(r.race_start).getTime()),
  );

  const activeDrivers = [...new Set([...(ds ?? []).map((s) => s.driver_id), ...(results ?? []).map((r) => r.driver_id)])]
    .map((id) => dMap.get(id))
    .filter(Boolean);
  const activeTeams = (cs ?? []).map((c) => cMap.get(c.constructor_id)).filter(Boolean);

  const [{ data: dp }, { data: tp }] = await Promise.all([
    db.from("driver_profiles").select("driver_id,current_team,updated_at,image_page,image_url"),
    db.from("team_profiles").select("constructor_id,lineup,updated_at,image_page,image_url"),
  ]);
  const dPrev = new Map((dp ?? []).map((p) => [p.driver_id, p]));
  const tPrev = new Map((tp ?? []).map((p) => [p.constructor_id, p]));

  // Kolejność: brak profilu, zmiana zespołu/składu, wyścig od ostatniej aktualizacji, profil starszy niż tydzień.
  const priority = (prev: any, changed: boolean) => {
    if (!prev) return 0;
    if (changed) return 1;
    const at = new Date(prev.updated_at).getTime();
    if (at < lastRaceAt) return 2;
    if (Date.now() - at > MAX_AGE_MS) return 3;
    return 9;
  };
  const dQueue = activeDrivers
    .map((d) => ({ d, p: priority(dPrev.get(d.driver_id), (dPrev.get(d.driver_id)?.current_team ?? null) !== (teamOf.get(d.driver_id)?.constructor_id ?? null)) }))
    .filter((x) => x.p < 9)
    .sort((a, b) => a.p - b.p);
  const tQueue = activeTeams
    .map((c) => ({ c, p: priority(tPrev.get(c.constructor_id), (tPrev.get(c.constructor_id)?.lineup ?? "") !== [...(lineupIds.get(c.constructor_id) ?? [])].sort().join(",")) }))
    .filter((x) => x.p < 9)
    .sort((a, b) => a.p - b.p);

  const titles = [...new Set([...dQueue.map((x) => titleFromUrl(x.d.wiki_url)), ...tQueue.map((x) => titleFromUrl(x.c.wiki_url))].filter(Boolean))];
  const pages = titles.length ? await enPages(titles) : new Map<string, PageInfo>();
  const photoFiles = [...new Set(dQueue.map((x) => pages.get(titleFromUrl(x.d.wiki_url))?.image).filter(Boolean) as string[])];
  const photos = photoFiles.length ? await imageMeta(photoFiles) : new Map<string, ImageMeta>();

  const done = { drivers: 0, teams: 0 };
  const errors: string[] = [];
  // Zespoły i kierowców przeplatamy, żeby przy limicie czasu obie listy szły do przodu.
  const jobs: (() => Promise<void>)[] = [];
  const maxLen = Math.max(dQueue.length, tQueue.length);
  for (let i = 0; i < maxLen; i++) {
    const t = tQueue[i];
    if (t) jobs.push(async () => {
      const row = await teamProfile(t.c, ctx, pages.get(titleFromUrl(t.c.wiki_url)), tPrev.get(t.c.constructor_id));
      const { error } = await db.from("team_profiles").upsert(row);
      if (error) throw new Error(error.message);
      done.teams++;
    });
    for (const d of dQueue.slice(i * 2, i * 2 + 2)) {
      jobs.push(async () => {
        const page = pages.get(titleFromUrl(d.d.wiki_url));
        const row = await driverProfile(d.d, ctx, page, page?.image ? photos.get(page.image) : undefined, dPrev.get(d.d.driver_id));
        const { error } = await db.from("driver_profiles").upsert(row);
        if (error) throw new Error(error.message);
        done.drivers++;
      });
    }
  }
  for (const job of jobs) {
    if (outOfTime()) break;
    try {
      await job();
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return {
    season,
    done,
    left: { drivers: dQueue.length - done.drivers, teams: tQueue.length - done.teams },
    errors,
    ms: Date.now() - started,
  };
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-sync-token") ?? "";
  const { data: valid, error: authError } = await db.rpc("check_sync_token", { token });
  if (authError || !valid) return new Response("forbidden", { status: 403 });
  try {
    return Response.json({ ok: true, ...(await run()) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});

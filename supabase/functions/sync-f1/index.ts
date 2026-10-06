// sync-f1: pobiera dane bieżącego sezonu i listę mistrzów z Jolpica-F1 (następca Ergast),
// kolory zespołów z OpenF1, i zapisuje je w bazie. Frontend czyta wyłącznie z bazy.
// Wywołuje ją pg_cron z nagłówkiem x-sync-token (token leży w private.settings).
import { createClient } from "npm:@supabase/supabase-js@2";

const JOLPICA = "https://api.jolpi.ca/ergast/f1";
const OPENF1 = "https://api.openf1.org/v1";
const CHAMPION_SEASONS_PER_RUN = 20;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Jolpica pozwala na kilka zapytań na sekundę, więc między stronami robimy krótką przerwę.
async function jolpica(path: string, pause = 300): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${JOLPICA}${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Jolpica ${path}: HTTP ${res.status}`);
    await sleep(pause);
    return (await res.json()).MRData;
  }
  throw new Error(`Jolpica ${path}: limit zapytań`);
}

// Pobiera wszystkie strony; pick wyciąga tablicę z odpowiedzi.
async function jolpicaAll<T>(path: string, pick: (m: any) => T[]): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const m = await jolpica(`${path}${sep}limit=100&offset=${offset}`);
    out.push(...pick(m));
    offset += Number(m.limit);
    if (offset >= Number(m.total)) return out;
  }
}

const ts = (date?: string, time?: string) => (date ? (time ? `${date}T${time}` : `${date}T00:00:00Z`) : null);
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

function driverRow(d: any) {
  return {
    driver_id: d.driverId,
    code: d.code ?? null,
    permanent_number: num(d.permanentNumber),
    given_name: d.givenName,
    family_name: d.familyName,
    date_of_birth: d.dateOfBirth ?? null,
    nationality: d.nationality ?? null,
    wiki_url: d.url ?? null,
  };
}

function constructorRow(c: any) {
  return { constructor_id: c.constructorId, name: c.name, nationality: c.nationality ?? null, wiki_url: c.url ?? null };
}

// Upsert z usunięciem duplikatów klucza (np. ten sam kierowca w wielu wyścigach).
async function upsert(table: string, rows: Record<string, unknown>[], onConflict: string) {
  const keys = onConflict.split(",");
  const unique = [...new Map(rows.map((r) => [keys.map((k) => r[k]).join("|"), r])).values()];
  if (!unique.length) return;
  const { error } = await db.from(table).upsert(unique, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
}

// Nazwy zespołów w OpenF1 i Jolpica różnią się ("Red Bull Racing" vs "Red Bull"), więc porównujemy słowa kluczowe.
const ALIASES: Record<string, string[]> = {
  rb: ["racing bulls", "visa cash app", "alphatauri", "toro rosso"],
  sauber: ["kick sauber", "stake", "alfa romeo"],
  red_bull: ["red bull racing"],
};
function matchTeam(constructorId: string, name: string, openf1Team: string) {
  const a = openf1Team.toLowerCase();
  if ((ALIASES[constructorId] ?? []).some((x) => a.includes(x))) return true;
  if (constructorId === "red_bull" && a.includes("racing bulls")) return false;
  const first = name.toLowerCase().split(/\s+/)[0];
  return a.split(/\s+/)[0] === first;
}

async function syncTeamColours(constructors: { constructor_id: string; name: string }[]) {
  const res = await fetch(`${OPENF1}/drivers?session_key=latest`);
  if (!res.ok) return `OpenF1 HTTP ${res.status}`;
  const list: any[] = await res.json();
  let updated = 0;
  for (const c of constructors) {
    const hit = list.find((d) => d.team_name && d.team_colour && matchTeam(c.constructor_id, c.name, d.team_name));
    if (!hit || !/^[0-9A-Fa-f]{6}$/.test(hit.team_colour)) continue;
    const { error } = await db.from("constructors").update({ team_colour: hit.team_colour }).eq("constructor_id", c.constructor_id);
    if (!error) updated++;
  }
  return `kolory: ${updated}/${constructors.length}`;
}

async function run() {
  const detail: Record<string, unknown> = {};

  // 1. Kalendarz i tory
  const cal = await jolpica("/current.json?limit=100");
  const season = Number(cal.RaceTable.season);
  const races: any[] = cal.RaceTable.Races;
  await upsert("circuits", races.map((r) => ({
    circuit_id: r.Circuit.circuitId,
    name: r.Circuit.circuitName,
    locality: r.Circuit.Location?.locality ?? null,
    country: r.Circuit.Location?.country ?? null,
    lat: num(r.Circuit.Location?.lat),
    lng: num(r.Circuit.Location?.long),
    wiki_url: r.Circuit.url ?? null,
  })), "circuit_id");
  await upsert("races", races.map((r) => ({
    season,
    round: Number(r.round),
    name: r.raceName,
    circuit_id: r.Circuit.circuitId,
    race_start: ts(r.date, r.time),
    qualifying_start: ts(r.Qualifying?.date, r.Qualifying?.time),
    sprint_start: ts(r.Sprint?.date, r.Sprint?.time),
    fp1_start: ts(r.FirstPractice?.date, r.FirstPractice?.time),
    wiki_url: r.url ?? null,
  })), "season,round");
  detail.races = races.length;

  // 2. Kierowcy i zespoły sezonu
  const drivers = await jolpicaAll("/current/drivers.json", (m) => m.DriverTable.Drivers);
  const constructors = await jolpicaAll("/current/constructors.json", (m) => m.ConstructorTable.Constructors);
  await upsert("drivers", drivers.map(driverRow), "driver_id");
  await upsert("constructors", constructors.map(constructorRow), "constructor_id");
  detail.drivers = drivers.length;
  detail.constructors = constructors.length;

  // 3. Wyniki wyścigów (stronicowane po wierszach wyników, więc składamy rundy z kilku stron)
  const resultRaces = await jolpicaAll("/current/results.json", (m) => m.RaceTable.Races);
  const results = resultRaces.flatMap((r: any) => (r.Results ?? []).map((x: any) => ({
    season,
    round: Number(r.round),
    driver_id: x.Driver.driverId,
    constructor_id: x.Constructor?.constructorId ?? null,
    position: num(x.position),
    position_text: x.positionText ?? null,
    grid: num(x.grid),
    laps: num(x.laps),
    status: x.status ?? null,
    points: Number(x.points ?? 0),
  })));
  // Kierowca rezerwowy może pojawić się w wynikach, a nie w liście sezonu.
  const extra = resultRaces.flatMap((r: any) => (r.Results ?? []).map((x: any) => x.Driver));
  await upsert("drivers", extra.map(driverRow), "driver_id");
  await upsert("race_results", results, "season,round,driver_id");
  detail.results = results.length;

  // 4. Klasyfikacje
  const ds = await jolpica("/current/driverStandings.json?limit=100");
  const dList = ds.StandingsTable.StandingsLists[0];
  if (dList) {
    const rows = dList.DriverStandings.map((s: any) => ({
      season,
      after_round: Number(dList.round),
      position: num(s.position),
      driver_id: s.Driver.driverId,
      constructor_id: s.Constructors?.at(-1)?.constructorId ?? null,
      points: Number(s.points),
      wins: Number(s.wins),
    }));
    await upsert("drivers", dList.DriverStandings.map((s: any) => driverRow(s.Driver)), "driver_id");
    await upsert("driver_standings", rows, "season,driver_id");
    detail.driver_standings_round = Number(dList.round);
  }
  const cs = await jolpica("/current/constructorStandings.json?limit=100");
  const cList = cs.StandingsTable.StandingsLists[0];
  if (cList) {
    await upsert("constructor_standings", cList.ConstructorStandings.map((s: any) => ({
      season,
      after_round: Number(cList.round),
      position: num(s.position),
      constructor_id: s.Constructor.constructorId,
      points: Number(s.points),
      wins: Number(s.wins),
    })), "season,constructor_id");
  }

  // 5. Mistrzowie świata. Jolpica wymaga roku przy klasyfikacjach, więc dociągamy brakujące sezony
  // partiami (limit zapytań API), a bieżący dopiero po ostatniej rundzie.
  const lastRound = Math.max(0, ...races.map((r) => Number(r.round)));
  const seasonDone = resultRaces.some((r: any) => Number(r.round) === lastRound);
  const { data: have } = await db.from("champions").select("season");
  const known = new Set((have ?? []).map((r) => r.season));
  const missing: number[] = [];
  for (let y = 1950; y <= (seasonDone ? season : season - 1); y++) if (!known.has(y)) missing.push(y);
  // Każdy sezon zapisujemy od razu, żeby przy limicie zapytań nie stracić tego, co już pobrane.
  let added = 0;
  try {
    for (const y of missing.slice(0, CHAMPION_SEASONS_PER_RUN)) {
      const d = (await jolpica(`/${y}/driverStandings/1.json`, 700)).StandingsTable.StandingsLists[0]?.DriverStandings[0];
      if (!d) continue;
      const c = y >= 1958
        ? (await jolpica(`/${y}/constructorStandings/1.json`, 700)).StandingsTable.StandingsLists[0]?.ConstructorStandings[0]?.Constructor
        : null;
      await upsert("champions", [{
        season: y,
        driver_name: `${d.Driver.givenName} ${d.Driver.familyName}`,
        driver_nationality: d.Driver.nationality ?? null,
        driver_wiki_url: d.Driver.url ?? null,
        driver_team: d.Constructors?.map((x: any) => x.name).join(" / ") ?? null,
        driver_points: Number(d.points),
        driver_wins: Number(d.wins),
        constructor_name: c?.name ?? null,
        constructor_nationality: c?.nationality ?? null,
      }], "season");
      added++;
    }
  } catch (e) {
    detail.champions_error = (e as Error).message;
  }
  detail.champions_added = added;
  detail.champions_missing = missing.length - added;

  // 6. Kolory zespołów (dodatek: jeśli OpenF1 nie odpowie, reszta danych i tak jest aktualna)
  try {
    detail.openf1 = await syncTeamColours(constructors.map((c: any) => ({ constructor_id: c.constructorId, name: c.name })));
  } catch (e) {
    detail.openf1 = `pominięte: ${(e as Error).message}`;
  }

  return { season, detail };
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-sync-token") ?? "";
  const { data: valid, error: authError } = await db.rpc("check_sync_token", { token });
  if (authError || !valid) return new Response("forbidden", { status: 403 });

  const { data: recent } = await db.from("sync_runs").select("id")
    .gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString()).limit(1);
  if (recent?.length) return new Response("too soon", { status: 429 });

  const { data: runRow } = await db.from("sync_runs").insert({}).select("id").single();
  try {
    const { season, detail } = await run();
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, season, detail }).eq("id", runRow!.id);
    return Response.json({ ok: true, season, detail });
  } catch (e) {
    const message = (e as Error).message;
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, detail: { error: message } }).eq("id", runRow!.id);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});

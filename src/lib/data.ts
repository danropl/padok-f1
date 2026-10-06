import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { persistSession: false },
});

export type Compound = "soft" | "medium" | "hard";

export interface Driver {
  driver_id: string;
  code: string | null;
  permanent_number: number | null;
  given_name: string;
  family_name: string;
  date_of_birth: string | null;
  nationality: string | null;
  wiki_url: string | null;
}
export interface Constructor {
  constructor_id: string;
  name: string;
  nationality: string | null;
  wiki_url: string | null;
  team_colour: string | null;
}
export interface Circuit {
  circuit_id: string;
  name: string;
  locality: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  wiki_url: string | null;
}
export interface Race {
  season: number;
  round: number;
  name: string;
  circuit_id: string;
  race_start: string | null;
  qualifying_start: string | null;
  sprint_start: string | null;
  fp1_start: string | null;
  wiki_url: string | null;
}
export interface RaceResult {
  season: number;
  round: number;
  driver_id: string;
  constructor_id: string | null;
  position: number | null;
  position_text: string | null;
  grid: number | null;
  laps: number | null;
  status: string | null;
  points: number;
}
export interface DriverStanding {
  season: number;
  after_round: number;
  position: number | null;
  driver_id: string;
  constructor_id: string | null;
  points: number;
  wins: number;
}
export interface ConstructorStanding {
  season: number;
  after_round: number;
  position: number | null;
  constructor_id: string;
  points: number;
  wins: number;
}
export interface Champion {
  season: number;
  driver_name: string;
  driver_nationality: string | null;
  driver_wiki_url: string | null;
  driver_team: string | null;
  driver_points: number | null;
  driver_wins: number | null;
  constructor_name: string | null;
  constructor_nationality: string | null;
}
export interface GuideSection {
  slug: string;
  title: string;
  lede: string;
  body: string;
  compound: Compound;
  sort: number;
}
export interface GlossaryTerm {
  slug: string;
  term: string;
  definition: string;
  example: string | null;
  category: string;
}
export interface Series {
  slug: string;
  name: string;
  tier: number;
  tagline: string;
  body: string;
  facts: string[];
  official_url: string;
}
export interface Milestone {
  year: number;
  title: string;
  body: string;
}
export interface PointsRow {
  kind: "race" | "sprint";
  position: number;
  points: number;
}
export interface SyncRun {
  finished_at: string | null;
  ok: boolean | null;
}

export interface Tables {
  drivers: Driver;
  constructors: Constructor;
  circuits: Circuit;
  races: Race;
  race_results: RaceResult;
  driver_standings: DriverStanding;
  constructor_standings: ConstructorStanding;
  champions: Champion;
  guide_sections: GuideSection;
  glossary: GlossaryTerm;
  series: Series;
  milestones: Milestone;
  points_system: PointsRow;
  sync_runs: SyncRun;
}
export type TableName = keyof Tables;

// Jeśli baza nie odpowiada (np. projekt Supabase uśpiony), strona pokazuje ostatnią kopię danych
// zapisaną przy budowaniu w public/snapshot.json i mówi o tym wprost.
let snapshot: Promise<Partial<Record<TableName, unknown[]>> | null> | null = null;
function loadSnapshot() {
  snapshot ??= fetch(`${import.meta.env.BASE_URL}snapshot.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return snapshot;
}

let liveDown = false;
const cache = new Map<TableName, Promise<{ rows: unknown[]; fromSnapshot: boolean }>>();

// Klient Supabase ponawia nieudane zapytania, więc przy niedostępnej bazie przerywamy po kilku sekundach.
function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function fetchTable(name: TableName): Promise<{ rows: unknown[]; fromSnapshot: boolean }> {
  try {
    return await withTimeout(fetchLive(name), 6000);
  } catch {
    // Po pierwszej porażce kolejne podstrony od razu sięgają po kopię, zamiast znów czekać.
    liveDown = true;
    const snap = await loadSnapshot();
    const rows = snap?.[name];
    if (rows) return { rows, fromSnapshot: true };
    throw new Error("Nie udało się pobrać danych.");
  }
}

async function fetchLive(name: TableName) {
  if (liveDown) throw new Error("baza niedostępna");
  const all: unknown[] = [];
  // PostgREST oddaje maksymalnie 1000 wierszy naraz.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(name).select("*").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return { rows: all, fromSnapshot: false };
}

export function getTable<K extends TableName>(name: K) {
  if (!cache.has(name)) {
    const p = fetchTable(name);
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return cache.get(name)! as Promise<{ rows: Tables[K][]; fromSnapshot: boolean }>;
}

type Loaded<K extends readonly TableName[]> = { [I in keyof K]: Tables[K[I]][] };

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T; fromSnapshot: boolean };

// Wczytuje kilka tabel naraz. Dane są małe (kilkaset wierszy), więc filtrujemy po stronie przeglądarki.
export function useTables<const K extends readonly TableName[]>(...names: K): Load<Loaded<K>> {
  const [state, setState] = useState<Load<Loaded<K>>>({ status: "loading" });
  const key = names.join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(names.map((n) => getTable(n)))
      .then((res) => {
        if (!alive) return;
        setState({
          status: "ready",
          data: res.map((r) => r.rows) as Loaded<K>,
          fromSnapshot: res.some((r) => r.fromSnapshot),
        });
      })
      .catch((e: Error) => alive && setState({ status: "error", message: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export const fullName = (d: Pick<Driver, "given_name" | "family_name">) => `${d.given_name} ${d.family_name}`;

export function byId<T, K extends keyof T>(rows: T[], key: K) {
  return new Map(rows.map((r) => [r[key], r]));
}

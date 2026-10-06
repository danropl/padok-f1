// Zapisuje kopię wszystkich publicznych tabel do public/snapshot.json.
// Strona korzysta z niej tylko wtedy, gdy baza nie odpowiada (np. uśpiony darmowy projekt Supabase).
// Uruchamiane przy każdym buildzie w GitHub Actions: node scripts/snapshot.mjs
import { writeFile } from "node:fs/promises";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_KEY;
const tables = [
  "drivers", "constructors", "circuits", "races", "race_results", "driver_standings",
  "constructor_standings", "champions", "guide_sections", "glossary", "series", "milestones", "points_system",
];

const out = {};
for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.warn(`Pomijam ${t}: HTTP ${res.status}. Zostaje poprzednia kopia, jeśli istnieje.`);
    process.exit(0);
  }
  out[t] = await res.json();
}
await writeFile(new URL("../public/snapshot.json", import.meta.url), JSON.stringify(out));
console.log("snapshot.json:", Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(" "));

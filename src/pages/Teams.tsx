import { Link } from "react-router-dom";
import { DataGate, PageHead } from "../components/bits";
import { byId, fullName, useTables } from "../lib/data";
import { country } from "../lib/format";
import { useTitle } from "../lib/title";

export function Teams() {
  useTitle("Zespoły");
  const load = useTables("constructor_standings", "constructors", "driver_standings", "drivers");
  return (
    <article>
      <PageHead kicker="Zespoły" title="Klasyfikacja konstruktorów">
        <p>
          Tu liczą się punkty obu kierowców razem. Od miejsca w tej tabeli zależy, ile pieniędzy zespół dostanie od F1,
          dlatego walka o 7. miejsce bywa tak zacięta jak o tytuł.
        </p>
      </PageHead>
      <DataGate load={load}>
        {([cs, constructors, ds, drivers]) => {
          const cMap = byId(constructors, "constructor_id");
          const dMap = byId(drivers, "driver_id");
          const rows = [...cs].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
          const max = rows[0]?.points || 1;
          return (
            <ol className="teams">
              {rows.map((s) => {
                const t = cMap.get(s.constructor_id);
                if (!t) return null;
                const pair = ds.filter((d) => d.constructor_id === s.constructor_id).sort((a, b) => b.points - a.points);
                const colour = t.team_colour ? `#${t.team_colour}` : "var(--ink)";
                return (
                  <li key={t.constructor_id} className="team" style={{ ["--team" as string]: colour }}>
                    <div className="team__top">
                      <span className="team__pos">{s.position}</span>
                      <h2 className="team__name">{t.name}</h2>
                      <span className="team__pts">{s.points} pkt</span>
                    </div>
                    <span className="team__bar" aria-hidden="true">
                      <span style={{ width: `${(s.points / max) * 100}%` }} />
                    </span>
                    <p className="team__meta">
                      {country(t.nationality)}
                      {s.wins > 0 && ` · ${s.wins} ${s.wins === 1 ? "wygrana" : "wygranych"}`}
                    </p>
                    {pair.length > 0 && (
                      <ul className="team__drivers">
                        {pair.map((p) => {
                          const d = dMap.get(p.driver_id);
                          return d ? (
                            <li key={p.driver_id}>
                              <Link to={`/kierowcy/${d.driver_id}`}>{fullName(d)}</Link> <span className="muted">{p.points} pkt</span>
                            </li>
                          ) : null;
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          );
        }}
      </DataGate>
    </article>
  );
}

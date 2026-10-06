import { useMemo, useState } from "react";
import { DataGate, PageHead } from "../components/bits";
import { useTables, type Champion } from "../lib/data";
import { country } from "../lib/format";
import { useTitle } from "../lib/title";

export function History() {
  useTitle("Historia");
  const load = useTables("milestones", "champions");
  return (
    <article>
      <PageHead kicker="Historia" title="Ponad 75 lat w kilkunastu punktach">
        <p>Nie trzeba znać wszystkich sezonów. Wystarczy kilka momentów, do których komentatorzy wracają co roku.</p>
      </PageHead>
      <DataGate load={load}>
        {([milestones, champions]) => (
          <div className="history">
            <ol className="timeline">
              {[...milestones]
                .sort((a, b) => a.year - b.year)
                .map((m) => (
                  <li key={`${m.year}-${m.title}`}>
                    <span className="timeline__year">{m.year}</span>
                    <div>
                      <h2>{m.title}</h2>
                      <p>{m.body}</p>
                    </div>
                  </li>
                ))}
            </ol>
            <Champions rows={champions} />
          </div>
        )}
      </DataGate>
    </article>
  );
}

function Champions({ rows }: { rows: Champion[] }) {
  const [sort, setSort] = useState<"year" | "titles">("year");
  const titles = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.driver_name, (m.get(r.driver_name) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const multi = titles.filter(([, n]) => n >= 3);

  return (
    <section className="champions" aria-labelledby="champions-title">
      <h2 id="champions-title">Mistrzowie świata</h2>
      {rows.length === 0 ? (
        <p>Lista mistrzów właśnie się uzupełnia z bazy Jolpica-F1. Zajrzyj za kilka godzin.</p>
      ) : (
        <>
          <p>
            {rows.length} sezonów w bazie. Trzy i więcej tytułów ma {multi.length} kierowców:{" "}
            {multi.map(([n, c]) => `${n} (${c})`).join(", ")}.
          </p>
          <div className="filter" role="group" aria-label="Kolejność">
            <button type="button" aria-pressed={sort === "year"} onClick={() => setSort("year")}>
              Od najnowszych
            </button>
            <button type="button" aria-pressed={sort === "titles"} onClick={() => setSort("titles")}>
              Według liczby tytułów
            </button>
          </div>
          {sort === "year" ? (
            <div className="table-wrap">
              <table className="data data--text">
                <caption className="sr-only">Mistrzowie kierowców i konstruktorów według sezonów</caption>
                <thead>
                  <tr>
                    <th scope="col">Sezon</th>
                    <th scope="col">Kierowca</th>
                    <th scope="col" className="hide-sm">Zespół kierowcy</th>
                    <th scope="col">Mistrz konstruktorów</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => b.season - a.season)
                    .map((r) => (
                      <tr key={r.season}>
                        <th scope="row">{r.season}</th>
                        <td>
                          {r.driver_name}
                          <span className="muted"> · {country(r.driver_nationality)}</span>
                        </td>
                        <td className="hide-sm">{r.driver_team}</td>
                        <td>{r.constructor_name ?? <span className="muted">przed 1958</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ol className="title-count">
              {titles.map(([name, n]) => (
                <li key={name}>
                  <span className="title-count__n">{n}</span> {name}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

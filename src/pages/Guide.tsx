import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { COMPOUND_LABEL, CompoundTag, DataGate, PageHead, Prose, Tyre } from "../components/bits";
import { useTables, type Compound } from "../lib/data";
import { useTitle } from "../lib/title";

export function Guide() {
  useTitle("Poradnik");
  const load = useTables("guide_sections", "points_system");
  const [filter, setFilter] = useState<Compound | "all">("all");
  const { hash } = useLocation();

  // Linki z kotwicą (#flagi) działają też po wczytaniu danych.
  useEffect(() => {
    if (load.status !== "ready" || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView();
    el?.querySelector("h2")?.focus();
  }, [load.status, hash]);

  return (
    <article className="guide">
      <PageHead kicker="Poradnik" title="Jak oglądać F1 i wiedzieć, co się dzieje">
        <p>
          Dwanaście krótkich rozdziałów. Każdy ma oznaczenie mieszanki: czerwone wystarczą na pierwszy wyścig, białe
          możesz zostawić na później.
        </p>
      </PageHead>

      <div className="filter" role="group" aria-label="Pokaż rozdziały">
        {(["all", "soft", "medium", "hard"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "Wszystkie" : (
              <>
                <Tyre compound={f} size={16} /> {COMPOUND_LABEL[f]}
              </>
            )}
          </button>
        ))}
      </div>

      <DataGate load={load}>
        {([sections, points]) => (
          <>
            {sections
              .filter((s) => filter === "all" || s.compound === filter)
              .sort((a, b) => a.sort - b.sort)
              .map((s) => (
                <section key={s.slug} id={s.slug} className={`chapter chapter--${s.compound}`} aria-labelledby={`h-${s.slug}`}>
                  <CompoundTag compound={s.compound} />
                  <h2 id={`h-${s.slug}`} tabIndex={-1}>
                    {s.title}
                  </h2>
                  <p className="chapter__lede">{s.lede}</p>
                  <div className="chapter__body">
                    <div className="prose">
                      <Prose text={s.body} />
                    </div>
                    {s.slug === "punkty" && <PointsTable rows={points} />}
                  </div>
                </section>
              ))}
          </>
        )}
      </DataGate>
    </article>
  );
}

function PointsTable({ rows }: { rows: { kind: string; position: number; points: number }[] }) {
  const race = rows.filter((r) => r.kind === "race").sort((a, b) => a.position - b.position);
  const sprint = new Map(rows.filter((r) => r.kind === "sprint").map((r) => [r.position, r.points]));
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>Punkty za miejsca</caption>
        <thead>
          <tr>
            <th scope="col">Miejsce</th>
            <th scope="col">Wyścig</th>
            <th scope="col">Sprint</th>
          </tr>
        </thead>
        <tbody>
          {race.map((r) => (
            <tr key={r.position}>
              <th scope="row">{r.position}.</th>
              <td>{r.points}</td>
              <td>{sprint.get(r.position) ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

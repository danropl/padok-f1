import { Link } from "react-router-dom";
import { CompoundTag, DataGate, TeamSwatch, Tyre } from "../components/bits";
import { byId, fullName, useTables, type Compound } from "../lib/data";
import { countryName, daysUntil, inDays, raceName, weekdayTime } from "../lib/format";
import { useTitle } from "../lib/title";

export function Home() {
  useTitle(null);
  const load = useTables("races", "circuits", "driver_standings", "drivers", "constructors", "race_results", "guide_sections");

  return (
    <div className="home">
      <section className="home-intro">
        <p className="kicker">Przewodnik dla świeżych kibiców Formuły 1</p>
        <h1>
          Pierwszy wyścig za tobą, a&nbsp;w&nbsp;głowie same pytania? <em>To normalne.</em>
        </h1>
        <p className="home-intro__lede">
          Padok tłumaczy F1 po kolei: najpierw to, bez czego nie da się oglądać, potem strategia i przepisy, a na końcu
          historia i serie juniorskie. Dane o kierowcach, wynikach i kalendarzu są aktualne, bo ściągamy je z
          publicznych baz po każdym weekendzie.
        </p>
        <Link to="/poradnik" className="btn btn--primary">
          Zacznij od pięciominutowych podstaw
        </Link>
      </section>

      <DataGate load={load}>
        {([races, circuits, standings, drivers, constructors, results, guide]) => {
          const now = Date.now();
          const next = races
            .filter((r) => r.race_start && new Date(r.race_start).getTime() > now - 3 * 3600_000)
            .sort((a, b) => a.round - b.round)[0];
          const circuit = next && circuits.find((c) => c.circuit_id === next.circuit_id);
          const lastRound = Math.max(0, ...results.map((r) => r.round));
          const lastRace = races.find((r) => r.round === lastRound);
          const podium = results
            .filter((r) => r.round === lastRound && r.position && r.position <= 3)
            .sort((a, b) => a.position! - b.position!);
          const dMap = byId(drivers, "driver_id");
          const cMap = byId(constructors, "constructor_id");
          const top = [...standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(0, 10);
          const leaderPts = top[0]?.points ?? 0;
          const afterRound = top[0]?.after_round;

          return (
            <>
              <aside className="next-race" aria-labelledby="next-race-title">
                {next && circuit ? (
                  <>
                    <p className="kicker">Najbliższy weekend · runda {next.round}</p>
                    <h2 id="next-race-title">{raceName(next.name)}</h2>
                    <p className="next-race__where">
                      {circuit.locality}, {countryName(circuit.country)}
                    </p>
                    <p className="next-race__when">{inDays(daysUntil(next.race_start!))}</p>
                    <dl className="sessions">
                      {next.sprint_start && (
                        <>
                          <dt>Sprint</dt>
                          <dd>{weekdayTime(next.sprint_start)}</dd>
                        </>
                      )}
                      {next.qualifying_start && (
                        <>
                          <dt>Kwalifikacje</dt>
                          <dd>{weekdayTime(next.qualifying_start)}</dd>
                        </>
                      )}
                      <dt>Wyścig</dt>
                      <dd>{weekdayTime(next.race_start!)}</dd>
                    </dl>
                    <p className="small">Godziny w czasie polskim.</p>
                    <Link to={`/kalendarz/${next.round}`}>Co warto wiedzieć o tym torze</Link>
                  </>
                ) : (
                  <>
                    <p className="kicker">Przerwa między sezonami</p>
                    <h2 id="next-race-title">Następny wyścig pojawi się, gdy F1 opublikuje kalendarz</h2>
                  </>
                )}
              </aside>

              <section className="reading-path" aria-labelledby="path-title">
                <h2 id="path-title">Czytaj jak opony: od miękkich do twardych</h2>
                <p className="reading-path__lede">
                  Czerwone teksty to minimum na pierwszy wyścig. Żółte przydadzą się, gdy zaczniesz zauważać strategię.
                  Białe są dla tych, którzy chcą wiedzieć, skąd to wszystko się wzięło.
                </p>
                {(["soft", "medium", "hard"] as Compound[]).map((c) => (
                  <div key={c} className={`path-stint path-stint--${c}`}>
                    <CompoundTag compound={c} />
                    <ol>
                      {guide
                        .filter((g) => g.compound === c)
                        .sort((a, b) => a.sort - b.sort)
                        .map((g) => (
                          <li key={g.slug}>
                            <Link to={`/poradnik#${g.slug}`}>{g.title}</Link>
                          </li>
                        ))}
                    </ol>
                  </div>
                ))}
              </section>

              <section className="standings-mini" aria-labelledby="standings-title">
                <h2 id="standings-title">
                  Klasyfikacja kierowców{afterRound ? <span className="muted"> po {afterRound}. rundzie</span> : null}
                </h2>
                <ol className="bars">
                  {top.map((s) => {
                    const d = dMap.get(s.driver_id);
                    const team = s.constructor_id ? cMap.get(s.constructor_id) : undefined;
                    if (!d) return null;
                    return (
                      <li key={s.driver_id}>
                        <span className="bars__pos">{s.position}</span>
                        <Link to={`/kierowcy/${d.driver_id}`} className="bars__name">
                          {fullName(d)}
                        </Link>
                        <span className="bars__team">
                          <TeamSwatch colour={team?.team_colour ?? null} />
                          {team?.name}
                        </span>
                        <span className="bars__track" aria-hidden="true">
                          <span
                            className="bars__fill"
                            style={{
                              width: `${leaderPts ? (s.points / leaderPts) * 100 : 0}%`,
                              background: team?.team_colour ? `#${team.team_colour}` : undefined,
                            }}
                          />
                        </span>
                        <span className="bars__pts">{s.points} pkt</span>
                      </li>
                    );
                  })}
                </ol>
                <p>
                  <Link to="/kierowcy">Pełna lista kierowców</Link> · <Link to="/zespoly">Klasyfikacja zespołów</Link>
                </p>
              </section>

              <div className="home-side">
              {lastRace && podium.length > 0 && (
                <section className="last-race" aria-labelledby="last-title">
                  <h2 id="last-title">
                    Ostatnio: {raceName(lastRace.name)}
                  </h2>
                  <ol className="podium">
                    {podium.map((p) => {
                      const d = dMap.get(p.driver_id);
                      return (
                        <li key={p.driver_id}>
                          <span className="podium__pos">{p.position}</span>
                          {d ? fullName(d) : p.driver_id}
                        </li>
                      );
                    })}
                  </ol>
                  <Link to={`/kalendarz/${lastRace.round}`}>Pełne wyniki wyścigu</Link>
                </section>
              )}

              <section className="home-pl" aria-labelledby="pl-title">
                <Tyre compound="soft" size={40} />
                <div>
                  <h2 id="pl-title">A Polacy?</h2>
                  <p>
                    Jedyny Polak, który ścigał się w F1, to Robert Kubica. W 2008 roku wygrał Grand Prix Kanady. Jego
                    historię znajdziesz <Link to="/historia">na osi czasu</Link>.
                  </p>
                </div>
              </section>
              </div>
            </>
          );
        }}
      </DataGate>
    </div>
  );
}

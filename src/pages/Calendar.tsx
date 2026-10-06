import { Link, useParams } from "react-router-dom";
import { DataGate, PageHead } from "../components/bits";
import { setConsent, useConsent } from "../lib/consent";
import { byId, fullName, useTables, type Circuit } from "../lib/data";
import { countryName, dateTime, dayMonth, finishLabel, fullDate, raceName, weekdayTime } from "../lib/format";
import { useTitle } from "../lib/title";
import { NotFoundInline } from "./Drivers";

export function Calendar() {
  useTitle("Kalendarz");
  const load = useTables("races", "circuits", "race_results", "drivers");
  return (
    <article>
      <PageHead kicker="Kalendarz" title="Sezon wyścig po wyścigu">
        <p>Godziny w czasie polskim. Weekendy ze sprintem mają osobne oznaczenie, bo sobota wygląda w nich inaczej.</p>
      </PageHead>
      <DataGate load={load}>
        {([races, circuits, results, drivers]) => {
          const cMap = byId(circuits, "circuit_id");
          const dMap = byId(drivers, "driver_id");
          const now = Date.now();
          const nextRound = races
            .filter((r) => r.race_start && new Date(r.race_start).getTime() > now - 3 * 3600_000)
            .sort((a, b) => a.round - b.round)[0]?.round;
          return (
            <ol className="calendar">
              {[...races]
                .sort((a, b) => a.round - b.round)
                .map((r) => {
                  const c = cMap.get(r.circuit_id);
                  const winner = results.find((x) => x.round === r.round && x.position === 1);
                  const wd = winner && dMap.get(winner.driver_id);
                  const state = r.round === nextRound ? "next" : winner ? "done" : "future";
                  return (
                    <li key={r.round} className={`cal cal--${state}`}>
                      <span className="cal__round">{String(r.round).padStart(2, "0")}</span>
                      <div className="cal__main">
                        <Link to={`/kalendarz/${r.round}`} className="cal__name">
                          {raceName(r.name)}
                        </Link>
                        <span className="cal__where">
                          {c?.locality}, {countryName(c?.country ?? null)}
                        </span>
                      </div>
                      <div className="cal__side">
                        {r.race_start && <span className="cal__date">{dayMonth(r.race_start)}</span>}
                        {r.sprint_start && <span className="pill">sprint</span>}
                        {state === "next" && <span className="pill pill--next">następny</span>}
                        {wd && <span className="cal__winner">wygrał {fullName(wd)}</span>}
                      </div>
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

export function RacePage() {
  const { round } = useParams();
  const load = useTables("races", "circuits", "race_results", "drivers", "constructors");
  return (
    <DataGate load={load}>
      {([races, circuits, results, drivers, constructors]) => {
        const r = races.find((x) => String(x.round) === round);
        if (!r) return <NotFoundInline what="wyścigu" back="/kalendarz" />;
        const c = circuits.find((x) => x.circuit_id === r.circuit_id);
        const rows = results.filter((x) => x.round === r.round).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
        const dMap = byId(drivers, "driver_id");
        const tMap = byId(constructors, "constructor_id");
        return (
          <RaceView title={raceName(r.name)}>
            <header className="page-head">
              <p className="kicker">
                <Link to="/kalendarz">Kalendarz</Link> / runda {r.round}
              </p>
              <h1>{raceName(r.name)}</h1>
              <p className="page-head__lede">
                {c?.name}, {c?.locality}, {countryName(c?.country ?? null)}
                {r.race_start && <> · {fullDate(r.race_start)}</>}
              </p>
            </header>

            <div className="race-grid">
              <section aria-labelledby="sched">
                <h2 id="sched">Program weekendu</h2>
                <dl className="sessions sessions--wide">
                  {r.fp1_start && (<><dt>1. trening</dt><dd>{dateTime(r.fp1_start)}</dd></>)}
                  {r.sprint_start && (<><dt>Sprint</dt><dd>{weekdayTime(r.sprint_start)}</dd></>)}
                  {r.qualifying_start && (<><dt>Kwalifikacje</dt><dd>{weekdayTime(r.qualifying_start)}</dd></>)}
                  {r.race_start && (<><dt>Wyścig</dt><dd>{weekdayTime(r.race_start)}</dd></>)}
                </dl>
                <p className="small">Czas polski. Pozostałe treningi są w oficjalnym programie na formula1.com.</p>
              </section>
              {c && <CircuitMap c={c} />}
            </div>

            <section aria-labelledby="res">
              <h2 id="res">Wyniki</h2>
              {rows.length === 0 ? (
                <p>Wyścig jeszcze się nie odbył. Wyniki pojawią się tu kilka godzin po mecie.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Poz.</th>
                        <th scope="col">Kierowca</th>
                        <th scope="col" className="hide-sm">Zespół</th>
                        <th scope="col">Start</th>
                        <th scope="col">Status</th>
                        <th scope="col">Pkt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => {
                        const d = dMap.get(x.driver_id);
                        const t = x.constructor_id ? tMap.get(x.constructor_id) : undefined;
                        const fin = finishLabel(x);
                        const gained = x.grid && /^\d+$/.test(x.position_text ?? "") ? x.grid - x.position! : 0;
                        return (
                          <tr key={x.driver_id}>
                            <td>{fin.pos}</td>
                            <th scope="row">
                              <Link to={`/kierowcy/${x.driver_id}`}>{d ? fullName(d) : x.driver_id}</Link>
                            </th>
                            <td className="hide-sm">{t?.name}</td>
                            <td>
                              {x.grid ? x.grid : "aleja"}
                              {gained > 0 && <span className="gain"> +{gained}</span>}
                            </td>
                            <td>{fin.note}</td>
                            <td>{x.points || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </RaceView>
        );
      }}
    </DataGate>
  );
}

function RaceView({ title, children }: { title: string; children: React.ReactNode }) {
  useTitle(title);
  return <article className="race">{children}</article>;
}

// Mapa z OpenStreetMap ładuje się tylko po zgodzie, bo iframe wysyła adres IP do zewnętrznego serwera.
function CircuitMap({ c }: { c: Circuit }) {
  const consent = useConsent();
  if (c.lat == null || c.lng == null) return null;
  const d = 0.012;
  const bbox = [c.lng - d * 1.6, c.lat - d, c.lng + d * 1.6, c.lat + d].join(",");
  return (
    <section aria-labelledby="map-title">
      <h2 id="map-title">Gdzie leży tor</h2>
      {consent?.maps ? (
        <iframe
          className="map"
          title={`Mapa okolicy toru ${c.name}`}
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${c.lat},${c.lng}`}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="map map--off">
          <p>
            Mapa pochodzi z OpenStreetMap i po wczytaniu łączy się z ich serwerem. Pokażemy ją dopiero, gdy się na to
            zgodzisz.
          </p>
          <button type="button" className="btn" onClick={() => setConsent(true)}>
            Pokaż mapy torów
          </button>
        </div>
      )}
      <p className="small">
        Mapa © współtwórcy <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.
      </p>
    </section>
  );
}

import { Link, useParams } from "react-router-dom";
import { Credit, DataGate, PageHead, Picture, TeamSwatch, WikiExtract } from "../components/bits";
import { byId, fullName, useTables, type DriverProfile } from "../lib/data";
import { age, country, finishLabel, raceName } from "../lib/format";
import { useTitle } from "../lib/title";

export function Drivers() {
  useTitle("Kierowcy");
  const load = useTables("driver_standings", "drivers", "constructors", "driver_profiles");
  return (
    <article>
      <PageHead kicker="Kierowcy" title="Kto jeździ w tym sezonie">
        <p>
          Kolejność według punktów. Kolor przy nazwisku to barwy zespołu, a numer to stały numer startowy, który kierowca
          wybiera na całą karierę.
        </p>
      </PageHead>
      <DataGate load={load}>
        {([standings, drivers, constructors, profiles]) => {
          const dMap = byId(drivers, "driver_id");
          const pMap = byId(profiles, "driver_id");
          const cMap = byId(constructors, "constructor_id");
          const rows = [...standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
          return (
            <ol className="grid-list">
              {rows.map((s) => {
                const d = dMap.get(s.driver_id);
                const t = s.constructor_id ? cMap.get(s.constructor_id) : undefined;
                if (!d) return null;
                const photo = pMap.get(d.driver_id)?.image_url ?? null;
                return (
                  <li key={d.driver_id} className="driver-row" style={{ ["--team" as string]: t?.team_colour ? `#${t.team_colour}` : "var(--line)" }}>
                    <span className="driver-row__pos" aria-label={`Miejsce ${s.position}`}>{s.position}</span>
                    {photo ? (
                      <Picture src={photo} alt="" className="driver-row__photo" />
                    ) : (
                      <span className="driver-row__num" aria-hidden="true">{d.permanent_number ?? ""}</span>
                    )}
                    <div className="driver-row__main">
                      <Link to={`/kierowcy/${d.driver_id}`} className="driver-row__name">
                        {d.given_name} <strong>{d.family_name}</strong>
                      </Link>
                      <span className="driver-row__meta">
                        {photo && d.permanent_number ? `#${d.permanent_number} · ` : ""}
                        {t?.name} · {country(d.nationality)}
                      </span>
                    </div>
                    <span className="driver-row__pts">
                      {s.points}
                      <span className="muted"> pkt</span>
                    </span>
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

export function DriverPage() {
  const { id } = useParams();
  const load = useTables("drivers", "driver_standings", "constructors", "race_results", "races", "driver_profiles");
  return (
    <DataGate load={load}>
      {([drivers, standings, constructors, results, races, profiles]) => {
        const d = drivers.find((x) => x.driver_id === id);
        if (!d) return <NotFoundInline what="kierowcy" back="/kierowcy" />;
        const s = standings.find((x) => x.driver_id === id);
        const team = s?.constructor_id ? constructors.find((c) => c.constructor_id === s.constructor_id) : undefined;
        const mine = results.filter((r) => r.driver_id === id).sort((a, b) => a.round - b.round);
        const rMap = byId(races, "round");
        const classified = mine.filter((r) => /^\d+$/.test(r.position_text ?? ""));
        const podiums = classified.filter((r) => r.position! <= 3).length;
        const best = Math.min(99, ...classified.map((r) => r.position!));
        const mate = standings.find((x) => x.constructor_id === s?.constructor_id && x.driver_id !== id);
        const mateDriver = mate && drivers.find((x) => x.driver_id === mate.driver_id);
        return (
          <DriverView
            name={fullName(d)}
            d={d}
            team={team}
            s={s}
            podiums={podiums}
            best={best}
            mine={mine}
            rMap={rMap}
            profile={profiles.find((p) => p.driver_id === id)}
            mate={mate && mateDriver ? { id: mateDriver.driver_id, name: fullName(mateDriver), points: mate.points } : undefined}
          />
        );
      }}
    </DataGate>
  );
}

function DriverView(props: {
  name: string;
  d: import("../lib/data").Driver;
  team?: import("../lib/data").Constructor;
  s?: import("../lib/data").DriverStanding;
  podiums: number;
  best: number;
  mine: import("../lib/data").RaceResult[];
  rMap: Map<number, import("../lib/data").Race>;
  mate?: { id: string; name: string; points: number };
  profile?: DriverProfile;
}) {
  const { name, d, team, s, podiums, best, mine, rMap, mate, profile } = props;
  useTitle(name);
  return (
    <article className="driver" style={{ ["--team" as string]: team?.team_colour ? `#${team.team_colour}` : "var(--ink)" }}>
      <header className={`driver__head${profile?.image_url ? " driver__head--photo" : ""}`}>
        {profile?.image_url && (
          <Picture src={profile.image_url} alt={`${name}, zdjęcie portretowe`} className="driver__photo" />
        )}
        <p className="kicker">
          <Link to="/kierowcy">Kierowcy</Link> / {team?.name ?? "bez zespołu w tym sezonie"}
        </p>
        <h1>
          {d.given_name} <span className="driver__family">{d.family_name}</span>
        </h1>
        {d.permanent_number && <p className="driver__bignum" aria-label={`Numer startowy ${d.permanent_number}`}>{d.permanent_number}</p>}
      </header>

      {profile && <Career p={profile} />}

      <h2>Sezon {s?.season ?? ""}</h2>
      <dl className="stats">
        <div><dt>Miejsce w sezonie</dt><dd>{s?.position ?? "–"}</dd></div>
        <div><dt>Punkty</dt><dd>{s?.points ?? 0}</dd></div>
        <div><dt>Wygrane</dt><dd>{s?.wins ?? 0}</dd></div>
        <div><dt>Podia</dt><dd>{podiums}</dd></div>
        <div><dt>Najlepszy wynik</dt><dd>{best < 99 ? `${best}.` : "–"}</dd></div>
        {d.date_of_birth && <div><dt>Wiek</dt><dd>{age(d.date_of_birth)}</dd></div>}
        <div><dt>Kraj</dt><dd>{country(d.nationality)}</dd></div>
      </dl>

      {mate && s && (
        <p className="driver__mate">
          Partner z zespołu: <Link to={`/kierowcy/${mate.id}`}>{mate.name}</Link>, {mate.points} pkt.{" "}
          {s.points === mate.points
            ? "Remis w punktach."
            : s.points > mate.points
              ? `${d.family_name} prowadzi w wewnętrznym pojedynku o ${s.points - mate.points} pkt.`
              : `${d.family_name} traci do partnera ${mate.points - s.points} pkt.`}{" "}
          To najuczciwsze porównanie w F1, bo obaj jeżdżą tym samym autem.
        </p>
      )}

      <h2>Wyścig po wyścigu</h2>
      {mine.length === 0 ? (
        <p>W tym sezonie kierowca nie ma jeszcze wyników w wyścigach.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Runda</th>
                <th scope="col">Grand Prix</th>
                <th scope="col">Start</th>
                <th scope="col">Meta</th>
                <th scope="col">Pkt</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.round}>
                  <td>{r.round}</td>
                  <th scope="row">
                    <Link to={`/kalendarz/${r.round}`}>{raceName(rMap.get(r.round)?.name ?? "")}</Link>
                  </th>
                  <td>{r.grid ? r.grid : "aleja"}</td>
                  <td>{(({ pos, note }) => (pos === "–" ? note : note ? `${pos} ${note.toLowerCase()}` : pos))(finishLabel(r))}</td>
                  <td>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {profile && <WikiExtract text={profile.wiki_extract} url={profile.wiki_url} />}
      {!profile?.wiki_url && d.wiki_url && (
        <p className="small">
          Więcej o karierze: <a href={d.wiki_url} rel="noopener">{name} w Wikipedii (po angielsku)</a>
        </p>
      )}
      {profile && <Credit c={profile} what="Zdjęcie" />}
      {team && (
        <p className="small">
          <TeamSwatch colour={team.team_colour} /> <Link to="/zespoly">{team.name} w klasyfikacji zespołów</Link>
        </p>
      )}
    </article>
  );
}

// Skrót kariery: tekst i liczby składa skrypt sync-profiles z wyników Jolpica-F1, więc po transferze
// albo kolejnym wyścigu opis zmienia się sam.
function Career({ p }: { p: DriverProfile }) {
  const st = p.stats;
  return (
    <section className="career" aria-labelledby="career-title">
      <h2 id="career-title">Kariera w skrócie</h2>
      <p className="career__summary">{p.summary}</p>
      <dl className="stats stats--career">
        <div><dt>Starty</dt><dd>{st.starts}</dd></div>
        <div><dt>Zwycięstwa</dt><dd>{st.wins}</dd></div>
        <div><dt>Podia</dt><dd>{st.podiums}</dd></div>
        <div><dt>Pole position</dt><dd>{st.poles}</dd></div>
        <div><dt>Tytuły</dt><dd>{st.titles.length}</dd></div>
      </dl>
      {st.career.length > 0 && (
        <ol className="stints" aria-label="Zespoły w karierze">
          {st.career.map((c, i) => (
            <li key={`${c.team}-${c.from}-${i}`}>
              <span className="stints__years">{c.from === c.to ? c.from : `${c.from}–${String(c.to).slice(2)}`}</span>
              <span className="stints__team">{c.team}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="small muted">
        Opis składa się automatycznie z wyników F1 i odświeża po każdym wyścigu oraz po zmianie zespołu (ostatnio{" "}
        {new Date(p.updated_at).toLocaleDateString("pl-PL")}).
      </p>
    </section>
  );
}

export function NotFoundInline({ what, back }: { what: string; back: string }) {
  return (
    <article>
      <h1>Nie ma takiego {what}</h1>
      <p>
        Może link jest stary albo literówka wkradła się w adres. <Link to={back}>Wróć do listy</Link>.
      </p>
    </article>
  );
}

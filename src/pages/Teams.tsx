import { Link, useParams } from "react-router-dom";
import { Credit, DataGate, PageHead, Picture, WikiExtract } from "../components/bits";
import { byId, fullName, useTables, type TeamProfile } from "../lib/data";
import { country, raceName } from "../lib/format";
import { useTitle } from "../lib/title";
import { NotFoundInline } from "./Drivers";

export function Teams() {
  useTitle("Zespoły");
  const load = useTables("constructor_standings", "constructors", "driver_standings", "drivers", "team_profiles");
  return (
    <article>
      <PageHead kicker="Zespoły" title="Klasyfikacja konstruktorów">
        <p>
          Tu liczą się punkty obu kierowców razem. Od miejsca w tej tabeli zależy, ile pieniędzy zespół dostanie od F1,
          dlatego walka o 7. miejsce bywa tak zacięta jak o tytuł.
        </p>
      </PageHead>
      <DataGate load={load}>
        {([cs, constructors, ds, drivers, profiles]) => {
          const cMap = byId(constructors, "constructor_id");
          const dMap = byId(drivers, "driver_id");
          const pMap = byId(profiles, "constructor_id");
          const rows = [...cs].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
          const max = rows[0]?.points || 1;
          return (
            <ol className="teams">
              {rows.map((s) => {
                const t = cMap.get(s.constructor_id);
                if (!t) return null;
                const p = pMap.get(t.constructor_id);
                const pair = ds.filter((d) => d.constructor_id === s.constructor_id).sort((a, b) => b.points - a.points);
                const colour = t.team_colour ? `#${t.team_colour}` : "var(--ink)";
                return (
                  <li key={t.constructor_id} className="team" style={{ ["--team" as string]: colour }}>
                    <div className="team__top">
                      <span className="team__pos">{s.position}</span>
                      <h2 className="team__name">
                        <Link to={`/zespoly/${t.constructor_id}`}>{t.name}</Link>
                      </h2>
                      <span className="team__pts">{s.points} pkt</span>
                    </div>
                    <span className="team__bar" aria-hidden="true">
                      <span style={{ width: `${(s.points / max) * 100}%` }} />
                    </span>
                    <div className="team__body">
                      {p?.image_url && (
                        <span className="logo-plate logo-plate--small">
                          <Picture src={p.image_url} alt={`Logo zespołu ${t.name}`} />
                        </span>
                      )}
                      <div>
                        <p className="team__meta">
                          {country(t.nationality)}
                          {s.wins > 0 && ` · ${s.wins} ${s.wins === 1 ? "wygrana" : "wygranych"}`}
                          {p?.sponsors.length ? ` · sponsor tytularny: ${p.sponsors.join(", ")}` : ""}
                        </p>
                        {pair.length > 0 && (
                          <ul className="team__drivers">
                            {pair.map((x) => {
                              const d = dMap.get(x.driver_id);
                              return d ? (
                                <li key={x.driver_id}>
                                  <Link to={`/kierowcy/${d.driver_id}`}>{fullName(d)}</Link>{" "}
                                  <span className="muted">{x.points} pkt</span>
                                </li>
                              ) : null;
                            })}
                          </ul>
                        )}
                      </div>
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

export function TeamPage() {
  const { id } = useParams();
  const load = useTables("constructors", "constructor_standings", "driver_standings", "drivers", "team_profiles", "driver_profiles");
  return (
    <DataGate load={load}>
      {([constructors, cs, ds, drivers, profiles, dProfiles]) => {
        const t = constructors.find((c) => c.constructor_id === id);
        if (!t) return <NotFoundInline what="zespołu" back="/zespoly" />;
        const s = cs.find((x) => x.constructor_id === id);
        const p = profiles.find((x) => x.constructor_id === id);
        const dMap = byId(drivers, "driver_id");
        const dpMap = byId(dProfiles, "driver_id");
        const pair = ds
          .filter((d) => d.constructor_id === id)
          .sort((a, b) => b.points - a.points)
          .map((x) => ({ x, d: dMap.get(x.driver_id), photo: dpMap.get(x.driver_id)?.image_url ?? null }))
          .filter((r) => r.d);
        return <TeamView name={t.name} colour={t.team_colour} nationality={t.nationality} s={s} p={p} pair={pair} />;
      }}
    </DataGate>
  );
}

function TeamView(props: {
  name: string;
  colour: string | null;
  nationality: string | null;
  s?: import("../lib/data").ConstructorStanding;
  p?: TeamProfile;
  pair: { x: import("../lib/data").DriverStanding; d?: import("../lib/data").Driver; photo: string | null }[];
}) {
  const { name, colour, nationality, s, p, pair } = props;
  useTitle(name);
  const st = p?.stats;
  return (
    <article className="team-page" style={{ ["--team" as string]: colour ? `#${colour}` : "var(--ink)" }}>
      <header className="team-page__head">
        <p className="kicker">
          <Link to="/zespoly">Zespoły</Link> / {country(nationality)}
        </p>
        <div className="team-page__title">
          <div>
            <h1>{name}</h1>
            {p?.official_name && p.official_name !== name && <p className="team-page__official">{p.official_name}</p>}
          </div>
          {p?.image_url && (
            <span className="logo-plate">
              <Picture src={p.image_url} alt={`Logo zespołu ${name}`} />
            </span>
          )}
        </div>
      </header>

      {p && (
        <dl className="facts">
          <div>
            <dt>Sponsorzy tytularni</dt>
            <dd>{p.sponsors.length ? p.sponsors.join(", ") : "brak w oficjalnej nazwie"}</dd>
          </div>
          {p.principal && (
            <div>
              <dt>Szef zespołu</dt>
              <dd>{p.principal}</dd>
            </div>
          )}
          {p.base && (
            <div>
              <dt>Siedziba</dt>
              <dd>{p.base}</dd>
            </div>
          )}
          {p.previous_names.length > 0 && (
            <div>
              <dt>Wcześniej jako</dt>
              <dd>{p.previous_names.join(", ")}</dd>
            </div>
          )}
        </dl>
      )}
      {p && (
        <p className="small muted facts__note">
          Sponsor tytularny to firma, której nazwa jest w oficjalnej nazwie zgłoszenia, np. „Oracle” w „Oracle Red Bull
          Racing”. Dlatego tę nazwę słychać w transmisjach i widać w oficjalnych wynikach.
        </p>
      )}

      <h2>Skład na ten sezon</h2>
      {pair.length === 0 ? (
        <p>Zespół nie ma jeszcze punktów w tym sezonie.</p>
      ) : (
        <ul className="lineup">
          {pair.map(({ x, d, photo }) => (
            <li key={x.driver_id}>
              <Link to={`/kierowcy/${d!.driver_id}`} className="lineup__card">
                {photo ? <Picture src={photo} alt="" className="lineup__photo" /> : <span className="lineup__num">{d!.permanent_number}</span>}
                <span>
                  <span className="lineup__name">{fullName(d!)}</span>
                  <span className="muted">
                    {x.position}. miejsce · {x.points} pkt
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {p && st && (
        <section aria-labelledby="team-history">
          <h2 id="team-history">Zespół w skrócie</h2>
          <p className="career__summary">{p.summary}</p>
          <dl className="stats stats--career">
            <div><dt>Grand Prix</dt><dd>{st.entries}</dd></div>
            <div><dt>Zwycięstwa</dt><dd>{st.wins}</dd></div>
            <div><dt>Podia</dt><dd>{st.podiums}</dd></div>
            <div><dt>Pole position</dt><dd>{st.poles}</dd></div>
            <div><dt>Tytuły konstruktorów</dt><dd>{st.constructor_titles.length}</dd></div>
          </dl>
          {st.first_race && (
            <p className="small muted">
              Liczby dotyczą startów pod nazwą {name}, od {raceName(st.first_race.name)} {st.first_race.season}. Opis
              składa się automatycznie z wyników F1 i Wikipedii i odświeża po każdym wyścigu oraz po zmianie składu.
            </p>
          )}
        </section>
      )}

      {s && (
        <p>
          W tym sezonie: {s.position}. miejsce w klasyfikacji konstruktorów, {s.points} pkt.
        </p>
      )}
      {p && <WikiExtract text={p.wiki_extract} url={p.wiki_url} />}
      {p && <Credit c={p} what="Logo" />}
      {p?.image_url && (
        <p className="small muted">Logo jest znakiem towarowym zespołu i służy tu wyłącznie do jego rozpoznania.</p>
      )}
    </article>
  );
}

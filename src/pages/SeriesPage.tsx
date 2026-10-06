import { DataGate, PageHead } from "../components/bits";
import { useTables } from "../lib/data";
import { useTitle } from "../lib/title";

export function SeriesPage() {
  useTitle("Serie");
  const load = useTables("series");
  return (
    <article>
      <PageHead kicker="Serie towarzyszące" title="Drabina do Formuły 1">
        <p>
          Prawie każdy kierowca F1 przeszedł przez te same szczeble. W weekend wyścigowy na torze często jeżdżą też F2,
          F3 albo F1 Academy, więc warto wiedzieć, na co patrzysz w sobotę rano.
        </p>
      </PageHead>
      <DataGate load={load}>
        {([series]) => (
          <ol className="ladder">
            {[...series]
              .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
              .map((s) => (
                <li key={s.slug} className={`ladder__rung ladder__rung--t${s.tier}`}>
                  <h2>{s.name}</h2>
                  <p className="ladder__tagline">{s.tagline}</p>
                  <p>{s.body.split(/\n\s*\n/).map((p, i) => <span key={i} className="para">{p}</span>)}</p>
                  <ul className="facts">
                    {s.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <a href={s.official_url} rel="noopener">
                    Oficjalna strona: {s.name}
                  </a>
                </li>
              ))}
          </ol>
        )}
      </DataGate>
      <p className="small">
        Wyniki F2, F3 i F1 Academy nie są dostępne w darmowych publicznych API, z których korzystamy, więc zamiast
        przepisywać je ręcznie odsyłamy do oficjalnych stron serii.
      </p>
    </article>
  );
}

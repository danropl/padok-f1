import { useId, useState } from "react";
import { DataGate, PageHead } from "../components/bits";
import { useTables } from "../lib/data";
import { useTitle } from "../lib/title";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

export function Glossary() {
  useTitle("Słownik");
  const load = useTables("glossary");
  const [q, setQ] = useState("");
  const inputId = useId();

  return (
    <article>
      <PageHead kicker="Słownik" title="Co oni właściwie mówią">
        <p>Komentatorzy rzucają skrótami i angielskimi słowami. Tu jest ściąga, którą możesz mieć otwartą w czasie wyścigu.</p>
      </PageHead>

      <div className="search">
        <label htmlFor={inputId}>Szukaj hasła</label>
        <input id={inputId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="np. undercut, VSC, docisk" autoComplete="off" />
      </div>

      <DataGate load={load}>
        {([terms]) => {
          const nq = norm(q.trim());
          const hits = terms
            .filter((t) => !nq || norm(t.term).includes(nq) || norm(t.definition).includes(nq))
            .sort((a, b) => a.term.localeCompare(b.term, "pl"));
          const cats = [...new Set(hits.map((t) => t.category))].sort((a, b) => a.localeCompare(b, "pl"));
          return (
            <>
              <p className="small" role="status" aria-live="polite">
                {nq ? `Znaleziono: ${hits.length}` : `${terms.length} haseł`}
              </p>
              {hits.length === 0 && <p>Nie mamy jeszcze tego hasła. Napisz, czego brakuje, przez formularz pytań.</p>}
              <div className="glossary">
                {cats.map((c) => (
                  <section key={c} aria-labelledby={`cat-${c}`}>
                    <h2 id={`cat-${c}`} className="glossary__cat">{c}</h2>
                    <dl>
                      {hits
                        .filter((t) => t.category === c)
                        .map((t) => (
                          <div key={t.slug} id={t.slug} className="glossary__item">
                            <dt>{t.term}</dt>
                            <dd>
                              {t.definition}
                              {t.example && <span className="glossary__example">„{t.example}”</span>}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </section>
                ))}
              </div>
            </>
          );
        }}
      </DataGate>
    </article>
  );
}

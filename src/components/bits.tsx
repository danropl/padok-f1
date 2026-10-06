import { Fragment, type ReactNode } from "react";
import type { Compound, Load } from "../lib/data";

export const COMPOUND_LABEL: Record<Compound, string> = {
  soft: "Miękka",
  medium: "Pośrednia",
  hard: "Twarda",
};
export const COMPOUND_TIME: Record<Compound, string> = {
  soft: "na 5 minut",
  medium: "na wieczór",
  hard: "dla wytrwałych",
};

// Bok opony z kolorowym paskiem mieszanki: znak rozpoznawczy serwisu, rysowany ręcznie, nie z zestawu ikon.
export function Tyre({ compound, size = 28 }: { compound: Compound; size?: number }) {
  return (
    <svg className={`tyre tyre--${compound}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" className="tyre__rubber" />
      <circle cx="16" cy="16" r="11.5" className="tyre__band" fill="none" strokeWidth="2.6" strokeDasharray="15 3" />
      <circle cx="16" cy="16" r="6.5" className="tyre__rim" />
      <circle cx="16" cy="16" r="2" className="tyre__nut" />
    </svg>
  );
}

export function CompoundTag({ compound }: { compound: Compound }) {
  return (
    <span className={`compound-tag compound-tag--${compound}`}>
      <Tyre compound={compound} size={18} />
      {COMPOUND_LABEL[compound]} <span className="compound-tag__time">· {COMPOUND_TIME[compound]}</span>
    </span>
  );
}

// Treści z bazy: akapity rozdzielone pustą linią, linie zaczynające się od "- " to punkty listy.
export function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{emphasizeLead(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{b}</p>;
      })}
    </>
  );
}

// "Czerwona: opis" → pogrubiony początek przed dwukropkiem, żeby listę dało się przeskanować wzrokiem.
function emphasizeLead(line: string) {
  const m = line.match(/^([^:]{1,40}):\s(.*)$/);
  if (!m) return line;
  return (
    <Fragment>
      <strong>{m[1]}:</strong> {m[2]}
    </Fragment>
  );
}

export function DataGate<T>({ load, children }: { load: Load<T>; children: (data: T) => ReactNode }) {
  if (load.status === "loading") {
    return (
      <p className="data-note" role="status">
        Wczytuję dane z bazy…
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <p className="data-note data-note--error" role="alert">
        Nie udało się pobrać danych. Odśwież stronę za chwilę, a jeśli to nie pomoże, napisz do nas przez formularz.
      </p>
    );
  }
  return (
    <>
      {load.fromSnapshot && (
        <p className="data-note" role="status">
          Baza chwilowo nie odpowiada, więc pokazujemy ostatnią zapisaną kopię danych. Wyniki mogą być nieaktualne.
        </p>
      )}
      {children(load.data)}
    </>
  );
}

export function TeamSwatch({ colour, label }: { colour: string | null; label?: string }) {
  return (
    <span
      className="swatch"
      style={{ background: colour ? `#${colour}` : "var(--line)" }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    />
  );
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <p className="kicker">{kicker}</p>
      <h1>{title}</h1>
      {children && <div className="page-head__lede">{children}</div>}
    </header>
  );
}

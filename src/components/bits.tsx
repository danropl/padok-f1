import { Fragment, useState, type ReactNode } from "react";
import { SNAPSHOT_ONLY, type Compound, type ImageCredit, type Load } from "../lib/data";

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
          {SNAPSHOT_ONLY
            ? "To podgląd strony z kopią danych zapisaną przy budowaniu. Opublikowana strona czyta bazę na bieżąco."
            : "Baza chwilowo nie odpowiada, więc pokazujemy ostatnią zapisaną kopię danych. Wyniki mogą być nieaktualne."}
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

// Zdjęcia i loga pochodzą z Wikimedia Commons (wolne licencje) i leżą w naszym Supabase Storage.
// Gdy obraz się nie wczyta (np. podgląd bez sieci), znika zamiast zostawiać pustą ramkę.
export function Picture({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

// Podpis wymagany przez licencje CC: autor, licencja z linkiem, źródło.
export function Credit({ c, what }: { c: ImageCredit; what: string }) {
  if (!c.image_url || !c.image_page) return null;
  return (
    <p className="credit">
      {what}: {c.image_author ?? "autor nieznany"},{" "}
      {c.image_license_url ? <a href={c.image_license_url} rel="noopener license">{c.image_license}</a> : c.image_license},{" "}
      <a href={c.image_page} rel="noopener">Wikimedia Commons</a>
    </p>
  );
}

// Wstęp z polskiej Wikipedii na licencji CC BY-SA 4.0, zawsze z linkiem do artykułu.
export function WikiExtract({ text, url }: { text: string | null; url: string | null }) {
  if (!text || !url) return null;
  return (
    <figure className="wiki-extract">
      <blockquote cite={url}>
        <p>{text}</p>
      </blockquote>
      <figcaption>
        Fragment artykułu z <a href={url} rel="noopener">polskiej Wikipedii</a>, licencja{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl" rel="noopener license">CC BY-SA 4.0</a>.
      </figcaption>
    </figure>
  );
}

import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { reopenConsent, setConsent, useConsent } from "../lib/consent";
import { SITE } from "../site";

const NAV = [
  { to: "/poradnik", label: "Poradnik" },
  { to: "/kalendarz", label: "Kalendarz" },
  { to: "/kierowcy", label: "Kierowcy" },
  { to: "/zespoly", label: "Zespoły" },
  { to: "/serie", label: "Serie" },
  { to: "/historia", label: "Historia" },
  { to: "/slownik", label: "Słownik" },
];

export function Layout() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Po zmianie strony przewijamy na górę i przenosimy fokus na treść, żeby czytnik ekranu zaczął od nagłówka.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    main.current?.focus();
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#tresc" onClick={(e) => (e.preventDefault(), main.current?.focus())}>
        Przejdź do treści
      </a>
      <header className="site-head">
        <Link to="/" className="wordmark" aria-label="Padok, strona główna">
          <span className="wordmark__p">P</span>adok
        </Link>
        <nav aria-label="Główna nawigacja" className="site-nav">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to}>{n.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="tresc" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <ConsentBanner />
    </>
  );
}

function Footer() {
  return (
    <footer className="site-foot">
      <div className="site-foot__grid">
        <div>
          <p className="wordmark wordmark--small">
            <span className="wordmark__p">P</span>adok
          </p>
          <p className="site-foot__note">
            Nieoficjalny przewodnik dla kibiców. Nie jesteśmy związani z Formula One Group, FIA ani żadnym zespołem.
            Nazwy serii i zespołów należą do ich właścicieli.
          </p>
          <p className="site-foot__note">
            Dane sportowe: <a href="https://github.com/jolpica/jolpica-f1">Jolpica-F1</a> i{" "}
            <a href="https://openf1.org">OpenF1</a>, odświeżane co 6 godzin.
          </p>
        </div>
        <nav aria-label="Informacje">
          <ul className="site-foot__links">
            <li><Link to="/pytanie">Zadaj pytanie lub zgłoś błąd</Link></li>
            <li><Link to="/o-serwisie">O serwisie i kontakt</Link></li>
            <li><Link to="/regulamin">Regulamin</Link></li>
            <li><Link to="/prywatnosc">Polityka prywatności</Link></li>
            <li><Link to="/cookies">Polityka cookies</Link></li>
            <li><Link to="/zwroty">Polityka zwrotów</Link></li>
            <li>
              <button type="button" className="linklike" onClick={reopenConsent}>
                Zmień ustawienia prywatności
              </button>
            </li>
          </ul>
        </nav>
      </div>
      <p className="site-foot__owner">© {new Date().getFullYear()} {SITE.owner}</p>
    </footer>
  );
}

function ConsentBanner() {
  const consent = useConsent();
  if (consent) return null;
  return (
    <section className="consent" aria-labelledby="consent-title" role="region">
      <h2 id="consent-title">Zanim zaczniesz</h2>
      <p>
        Nie śledzimy cię: bez analityki, bez reklam, bez pikseli. Jedyna opcjonalna rzecz to mapy torów z
        OpenStreetMap, które przy wyświetleniu wysyłają twój adres IP do ich serwerów. Szczegóły w{" "}
        <Link to="/cookies">polityce cookies</Link>.
      </p>
      <div className="consent__actions">
        <button type="button" className="btn" onClick={() => setConsent(true)}>
          Pokazuj mapy torów
        </button>
        <button type="button" className="btn" onClick={() => setConsent(false)}>
          Bez map, tylko niezbędne
        </button>
      </div>
    </section>
  );
}

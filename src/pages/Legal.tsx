import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/bits";
import { reopenConsent, useConsent } from "../lib/consent";
import { useTitle } from "../lib/title";
import { SITE, isPlaceholder } from "../site";

// Brakujące dane właściciela wyświetlamy jako wyraźnie oznaczone pola, nigdy jako zmyślone wartości.
function V({ value }: { value: string }) {
  return isPlaceholder(value) ? <mark className="placeholder">{value}</mark> : <>{value}</>;
}

function Doc({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  useTitle(title);
  return (
    <article className="legal">
      <PageHead kicker={kicker} title={title}>
        <p>Ostatnia zmiana: {SITE.updated}</p>
      </PageHead>
      <div className="prose">{children}</div>
    </article>
  );
}

const Controller = () => (
  <p>
    <V value={SITE.owner} />, <V value={SITE.address} />, <V value={SITE.nip} />, e-mail: <V value={SITE.email} />.
  </p>
);

export function Privacy() {
  return (
    <Doc kicker="Dokumenty" title="Polityka prywatności">
      <h2>W skrócie</h2>
      <ul>
        <li>Nie zakładasz konta, nie logujesz się, nie płacisz.</li>
        <li>Nie używamy analityki, reklam ani pikseli śledzących.</li>
        <li>Dane osobowe zbieramy tylko wtedy, gdy samodzielnie wyślesz formularz pytań i zechcesz dostać odpowiedź.</li>
      </ul>

      <h2>Kto jest administratorem danych</h2>
      <Controller />

      <h2>Jakie dane i po co</h2>
      <h3>Formularz pytań</h3>
      <p>
        Zapisujemy temat, treść wiadomości i datę wysłania. Jeśli zaznaczysz, że chcesz odpowiedź, zapisujemy też adres
        e-mail i treść zgody zaznaczonej w formularzu.
      </p>
      <ul>
        <li>
          Wiadomość bez adresu: przetwarzamy ją, żeby poprawiać serwis. Podstawa: nasz prawnie uzasadniony interes (art. 6
          ust. 1 lit. f RODO). Usuwamy ją po 90 dniach.
        </li>
        <li>
          Wiadomość z adresem: używamy adresu tylko do odpowiedzi. Podstawa: twoja zgoda (art. 6 ust. 1 lit. a RODO).
          Usuwamy ją najpóźniej po 12 miesiącach albo wcześniej, gdy wycofasz zgodę.
        </li>
      </ul>
      <p>Usuwanie odbywa się automatycznie, codziennie w nocy.</p>

      <h3>Logi serwera</h3>
      <p>
        Serwery, na których działa strona i baza danych, zapisują techniczne logi połączeń (m.in. adres IP, czas, rodzaj
        przeglądarki). Służą do utrzymania i zabezpieczenia usługi i są usuwane przez dostawców po krótkim czasie.
      </p>

      <h2>Komu przekazujemy dane</h2>
      <ul>
        <li>Supabase Inc.: baza danych, formularz i kopie zdjęć. Dane są przechowywane w regionie UE (Frankfurt).</li>
        <li>
          Dostawca hostingu strony: <V value="[NAZWA HOSTINGU, np. GitHub Pages]" />. Jeśli dostawca ma siedzibę poza
          EOG, przekazanie odbywa się na podstawie standardowych klauzul umownych lub decyzji o adekwatności (EU-US Data
          Privacy Framework).
        </li>
        <li>
          OpenStreetMap Foundation: tylko jeśli włączysz mapy torów. Wtedy twoja przeglądarka łączy się bezpośrednio z
          ich serwerem.
        </li>
      </ul>
      <p>Nie sprzedajemy danych i nie przekazujemy ich do celów marketingowych.</p>

      <h2>Twoje prawa</h2>
      <p>
        Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia oraz
        sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie. Zgodę na odpowiedź mailem możesz wycofać w
        każdej chwili, pisząc na <V value={SITE.email} />. Wycofanie zgody nie wpływa na to, co zrobiliśmy wcześniej.
      </p>
      <p>
        Możesz też złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa,{" "}
        <a href="https://uodo.gov.pl">uodo.gov.pl</a>).
      </p>
      <p>Podanie danych jest dobrowolne. Bez adresu e-mail po prostu nie odpiszemy.</p>
    </Doc>
  );
}

export function Cookies() {
  const consent = useConsent();
  return (
    <Doc kicker="Dokumenty" title="Polityka cookies">
      <p>
        Padok nie ustawia ciasteczek. W pamięci przeglądarki (localStorage) zapisujemy jedną informację: czy zgadzasz się
        na wyświetlanie map torów. Bez tego musielibyśmy pytać przy każdej wizycie.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Co</th>
              <th scope="col">Gdzie</th>
              <th scope="col">Po co</th>
              <th scope="col">Jak długo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">padok.consent.v1</th>
              <td>localStorage</td>
              <td>Zapamiętanie twojego wyboru w sprawie map. Niezbędne.</td>
              <td>Do czasu wyczyszczenia danych przeglądarki</td>
            </tr>
            <tr>
              <th scope="row">Mapa OpenStreetMap</th>
              <td>Ramka na stronie wyścigu</td>
              <td>Pokazanie położenia toru. Opcjonalne, tylko po zgodzie. OpenStreetMap otrzymuje twój adres IP.</td>
              <td>Zgodnie z polityką OSM</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Czcionki są wbudowane w stronę, więc nie łączymy się z Google Fonts. Nie ma też osadzonych filmów z YouTube ani
        przycisków serwisów społecznościowych.
      </p>
      <p>
        Podstawa prawna: art. 399 ustawy Prawo komunikacji elektronicznej (zapisywanie informacji w urządzeniu
        użytkownika) i RODO.
      </p>
      <h2>Twój obecny wybór</h2>
      <p>
        {consent == null
          ? "Wybór nie został jeszcze dokonany."
          : consent.maps
            ? "Mapy torów są włączone."
            : "Mapy torów są wyłączone."}
      </p>
      <button type="button" className="btn" onClick={reopenConsent}>
        Zmień wybór
      </button>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc kicker="Dokumenty" title="Regulamin">
      <h2>1. Kto prowadzi serwis</h2>
      <Controller />
      <h2>2. Co oferujemy</h2>
      <p>
        Padok to bezpłatny serwis informacyjny o Formule 1 i seriach towarzyszących. Udostępniamy teksty poradnikowe,
        słownik, dane o sezonie oraz formularz pytań. Korzystanie nie wymaga rejestracji.
      </p>
      <h2>3. Wymagania techniczne</h2>
      <p>Wystarczy aktualna przeglądarka z włączonym JavaScriptem i dostęp do internetu.</p>
      <h2>4. Zasady korzystania</h2>
      <ul>
        <li>Nie wysyłaj przez formularz treści bezprawnych, obraźliwych ani danych osobowych innych osób.</li>
        <li>Nie próbuj zakłócać działania serwisu ani masowo pobierać danych. Dane źródłowe są dostępne w Jolpica-F1 i OpenF1.</li>
      </ul>
      <h2>5. Dane i ich źródła</h2>
      <p>
        Wyniki, klasyfikacje i kalendarz pochodzą z publicznych baz Jolpica-F1 i OpenF1 i są odświeżane automatycznie.
        Mogą zawierać opóźnienia lub błędy, za które nie odpowiadamy. Oficjalnym źródłem wyników jest FIA. Serwis nie
        jest powiązany z Formula One Group, FIA ani zespołami.
      </p>
      <h2>6. Reklamacje</h2>
      <p>
        Uwagi do działania serwisu zgłoś przez <Link to="/pytanie">formularz</Link> albo na <V value={SITE.email} />.
        Odpowiadamy w ciągu 14 dni.
      </p>
      <h2>7. Prawa autorskie</h2>
      <p>
        Teksty i grafiki Padoku są nasze. Możesz je cytować z podaniem źródła. Nie używamy zdjęć kierowców ani logotypów
        zespołów, bo nie mamy do nich licencji.
      </p>
      <h2>8. Zmiany regulaminu</h2>
      <p>O zmianach informujemy na tej stronie, podając datę ostatniej zmiany.</p>
    </Doc>
  );
}

export function Refunds() {
  return (
    <Doc kicker="Dokumenty" title="Polityka zwrotów">
      <p>
        Padok jest bezpłatny. Niczego nie sprzedajemy, nie pobieramy opłat i nie prowadzimy subskrypcji, więc nie ma czego
        zwracać.
      </p>
      <p>
        Gdybyśmy kiedyś wprowadzili płatne funkcje, zanim cokolwiek kupisz, opiszemy tu zasady odstąpienia od umowy (14
        dni dla konsumentów, zgodnie z ustawą o prawach konsumenta) i sposób zwrotu pieniędzy.
      </p>
      <p>
        Jeśli ktoś pobrał od ciebie opłatę, powołując się na Padok, to nie my. Napisz do nas: <V value={SITE.email} />.
      </p>
    </Doc>
  );
}

export function About() {
  return (
    <Doc kicker="O serwisie" title="Kto to robi i dlaczego">
      <p>
        Padok powstał dla ludzi, którzy zaczęli oglądać F1 i utknęli na pytaniu „dlaczego on zjechał do boksu, skoro
        prowadził?”. Piszemy prosto, po polsku i bez udawania, że wszystko jest oczywiste.
      </p>
      <h2>Kontakt</h2>
      <Controller />
      <p>
        Najszybciej przez <Link to="/pytanie">formularz pytań</Link>.
      </p>
      <h2>Skąd dane</h2>
      <ul>
        <li>
          <a href="https://github.com/jolpica/jolpica-f1">Jolpica-F1</a>: kalendarz, wyniki, klasyfikacje, lista mistrzów.
        </li>
        <li>
          <a href="https://openf1.org">OpenF1</a>: kolory zespołów.
        </li>
        <li>
          <a href="https://pl.wikipedia.org">Wikipedia</a>: wstępy do profili (licencja CC BY-SA 4.0, z linkiem do
          artykułu), a z angielskiej wersji oficjalne nazwy zespołów, siedziby i szefowie.
        </li>
        <li>
          <a href="https://commons.wikimedia.org">Wikimedia Commons</a>: zdjęcia kierowców i loga zespołów, wyłącznie
          pliki na wolnych licencjach, każdy podpisany autorem i licencją. Kopie trzymamy na naszym serwerze, więc
          oglądanie ich nie łączy Twojej przeglądarki z serwerami Wikimedia.
        </li>
        <li>Opisy karier i zespołów składa automatycznie nasz skrypt z powyższych danych.</li>
        <li>Teksty poradnika, słownika, historii i opisy serii: napisane przez nas.</li>
      </ul>
      <h2>Czego nie robimy</h2>
      <p>
        Nie używamy zdjęć z oficjalnych serwisów F1 ani agencji fotograficznych, tylko pliki z wolną licencją. Jeśli
        zespół nie udostępnił logo na takiej licencji, nie pokazujemy go wcale. Loga są znakami towarowymi zespołów i
        służą tu tylko do ich rozpoznania. Nie piszemy opinii „od fanów”, których nie dostaliśmy, i nie twierdzimy, że jesteśmy najlepsi w czymkolwiek.
      </p>
      <h2>Przepisy, które sprawdziliśmy</h2>
      <ul>
        <li>RODO: minimalny zakres danych, jasne podstawy prawne, automatyczne usuwanie.</li>
        <li>Prawo komunikacji elektronicznej (art. 399): zgoda przed wczytaniem zewnętrznych map.</li>
        <li>Ustawa o świadczeniu usług drogą elektroniczną: regulamin dostępny przed skorzystaniem z formularza.</li>
        <li>Dostępność: kontrast zgodny z WCAG 2.1 AA, obsługa klawiaturą, opisy dla czytników ekranu.</li>
      </ul>
    </Doc>
  );
}

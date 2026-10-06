import { HashRouter, Link, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Ask } from "./pages/Ask";
import { Calendar, RacePage } from "./pages/Calendar";
import { DriverPage, Drivers } from "./pages/Drivers";
import { Glossary } from "./pages/Glossary";
import { Guide } from "./pages/Guide";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { About, Cookies, Privacy, Refunds, Terms } from "./pages/Legal";
import { SeriesPage } from "./pages/SeriesPage";
import { Teams } from "./pages/Teams";
import { useTitle } from "./lib/title";

// HashRouter: strona działa na statycznym hostingu (GitHub Pages) bez przepisywania adresów po stronie serwera.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="poradnik" element={<Guide />} />
          <Route path="kalendarz" element={<Calendar />} />
          <Route path="kalendarz/:round" element={<RacePage />} />
          <Route path="kierowcy" element={<Drivers />} />
          <Route path="kierowcy/:id" element={<DriverPage />} />
          <Route path="zespoly" element={<Teams />} />
          <Route path="serie" element={<SeriesPage />} />
          <Route path="historia" element={<History />} />
          <Route path="slownik" element={<Glossary />} />
          <Route path="pytanie" element={<Ask />} />
          <Route path="prywatnosc" element={<Privacy />} />
          <Route path="cookies" element={<Cookies />} />
          <Route path="regulamin" element={<Terms />} />
          <Route path="zwroty" element={<Refunds />} />
          <Route path="o-serwisie" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function NotFound() {
  useTitle("Nie ma takiej strony");
  return (
    <article>
      <p className="kicker">Błąd 404</p>
      <h1>Ta strona zjechała do boksu i nie wróciła</h1>
      <p>
        <Link to="/">Wróć na start</Link> albo zajrzyj do <Link to="/poradnik">poradnika</Link>.
      </p>
    </article>
  );
}

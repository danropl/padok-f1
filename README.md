# Padok

Przewodnik po Formule 1 dla początkujących kibiców. Frontend: Vite + React + TypeScript. Backend: Supabase (Postgres, Edge Function, pg_cron).

## Jak to działa

- `supabase/functions/sync-f1` co 6 godzin (pg_cron) pobiera z [Jolpica-F1](https://github.com/jolpica/jolpica-f1) kalendarz, wyniki, klasyfikacje i mistrzów świata, a z [OpenF1](https://openf1.org) kolory zespołów. Oba API są darmowe i nie wymagają klucza.
- Treści redakcyjne (poradnik, słownik, serie, historia) są w tabelach seedowanych migracją `20261006200200_content.sql`.
- Przeglądarka ma przez RLS tylko odczyt tabel i prawo wstawiania do `questions` (formularz pytań). Spam hamuje trigger, stare wiadomości usuwa cron.
- `public/snapshot.json` to zapasowa kopia danych odświeżana przy każdym buildzie (`scripts/snapshot.mjs`). Strona używa jej tylko, gdy baza nie odpowiada.

## Uruchomienie lokalne

```bash
cp .env.example .env   # adres i klucz publiczny projektu Supabase
npm install
npm run dev
```

## Publikacja

Workflow `.github/workflows/pages.yml` buduje stronę i publikuje ją na GitHub Pages przy każdym pushu na `main` i codziennie rano (żeby odświeżyć kopię danych i nie dopuścić do uśpienia darmowego projektu Supabase). W ustawieniach repozytorium: Settings → Pages → Source: GitHub Actions.

## Przed publikacją

Uzupełnij dane właściciela w `src/site.ts` (nazwa, adres, NIP, e-mail) i nazwę hostingu w polityce prywatności (`src/pages/Legal.tsx`). Do tego czasu strona pokazuje je jako wyróżnione pola do uzupełnienia.

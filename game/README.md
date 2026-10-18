# WORLD GP

Wyścigowa gra F1 w przeglądarce: tor Monza odwzorowany z prawdziwej geometrii, pełny widok 3D (three.js), kwalifikacje, wyścig, pogoda, zużycie opon, DRS, uszkodzenia, dźwięk silników V10 (także rywali), tryb kariery (kierowca albo właściciel zespołu) i kreator kierowców, zespołów i malowań. Zespoły i kierowcy są fikcyjni, inspirowani stawką F1.

Gra to czysty HTML + JavaScript bez budowania i bez zależności z npm. Biblioteki: three.js (MIT) w `js/vendor/three.min.js` i supabase-js (MIT, tylko dla multiplayer) w `js/vendor/supabase.js`.

Pełna dokumentacja ze zrzutami ekranu: [docs/WORLD-GP-dokumentacja.pdf](docs/WORLD-GP-dokumentacja.pdf). Prezentacja: [docs/WORLD-GP-prezentacja.pptx](docs/WORLD-GP-prezentacja.pptx). Jak działa AI bolidów: [docs/WORLD-GP-AI-bolidow.md](docs/WORLD-GP-AI-bolidow.md).

## Uruchomienie

Gra działa wyłącznie w 3D i wymaga przeglądarki z WebGL (aktualny Chrome, Edge, Firefox lub Safari z włączonym przyspieszeniem sprzętowym).

Gra jest na gałęzi `claude/f1-game-github-export-1jz93w`. Gałąź `main` (domyślna na GitHubie) jej nie zawiera, dlatego klonuj z `-b`:

```bash
git clone -b claude/f1-game-github-export-1jz93w https://github.com/danropl/padok-f1.git
```

Potem uruchamiaj grę skryptem z katalogu `game`. Skrypt najpierw pobiera najnowszą wersję (`git pull`), a potem otwiera grę w przeglądarce:

- **macOS:** dwuklik `start.command` w Finderze albo w Terminalu `./start.command`
- **Windows:** dwuklik `start.bat`
- **ręcznie:** `python3 serve.py`, potem http://localhost:8000

`serve.py` wyłącza pamięć podręczną przeglądarki, więc po aktualizacji zawsze ładuje się nowa wersja. Jeśli port 8000 zajmuje inny serwer (np. stary `python3 -m http.server` z poprzedniego folderu), `serve.py` uruchomi grę na następnym wolnym porcie i to napisze. Przy zwykłym `python3 -m http.server` Safari i Chrome potrafią przez kilka godzin pokazywać stare pliki; pomaga wtedy twarde odświeżenie (Cmd+Shift+R albo Ctrl+Shift+R).

Wersja gry jest widoczna na dole menu. W multiplayer wszyscy gracze muszą mieć tę samą wersję, inaczej host odmówi dołączenia.

Zapis gry (kariera, kreator, ustawienia) trzyma `localStorage` przeglądarki pod kluczem `pixelgp-save-v1`.

## Sterowanie

| Klawiatura | Akcja |
| --- | --- |
| `↑` / `W` | gaz |
| `↓` / `S` | hamulec |
| `←` `→` | skręt |
| `E` | DRS |
| `X` / `Z` | bieg w górę / w dół (ręczna skrzynia) |
| `R` | powrót na tor |
| `C` | kamera |
| `V` | patrz do tyłu |
| `Esc` | pauza |
| `M` | dźwięk |

Pad (DualSense i inne): lewa gałka skręt, `R2` gaz, `L2` hamulec, `R1` / `✕` DRS, `△` kamera, `□` patrz do tyłu, `○` powrót na tor, `Options` pauza. Na telefonie działa sterowanie dotykowe.

### Ręczna skrzynia biegów (opcja)

**Ustawienia → Jazda → Skrzynia biegów: Ręczna** (także w menu pauzy). Domyślnie skrzynia jest automatyczna, a AI zawsze jeździ z automatem.

- Zmiana biegów: klawiatura `X` w górę, `Z` w dół (albo `+` / `−` na klawiaturze numerycznej); pad `R1` w górę, `L1` w dół. Przy ręcznej skrzyni DRS na padzie jest pod `✕`, a zjazd do boksu pod `Create` albo `L3`. Na telefonie pojawiają się przyciski `+` i `−`.
- Pełna moc jest od ok. 12 000 obr./min (silnik V10 kręci się do 19 000). Na za wysokim biegu silnik słabnie, a na końcu biegu działa ogranicznik obrotów (bieg na wyświetlaczu robi się niebieski).
- Redukcja, po której silnik przekroczyłby obroty, jest blokowana. Niższy bieg mocniej hamuje silnikiem.
- Kto zmienia biegi przy ok. 18 500 obr./min (zapalone prawie wszystkie diody), jest prawie tak szybki jak automat (0–200 km/h: 4,7 s wobec 4,6 s).
- Aleja serwisowa, powrót na tor (`R`) i przejęcie bolidu przez AI ustawiają bieg automatycznie.

## Weekend wyścigowy

- **Dystans:** od 1 do 53 okrążeń (pełny dystans Grand Prix Monzy). Zużycie opon „Auto" przyspiesza degradację w krótszych wyścigach, by strategia miała znaczenie.
- **Kwalifikacje Q1 · Q2 · Q3:** po Q1 odpada pięciu najwolniejszych, po Q2 kolejnych pięciu, Q3 ustala pierwszą dziesiątkę. Każdy segment można przejechać albo zasymulować. Do wyboru też jedno okrążenie.
- **Pit stopy:** `B` (pad: `L1`) zgłasza zjazd, `1`–`4` (pad: krzyżak ▲▼) wybiera opony. Przejazd aleją prowadzi gra (80 km/h przy garażach), na stanowisku wymiana opon i naprawa skrzydeł. AI ma własną strategię. Na suchym torze od 10 okrążeń obowiązują dwie różne mieszanki (inaczej +30 s).
- **Samochód bezpieczeństwa i VSC:** po wypadkach, awariach AI i przy odłamkach. Pod SC kolejka bez wyprzedzania i restart na linii mety, pod VSC limit prędkości. DRS wraca dwa okrążenia po restarcie. Częstość awarii: wyłączone / rzadko / często.

## Multiplayer

**Menu → Multiplayer.** Jedna osoba tworzy lobby (publiczne albo prywatne), pozostali dołączają z listy albo kodem. Każdy wybiera zespół i kierowcę (także z kreatora), host ustawia dystans, pogodę, kwalifikacje, AI, SC, zużycie opon i uszkodzenia. Potem kwalifikacje online, wybór opon na start i wyścig.

- Lista lobby i łączenie graczy działają przez Supabase Realtime (projekt z `.env.example`), sam wyścig — bezpośrednio między przeglądarkami (WebRTC). Gdy połączenie bezpośrednie się nie uda, dane idą przez serwer rzadziej. Darmowy plan Supabase ma limit ok. 100 wiadomości na sekundę na projekt.
- Host prowadzi AI i dyrekcję wyścigu: nie przełączaj karty, gdy jesteś hostem (przeglądarka wstrzymuje wtedy grę).
- Wyścig online nie zatrzymuje się na pauzie. Gracz, który się rozłączy, oddaje bolid AI.
- Test na jednym komputerze: dodaj `?mp=local` do adresu i otwórz grę w dwóch kartach.

## Adaptacyjne spusty DualSense (PS5)

Działają w Chrome i Edge (WebHID), gdy gra jest otwarta z `localhost` albo `https`. W grze: **Ustawienia → Kontroler → „Połącz DualSense: adaptacyjne spusty"** i zgoda przeglądarki na dostęp do pada. Tam też włącznik, siła oporu i test spustów.

- **L2 (hamulec):** opór twardnieje w miarę wciskania jak pedał hamulca (mocniej przy dużej prędkości), drży przy pracy ABS, odbija przy blokowaniu kół.
- **R2 (gaz):** lekka sprężyna, szarpnięcie przy zmianie biegu w górę, drżenie na ograniczniku obrotów, przy buksowaniu, pracy kontroli trakcji, na żwirze, trawie i krawężnikach.

## Dźwięk silników V10

Silniki brzmią jak V10 z F1 lat 2000–2005. Dźwięk jest syntezowany na bieżąco, bez nagrań:

- **Obroty:** do 19 000 obr./min, 10 zapłonów na dwa obroty wału (przy 18 000 obr./min 1500 na sekundę). Przełożenia są stałe, więc na każdym biegu obroty rosną liniowo z prędkością, a po zmianie w górę spadają o ok. 20%. Diody na kierownicy i pasek obrotów zapalają się od ok. 15 000 obr./min.
- **Model:** impulsy ciśnienia z dwóch rzędów cylindrów przez osobne rury wydechowe, dolot z rezonansem airboksu, rozrzut spalania między zapłonami. Każdy bolid ma trochę inny charakter brzmienia.
- **Zachowanie:** strzały z wydechu po odpuszczeniu gazu, krótka przerwa zapłonu przy zmianie biegu w górę, przegazówka przy redukcji, ogranicznik obrotów, ogranicznik prędkości w alei serwisowej, wypadanie zapłonów przy uszkodzonym silniku. Na polach startowych przy zapalonych światłach rywale trzymają obroty.
- **Słuchacz w kamerze:** z kokpitu i T-kamery słychać dolot i silnik z bliska, z zewnątrz głównie wydech. Słychać też do 4 najbliższych rywali, z odległością, kierunkiem i efektem Dopplera (najlepiej w kamerze telewizyjnej).
- **Ustawienia → Dźwięk → Silniki:** V10 albo Prosty (dawny, lżejszy dźwięk tylko własnego bolidu, na słabsze urządzenia).
- Synteza działa w osobnym wątku audio (AudioWorklet), gdy gra jest otwarta z `localhost` albo `https`. Z innego adresu ten sam dźwięk liczy się w wątku głównym.

## Grafika 3D

Drzewa z kart liści (trzy gatunki, kołysanie na wietrze), trawa 3D na poboczach wokół kamery, asfalt z kruszywem i smugami gumy w strefach hamowania, żwir z otoczaków. W kamerze z kokpitu (`C`) widać szczegółowe wnętrze: kierownicę z wyświetlaczem (bieg, prędkość, czasy, DRS, ERS), diodami obrotów, przyciskami i pokrętłami, dłonie w rękawicach skręcające razem z kierownicą.

## Pliki

| Plik | Zawartość |
| --- | --- |
| `js/data.js` | zespoły, kierowcy, tor Monza, kalendarz, opony, pogoda |
| `js/track.js` | geometria toru |
| `js/physics.js` | model jazdy bolidu |
| `js/session.js` | kwalifikacje i wyścig, przeciwnicy |
| `js/quali.js` | kwalifikacje Q1 · Q2 · Q3 |
| `js/pit.js` | aleja serwisowa, pit stopy, strategia AI |
| `js/racecontrol.js` | samochód bezpieczeństwa, VSC, awarie |
| `js/net.js`, `js/multi.js` | multiplayer: lobby, WebRTC, synchronizacja wyścigu |
| `js/career.js` | zapis gry, zespoły własne, tryb kariery |
| `js/render.js` | rozmieszczenie trybun, boksów, drzew i reklam dla sceny 3D, linia jazdy, minimapa |
| `js/sprites.js` | ikony bolidów, kasków i flag w menu i kreatorze |
| `js/car3d.js`, `js/world3d-lite.js`, `js/view3d.js`, `js/post3d.js` | widok 3D: bolid, tor, drzewa, trawa, kamery, postprocessing |
| `js/cockpit3d.js` | wnętrze kokpitu (kierownica, wyświetlacz, dłonie) |
| `js/audio.js` | dźwięk: silniki (słuchacz w kamerze, rywale, odległość, Doppler) i efekty (Web Audio) |
| `js/v10.js` | synteza dźwięku silnika V10 (AudioWorklet, zapasowo w wątku głównym) |
| `js/input.js` | pad, wibracje, adaptacyjne spusty DualSense (WebHID) |
| `js/game.js` | pętla gry |
| `serve.py`, `start.command`, `start.bat` | lokalny serwer bez pamięci podręcznej i uruchamianie z aktualizacją |
| `js/ui.js` | menu, HUD, kreator, ustawienia |

# Monza Grand Prix

Wyścigowa gra F1 w przeglądarce: tor Monza odwzorowany z prawdziwej geometrii, widok 3D (three.js) i z góry, kwalifikacje, wyścig, pogoda, zużycie opon, DRS, uszkodzenia, tryb kariery (kierowca albo właściciel zespołu) i kreator kierowców, zespołów i malowań. Zespoły i kierowcy są fikcyjni, inspirowani stawką F1.

Gra to czysty HTML + JavaScript bez budowania i bez zależności z npm. Jedyna biblioteka to three.js (MIT) w `js/vendor/three.min.js`.

## Uruchomienie

Otwórz `index.html` w przeglądarce albo uruchom dowolny serwer statyczny w tym katalogu:

```bash
cd game
python3 -m http.server 8000   # potem http://localhost:8000
```

Zapis gry (kariera, kreator, ustawienia) trzyma `localStorage` przeglądarki pod kluczem `pixelgp-save-v1`.

## Sterowanie

| Klawiatura | Akcja |
| --- | --- |
| `↑` / `W` | gaz |
| `↓` / `S` | hamulec |
| `←` `→` | skręt |
| `E` | DRS |
| `R` | powrót na tor |
| `C` | kamera |
| `V` | patrz do tyłu |
| `Esc` | pauza |
| `M` | dźwięk |

Pad (DualSense i inne): lewa gałka skręt, `R2` gaz, `L2` hamulec, `R1` / `✕` DRS, `△` kamera, `□` patrz do tyłu, `○` powrót na tor, `Options` pauza. Na telefonie działa sterowanie dotykowe.

## Adaptacyjne spusty DualSense (PS5)

Działają w Chrome i Edge (WebHID), gdy gra jest otwarta z `localhost` albo `https`. W grze: **Ustawienia → Kontroler → „Połącz DualSense: adaptacyjne spusty"** i zgoda przeglądarki na dostęp do pada. Tam też włącznik, siła oporu i test spustów.

- **L2 (hamulec):** opór twardnieje w miarę wciskania jak pedał hamulca (mocniej przy dużej prędkości), drży przy pracy ABS, odbija przy blokowaniu kół.
- **R2 (gaz):** lekka sprężyna, szarpnięcie przy zmianie biegu w górę, drżenie na ograniczniku obrotów, przy buksowaniu, pracy kontroli trakcji, na żwirze, trawie i krawężnikach.

## Grafika 3D

Drzewa z kart liści (trzy gatunki, kołysanie na wietrze), trawa 3D na poboczach wokół kamery, asfalt z kruszywem i smugami gumy w strefach hamowania, żwir z otoczaków. W kamerze z kokpitu (`C`) widać szczegółowe wnętrze: kierownicę z wyświetlaczem (bieg, prędkość, czasy, DRS, ERS), diodami obrotów, przyciskami i pokrętłami, dłonie w rękawicach skręcające razem z kierownicą.

## Pliki

| Plik | Zawartość |
| --- | --- |
| `js/data.js` | zespoły, kierowcy, tor Monza, kalendarz, opony, pogoda |
| `js/track.js` | geometria toru |
| `js/physics.js` | model jazdy bolidu |
| `js/session.js` | kwalifikacje i wyścig, przeciwnicy |
| `js/career.js` | zapis gry, zespoły własne, tryb kariery |
| `js/render.js`, `js/sprites.js` | widok z góry (canvas 2D) |
| `js/car3d.js`, `js/world3d-lite.js`, `js/view3d.js`, `js/post3d.js` | widok 3D: bolid, tor, drzewa, trawa, kamery, postprocessing |
| `js/cockpit3d.js` | wnętrze kokpitu (kierownica, wyświetlacz, dłonie) |
| `js/audio.js` | dźwięk silnika i efekty (Web Audio) |
| `js/input.js` | pad, wibracje, adaptacyjne spusty DualSense (WebHID) |
| `js/game.js` | pętla gry |
| `js/ui.js` | menu, HUD, kreator, ustawienia |

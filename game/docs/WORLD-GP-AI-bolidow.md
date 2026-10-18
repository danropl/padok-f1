# WORLD GP — jak działa AI bolidów

## Wprowadzenie

AI bolidów w WORLD GP nie uczy się ani nie przeszukuje drzewa decyzji. Każdy bolid AI jedzie po wyliczonej raz linii jazdy z prędkością z wyliczonego raz profilu prędkości, a w każdej klatce prosty kontroler zamienia te dwie rzeczy na skręt, gaz i hamulec. Różnice między kierowcami i poziomami trudności biorą się z jednego współczynnika `skill`, który obniża przyczepność w profilu prędkości.

AI steruje bolidem tymi samymi wejściami co gracz (`steer`, `throttle`, `brake`, `drsOpen`), a ruch liczy ta sama fizyka (`PG.stepCar`). Nie ma teleportacji ani „gumki” (rubber banding).

Dokumentacja opisuje wersję gry 2026.10.15.1 na gałęzi `claude/f1-game-github-export-1jz93w` repozytorium [danropl/padok-f1](https://github.com/danropl/padok-f1/tree/claude/f1-game-github-export-1jz93w).

| Plik | Rola w AI |
| --- | --- |
| `game/js/track.js` | linia jazdy (`racingLine`) i profil prędkości (`PG.speedProfile`) |
| `game/js/session.js` | poziomy trudności (`DIFF`), `setupAI`, pętla sesji, brudne powietrze, uszkodzenia |
| `game/js/physics.js` | kontroler `PG.aiControl`, pomoce dla AI w fizyce, `PG.resetCar` |
| `game/js/pit.js` | strategia pit stopów (`Pit.aiPlan`, `Pit.suggest`) |
| `game/js/racecontrol.js` | awarie, zjazd na pobocze, SC i VSC, limity prędkości |
| `game/js/quali.js` | symulowane czasy AI w kwalifikacjach |
| `game/js/multi.js` | multiplayer: host prowadzi AI, przejęcie bolidu |

![Schemat AI bolidu: linia jazdy i profil prędkości liczone raz przy starcie sesji, kontroler AI 4 razy na klatkę: ruch w stawce, skręt, prędkość docelowa, wejścia bolidu](WORLD-GP-AI-schemat.png)

Górny pas liczy się raz, dolny 4 razy na klatkę dla każdego bolidu AI. Cała „inteligencja” jazdy siedzi w profilu prędkości, a kontroler tylko go realizuje.

## 1. Linia jazdy

Linia jazdy to jedno przesunięcie boczne `o[i]` dla każdej próbki osi toru, liczone raz przy wczytaniu toru (`racingLine` w `track.js`). Wszystkie bolidy AI jadą po tej samej linii.

Algorytm to iteracyjne wygładzanie, a nie optymalizacja czasu okrążenia:

1. Start: `o[i] = 0`, czyli środek toru.
2. Dla każdej próbki `i` bierze punkty linii `st` próbek przed i za nią, liczy ich środek i rzutuje go na normalną toru w punkcie `i`.
3. Nowe przesunięcie to `0,3 × stare + 0,7 × rzut`, obcięte do `±(hw − 1,6)` m, gdzie `hw` to połowa szerokości toru. Bolid zostaje 1,6 m od krawędzi.
4. Kroki `st` maleją: 48, 24, 12, 6, 3, 1 próbek. Dwa pierwsze po 120 iteracji, pozostałe po 80. Duży krok prostuje całe zakręty (zewnętrzna – wewnętrzna – zewnętrzna), mały wygładza szczegóły.

Potem dla każdego punktu linii liczona jest odległość do następnego (`L.ds`) i krzywizna `L.k` z okręgu przez trzy punkty oddalone o ±7 próbek. Krzywizna to jedyna informacja o zakręcie, z której korzysta dalej profil prędkości i hamowanie AI.

Ta sama linia jest rysowana graczowi jako podpowiedź (ustawienie „Linia jazdy”), a samochód bezpieczeństwa też po niej jedzie.

## 2. Profil prędkości

Profil prędkości to tablica `profile.v[i]`: największa prędkość, z jaką dany bolid może przejechać każdy punkt linii jazdy. Liczy go `PG.speedProfile(T, p)` w `track.js`, osobno dla każdego bolidu, z jego mocy, oporu, docisku i przyczepności. Zwraca też teoretyczny czas okrążenia `lapTime`.

**Krok 1. Limit w zakręcie.** Przyczepność boczna rośnie z prędkością przez docisk: a = (A0 + B·v²)·grip, gdzie A0 = 23 m/s², B = 0,0042 (stałe `PG.PHYS.latA0` i `latB`). Z równania k·v² = a wychodzi:

```math
v_{\max}(i) = \sqrt{\frac{A_0 \cdot gm}{|k_i| - B \cdot gm \cdot am}}
```

gdzie k to krzywizna linii, gm mnożnik przyczepności, am mnożnik docisku. Gdy mianownik wychodzi ≤ 0, docisk sam utrzyma bolid i limitem jest 110 m/s (396 km/h).

**Krok 2. Hamowanie (przebieg wstecz).** Od końca okrążenia do początku: prędkość w punkcie `a` nie może przekroczyć prędkości, z której da się wyhamować do punktu `b` na odcinku `ds`. Opóźnienie to hamulce (`brkA0` = 10, `brkB` = 0,0045, z dociskiem) plus opór powietrza `cd·v²`.

**Krok 3. Przyspieszenie (przebieg w przód).** Od początku do końca: prędkość w kolejnym punkcie nie może przekroczyć tego, co bolid zdąży osiągnąć. Przyspieszenie to mniejsza z wartości: trakcja (`tracA0` = 12, `tracB` = 0,002) albo moc / v, minus opór.

**Koło tarcia.** W krokach 2 i 3 hamowanie i trakcja są mnożone przez `lonAvail(k, v)`: część przyczepności wzdłużnej, która zostaje przy danym skręcie. Bolid nie może więc jednocześnie w pełni hamować i w pełni skręcać. Stała `comb` = 1,2 ogranicza sumę: √(boczne² + wzdłużne²) ≤ 1,2.

Oba przebiegi wykonują się dwa razy po 2N próbek, żeby domknąć okrążenie. Wynik to wykres prędkości z płaskimi prostymi, liniowymi rampami hamowania przed zakrętami i dołkami w zakrętach. Ten wykres jest „planem jazdy” każdego bolidu AI.

## 3. Poziom trudności i umiejętność kierowcy

Poziom trudności nie zmienia zachowania AI, tylko jego profil prędkości. `setupAI` w `session.js` buduje profil z przyczepnością pomnożoną przez `skill`, więc słabszy kierowca wcześniej hamuje i wolniej przejeżdża zakręty. Na prostych wszyscy jadą tym samym bolidem: decyduje moc i opór zespołu.

```math
skill = \min\bigl(0{,}995,\ DIFF + (pace - 86)\cdot 0{,}0032 + (wet - 85)\cdot 0{,}002\bigr)
```

Składnik `wet` (umiejętność jazdy w deszczu) działa tylko na mokrym torze. `pace` i `wet` to atrybuty kierowcy z `data.js` albo z kreatora.

| Poziom | `DIFF` | Przykład: `skill` kierowcy z `pace` 80 / 86 / 95 (sucho) |
| --- | --- | --- |
| Łatwy | 0,865 | 0,846 / 0,865 / 0,894 |
| Normalny | 0,925 | 0,906 / 0,925 / 0,954 |
| Trudny | 0,972 | 0,953 / 0,972 / 0,995 (limit) |

Prędkość w zakręcie rośnie mniej więcej z pierwiastkiem przyczepności, więc `skill` 0,925 daje około 96% prędkości w wolnym zakręcie, a 0,865 około 93%.

Skąd jeszcze biorą się różnice między bolidami AI:

- **Bolid zespołu** (`PG.carParams` w `physics.js`): moc z atrybutu `power` i silnika, docisk i opór z `aero`, przyczepność z `aero` i `tyre`, zużycie opon z `tyre` zespołu i kierowcy.
- **Start**: czas reakcji `0,16 + (100 − start) × 0,006 + losowo 0–0,12` s oraz `launchBoost` (trakcja ×0,9–1,05 przez pierwsze 3 s) z atrybutu `start`.
- **Bolid gracza prowadzony przez AI** (tryb auto, po mecie, przejęcie w multiplayer) dostaje `skill` co najmniej 0,95.

**Kwalifikacje.** AI nie jedzie okrążeń kwalifikacyjnych. `PG.simQualiTime` liczy profil na nowych miękkich oponach (na mokrym: deszczowe) i zwraca `lapTime × 1,005 + losowo 0–0,35 s`. `quali.js` dodaje lekkie przyspieszanie toru w kolejnych segmentach.

## 4. Kontroler AI krok po kroku

`PG.aiControl(car, T, cars, env, dt)` w `physics.js` wywołuje się dla każdego bolidu AI 4 razy na klatkę (pętla sesji dzieli krok na 4 podkroki). Ustawia skręt, gaz, hamulec i DRS, a potem fizyka przesuwa bolid.

### 4.1 Skręt: podążanie za punktem przed bolidem

To metoda „pure pursuit”, znana z robotyki:

1. Punkt celu leży na linii jazdy `look` metrów przed bolidem: `look = 9 + 0,32 × v` m (v w m/s). Przy 100 km/h to ok. 18 m, przy 300 km/h ok. 36 m. Szybciej = dalej, więc bez nerwowego wężykowania.
2. Do punktu dodawane jest przesunięcie boczne `car.offset` (wyprzedzanie, rozdział 5), obcięte tak, by cel był co najmniej 2,2 m od krawędzi.
3. Kąt `ang` między kierunkiem ruchu bolidu (kurs + kąt znoszenia `beta`) a kierunkiem do celu.
4. Krzywizna łuku przez cel: `curv = 2 × sin(ang) / dist`.
5. `steer = curv / maxCurv`, obcięte do ±1. `maxCurv` to największa krzywizna, jaką bolid przejedzie przy obecnej prędkości i przyczepności (liczy ją fizyka). Dzięki temu wartość skrętu oznacza ułamek przyczepności, tak jak u gracza.

### 4.2 Gaz i hamulec: trzymanie prędkości z profilu

1. Prędkość docelowa to wartość profilu w punkcie `4 + 0,12 × v` m przed bolidem (przy 300 km/h: 14 m), razy `ai.pace` (domyślnie 1).
2. Korekta za opony i pogodę: × √(obecna przyczepność opon / przyczepność przy budowie profilu). Zużyte opony = wolniej w zakrętach.
3. Korekta za brudne powietrze i ruch w stawce (rozdział 5), limit samochodu bezpieczeństwa `rcCap` (rozdział 9). Poza torem (`|lat| > hw + 0,5`) najwyżej 30 m/s (108 km/h).
4. Regulator z martwą strefą:

| Sytuacja | Gaz | Hamulec |
| --- | --- | --- |
| v < cel − 0,3 m/s | `min(1, (cel − v) / 2,5 + 0,4)` | 0 |
| v > cel + 0,6 m/s | 0 | `min(1, (v − cel) / 4)` |
| pomiędzy | 0,35 | 0 |

Bo profil ma już wbudowane hamowanie (rozdział 2), AI nie musi przewidywać zakrętów: wystarczy, że trzyma się prędkości z profilu kilkanaście metrów przed sobą.

### 4.3 DRS

AI otwiera DRS, gdy ma do niego prawo (`drsAllowed`: strata do bolidu przed nim poniżej 1,0 s w punkcie pomiaru, ta sama zasada co dla gracza), jest w strefie DRS, skręt jest w granicach ±0,3 i nie hamuje. Każde z tych zdarzeń zamyka klapę w następnym podkroku.

## 5. Ruch w stawce: wyprzedzanie, jazda za rywalem, aerodynamika

AI wyprzedza, zjeżdżając z linii jazdy o 5 m w bok od rywala, a gdy nie ma miejsca, zwalnia do jego prędkości. Nie broni pozycji: nie ma logiki blokowania ani zmiany linii pod atakującego (pole `ai.attack` istnieje, ale nic go nie używa).

### 5.1 Decyzja o wyprzedzaniu

Na początku każdego wywołania `aiControl` przegląda wszystkie bolidy. Rywal jest „na drodze”, gdy jest 0–34 m przed nim po osi toru i różnica pozycji bocznej jest mniejsza niż 4,4 m. Wtedy:

1. AI sprawdza, czy jest szybsze: obecna prędkość większa od rywala o 0,3 m/s albo prędkość z profilu w tym miejscu większa o 1,5 m/s.
2. Wybiera stronę, po której przy rywalu jest więcej miejsca do krawędzi (`roomR = hw − o.lat`, `roomL = o.lat + hw`), i zapamiętuje ją w `ai.side`, żeby nie przeskakiwać z boku na bok.
3. Docelowe przesunięcie = pozycja rywala ± 5,0 m, liczone względem linii jazdy.

Gdy nikogo nie ma na drodze, `ai.side` się zeruje, a cel wraca do 0, czyli na linię jazdy. Przesunięcie zmienia się płynnie: `offset += (cel − offset) × min(1, 1,6 × dt)`, co daje zjazd w bok w ok. 0,6 s.

### 5.2 Jazda za rywalem

Gdy rywal jest bliżej niż 11 m i różnica boczna jest mniejsza niż 3,4 m (AI nie zdążyło jeszcze zjechać obok), prędkość docelowa jest ograniczona do 98,5% prędkości rywala, a poniżej 7 m do 90%. To chroni przed najechaniem na tył. Kolizje i tak są liczone przez `PG.collide`, a uszkodzenia z kontaktu dwóch bolidów AI są mnożone przez 0,6 („AI między sobą ostrożniejsze”).

### 5.3 Brudne powietrze i tunel aerodynamiczny

Funkcja `slipstream` w `session.js` liczy dla każdego bolidu dwie wartości z bolidów przed nim:

| Efekt | Zasięg | Siła | Skutek |
| --- | --- | --- | --- |
| Tunel (`slip`) | 4–36 m przed, ±3,2 m w bok | opór × (1 − 0,3 × (1 − d/36)), do −30% tuż za rywalem | szybciej na prostych |
| Brudne powietrze (`dirty`) | 3–35 m przed, ±3,5 m w bok | waga 0–1, docisk × (1 − 0,22 × dirty) | wolniej w zakrętach |

Fizyka działa tak samo na gracza i AI. AI dodatkowo obniża prędkość docelową w zakręcie, gdy wykorzystuje ponad 30% przyczepności i jedzie w brudnym powietrzu. Bez tej korekty AI wjeżdżałoby w zakręt za szybko, bo profil liczono w czystym powietrzu. Efekt: tak jak w F1, AI łatwo dogania rywala na prostej, ale trudno mu jechać tuż za nim w zakrętach.

## 6. Pomoce i uproszczenia AI w fizyce

AI jedzie tą samą fizyką co gracz, ale z kilkoma pomocami, które chronią je przed obrotem i wypadnięciem z toru. Bez nich prosty kontroler z rozdziału 4 nie poradziłby sobie z granicą przyczepności.

| Mechanizm | Gracz | AI | Gdzie |
| --- | --- | --- | --- |
| ABS i kontrola trakcji | według ustawień | zawsze włączone | `session.js`, `absOn`, `tcOn` |
| Skrzynia biegów | automatyczna albo ręczna, według ustawień | zawsze automatyczna | `session.js`, `manual`; `physics.js`, `gearPower` |
| Przeniesienie obciążenia | hamowanie dociąża przód, gaz tył, odciążona oś traci przyczepność | odciążona oś nie traci przyczepności (`kF`, `kR` ≥ 1) | `physics.js`, „pomoc stabilności” |
| Hamowanie w zakręcie | ABS liczy z obecnego skrętu | ABS liczy z krzywizny linii jazdy, tak jak profil prędkości | `physics.js`, `ulB` |
| Blokada kół | wpływa na jazdę i płaszczy opony | tylko efekt: 7% szans przy mocnym hamowaniu, 0,2–0,6 s dymu i dźwięku | `physics.js`, `aiLockT` |
| Kontra w poślizgu | pomoc przy kontrze | brak, AI nie wpada w poślizg | `physics.js` |

Punkt „hamowanie w zakręcie” jest ważny: profil prędkości zakłada, że hamowanie dzieli przyczepność z krzywizną linii. Gdyby fizyka liczyła ją z chwilowego skrętu (który przy wejściu w zakręt jest większy), AI hamowałoby słabiej niż w planie i wypadało z toru.

**Start.** Przed zgaszeniem świateł AI stoi na hamulcu. Po starcie czeka swój czas reakcji (rozdział 3), potem przejmuje kontroler. Falstart może popełnić tylko gracz.

## 7. Odporność: utknięcie, wyjazd z toru, uszkodzenia

Gdy coś pójdzie nie tak, AI ma trzy zabezpieczenia: limit prędkości poza torem, reset po utknięciu i wolniejszy profil po uszkodzeniu.

- **Poza torem.** Gdy bolid jest dalej niż 0,5 m za krawędzią, prędkość docelowa spada do 30 m/s (108 km/h). Kontroler skrętu i tak celuje w linię jazdy, więc bolid wraca na tor.
- **Utknięcie.** Od 6. sekundy wyścigu bolid AI jadący wolniej niż 3 m/s przez ponad 3 s jest resetowany (`PG.resetCar`): 10 m wstecz na linię jazdy, prosto, 8 m/s, bez przesunięcia bocznego. Przez 2,5 s jest „duchem” (`ghost`), żeby nie zderzył się z nadjeżdżającymi. Reset nie naprawia uszkodzeń.
- **Uszkodzenia.** Po każdym uszkodzeniu `flushDamage` w `session.js` sprawdza, czy zmienił się wpływ na osiągi (moc, opór, docisk, przyczepność z `PG.dmgPerf`). Jeśli tak, najwyżej co 0,5 s przebudowuje profil prędkości (`rebuildProfile`). Bolid z urwanym skrzydłem zaczyna więc hamować wcześniej i wolniej jechać zakręty, zamiast wypadać z toru.
- **Decyzja po uszkodzeniu.** W trybie pełnych uszkodzeń bolid AI odpada z wyścigu, gdy suma uszkodzeń przekracza 0,6, silnik jest zniszczony albo oba przednie zawieszenia są zniszczone. Lżej uszkodzony bolid przechodzi przez strategię pit stopów (rozdział 8), która może wezwać go po nowe skrzydło.

## 8. Strategia pit stopów

AI zjeżdża do boksu z jednego z czterech powodów, sprawdzanych w tej kolejności przez `Pit.aiPlan` w `pit.js`. Plan jest liczony po każdym okrążeniu, po każdym uszkodzeniu i przy wyjeździe samochodu bezpieczeństwa. Nie działa, gdy zostało mniej niż jedno pełne okrążenie.

| Powód | Warunek |
| --- | --- |
| Uszkodzenie (`dmg`) | przednie skrzydło uszkodzone ponad 0,38 albo tylne ponad 0,5 |
| Zużycie opon (`wear`) | zużycie ≥ próg bolidu i przy obecnym tempie zużycia opony doszłyby do mety ponad 0,9 |
| Zasada dwóch mieszanek (`rule`) | na suchym torze, od 10 okrążeń, bolid użył jednej mieszanki i zostało nie więcej niż 35% dystansu (co najmniej 2 okrążenia) |
| Tani postój pod SC/VSC (`sc`) | zostało ponad 4 okrążenia i zużycie > 0,32 albo zasada dwóch mieszanek niespełniona |

Próg zużycia jest losowany raz na bolid z zakresu 0,66–0,76, dlatego bolidy AI nie zjeżdżają w tym samym okrążeniu. Twarde opony podnoszą go o 0,06, miękkie obniżają o 0,04.

**Wybór opon** (`Pit.suggest`): na mokrym torze zawsze deszczowe. Na suchym AI bierze najbardziej miękką mieszankę, która dojedzie do mety ze zużyciem najwyżej 0,82. Tempo zużycia AI mierzy na ostatnim okrążeniu (przed pierwszym pomiarem używa modelu). Jeśli zasada dwóch mieszanek nie jest spełniona i wybór wypada na obecną mieszankę, AI bierze inną.

Przejazd aleją serwisową i postój prowadzi `pit.js` tak samo jak u gracza: 80 km/h przy garażach, wymiana opon i naprawa skrzydeł.

## 9. Dyrekcja wyścigu: awarie, SC i VSC

Dyrekcja wyścigu (`racecontrol.js`) losuje awarie bolidów AI i zamienia je, razem z wypadkami, w samochód bezpieczeństwa albo VSC. Na bolidy AI działa to wyłącznie przez limit prędkości `rcCap`, który kontroler bierze pod uwagę jak każdy inny limit.

**Awarie.** Od 30. sekundy wyścigu do dwóch okrążeń przed metą każdy bolid AI poza boksem może co podkrok dostać awarię z prawdopodobieństwem `częstość × dt`. Gracz nigdy.

| Ustawienie | Częstość na bolid | Średnio jedna awaria na bolid co |
| --- | --- | --- |
| Wyłączone | 0 | nigdy |
| Rzadko | 1/45 000 na s | 12,5 h jazdy |
| Często | 1/15 000 na s | 4,2 h jazdy |

Przy N bolidach AI awaria w stawce zdarza się średnio co 45 000 / N s (rzadko) albo 15 000 / N s (często). Na przykład dla 19 bolidów AI to ok. 40 i 13 minut.

**Zjazd z toru.** Bolid z awarią albo rozbity (`RC.retire`) przestaje używać zwykłego kontrolera. `RC.retireControl` celuje w punkt 3,2 m za krawędzią toru po tej stronie, po której jest, odcina gaz i lekko hamuje. Staje, gdy jest za krawędzią albo po 20 s.

**Kiedy SC, kiedy VSC.** Bolid stojący na torze lub tuż przy nim albo rozbity: 75% szans na SC, 25% na VSC. Bolid daleko na poboczu: VSC. Odłamki (urwane skrzydło): 40% szans na VSC. Na ostatnim okrążeniu lidera zawsze VSC.

**Limity prędkości dla AI** (`RC.caps`):

- **VSC:** 58% prędkości z własnego profilu, najmniej 16 m/s.
- **SC:** kolejka bez wyprzedzania. Każdy bolid dogania bolid albo samochód bezpieczeństwa przed sobą (82% profilu), a w zasięgu 400 m dopasowuje się do jego prędkości, utrzymując odstęp 16 m za bolidem i 30 m za SC. Samochód bezpieczeństwa jedzie po linii jazdy z 60% prędkości profilu, najwyżej 50 m/s.
- **SC zjeżdża:** lider sam dyktuje tempo (60% profilu) do linii mety, gdzie następuje restart.

Wyjazd SC lub VSC wywołuje też strategię pit stopów u wszystkich bolidów AI w trybie „taniego postoju” (rozdział 8).

## 10. AI w multiplayerze

W multiplayerze wszystkie bolidy AI prowadzi host, a pozostali gracze dostają ich pozycje przez sieć. Każdy gracz liczy fizykę tylko swojego bolidu.

- **Ustawienia lobby:** „Bolidy AI” (pełna stawka albo tylko gracze) i „Poziom AI” (łatwy, normalny, trudny = `DIFF` z rozdziału 3).
- **Host:** uruchamia `aiControl` i dyrekcję wyścigu. U klienta `S.netClient` wyłącza awarie i SC, a bolidy z sieci (`remote`) są pomijane w pętli i tylko interpolowane w czasie.
- **Kwalifikacje:** gracze jadą swoje okrążenia, czasy AI host symuluje (`Q.simulate`) i rozsyła cel do awansu.
- **Rozłączenie gracza:** jego bolid przejmuje AI (`takeOver` w `multi.js`). Bolid przestaje być zdalny, czas okrążenia liczy się od chwili przejęcia, a niepełne okrążenie nie trafia do rekordów.
- **Host nie może przełączać karty:** przeglądarka wstrzymuje wtedy pętlę gry, więc zatrzymują się też wszystkie bolidy AI.

## 11. Parametry do strojenia

Największy wpływ na siłę AI ma `DIFF` w `session.js`. Pozostałe stałe zmieniają charakter jazdy, a nie tempo, więc warto je ruszać pojedynczo i sprawdzać w wyścigu.

| Parametr | Plik | Wartość | Co zmienia |
| --- | --- | --- | --- |
| `DIFF` (easy / normal / hard) | `session.js` | 0,865 / 0,925 / 0,972 | tempo AI w zakrętach i na hamowaniu |
| wpływ `pace` na `skill` | `session.js` | 0,0032 na punkt | rozrzut tempa między kierowcami |
| limit `skill` | `session.js` | 0,995 | najszybszy możliwy kierowca AI |
| `brakeMul` w profilu AI | `session.js` | 0,97 | zapas na hamowaniu (mniej = ostrożniej) |
| odległość celu skrętu | `physics.js` | 9 + 0,32 × v m | płynność skrętu (mniej = ciaśniej, ale nerwowo) |
| podgląd prędkości | `physics.js` | 4 + 0,12 × v m | jak wcześnie AI reaguje na hamowanie z profilu |
| strefa wykrycia rywala | `physics.js` | 34 m, ±4,4 m | jak wcześnie AI zaczyna wyprzedzanie |
| odstęp boczny przy wyprzedzaniu | `physics.js` | 5,0 m | jak szeroko AI omija rywala |
| tempo zjazdu w bok | `physics.js` | 1,6 / s | jak gwałtownie AI zmienia linię |
| limit za rywalem | `physics.js` | 98,5% (< 11 m), 90% (< 7 m) | ryzyko najechania na tył |
| utrata docisku w brudnym powietrzu | `physics.js`, `PHYS.dirty` | 0,22 | trudność jazdy tuż za rywalem (gracz i AI) |
| odstęp linii od krawędzi | `track.js` | 1,6 m | jak blisko krawędzi jeździ AI |
| próg zużycia opon | `pit.js` | 0,66–0,76 | kiedy AI zjeżdża do boksu |
| częstość awarii | `racecontrol.js` | 1/45 000, 1/15 000 na s | jak często są SC i VSC |

Znane ograniczenia, które warto rozważyć przy rozwoju:

- AI nie broni pozycji ani nie wybiera momentu ataku (`ai.attack` jest nieużywane).
- Wszystkie bolidy AI jadą po jednej linii jazdy i nie popełniają błędów poza kosmetycznymi blokadami kół.
- Pętla wyprzedzania przegląda wszystkie bolidy, więc koszt rośnie z kwadratem liczby bolidów (przy obecnej stawce to bez znaczenia).

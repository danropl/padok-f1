-- Treści redakcyjne Padoku. Pisane ręcznie, po polsku, stan na sezon 2026.
-- Liczby, które zmieniają się co sezon (kierowcy, punkty w klasyfikacji, kalendarz), NIE są tutaj: przychodzą z API.

insert into public.points_system (kind, position, points) values
  ('race', 1, 25), ('race', 2, 18), ('race', 3, 15), ('race', 4, 12), ('race', 5, 10),
  ('race', 6, 8), ('race', 7, 6), ('race', 8, 4), ('race', 9, 2), ('race', 10, 1),
  ('sprint', 1, 8), ('sprint', 2, 7), ('sprint', 3, 6), ('sprint', 4, 5),
  ('sprint', 5, 4), ('sprint', 6, 3), ('sprint', 7, 2), ('sprint', 8, 1);

insert into public.guide_sections (slug, title, lede, body, compound, sort) values
('o-co-chodzi', 'Dwa tytuły, jedenaście zespołów',
 'W każdym sezonie rozdaje się dwa mistrzostwa. Większość nieporozumień bierze się z tego, że ludzie widzą tylko jedno.',
$$Mistrzostwo kierowców wygrywa człowiek, który zbierze najwięcej punktów w całym sezonie. Mistrzostwo konstruktorów wygrywa zespół: liczą się punkty obu jego kierowców razem.

Od 2026 roku na starcie staje 11 zespołów, każdy z dwoma kierowcami, czyli 22 samochody. Nowy jest Cadillac, a dawny Sauber jeździ już jako fabryczne Audi.

Dlatego czasem zobaczysz, że kierowca walczy o 9. miejsce tak, jakby od tego zależało życie. Dla zespołu zależą od tego pieniądze: im wyżej w klasyfikacji konstruktorów, tym większa część nagród z puli F1.

Zespoły same budują swoje samochody, ale silniki biorą od kilku dostawców. Dwa auta z tym samym silnikiem nadal mogą być od siebie o sekundę na okrążeniu wolniejsze, bo różnią się wszystkim innym.$$, 'soft', 10),

('weekend', 'Weekend od piątku do niedzieli',
 'Wyścig to tylko ostatnie dwie godziny. Wcześniej są treningi i kwalifikacje, które ustawiają kolejność na starcie.',
$$Zwykły weekend wygląda tak:

- Piątek: dwa treningi (FP1 i FP2), po godzinie. Zespoły sprawdzają ustawienia i opony, czasy niewiele jeszcze mówią.
- Sobota: trzeci trening (FP3), a potem kwalifikacje.
- Niedziela: wyścig, około 305 km, czyli mniej więcej półtorej godziny. Wyjątkiem jest Monako, gdzie dystans jest krótszy.

Kwalifikacje mają trzy części. W Q1 jadą wszyscy, a sześciu najwolniejszych odpada. W Q2 odpada kolejnych sześciu. W Q3 dziesięciu najszybszych walczy o pole position, czyli pierwsze miejsce na starcie.

Na torach, gdzie trudno wyprzedzać (Monako, Singapur, Węgry), kwalifikacje często rozstrzygają więcej niż sam wyścig.$$, 'soft', 20),

('punkty', 'Kto dostaje punkty',
 'Punktuje pierwsza dziesiątka wyścigu i pierwsza ósemka sprintu. Nic więcej nie trzeba zapamiętywać.',
$$W wyścigu punkty dostaje pierwszych dziesięciu kierowców: 25, 18, 15, 12, 10, 8, 6, 4, 2 i 1. W sprincie punktuje pierwsza ósemka, od 8 punktów w dół do 1.

Od 2025 roku nie ma już dodatkowego punktu za najszybsze okrążenie. Jeśli trafisz na starszy artykuł, który o nim wspomina, to nie błąd, tylko inne czasy.

Gdy dwóch kierowców kończy sezon z tą samą liczbą punktów, wyżej jest ten, kto ma więcej zwycięstw. Jeśli i to jest równe, liczą się drugie miejsca, potem trzecie i tak dalej.$$, 'soft', 30),

('flagi', 'Flagi, które warto znać',
 'Sędziowie rozmawiają z kierowcami kolorami. Pięć z nich zobaczysz w niemal każdym wyścigu.',
$$- Żółta: niebezpieczeństwo na torze, nie wolno wyprzedzać w tym miejscu. Dwie żółte naraz oznaczają, że trzeba być gotowym do zatrzymania.
- Zielona: koniec zagrożenia, można się ścigać.
- Niebieska: pokazywana kierowcy, którego za chwilę zdubluje szybszy samochód. Ma go przepuścić.
- Czerwona: wyścig zatrzymany, wszyscy zjeżdżają do alei serwisowej. Zdarza się po poważnym wypadku albo w ulewie.
- Czarno-biała po przekątnej: ostrzeżenie za niesportowe zachowanie, np. wielokrotne przekraczanie limitów toru.
- Czarna z numerem: dyskwalifikacja.
- Szachownica: koniec wyścigu.

Do tego dochodzi samochód bezpieczeństwa (Safety Car), za którym stawka jedzie wolno i nie może wyprzedzać, oraz wirtualny samochód bezpieczeństwa (VSC), kiedy wszyscy muszą zwolnić do ustalonego tempa, ale żadnego auta przed nimi nie ma.$$, 'soft', 40),

('opony', 'Opony decydują częściej, niż myślisz',
 'Te same auto na innych oponach to inny samochód. Kolor na boku opony mówi ci, jaką strategię wybrał zespół.',
$$Pirelli przywozi na każdy weekend trzy mieszanki na suchy tor, oznaczone kolorami na boku opony:

- Czerwona (miękka): najszybsza, ale najkrócej wytrzymuje.
- Żółta (pośrednia): kompromis.
- Biała (twarda): najwolniejsza na jednym okrążeniu, za to wytrzymuje najdłużej.

Na mokry tor są jeszcze opony przejściowe (zielone) i deszczowe (niebieskie).

Jeśli wyścig jest suchy, każdy kierowca musi użyć co najmniej dwóch różnych mieszanek. To dlatego zjeżdżają do boksu nawet wtedy, gdy nic się nie zepsuło.

Ten serwis zresztą też jest podzielony na mieszanki: czerwone teksty przeczytasz w pięć minut, białe są dla tych, którzy chcą wiedzieć wszystko.$$, 'medium', 50),

('strategia', 'Pit stop, undercut i overcut',
 'Wymiana czterech opon trwa dwie, trzy sekundy. Wjazd i wyjazd z alei serwisowej zabiera ponad dwadzieścia. Stąd cała gra.',
$$W alei serwisowej obowiązuje limit prędkości (zwykle 80 km/h), więc każdy postój kosztuje kierowcę sporo czasu względem rywali na torze.

Undercut to zjazd po świeże opony wcześniej niż rywal przed tobą. Na nowych oponach jedziesz szybciej, a on traci czas na zużytych. Gdy on w końcu zjedzie, wyjeżdża za tobą.

Overcut działa odwrotnie: zostajesz na torze dłużej, licząc, że na pustym torze pojedziesz szybciej niż rywal, który właśnie wyjechał na zimnych oponach.

Safety Car w trakcie wyścigu zmienia rachunek. Stawka jedzie wolno, więc zjazd do boksu kosztuje mniej. Dlatego pod samochodem bezpieczeństwa połowa stawki nagle zjeżdża do alei.$$, 'medium', 60),

('sprint', 'Weekend ze sprintem',
 'Kilka razy w roku piątek i sobota wyglądają inaczej, bo do programu dochodzi krótki wyścig.',
$$W weekend sprinterski jest tylko jeden trening. Po nim odbywają się kwalifikacje do sprintu (też w trzech częściach, ale krótszych).

W sobotę jedzie się sprint, około 100 km, bez obowiązkowego zjazdu do boksu. Po sprincie są normalne kwalifikacje do niedzielnego wyścigu, a w niedzielę wszystko wygląda jak zwykle.

Sprint daje mniej punktów (od 8 dla zwycięzcy), ale za to szansę na walkę w sobotę. W kalendarzu na stronie Kalendarz sprinty są oznaczone osobno.$$, 'medium', 70),

('przepisy-2026', 'Co zmieniło się w 2026 roku',
 'To największa zmiana przepisów od lat. Jeśli oglądałeś F1 kiedyś, część rzeczy działa teraz inaczej.',
$$Samochody są mniejsze i lżejsze niż w latach 2022–2025. Jednostka napędowa daje mniej więcej połowę mocy z silnika spalinowego i połowę z części elektrycznej, a paliwo jest w całości syntetyczne lub biologiczne.

Skrzydła z przodu i z tyłu są ruchome. Na prostych płaty się spłaszczają, żeby zmniejszyć opór, a przed zakrętami wracają do pozycji, która dociska auto do toru.

System DRS, czyli otwierana klapa tylnego skrzydła ułatwiająca wyprzedzanie, zniknął. Zamiast niego kierowca jadący blisko rywala może użyć dodatkowej porcji energii elektrycznej.

Doszły też dwa zespoły w nowych barwach: Cadillac jako jedenasty zespół i Audi w miejsce Saubera. Nowym dostawcą silników jest też Ford, który współpracuje z Red Bullem.$$, 'medium', 80),

('kary', 'Kary i sędziowie',
 'Decyzje sędziów potrafią zmienić wynik już po mecie. Warto wiedzieć, za co się karze i jak.',
$$Wyścig nadzoruje zespół sędziów FIA. Najczęstsze kary:

- 5 lub 10 sekund doliczonych do czasu albo odstanych w boksie przed wymianą opon.
- Przejazd przez aleję serwisową (drive-through) bez zatrzymania.
- Stop and go: zatrzymanie w boksie na 10 sekund, bez prac przy aucie.
- Cofnięcie na starcie kolejnego wyścigu, np. za wymianę zbyt wielu elementów silnika.
- Punkty karne na licencji. Kierowca, który zbierze 12 punktów w ciągu 12 miesięcy, pauzuje jeden wyścig.

Częsty powód kar to limity toru: wszystkie cztery koła nie mogą znaleźć się za białą linią. Za pierwsze razy kierowca dostaje ostrzeżenia, a gdy przekroczy limit kilka razy w jednym wyścigu, przychodzi kara czasowa.$$, 'medium', 90),

('super-licencja', 'Jak dostać się do F1',
 'Nie wystarczy być szybkim w gokartach. Trzeba zebrać punkty do super licencji, a po drodze przejść przez kilka serii.',
$$Żeby wystartować w F1, kierowca potrzebuje super licencji FIA. Musi mieć skończone 18 lat, prawo jazdy i 40 punktów zebranych w trzech ostatnich sezonach w seriach wyścigowych.

Najwięcej punktów dają wysokie miejsca w Formule 2, mniej w Formule 3 i niższych seriach. Typowa droga to gokarty, potem Formuła 4, Formuła 3, Formuła 2 i dopiero F1. Opisujemy ją na stronie Serie.

Większość zespołów F1 prowadzi akademie juniorskie, które finansują młodych kierowców i wybierają spośród nich przyszłych zawodników.$$, 'hard', 100),

('pieniadze', 'Budżety i limit wydatków',
 'Od 2021 roku zespoły nie mogą wydawać na samochód tyle, ile chcą. To wyrównało stawkę bardziej niż jakakolwiek zmiana techniczna.',
$$F1 wprowadziła limit wydatków (budget cap). Obejmuje koszty budowy i rozwoju samochodu, ale nie obejmuje m.in. pensji kierowców i najlepiej opłacanych menedżerów ani marketingu.

Zespół, który przekroczy limit, może dostać karę finansową, odjęcie punktów albo ograniczenie pracy w tunelu aerodynamicznym. Same godziny w tunelu też są limitowane: najsłabsze zespoły z poprzedniego sezonu dostają ich więcej niż najlepsze.

Przychody zespołów pochodzą głównie z nagród od F1 (zależnych od miejsca w klasyfikacji konstruktorów) i od sponsorów.$$, 'hard', 110),

('jak-ogladac', 'Jak oglądać i nie zgubić się w wyścigu',
 'Kilka nawyków, dzięki którym półtorej godziny wyścigu przestaje wyglądać jak losowe przetasowania.',
$$- Patrz na pasek z kolejnością po lewej stronie ekranu, a nie tylko na auto w kadrze. Pokazuje odstępy między kierowcami.
- Zwracaj uwagę, kto na jakich oponach jedzie. Ktoś, kto traci pozycje na twardych oponach, może za 20 okrążeń wyprzedzać wszystkich na miękkich.
- Po zjeździe do boksu sprawdź, przed kim kierowca wyjechał. To pokazuje, czy strategia się udała.
- Słuchaj komunikatów radiowych. Często mówią więcej o problemach z autem niż obraz.

Prawa do transmisji w Polsce zmieniają się co kilka lat, więc nie podajemy nazwy stacji. Aktualnego nadawcę dla twojego kraju podaje oficjalny serwis formula1.com.$$, 'hard', 120);

insert into public.glossary (slug, term, definition, example, category) values
('pole-position', 'Pole position', 'Pierwsze pole startowe, dla najszybszego kierowcy w kwalifikacjach.', 'Jest na pole, ale w Monako to połowa sukcesu.', 'Weekend'),
('grid', 'Pola startowe (grid)', 'Ustawienie samochodów przed startem wyścigu, parami w kolejności z kwalifikacji, po uwzględnieniu kar.', null, 'Weekend'),
('parc-ferme', 'Parc fermé', 'Zasada, według której od kwalifikacji do wyścigu nie można prawie nic zmieniać w ustawieniach auta. Złamanie jej oznacza start z alei serwisowej.', null, 'Przepisy'),
('formation-lap', 'Okrążenie formujące', 'Okrążenie przed startem, na którym kierowcy rozgrzewają opony i hamulce, a potem wracają na swoje pola.', null, 'Weekend'),
('falstart', 'Falstart', 'Ruszenie, zanim zgasną czerwone światła. Kończy się karą czasową.', null, 'Przepisy'),
('stint', 'Stint', 'Odcinek wyścigu przejechany na jednym komplecie opon, od zjazdu do zjazdu.', 'Długi stint na twardych oponach dał mu podium.', 'Strategia'),
('box', 'Box, box', 'Komunikat radiowy: zjedź w tym okrążeniu do alei serwisowej.', null, 'Strategia'),
('undercut', 'Undercut', 'Wcześniejszy zjazd po nowe opony, żeby wyprzedzić rywala, gdy on zjedzie później.', null, 'Strategia'),
('overcut', 'Overcut', 'Zostanie dłużej na torze niż rywal, licząc na lepsze tempo, gdy on wyjedzie na zimnych oponach.', null, 'Strategia'),
('in-lap', 'Okrążenie zjazdowe i wyjazdowe', 'In-lap to okrążenie kończące się zjazdem do boksu, out-lap to pierwsze okrążenie po wyjeździe. Oba liczą się w walce o undercut.', null, 'Strategia'),
('degradacja', 'Degradacja', 'Spadek osiągów opony w miarę jej zużycia. Duża degradacja oznacza więcej zjazdów.', null, 'Opony'),
('graining', 'Graining', 'Drobne kawałki gumy, które odrywają się i przyklejają do powierzchni opony. Auto traci przyczepność, zwykle na kilka okrążeń.', null, 'Opony'),
('blistering', 'Blistering', 'Pęcherze na oponie od przegrzania. Gorsze od grainingu, bo nie mija samo.', null, 'Opony'),
('docisk', 'Docisk (downforce)', 'Siła, z jaką powietrze dociska samochód do toru. Więcej docisku to szybsze zakręty, ale też większy opór na prostych.', null, 'Technika'),
('brudne-powietrze', 'Brudne powietrze', 'Zawirowane powietrze za jadącym przodem autem. Samochód z tyłu traci docisk i trudniej mu podążać blisko w zakrętach.', null, 'Technika'),
('cien-aerodynamiczny', 'Cień aerodynamiczny', 'Jazda tuż za rywalem na prostej, gdzie opór powietrza jest mniejszy. Pomaga się zbliżyć przed hamowaniem.', null, 'Technika'),
('drs', 'DRS', 'Otwierana klapa tylnego skrzydła, która w latach 2011–2025 ułatwiała wyprzedzanie. Od 2026 nie istnieje, zastąpił ją dodatkowy zastrzyk energii elektrycznej.', null, 'Technika'),
('aktywna-aerodynamika', 'Aktywna aerodynamika', 'Od 2026: przednie i tylne skrzydła zmieniają ustawienie na prostych i w zakrętach, żeby zmniejszać opór albo zwiększać docisk.', null, 'Technika'),
('jednostka-napedowa', 'Jednostka napędowa', 'Silnik spalinowy razem z częścią hybrydową. W F1 mówi się tak zamiast „silnik”, bo elektryka daje dziś mniej więcej połowę mocy.', null, 'Technika'),
('mgu-k', 'MGU-K', 'Silnik-generator przy tylnej osi. Odzyskuje energię przy hamowaniu i oddaje ją przy przyspieszaniu.', null, 'Technika'),
('porpoising', 'Porpoising', 'Podskakiwanie auta na prostych, gdy docisk z podłogi na przemian rośnie i zanika. Słynny problem z sezonu 2022.', null, 'Technika'),
('safety-car', 'Samochód bezpieczeństwa (SC)', 'Auto, które wyjeżdża na tor po wypadku. Stawka jedzie za nim wolno i nie może wyprzedzać.', null, 'Przepisy'),
('vsc', 'Wirtualny samochód bezpieczeństwa (VSC)', 'Wszyscy muszą zwolnić do ustalonego tempa, ale nikt nie jedzie przed stawką. Odstępy między kierowcami zostają mniej więcej takie same.', null, 'Przepisy'),
('czerwona-flaga', 'Czerwona flaga', 'Przerwanie sesji. Wszyscy zjeżdżają do alei serwisowej, a zespoły mogą zmienić opony.', null, 'Przepisy'),
('limity-toru', 'Limity toru', 'Granica toru wyznaczona białą linią. Gdy wszystkie cztery koła są poza nią, czas okrążenia może zostać skreślony.', null, 'Przepisy'),
('dnf', 'DNF', 'Did Not Finish: kierowca nie ukończył wyścigu. Obok często podany jest powód, np. awaria albo wypadek.', null, 'Wyniki'),
('dns-dsq', 'DNS i DSQ', 'DNS: nie wystartował. DSQ: zdyskwalifikowany, np. za zbyt lekkie auto po wyścigu.', null, 'Wyniki'),
('dublowanie', 'Dublowanie', 'Gdy lider dogania kierowcę o całe okrążenie. Kierowca z tyłu stawki dostaje niebieską flagę i musi ustąpić.', null, 'Wyniki'),
('team-orders', 'Polecenia zespołowe', 'Prośba zespołu, żeby jeden kierowca przepuścił drugiego. Dozwolona, ale zawsze budzi emocje.', null, 'Strategia'),
('debiutant', 'Debiutant (rookie)', 'Kierowca w pierwszym pełnym sezonie w F1.', null, 'Ludzie'),
('konstruktor', 'Konstruktor', 'Inaczej zespół: firma, która zbudowała samochód. Stąd nazwa klasyfikacji konstruktorów.', null, 'Ludzie'),
('wielki-szlem', 'Wielki szlem', 'Pole position, zwycięstwo, najszybsze okrążenie i prowadzenie przez cały wyścig w jednym weekendzie. Zdarza się rzadko.', null, 'Wyniki'),
('apex', 'Apex', 'Wewnętrzny punkt zakrętu, przez który kierowca przejeżdża najbliżej krawężnika.', null, 'Tor'),
('szykana', 'Szykana', 'Szybka sekwencja dwóch przeciwnych zakrętów, często wstawiona, żeby zwolnić auta przed długą prostą.', null, 'Tor'),
('nawrot', 'Nawrót', 'Bardzo ciasny zakręt, prawie o 180 stopni. Dobre miejsce do wyprzedzania przy hamowaniu.', null, 'Tor'),
('aleja-serwisowa', 'Aleja serwisowa', 'Pas równoległy do prostej startowej, gdzie są boksy zespołów. Obowiązuje w niej limit prędkości.', null, 'Tor');

insert into public.series (slug, name, tier, tagline, body, facts, official_url) values
('f1', 'Formuła 1', 1,
 'Szczyt: najszybsze samochody wyścigowe na torach zamkniętych i 22 miejsca dla kierowców na cały świat.',
$$Mistrzostwa świata od 1950 roku. Każdy zespół projektuje własny samochód, dlatego różnice w tempie między zespołami bywają większe niż między kierowcami.$$,
 '["11 zespołów, 22 kierowców (od 2026)", "Ponad 20 weekendów w sezonie, od marca do grudnia", "Dwa tytuły: kierowców i konstruktorów"]',
 'https://www.formula1.com'),
('f2', 'Formuła 2', 2,
 'Ostatni krok przed F1. Ścigają się na tych samych torach, w ten sam weekend.',
$$Wszyscy jeżdżą identycznymi samochodami, więc wyniki mówią dużo o kierowcy. W weekendzie są dwa wyścigi: krótszy sprint z odwróconą czołówką i dłuższy wyścig główny z obowiązkowym zjazdem do boksu.

Mistrz F2 dostaje od razu tyle punktów, ile potrzeba do super licencji.$$,
 '["Jednakowe samochody dla wszystkich", "Sprint i wyścig główny w każdym weekendzie", "Rozgrywana przy weekendach F1"]',
 'https://www.fiaformula2.com'),
('f3', 'Formuła 3', 3,
 'Najliczniejsza stawka w drabince F1, około 30 aut. Tu najczęściej pierwszy raz słyszy się nazwisko przyszłej gwiazdy.',
$$Też jednakowe samochody, ale słabsze i lżejsze niż w F2. Format weekendu jest podobny: sprint i wyścig główny. Przy 30 kierowcach kwalifikacje są bardzo ciasne, a jeden błąd potrafi przekreślić weekend.$$,
 '["Ok. 30 kierowców", "Sprint i wyścig główny", "Rozgrywana przy części weekendów F1"]',
 'https://www.fiaformula3.com'),
('f1-academy', 'F1 Academy', 3,
 'Seria dla kobiet, założona przez F1 w 2023 roku, żeby więcej kierowczyń dotarło do wyższych serii.',
$$Samochody są na poziomie Formuły 4. Każdy z zespołów F1 wspiera w niej swoją zawodniczkę i jego barwy widać na aucie. Część rund odbywa się podczas weekendów F1, więc warto zajrzeć do programu przed wyścigiem.$$,
 '["Wsparcie zespołów F1", "Auta klasy Formuły 4", "Od 2023 roku"]',
 'https://www.f1academy.com'),
('f4', 'Formuła 4 i serie regionalne', 4,
 'Pierwsze samochody wyścigowe po gokartach. Krajowe i regionalne mistrzostwa w wielu krajach.',
$$Tu kierowcy uczą się pracy z zespołem, ustawień i jazdy w deszczu. Najlepsi przechodzą do Formuły 3 albo serii regionalnych Formuły (FRECA i podobnych).$$,
 '["Wiek startowy od 15 lat", "Wiele krajowych mistrzostw", "Pierwsze punkty do super licencji"]',
 'https://www.fia.com');

insert into public.milestones (year, title, body) values
(1950, 'Pierwszy wyścig mistrzostw świata', 'Silverstone, 13 maja 1950. Pierwszym mistrzem świata został Giuseppe Farina z Alfa Romeo.'),
(1958, 'Rodzi się klasyfikacja konstruktorów', 'Od tego roku tytuł zdobywa też zespół. Pierwszym mistrzem konstruktorów był Vanwall.'),
(1994, 'Czarny weekend na Imoli', 'W ciągu dwóch dni zginęli Roland Ratzenberger i Ayrton Senna. Po tym weekendzie F1 przebudowała zasady bezpieczeństwa aut i torów.'),
(2006, 'Robert Kubica w F1', 'Pierwszy Polak w Formule 1 zadebiutował w Grand Prix Węgier w barwach BMW Sauber, a kilka wyścigów później stanął na podium na Monzy.'),
(2008, 'Kubica wygrywa w Kanadzie', 'Rok po groźnym wypadku na tym samym torze Kubica wygrał Grand Prix Kanady. To jedyne jak dotąd zwycięstwo polskiego kierowcy w F1.'),
(2014, 'Początek ery hybrydowej', 'Wolnossące silniki V8 zastąpiły turbodoładowane V6 z odzyskiwaniem energii. Przez kolejne lata dominował Mercedes.'),
(2018, 'Halo nad głową kierowcy', 'Tytanowy pałąk nad kokpitem. Wielu fanów go nie lubiło, dopóki nie uratował kilku kierowców w poważnych wypadkach.'),
(2020, 'Grosjean wychodzi z ognia', 'W Bahrajnie auto Romaina Grosjeana przecięło barierę i stanęło w płomieniach. Kierowca wyszedł o własnych siłach, a halo uznano za kluczowe dla jego przeżycia.'),
(2021, 'Limit wydatków', 'Zespoły po raz pierwszy musiały zmieścić się w budżecie na budowę i rozwój auta. Ten sam sezon skończył się jednym z najbardziej spornych finałów w historii, w Abu Zabi.'),
(2022, 'Powrót efektu przypowierzchniowego', 'Nowe auta generowały docisk głównie podłogą, żeby łatwiej było jechać blisko za rywalem.'),
(2023, 'Start F1 Academy', 'F1 uruchomiła własną serię dla kobiet, wspieraną przez wszystkie zespoły.'),
(2026, 'Nowe auta, nowe zespoły', 'Mniejsze samochody, aktywna aerodynamika, połowa mocy z elektryki i paliwo syntetyczne. Do stawki doszedł Cadillac, a Sauber stał się Audi.');

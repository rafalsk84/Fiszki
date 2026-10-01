# T-Fiszki

Fiszki zbierające **złe odpowiedzi z testów na T-Portalu** plus powtórki liczone **prawdziwym SM-2** (łatwość EF, przerwy, terminy). Mobile-first, działa też jako układ webowy; dane trzymane są lokalnie, a konto tylko je synchronizuje między telefonem a laptopem.

## Pliki

| plik | co robi |
|---|---|
| `t-fiszki.html` | cała aplikacja: HTML + CSS + JS w jednym pliku, zero zależności, działa też otwierana przez `file://` |
| `serwer.mjs` | konta, synchronizacja i zdjęcia fiszek: `node:http` + `node:sqlite` + `node:crypto`, też zero zależności |
| `cdp-check.mjs` | testy na żywym Chrome (205 asercji: konto, sync, konflikt 409, zdjęcie i film na fiszce, statystyki, kontrast AA, szerokości 320–2560 px, przełącznik widoku) |
| `sprawd-skladnie.mjs` | wyciąga każdy blok `<script>` z `t-fiszki.html` i sprawdza samą składnię — aplikacja jest jednym plikiem, więc edytor jej nie sprawdzi |
| `sonda-media.sh` | próba serwera przez `curl`: właściciel dostaje swoje zdjęcie, obce konto dostaje 404, SVG zostaje odrzucone, a kasacja konta sprząta pliki |
| `sonda-zabezpieczenia.sh` | próba przez `curl` na drugiej instancji z `PROXY=1`: nagłówki strony, ciastko `Secure`, limit rejestracji z adresu, blokada logowania liczona po `x-forwarded-for`, sufity kont i zdjęć |
| `.fonts/` | Manrope i Unbounded, które aplikacja i tak ma wklejone w HTML-u — zostawione jako źródło |

## Start

```bash
node serwer.mjs          # http://127.0.0.1:8765
```

Wymaga Node 24 (bo `node:sqlite`). Adres i port przez zmienne `HOST` i `PORT`; domyślnie serwer nasłuchuje tylko na `127.0.0.1`, więc z telefonu nie jest dostępny, dopóki sam tego nie zmienisz.

Bez serwera też da się korzystać: otwórz `t-fiszki.html` podwójnym kliknięciem, a fiszki będą w `localStorage` (tryb gościa). Po postawieniu serwera pojawia się rejestracja — hasło ląduje w bazie jako zaszyfrowany odcisk (scrypt + sól), a nie jako tekst; sesja to ciasteczko `HttpOnly` ważne 30 dni.

## Widoki: telefon i komputer

Jeden próg, **760 px**: poniżej aplikacja układa się jak na telefonie, od 760 px dostaje układ komputerowy z nawigacją jako paskiem z lewej. Trzy tryby: **Dopasuj do ekranu** (tak działa domyślne `auto`), **Telefon** (zawsze wąska kolumna, a na dużym oknie ramka telefonu z opisem obok) i **Komputer** (pełna szerokość okna). Przełącza się je przyciskiem w pasku — ikona pokazuje to, co właśnie widać (telefon albo monitor) — klawiszem `W`, albo w menu → „Widok aplikacji", gdzie trzy nazwane pola są obok siebie, a pod nimi jednozdaniowe wyjaśnienie, co oznacza wybrany tryb. Wybór jest zapamiętywany **na każdym urządzeniu osobno** (`localStorage`), więc telefon nie narzuca laptopowi widoku i odwrotnie — przez serwer podróżują fiszki, terminy i statystyki, nie układ okna.

Na telefonie pionowym tryb komputerowy nie ma gdzie się rozłożyć, więc dostaje układ 760 px przewijany w poziomie (pasek górny i nawigacja trzymają się krawędzi okna) — dokładnie tak działa „Wersja komputerowa" w Chrome. Wystarczy obrócić telefon (844 px), żeby całość zmieściła się bez przewijania.

Szerokie okno dostaje tyle kolumn, ile pomieści: **Postęp** układa bloki statystyk w dwóch kolumnach od 1200 px, a w trzech od 1700 px; panel, który nie mieści się do rzędu, rozciąga się na całą szerokość (`span`). Treść idzie do 1160 px, 1560 px i 1820 px w trzech progach (1700 i 2000 px), więc przy oknie ~2047 px nie zostaje pusty pas po prawej. Heatmapa jest gęsta (kafelek 13 px), a etykiety miesięcy siedzą dokładnie nad swoimi tygodniami — test porównuje ich pozycje z wyliczonymi kolumnami.

## Zdjęcie i film przy fiszce

Fiszka może mieć **zdjęcie** i **link z YouTube** — oba opcjonalnie, oba dodawane w formularzu karty.

**Zdjęcie** widać razem z pytaniem, na awersie karty: ma podpowiedzieć skojarzenie, a nie zdradzić odpowiedź. Na telefonie przycisk otwiera aparat, na komputerze zwykły wybór pliku. Aplikacja sama zmniejsza fotkę w przeglądarce — najdłuższy bok 900 px, JPEG, a jeśli nadal waży ponad 220 kB, dokomprymowuje mocniej. Z pięciomegabajtowego zdjęcia robi się około 150 kB, więc zmieści się w limicie przesyłu. Na serwerze plik leży w `dane/media-<nazwa bazy>/<id konta>/<losowy adres>`, a w karcie zostaje tylko sam adres `/api/media/…` — stan konta dzięki temu nadal mieści się w 2 MB. W trybie gościa (plik otwarty podwójnym kliknięciem) zdjęcie jest wklejone do karty jako `data:image/jpeg;base64,…` w `localStorage`, a po zalogowaniu aplikacja wypycha takie zdjęcia na serwer i zamienia adresy w kartach.

**Film** to link, z którego aplikacja zatrzymuje tylko 11-znakowy identyfikator (obsługuje `youtu.be`, `watch?v=`, `shorts`, `live` i `embed`). Na rewersie, pod odpowiedzią, jest przycisk; ramka odtwarzacza powstaje dopiero po kliknięciu, więc dopóki uczeń nie kliknie, aplikacja nie wysyła do YouTube ani jednego żądania — testy liczą żądania, żeby to udowodnić. Adresy spoza YouTube nie przechodzą, a żądanie z zewnątrz nie dołoży do karty obcego skryptu.

**Prywatność zdjęć:** serwer wydaje plik wyłącznie zalogowanemu właścicielowi — obce konto dostaje 404, nawet gdy zna adres. Typ pliku jest brany z bazy, a nie z nagłówka żądania, i tylko z sygnatury bajtów wynika, czy to JPEG, PNG czy WebP; SVG albo HTML udający zdjęcie jest odrzucony. Na konto jest sufit: 80 zdjęć albo 24 MB. Usunięcie zdjęcia w edytorze kasuje plik z serwera, a skasowanie konta sprząta cały jego katalog.

## Wystawienie na własnym serwerze (subdomena)

Aplikacja jest jedną stroną i jednym plikiem serwera, więc wystarczy Node 24 plus nginx z certyfikatem. Sam `node serwer.mjs` nasłuchuje na `127.0.0.1` i nie zna się na HTTPS — to rola serwera pośredniczącego.

**1. Pliki i usługa.** Wrzuć `serwer.mjs`, `t-fiszki.html` i katalog `dane/` na serwer, a potem opiisz usługę:

```bash
sudo nano /etc/systemd/system/t-fiszki.service
```

```ini
[Unit]
Description=T-Fiszki
After=network.target

[Service]
WorkingDirectory=/srv/t-fiszki
ExecStart=/usr/bin/node serwer.mjs
Environment=PORT=8765
Environment=HOST=127.0.0.1
Environment=BAZA=/srv/t-fiszki/dane/t-fiszki.db
Environment=PROXY=1
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now t-fiszki
```

`PROXY=1` to jedyna nowość względem uruchamiania na laptopie: mówi serwerowi, że ruch przychodzi przez nginx, więc prawdziwy adres gościa czyta z `x-forwarded-for`, a protokół z `x-forwarded-proto`. Bez tego flaga nie da się użyć — każde logowanie wyglądałoby jak z adresu nginxa, a ciastko sesji nigdy nie dostałoby `Secure`.

**2. Subdomena i szyfrowanie.** Nginx tylko przekierowuje na 8765; `client_max_body_size` musi pomieścić zdjęcie (sufit 4 MB):

```bash
sudo nano /etc/nginx/sites-available/fiszki
```

```nginx
server {
    listen 80;
    server_name fiszki.domena.pl;
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/fiszki /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d fiszki.domena.pl
```

**3. Co trzyma napór z internetu.** Hasła są solone i zaszyfrowane (scrypt), ale publiczny adres to nie domowy Wi-Fi, więc dochodzą limity:

| Zmienna | Domyślnie | Co ogranicza |
|---|---|---|
| `LIMIT_PROB` (w kodzie) | 8 / 15 min | błędne logowania z jednego adresu do jednej nazwy — potem 429 |
| `LIMIT_REJ` | 20 / godz | konta zakładane z jednego adresu — klasa z jednego NAT-u potrzebuje więcej, podnieś |
| `LIMIT_KONT` | 300 | sufity kont na całym serwerze, żeby nikt nie zalał bazy |
| `LIMIT_MEDIA` | 1 GB | wszystkie zdjęcia wszystkich kont |
| w kodzie | 80 zdjęć / 24 MB | sufit na jedno konto |

Formularz logowania nie da się osadzić w cudzej stronie (`frame-ancestors 'none'` plus `x-frame-options: DENY`), pliki z odpowiedziami idą z `nosniff`, a ciastko sesji po HTTPS dostaje `Secure`. **Nie ma** resetu hasła (serwer nie wysyła poczty), dwuetapowego logowania ani hasła do konta T-Portalu — to nadal osobny etap.

**4. Kopia.** Całe dane to `dane/` (baza SQLite z WAL plus katalogi zdjęć). Zrób przerwę w pracy usługi, żeby pliki nie były w połowie zapisu:

```bash
sudo systemctl stop t-fiszki && sudo tar czf /backup/t-fiszki-$(date +%F).tar.gz -C /srv/t-fiszki dane && sudo systemctl start t-fiszki
```

## Testy

```bash
rm -f dane/testy.db*
PORT=8766 BAZA=dane/testy.db node serwer.mjs   # osobne okno — serwer na bazie testowej, żeby nie dotykać danych z t-fiszki.db
PORT=8766 node cdp-check.mjs           # odpala własny profil Chrome w trybie bezokienkowym i weryfikuje aplikację
PORT=8766 node zywo.mjs                # dwa urządzenia (telefon 390 + laptop 1440) na osobnych profilach: formularz z emotikoną, zdjęcie i film wędrujące między urządzeniami, sync w obie strony, dziesięć dni sesji
node sprawd-skladnie.mjs               # składnia obu bloków <script> w t-fiszki.html
PORT=8766 bash sonda-media.sh          # API zdjęć z dwóch kont przez curl: właściciel, obce konto, obce źródło, SVG, wędrówka po katalogu, sprzątanie
bash sonda-zabezpieczenia.sh           # wystawienie do internetu: własna instancja z PROXY=1 i małymi limitami — nagłówki strony, ciastko Secure, limit rejestracji na adres, blokada logowania po x-forwarded-for, sufity kont i zdjęć
node skrypt-kontrola-znakow.cjs t-fiszki.html serwer.mjs README.md cdp-check.mjs   # po edycji polskiego tekstu: szuka znaków CJK, cyrylicy i znaków prywatnych
```

Testy domyślnie stukają w `127.0.0.1:8765`; `PORT=...` pozwala uruchomić je obok serwera, na którym właśnie pracujesz.

Testy same zakładają konta z unikalną nazwą przebiegu, usuwają je na końcu i sprawdzają, że baza wróciła do zera kont i do zera zdjęć. Zrzuty dowodowe lądują w `shots/` (nie w repo — odtwarzasz je tym samym poleceniem).

## Dane

`dane/t-fiszki.db` (SQLite razem z `-wal`/`-shm`) jest w `.gitignore`: to konta i fiszki konkretnych osób, więc nie podróżują do repo.

# T-Fiszki

Fiszki zbierające **złe odpowiedzi z testów na T-Portalu** plus powtórki liczone **prawdziwym SM-2** (łatwość EF, przerwy, terminy). Mobile-first, działa też jako układ webowy; dane trzymane są lokalnie, a konto tylko je synchronizuje między telefonem a laptopem.

## Pliki

| plik | co robi |
|---|---|
| `t-fiszki.html` | cała aplikacja: HTML + CSS + JS w jednym pliku, zero zależności, działa też otwierana przez `file://` |
| `serwer.mjs` | konta, synchronizacja i zdjęcia fiszek: `node:http` + `node:sqlite` + `node:crypto`, też zero zależności |
| `cdp-check.mjs` | testy na żywym Chrome (189 asercji: konto, sync, konflikt 409, zdjęcie i film na fiszce, statystyki, kontrast AA, szerokości 320–2560 px, przełącznik widoku) |
| `sprawd-skladnie.mjs` | wyciąga każdy blok `<script>` z `t-fiszki.html` i sprawdza samą składnię — aplikacja jest jednym plikiem, więc edytor jej nie sprawdzi |
| `sonda-media.sh` | próba serwera przez `curl`: właściciel dostaje swoje zdjęcie, obce konto dostaje 404, SVG zostaje odrzucone, a kasacja konta sprząta pliki |
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

## Zdjęcie i film przy fiszce

Fiszka może mieć **zdjęcie** i **link z YouTube** — oba opcjonalnie, oba dodawane w formularzu karty.

**Zdjęcie** widać razem z pytaniem, na awersie karty: ma podpowiedzieć skojarzenie, a nie zdradzić odpowiedź. Na telefonie przycisk otwiera aparat, na komputerze zwykły wybór pliku. Aplikacja sama zmniejsza fotkę w przeglądarce — najdłuższy bok 900 px, JPEG, a jeśli nadal waży ponad 220 kB, dokomprymowuje mocniej. Z pięciomegabajtowego zdjęcia robi się około 150 kB, więc zmieści się w limicie przesyłu. Na serwerze plik leży w `dane/media-<nazwa bazy>/<id konta>/<losowy adres>`, a w karcie zostaje tylko sam adres `/api/media/…` — stan konta dzięki temu nadal mieści się w 2 MB. W trybie gościa (plik otwarty podwójnym kliknięciem) zdjęcie jest wklejone do karty jako `data:image/jpeg;base64,…` w `localStorage`, a po zalogowaniu aplikacja wypycha takie zdjęcia na serwer i zamienia adresy w kartach.

**Film** to link, z którego aplikacja zatrzymuje tylko 11-znakowy identyfikator (obsługuje `youtu.be`, `watch?v=`, `shorts`, `live` i `embed`). Na rewersie, pod odpowiedzią, jest przycisk; ramka odtwarzacza powstaje dopiero po kliknięciu, więc dopóki uczeń nie kliknie, aplikacja nie wysyła do YouTube ani jednego żądania — testy liczą żądania, żeby to udowodnić. Adresy spoza YouTube nie przechodzą, a żądanie z zewnątrz nie dołoży do karty obcego skryptu.

**Prywatność zdjęć:** serwer wydaje plik wyłącznie zalogowanemu właścicielowi — obce konto dostaje 404, nawet gdy zna adres. Typ pliku jest brany z bazy, a nie z nagłówka żądania, i tylko z sygnatury bajtów wynika, czy to JPEG, PNG czy WebP; SVG albo HTML udający zdjęcie jest odrzucony. Na konto jest sufit: 80 zdjęć albo 24 MB. Usunięcie zdjęcia w edytorze kasuje plik z serwera, a skasowanie konta sprząta cały jego katalog.

## Testy

```bash
rm -f dane/testy.db*
PORT=8766 BAZA=dane/testy.db node serwer.mjs   # osobne okno — serwer na bazie testowej, żeby nie dotykać danych z t-fiszki.db
PORT=8766 node cdp-check.mjs           # odpala własny profil Chrome w trybie bezokienkowym i weryfikuje aplikację
PORT=8766 node zywo.mjs                # dwa urządzenia (telefon 390 + laptop 1440) na osobnych profilach: formularz z emotikoną, zdjęcie i film wędrujące między urządzeniami, sync w obie strony, dziesięć dni sesji
node sprawd-skladnie.mjs               # składnia obu bloków <script> w t-fiszki.html
PORT=8766 bash sonda-media.sh          # API zdjęć z dwóch kont przez curl: właściciel, obce konto, obce źródło, SVG, wędrówka po katalogu, sprzątanie
node skrypt-kontrola-znakow.cjs t-fiszki.html serwer.mjs README.md cdp-check.mjs   # po edycji polskiego tekstu: szuka znaków CJK, cyrylicy i znaków prywatnych
```

Testy domyślnie stukają w `127.0.0.1:8765`; `PORT=...` pozwala uruchomić je obok serwera, na którym właśnie pracujesz.

Testy same zakładają konta z unikalną nazwą przebiegu, usuwają je na końcu i sprawdzają, że baza wróciła do zera kont i do zera zdjęć. Zrzuty dowodowe lądują w `shots/` (nie w repo — odtwarzasz je tym samym poleceniem).

## Dane

`dane/t-fiszki.db` (SQLite razem z `-wal`/`-shm`) jest w `.gitignore`: to konta i fiszki konkretnych osób, więc nie podróżują do repo.

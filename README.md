# T-Fiszki

Fiszki zbierające **złe odpowiedzi z testów na T-Portalu** plus powtórki liczone **prawdziwym SM-2** (łatwość EF, przerwy, terminy). Mobile-first, działa też jako układ webowy; dane trzymane są lokalnie, a konto tylko je synchronizuje między telefonem a laptopem.

## Pliki

| plik | co robi |
|---|---|
| `t-fiszki.html` | cała aplikacja: HTML + CSS + JS w jednym pliku, zero zależności, działa też otwierana przez `file://` |
| `serwer.mjs` | konta i synchronizacja: `node:http` + `node:sqlite` + `node:crypto`, też zero zależności |
| `cdp-check.mjs` | testy na żywym Chrome (138 asercji: konto, sync, konflikt 409, statystyki, kontrast AA, szerokości 320–2560 px) |
| `.fonts/` | Manrope i Unbounded, które aplikacja i tak ma wklejone w HTML-u — zostawione jako źródło |

## Start

```bash
node serwer.mjs          # http://127.0.0.1:8765
```

Wymaga Node 24 (bo `node:sqlite`). Adres i port przez zmienne `HOST` i `PORT`; domyślnie serwer nasłuchuje tylko na `127.0.0.1`, więc z telefonu nie jest dostępny, dopóki sam tego nie zmienisz.

Bez serwera też da się korzystać: otwórz `t-fiszki.html` podwójnym kliknięciem, a fiszki będą w `localStorage` (tryb gościa). Po postawieniu serwera pojawia się rejestracja — hasło ląduje w bazie jako zaszyfrowany odcisk (scrypt + sól), a nie jako tekst; sesja to ciasteczko `HttpOnly` ważne 30 dni.

## Testy

```bash
rm -f dane/testy.db*
BAZA=dane/testy.db node serwer.mjs   # osobne okno — serwer na bazie testowej, żeby nie dotykać danych z t-fiszki.db
node cdp-check.mjs                   # odpala własny profil Chrome w trybie bezokienkowym i weryfikuje aplikację
node zywo.mjs                        # dwa urządzenia (telefon 390 + laptop 1440) na osobnych profilach: formularz z emotikoną, sync w obie strony, dziesięć dni sesji
```

Testy same zakładają konta z unikalną nazwą przebiegu, usuwają je na końcu i sprawdzają, że baza wróciła do zera kont. Zrzuty dowodowe lądują w `shots/` (nie w repo — odtwarzasz je tym samym poleceniem).

## Dane

`dane/t-fiszki.db` (SQLite razem z `-wal`/`-shm`) jest w `.gitignore`: to konta i fiszki konkretnych osób, więc nie podróżują do repo.

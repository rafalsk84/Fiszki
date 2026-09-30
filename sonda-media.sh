#!/bin/bash
# Sonduję punkty API zdjęć bez przeglądarki: kolejność odpowiedzi jest dowodem, nie zgadywanką.
set -u
cd "$(dirname "$0")"
S=${PORT:-8766}
ADRES="http://127.0.0.1:$S"
K1=$(date +%s)X$$
N_A="SondA$K1"
N_B="SondB$K1"
HASLO="sonda-haslo-1234"
JAR=/tmp/sonda-a.jar
JAR2=/tmp/sonda-b.jar
rm -f "$JAR" "$JAR2"

kod() { curl -s -o /tmp/out.bin -w '%{http_code}' "$@"; }

echo "== rejestracja kont =="
printf 'A: %s ' "$(kod -c "$JAR" -X POST "$ADRES/api/register" -H 'content-type: application/json' -d "{\"nazwa\":\"$N_A\",\"haslo\":\"$HASLO\"}")"
cat /tmp/out.bin; echo
printf 'B: %s ' "$(kod -c "$JAR2" -X POST "$ADRES/api/register" -H 'content-type: application/json' -d "{\"nazwa\":\"$N_B\",\"haslo\":\"$HASLO\"}")"
cat /tmp/out.bin; echo

printf '\xff\xd8\xff\xe0sonda-zdjecia' > /tmp/zdjecie.jpg
echo "== upload JPG (sygnatura) =="
printf 'POST /api/media: %s ' "$(kod -b "$JAR" -X POST "$ADRES/api/media" -H 'content-type: image/jpeg' --data-binary @/tmp/zdjecie.jpg)"
cat /tmp/out.bin; echo
ID=$(tr -d ' "' < /tmp/out.bin | sed 's/.*id:\([0-9a-f]*\).*/\1/')
echo "id=$ID"

echo "== pobranie swojego zdjęcia =="
printf 'GET /api/media/%s (właściciel): %s ' "$ID" "$(kod -b "$JAR" "$ADRES/api/media/$ID")"
file -b /tmp/out.bin; echo
printf 'nagłówki: '; curl -s -D - -o /dev/null -b "$JAR" "$ADRES/api/media/$ID" | tr -d '\r' | grep -iE 'content-type|cache-control|content-length'
printf 'GET bez ciasteczka: %s\n' "$(kod "$ADRES/api/media/$ID")"
printf 'GET inne konto: %s ' "$(kod -b "$JAR2" "$ADRES/api/media/$ID")"; cat /tmp/out.bin; echo

echo "== odmowy =="
printf '<svg xmlns="http://www.w3.org/2000/svg"><text>zly</text></svg>' > /tmp/zly.svg
printf 'POST svg: %s ' "$(kod -b "$JAR" -X POST "$ADRES/api/media" -H 'content-type: image/svg+xml' --data-binary @/tmp/zly.svg)"; cat /tmp/out.bin; echo
printf 'POST bez sesji: %s ' "$(kod -X POST "$ADRES/api/media" -H 'content-type: image/jpeg' --data-binary @/tmp/zdjecie.jpg)"; cat /tmp/out.bin; echo
printf 'GET ../t-fiszki.db: %s\n' "$(kod -b "$JAR" --path-as-is "$ADRES/api/media/../t-fiszki.db")"
printf 'GET %%2e%%2e%%2f: %s ' "$(kod -b "$JAR" "$ADRES/api/media/%2e%2e%2ft-fiszki.db")"; cat /tmp/out.bin; echo
printf 'GET zły id: %s ' "$(kod -b "$JAR" "$ADRES/api/media/nope")"; cat /tmp/out.bin; echo

echo "== media-usun =="
printf 'POST /api/media-usun: %s ' "$(kod -b "$JAR" -X POST "$ADRES/api/media-usun" -H 'content-type: application/json' -d "{\"id\":\"$ID\"}")"; cat /tmp/out.bin; echo
printf 'GET po usunięciu: %s\n' "$(kod -b "$JAR" "$ADRES/api/media/$ID")"

echo "== sprzątanie konta =="
printf 'POST /api/media (nowe): %s ' "$(kod -b "$JAR" -X POST "$ADRES/api/media" -H 'content-type: image/jpeg' --data-binary @/tmp/zdjecie.jpg)"; cat /tmp/out.bin; echo
printf 'zdjęcia przed kasowaniem konta: '; curl -s "$ADRES/api/health" | tr -d '\r'; echo
printf 'POST /api/konto-usun A: %s ' "$(kod -b "$JAR" -X POST "$ADRES/api/konto-usun" -H 'content-type: application/json' -d "{\"haslo\":\"$HASLO\"}")"; cat /tmp/out.bin; echo
printf 'POST /api/konto-usun B: %s ' "$(kod -b "$JAR2" -X POST "$ADRES/api/konto-usun" -H 'content-type: application/json' -d "{\"haslo\":\"$HASLO\"}")"; cat /tmp/out.bin; echo
printf 'health po kasowaniu: '; curl -s "$ADRES/api/health" | tr -d '\r'; echo
echo 'zawartość katalogu zdjęć:'
find dane -path '*media-*' -print | sed 's/^/  /'

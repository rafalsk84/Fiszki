#!/bin/bash
# Sonda zabezpieczeń na publicznym serwerze: osobna instancja z PROXY=1 i małymi limitami,
# własna baza i własny port — nic nie dotyka danych z 8765 ani bazy testowej CDP.
# Uruchom:  bash sonda-zabezpieczenia.sh
set -u
cd "$(dirname "$0")"

PORT_S=${PORT_SONDY:-8768}
BAZA_S=dane/zabezpieczenia.db
ADRES="http://127.0.0.1:$PORT_S"
HASLO="sonda-haslo-1234"
JEDEN=/tmp/sonda-z1.jar
DRUGI=/tmp/sonda-z2.jar
rm -f "$JEDEN" "$DRUGI" /tmp/sonda-z-out.bin "$BAZA_S"* "$BAZA_S"
rm -rf dane/media-zabezpieczenia

kod() { curl -s -o /tmp/sonda-z-out.bin -w '%{http_code}' "$@"; }
glowa() { curl -s -D - -o /dev/null "$@" | tr -d '\r'; }
zawartosc() { tr -d '\n' < /tmp/sonda-z-out.bin; }

ZLE=0
sprawdz() {  # sprawdz "nazwa" "tak|nie" "co widać"
  if [ "$2" = "tak" ]; then printf 'PASS %s\n' "$1"
  else printf 'FAIL %s — %s\n' "$1" "$3"; ZLE=$((ZLE + 1)); fi
}
ma()       { case "$2" in *"$1"*) echo tak;; *) echo nie;; esac; }        # ma czego-szukam gdzie
nie_ma()   { case "$2" in *"$1"*) echo nie;; *) echo tak;; esac; }
kod_ok()   { [ "$1" = "$2" ] && echo tak || echo nie; }                   # kod_ok <dostałem> <czekam>
rej() {  # rej nazwa adres-gościa plik-ciasteczek -> kod HTTP
  kod -c "$3" -X POST "$ADRES/api/register" -H 'content-type: application/json' \
      -H "x-forwarded-for: $2" -H 'x-forwarded-proto: https' -d "{\"nazwa\":\"$1\",\"haslo\":\"$HASLO\"}"
}

echo "== serwer na czas sondy (PROXY=1, LIMIT_REJ=3, LIMIT_KONT=6) =="
PROXY=1 PORT=$PORT_S HOST=127.0.0.1 BAZA=$BAZA_S LIMIT_REJ=3 LIMIT_KONT=6 node serwer.mjs > /tmp/sonda-z-serwer.txt 2>&1 &
SERWER_PID=$!
trap 'kill $SERWER_PID 2>/dev/null; sleep 1; rm -f "$BAZA_S" "$BAZA_S"-wal "$BAZA_S"-shm; rm -rf dane/media-zabezpieczenia' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$ADRES/api/health" && break; sleep 0.5; done
printf 'serwer: '; cat /tmp/sonda-z-serwer.txt; echo

echo "== nagłówki dokumentu =="
NAGLOWKI=$(glowa "$ADRES/")
sprawdz 'strona nie da się osadzić w cudzej ramce'     "$(ma "frame-ancestors 'none'" "$NAGLOWKI")" "$(echo "$NAGLOWKI" | grep -i content-security || echo 'brak nagłówka')"
sprawdz 'stary x-frame-options też jest postawiony'   "$(ma DENY "$NAGLOWKI")"                     "$(echo "$NAGLOWKI" | grep -i x-frame || echo 'brak nagłówka')"
sprawdz 'przeglądarka nie zgaduje typu pliku'         "$(ma nosniff "$NAGLOWKI")"                  "$(echo "$NAGLOWKI" | grep -i content-type-options || echo 'brak nagłówka')"
sprawdz 'adres strony nie wycieka do innych stron'    "$(ma 'referrer-policy' "$NAGLOWKI")"        "$(echo "$NAGLOWKI" | grep -i referrer || echo 'brak nagłówka')"

echo "== ciastko sesji =="
SET1=$(glowa -X POST "$ADRES/api/register" -H 'content-type: application/json' -H 'x-forwarded-proto: https' \
        -H 'x-forwarded-for: 203.0.113.1' -d "{\"nazwa\":\"BezProstokata\",\"haslo\":\"$HASLO\"}" | grep -i '^set-cookie')
SET2=$(glowa -X POST "$ADRES/api/register" -H 'content-type: application/json' \
        -H 'x-forwarded-for: 203.0.113.2' -d "{\"nazwa\":\"Prostokat\",\"haslo\":\"$HASLO\"}" | grep -i '^set-cookie')
sprawdz 'po HTTPS ciastko dostaje Secure'                        "$(ma Secure "$SET1")"  "$SET1"
sprawdz 'bez HTTPS ciastko zostaje bez Secure'                   "$(nie_ma Secure "$SET2")" "$SET2"
sprawdz 'ciastko jest HttpOnly'                                  "$(ma HttpOnly "$SET1")" "$SET1"
sprawdz 'ciastko jest SameSite=Lax (cudza strona go nie wyśle)'  "$(ma Lax "$SET1")" "$SET1"

echo "== limit rejestracji z jednego adresu =="
R1=$(rej 'SondA1' '198.51.100.10' "$JEDEN"); R2=$(rej 'SondA2' '198.51.100.10' "$JEDEN")
R3=$(rej 'SondA3' '198.51.100.10' "$JEDEN"); R4=$(rej 'SondA4' '198.51.100.10' "$JEDEN")
sprawdz 'czwarte konto z tego samego adresu dostaje 429' "$(kod_ok "$R4" 429)" "kody: $R1 $R2 $R3 $R4 — $(zawartosc)"
R5=$(rej 'SondB1' '198.51.100.11' "$DRUGI")
sprawdz 'następny adres za tym samym proxy nadal może się zarejestrować' "$(kod_ok "$R5" 200)" "kod $R5 — $(zawartosc)"

echo "== blokada logowania liczy się po adresie gościa, nie proxy =="
for i in 1 2 3 4 5 6 7 8; do kod -X POST "$ADRES/api/login" -H 'content-type: application/json' \
  -H 'x-forwarded-for: 203.0.113.77' -d "{\"nazwa\":\"Prostokat\",\"haslo\":\"zle-haslo-$i\"}" > /dev/null; done
Z9=$(kod -X POST "$ADRES/api/login" -H 'content-type: application/json' -H 'x-forwarded-for: 203.0.113.77' \
     -d "{\"nazwa\":\"Prostokat\",\"haslo\":\"$HASLO\"}")
sprawdz 'po ośmiu złych próbach z adresu przychodzi 429' "$(kod_ok "$Z9" 429)" "kod $Z9 — $(zawartosc)"
D9=$(kod -c "$DRUGI" -X POST "$ADRES/api/login" -H 'content-type: application/json' -H 'x-forwarded-for: 198.51.100.77' \
     -d "{\"nazwa\":\"Prostokat\",\"haslo\":\"$HASLO\"}")
sprawdz 'gość z drugiego adresu loguje się normalnie' "$(kod_ok "$D9" 200)" "kod $D9 — $(zawartosc)"

echo "== sufity na cały serwer =="
for i in 2 3 4 5 6 7; do rej "SondC$i" "198.51.100.2$i" "$DRUGI" > /dev/null; done
ZD=$(rej 'SondC9' '198.51.100.99' "$DRUGI")
sprawdz 'konto ponad limitem serwera dostaje 503' "$(kod_ok "$ZD" 503)" "kod $ZD — $(zawartosc)"
printf 'health: '; curl -s "$ADRES/api/health"; echo

echo "== sprzątanie =="
for NAZWA in BezProstokata Prostokat SondA1 SondA2 SondA3 SondB1 SondC2 SondC3 SondC4 SondC5 SondC6 SondC7; do
  J=/tmp/sonda-z-usun.jar; rm -f "$J"
  kod -c "$J" -X POST "$ADRES/api/login" -H 'content-type: application/json' -H 'x-forwarded-for: 198.51.100.5' \
      -d "{\"nazwa\":\"$NAZWA\",\"haslo\":\"$HASLO\"}" > /dev/null
  kod -b "$J" -X POST "$ADRES/api/konto-usun" -H 'content-type: application/json' -H 'x-forwarded-for: 198.51.100.5' \
      -d "{\"haslo\":\"$HASLO\"}" > /dev/null
done
PO=$(curl -s "$ADRES/api/health")
sprawdz 'wszystkie konta sondy zniknęły' "$(ma '"konta":0' "$PO")" "$PO"

if [ "$ZLE" -gt 0 ]; then echo "SONDA ZABEZPIECZEŃ: $ZLE porażek"; exit 1; fi
echo "SONDA ZABEZPIECZEŃ: wszystko zielono"

/*
  T-Fiszki — serwer kont i synchronizacji.
  Uruchom:  node serwer.mjs        potem otwórz  http://127.0.0.1:8765
  Publicznie (za nginxem z HTTPS): PROXY=1 — wtedy adres gościa i protokół czytamy z x-forwarded-*,
  a sufity na cały serwer ustawia LIMIT_REJ (kont na godzinę z adresu), LIMIT_KONT, LIMIT_MEDIA (bajty zdjęć).
  Node 24, zero zależności: wbudowany moduł sqlite, kryptografia i serwer HTTP.

  Co tu jest: konta (nazwa + hasło), sesja w ciasteczku, zapis stanu fiszek na serwerze.
  Hasła NIGDY nie są zapisywane — trzymamy tylko jego zaszyfrowany odcisk (scrypt + sól).
  Każdy uczeń widzi wyłącznie swoje dane: każde zapytanie jest filtrowane po id konta z sesji.
  Zdjęcia do fiszek są na serwerze w katalogu dane/media-<baza>/<id konta>; w kartach zostaje tylko adres.
*/
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {dirname, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const TUTAJ = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const BAZA = process.env.BAZA || join(TUTAJ, 'dane', 't-fiszki.db');   // testy: BAZA=dane/testy.db
const PLIK_APLIKACJI = join(TUTAJ, 't-fiszki.html');
const DNI_SESJI = 30;
const MAX_CIALA = 2 * 1024 * 1024;          // 2 MB na zestaw fiszek — z zapasem
const LIMIT_PROB = 8, OKNO_PROB = 15 * 60e3; // 8 błędnych logowań z rzędu na 15 minut
const MAX_MEDIA = 4 * 1024 * 1024;          // 4 MB na jeden plik graficzny (klient i tak zmniejsza do ~150 kB)
const LIMIT_ZDJEC = 80, LIMIT_BAJTOW = 24 * 1024 * 1024;    // sufit na konto: tyle zdjęć albo tyle bajtów
/* Sufity poniżej mają znaczenie poza domem. Lokalnie, bez PROXY=1, limity rejestracji i kont
   są tak wysokie, że nikt ich nie dotknie — a adres gościa bierzemy wtedy wprost z połączenia. */
const PROXY = process.env.PROXY === '1';                        // ruch za serwerem pośredniczącym: ufasz nagłówkom x-forwarded-*
const LIMIT_REJ = Number(process.env.LIMIT_REJ || 20);          // tyle kont można założyć z jednego adresu w godzinę
const OKNO_REJ = 60 * 60e3;
const LIMIT_KONT = Number(process.env.LIMIT_KONT || 300);       // sufit kont na całym serwerze
const LIMIT_MEDIA_CALKOWITY = Number(process.env.LIMIT_MEDIA || 1024 * 1024 * 1024);   // 1 GB zdjęć na serwer
// Zdjęcia leżą w katalogu przy bazie, więc testy na BAZA=dane/testy.db nie wchodzą w prawdziwe pliki.
const KATALOG_MEDIA = process.env.MEDIA || join(dirname(BAZA), 'media-' + basename(BAZA).replace(/\.[^.]*$/, ''));

mkdirSync(dirname(BAZA), {recursive: true});
const db = new DatabaseSync(BAZA);
db.exec(`
  pragma journal_mode = wal;
  create table if not exists konta(
    id integer primary key, nick text not null, nazwa text not null unique, sol text not null, odcisk text not null,
    utworzono integer not null);
  create table if not exists sesje(
    token text primary key, konto integer not null, wazna_do integer not null);
  create table if not exists stan(
    konto integer primary key, dane text not null, rev integer not null, zapisano integer not null);
  create table if not exists proby(
    klucz text primary key, ile integer not null, od integer not null);
  create table if not exists media(
    id text primary key, konto integer not null, plik text not null, typ text not null, rozmiar integer not null,
    utworzono integer not null);
`);

/* ── hasła ───────────────────────────────────────────────────────── */
const OD_WYJATKU = randomBytes(32).toString('hex');   // porównywany, gdy konta nie ma
function zaszyfruj(haslo, sol) {
  return new Promise((res, rej) =>
    scrypt(haslo.normalize('NFKC'), sol, 64, (e, d) => e ? rej(e) : res(d.toString('hex'))));
}
async function sprawdzOdcisk(haslo, sol, oczekiwany) {
  const dost = await zaszyfruj(haslo, sol || OD_WYJATKU);
  const a = Buffer.from(dost, 'hex'), b = Buffer.from(oczekiwany || OD_WYJATKU, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── pomocnicze ──────────────────────────────────────────────────── */
const ZAP = db.prepare('insert into proby(klucz,ile,od) values(?,1,?) on conflict(klucz) do update set ile=ile+1,od=excluded.od');
const CZY_BLOKADA = db.prepare('select ile,od from proby where klucz=?');
const CZYST_BLOKADA = db.prepare('delete from proby where klucz=?');
function zaBlokowany(klucz, teraz, limit = LIMIT_PROB, okno = OKNO_PROB) {
  const w = CZY_BLOKADA.get(klucz);
  if (!w) return 0;
  if (teraz - w.od > okno) { CZYST_BLOKADA.run(klucz); return 0; }
  return w.ile >= limit ? Math.max(1, Math.ceil((okno - (teraz - w.od)) / 60000)) : 0;
}
/* Gość za serwerem pośredniczącym ma adres nginxa, więc liczniki oparte na nim zamknęłyby całą klasę
   po jednej próbie. PROXY=1 mówi: pierwszy adres z x-forwarded-* jest prawdziwy. */
function adresKlienta(req) {
  if (PROXY) {
    const pierwszy = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (pierwszy) return pierwszy;
  }
  return req.socket.remoteAddress || '?';
}
const poHTTPS = req => PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const POBIERZ_KONTO = db.prepare('select id,nick,sol,odcisk from konta where nazwa=?');
async function uwierzytelnij(req, res) {
  const c = ciasteczka(req);
  if (!c.tfiszki_sesja) return null;
  const w = db.prepare('select konto,wazna_do from sesje where token=?').get(c.tfiszki_sesja);
  if (!w) return null;
  if (w.wazna_do < Date.now()) { db.prepare('delete from sesje where token=?').run(c.tfiszki_sesja); return null; }
  return w.konto;
}
function kontoPoId(id) { return db.prepare('select id,nick from konta where id=?').get(id); }
// Secure tylko gdy ruch przyszedł po HTTPS — inaczej ciastko zniknęłoby na zwykłym http:// w domu
function ciastkoSesja(wartosc, wiek, secure) {
  return `tfiszki_sesja=${wartosc}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${wiek}` + (secure ? '; Secure' : '');
}
function nowaSesja(res, req, idKonta) {
  const token = randomBytes(32).toString('hex');
  db.prepare('insert into sesje(token,konto,wazna_do) values(?,?,?)').run(token, idKonta, Date.now() + DNI_SESJI * 864e5);
  res.setHeader('set-cookie', ciastkoSesja(token, DNI_SESJI * 86400, poHTTPS(req)));
}
function wyloguj(res, req) {
  const c = ciasteczka(req);
  if (c.tfiszki_sesja) db.prepare('delete from sesje where token=?').run(c.tfiszki_sesja);
  res.setHeader('set-cookie', ciastkoSesja('', 0, poHTTPS(req)));
}
function ciasteczka(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function json(res, kod, dane) {
  const cialo = JSON.stringify(dane);
  res.writeHead(kod, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'content-length': Buffer.byteLength(cialo)});
  res.end(cialo);
}
function cialo(req) {
  return new Promise((res, rej) => {
    let buf = '', n = 0;
    req.on('data', function (d) { n += d.length; if (n > MAX_CIALA) { rej(Object.assign(new Error('za duze'), {kod: 413})); req.destroy(); return; } buf += d; });
    req.on('end', () => { try { res(buf ? JSON.parse(buf) : {}); } catch { rej(Object.assign(new Error('zle_json'), {kod: 400})); } });
    req.on('error', rej);
  });
}
/* ── zdjęcia ─────────────────────────────────────────────────────── */
/* Plik dostaje nazwę wylosowaną przez serwer, a typ z samych bajtów — nagłówek content-type
   od przeglądarki może kłamać, więc SVG, HTML i GIF-y nie przejdą. */
function obrazemJest(b) {
  if (b.length > 12 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ['image/jpeg', 'jpg'];
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return ['image/png', 'png'];
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
function cialoBin(req, limit) {
  return new Promise((res, rej) => {
    const czesci = []; let n = 0;
    req.on('data', function (d) {
      n += d.length;
      if (n > limit) { rej(Object.assign(new Error('za duze'), {kod: 413})); req.destroy(); return; }
      czesci.push(d);
    });
    req.on('end', () => res(Buffer.concat(czesci)));
    req.on('error', rej);
  });
}
const WK = db.prepare('select count(*) n, coalesce(sum(rozmiar),0) b from media where konto=?');
const LICZ_KONTA = db.prepare('select count(*) n from konta');
const MEDIA_WSZYSTKIE = db.prepare('select coalesce(sum(rozmiar),0) b from media');
const POBIERZ_MEDIA = db.prepare('select id,konto,plik,typ from media where id=?');
const DODAJ_MEDIA = db.prepare('insert into media(id,konto,plik,typ,rozmiar,utworzono) values(?,?,?,?,?,?)');
const USUN_MEDIA = db.prepare('delete from media where id=? and konto=?');
const NAZWA_MEDIA = /^[0-9a-f]{16}$/;
const katalogKonta = id => join(KATALOG_MEDIA, String(id));
function mediaUsunPlik(konto, plik) { try { rmSync(join(katalogKonta(konto), plik)); } catch (e) { /* pliku już nie ma — porządek w bazie i tak zrobiony */ } }

const czystaNazwa = s => String(s || '').normalize('NFKC').replace(/[<>]/g, '').trim().replace(/\s+/g, ' ');
const poprawnaNazwa = s => s.length >= 2 && s.length <= 28 && !/^\d+$/.test(s);
const poprawneHaslo = s => typeof s === 'string' && s.length >= 8 && s.length <= 128;
/* żądania zmieniające dane muszą przyjść z tej samej strony — ochrona przed podszyciem się inną domeną */
function dozwolonyZrodlo(req) {
  const o = req.headers.origin;
  if (!o) return true;                                   // fetch bez Origin (ten sam katalog) — OK
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

/* ── API ─────────────────────────────────────────────────────────── */
const TRASY = {
  'GET /api/health': async function (req, res) {
    json(res, 200, {ok: true, konta: db.prepare('select count(*) n from konta').get().n,
      zdjecia: db.prepare('select count(*) n from media').get().n});
  },
  'GET /api/me': async function (req, res) {
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {zalogowany: false});
    const s = db.prepare('select rev,zapisano from stan where konto=?').get(k.id);
    json(res, 200, {zalogowany: true, nazwa: k.nick, rev: s ? s.rev : 0, zapisano: s ? s.zapisano : null});
  },
  'POST /api/register': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const klucz = 'rej|' + adresKlienta(req), teraz = Date.now();
    const minut = zaBlokowany(klucz, teraz, LIMIT_REJ, OKNO_REJ);
    if (minut) return json(res, 429, {blad: `Za dużo kont zakładanych z tego adresu. Odczekaj ${minut} min.`});
    ZAP.run(klucz, teraz);                                  // liczy się każda próba, także ta z błędnymi danymi
    if (LICZ_KONTA.get().n >= LIMIT_KONT) return json(res, 503, {blad: 'Na tym serwerze jest już pełno kont — poproś opiekuna aplikacji o większy limit.'});
    const b = await cialo(req), nazwa = czystaNazwa(b.nazwa);
    if (!poprawnaNazwa(nazwa)) return json(res, 400, {blad: 'Podaj imię lub pseudonim: od 2 do 28 znaków, nie same cyfry.'});
    if (!poprawneHaslo(b.haslo)) return json(res, 400, {blad: 'Hasło musi mieć co najmniej 8 znaków.'});
    if (POBIERZ_KONTO.get(nazwa.toLowerCase())) return json(res, 409, {blad: 'Taka nazwa jest już zajęta — zaloguj się albo wybierz inną.'});
    const sol = randomBytes(16).toString('hex');
    const odcisk = await zaszyfruj(b.haslo, sol);
    const w = db.prepare('insert into konta(nick,nazwa,sol,odcisk,utworzono) values(?,?,?,?,?)').run(nazwa, nazwa.toLowerCase(), sol, odcisk, Date.now());
    nowaSesja(res, req, Number(w.lastInsertRowid));
    json(res, 200, {zalogowany: true, nazwa: nazwa});
  },
  'POST /api/login': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const b = await cialo(req), nazwa = czystaNazwa(b.nazwa), ip = adresKlienta(req) + '|' + nazwa.toLowerCase();
    const minut = zaBlokowany(ip, Date.now());
    if (minut) return json(res, 429, {blad: `Za wiele prób logowania. Odczekaj ${minut} min.`});
    const k = POBIERZ_KONTO.get(nazwa.toLowerCase());
    // przy braku konta i tak liczymy odcisk — czas odpowiedzi nie zdradza, czy taka nazwa istnieje
    const ok = await sprawdzOdcisk(String(b.haslo || ''), k && k.sol, k && k.odcisk);
    if (!ok) { ZAP.run(ip, Date.now()); return json(res, 401, {blad: 'Nazwa albo hasło się nie zgadza.'}); }
    CZYST_BLOKADA.run(ip);
    db.prepare('delete from sesje where wazna_do<?').run(Date.now());
    nowaSesja(res, req, k.id);
    json(res, 200, {zalogowany: true, nazwa: k.nick});
  },
  'POST /api/logout': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    wyloguj(res, req); json(res, 200, {zalogowany: false});
  },
  'GET /api/state': async function (req, res) {
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {blad: 'Brak sesji.'});
    const s = db.prepare('select dane,rev,zapisano from stan where konto=?').get(k.id);
    json(res, 200, {nazwa: k.nick, rev: s ? s.rev : 0, zapisano: s ? s.zapisano : null,
      dane: s ? JSON.parse(s.dane) : null});
  },
  'PUT /api/state': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {blad: 'Brak sesji.'});
    const b = await cialo(req);
    if (!b.dane || typeof b.dane !== 'object' || !Array.isArray(b.dane.cards)) return json(res, 400, {blad: 'Zestaw danych nie wygląda na fiszki.'});
    const st = db.prepare('select dane,rev from stan where konto=?').get(k.id);
    const rev = st ? st.rev : 0;
    if (typeof b.rev === 'number' && b.rev !== rev)          // ktoś zapisał wcześniej z innego urządzenia
      return json(res, 409, {blad: 'Nowsze dane są już na serwerze.', rev: rev, zapisano: st ? Date.now() : null, dane: JSON.parse(st.dane)});
    const nowe = rev + 1, teraz = Date.now();
    db.prepare(`insert into stan(konto,dane,rev,zapisano) values(?,?,?,?)
      on conflict(konto) do update set dane=excluded.dane, rev=excluded.rev, zapisano=excluded.zapisano`)
      .run(k.id, JSON.stringify(b.dane), nowe, teraz);
    json(res, 200, {ok: true, rev: nowe, zapisano: teraz});
  },
  'POST /api/media': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {blad: 'Brak sesji.'});
    const b = await cialoBin(req, MAX_MEDIA);
    const typ = obrazemJest(b);
    if (!typ) return json(res, 415, {blad: 'To nie jest zdjęcie — serwer przyjmuje JPG, PNG i WebP.'});
    const zapas = WK.get(k.id);
    if (zapas.n >= LIMIT_ZDJEC || zapas.b + b.length > LIMIT_BAJTOW)
      return json(res, 507, {blad: `Za dużo zdjęć na koncie (limit ${LIMIT_ZDJEC} zdjęć albo ${Math.round(LIMIT_BAJTOW / 1048576)} MB). Usuń zdjęcie ze starych fiszek.`});
    if (MEDIA_WSZYSTKIE.get().b + b.length > LIMIT_MEDIA_CALKOWITY)
      return json(res, 507, {blad: 'Serwer ma pełno zdjęć od wszystkich uczniów — powiedz opiekunowi aplikacji.'});
    const mid = randomBytes(8).toString('hex'), plik = mid + '.' + typ[1];
    mkdirSync(katalogKonta(k.id), {recursive: true});
    writeFileSync(join(katalogKonta(k.id), plik), b);
    DODAJ_MEDIA.run(mid, k.id, plik, typ[0], b.length, Date.now());
    json(res, 200, {ok: true, id: mid, url: '/api/media/' + mid, rozmiar: b.length});
  },
  'POST /api/media-usun': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {blad: 'Brak sesji.'});
    const b = await cialo(req);
    const w = typeof b.id === 'string' && NAZWA_MEDIA.test(b.id) ? POBIERZ_MEDIA.get(b.id) : null;
    if (!w || w.konto !== k.id) return json(res, 404, {blad: 'Brak takiego zdjęcia.'});
    USUN_MEDIA.run(b.id, k.id); mediaUsunPlik(k.id, w.plik);
    json(res, 200, {ok: true});
  },
  'POST /api/konto-usun': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const id = await uwierzytelnij(req, res);
    const k = id && kontoPoId(id);
    if (!k) return json(res, 401, {blad: 'Brak sesji.'});
    const b = await cialo(req);
    const p = db.prepare('select sol,odcisk from konta where id=?').get(k.id);
    if (!await sprawdzOdcisk(String(b.haslo || ''), p.sol, p.odcisk)) return json(res, 401, {blad: 'Hasło się nie zgadza.'});
    db.prepare('delete from stan where konto=?').run(k.id);
    db.prepare('delete from sesje where konto=?').run(k.id);
    db.prepare('delete from konta where id=?').run(k.id);
    db.prepare('delete from media where konto=?').run(k.id);
    // katalogi zdjęć noszą w nazwie numer konta, więc stąd nie da się wyjść poza dane
    try { rmSync(join(KATALOG_MEDIA, String(k.id)), {recursive: true, force: true}); } catch (e) { /* katalogu już nie ma */ }
    wyloguj(res, req);
    json(res, 200, {ok: true});
  }
};

/* Zdjęcia są tylko dla zalogowanego właściciela: plik leży w katalogu o nazwie jego konta,
   a adres zapytania to losowy szesnastkowy numer, więc po nazwie nie da się nic zgadnąć. */
async function pobierzMedia(req, res, sufix) {
  const id = await uwierzytelnij(req, res);
  const k = id && kontoPoId(id);
  if (!k) return json(res, 401, {blad: 'Brak sesji.'});
  if (!NAZWA_MEDIA.test(sufix)) return json(res, 400, {blad: 'Zła nazwa zdjęcia.'});
  const w = POBIERZ_MEDIA.get(sufix);
  if (!w || w.konto !== k.id) return json(res, 404, {blad: 'Brak takiego zdjęcia.'});
  let dane;
  try { dane = readFileSync(join(katalogKonta(w.konto), w.plik)); }
  catch (e) { USUN_MEDIA.run(w.id, w.konto); return json(res, 404, {blad: 'Zdjęcie zniknęło z serwera.'}); }
  res.writeHead(200, {'content-type': w.typ, 'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'content-length': dane.length});
  res.end(dane);
}

/* ── serwer ──────────────────────────────────────────────────────── */
const serwer = createServer(async function (req, res) {
  const klucz = req.method + ' ' + req.url.split('?')[0];
  try {
    if (TRASY[klucz]) return await TRASY[klucz](req, res);
    if (klucz.startsWith('GET /api/media/')) return await pobierzMedia(req, res, klucz.slice('GET /api/media/'.length));
    if (klucz.startsWith('POST /api/') || klucz.startsWith('PUT /api/')) return json(res, 404, {blad: 'Nie ma takiego punktu API.'});
    if (req.method === 'GET' && (klucz === 'GET /' || klucz === 'GET /t-fiszki.html')) {
      const html = readFileSync(PLIK_APLIKACJI);
      // Strona z formularzem logowania nie może dać się osadzić w cudzej ramce — inaczej ktoś podszyłby się pod nią.
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-length': html.length, 'x-content-type-options': 'nosniff',
        'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin'});
      return res.end(html);
    }
    res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'}); res.end('Nie ma takiej strony.');
  } catch (e) {
    if (e && e.kod) return json(res, e.kod, {blad: e.kod === 413 ? 'Zestaw fiszek jest za duży.' : 'Nie udało się odczytać danych.'});
    console.error('BŁĄD:', e && e.message);
    if (!res.headersSent) json(res, 500, {blad: 'Wewnętrzny błąd serwera.'});
  }
});
serwer.listen(PORT, HOST, function () {
  console.log(`T-Fiszki: http://${HOST}:${PORT}  (baza: ${BAZA})`);
  if (!existsSync(PLIK_APLIKACJI)) console.log('UWAGA: brakuje pliku t-fiszki.html obok serwera.');
});

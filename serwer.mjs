/*
  T-Fiszki — serwer kont i synchronizacji.
  Uruchom:  node serwer.mjs        potem otwórz  http://127.0.0.1:8765
  Node 24, zero zależności: wbudowany moduł sqlite, kryptografia i serwer HTTP.

  Co tu jest: konta (nazwa + hasło), sesja w ciasteczku, zapis stanu fiszek na serwerze.
  Hasła NIGDY nie są zapisywane — trzymamy tylko jego zaszyfrowany odcisk (scrypt + sól).
  Każdy uczeń widzi wyłącznie swoje dane: każde zapytanie jest filtrowane po id konta z sesji.
*/
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const TUTAJ = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const BAZA = process.env.BAZA || join(TUTAJ, 'dane', 't-fiszki.db');   // testy: BAZA=dane/testy.db
const PLIK_APLIKACJI = join(TUTAJ, 't-fiszki.html');
const DNI_SESJI = 30;
const MAX_CIALA = 2 * 1024 * 1024;          // 2 MB na zestaw fiszek — z zapasem
const LIMIT_PROB = 8, OKNO_PROB = 15 * 60e3; // 8 błędnych logowań z rzędu na 15 minut

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
function zaBlokowany(klucz, teraz) {
  const w = CZY_BLOKADA.get(klucz);
  if (!w) return 0;
  if (teraz - w.od > OKNO_PROB) { CZYST_BLOKADA.run(klucz); return 0; }
  return w.ile >= LIMIT_PROB ? Math.ceil((OKNO_PROB - (teraz - w.od)) / 60000) : 0;
}
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
function nowaSesja(res, idKonta) {
  const token = randomBytes(32).toString('hex');
  db.prepare('insert into sesje(token,konto,wazna_do) values(?,?,?)').run(token, idKonta, Date.now() + DNI_SESJI * 864e5);
  res.setHeader('set-cookie', `tfiszki_sesja=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DNI_SESJI * 86400}`);
}
function wyloguj(res, req) {
  const c = ciasteczka(req);
  if (c.tfiszki_sesja) db.prepare('delete from sesje where token=?').run(c.tfiszki_sesja);
  res.setHeader('set-cookie', 'tfiszki_sesja=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
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
    json(res, 200, {ok: true, konta: db.prepare('select count(*) n from konta').get().n});
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
    const b = await cialo(req), nazwa = czystaNazwa(b.nazwa);
    if (!poprawnaNazwa(nazwa)) return json(res, 400, {blad: 'Podaj imię lub pseudonim: od 2 do 28 znaków, nie same cyfry.'});
    if (!poprawneHaslo(b.haslo)) return json(res, 400, {blad: 'Hasło musi mieć co najmniej 8 znaków.'});
    if (POBIERZ_KONTO.get(nazwa.toLowerCase())) return json(res, 409, {blad: 'Taka nazwa jest już zajęta — zaloguj się albo wybierz inną.'});
    const sol = randomBytes(16).toString('hex');
    const odcisk = await zaszyfruj(b.haslo, sol);
    const w = db.prepare('insert into konta(nick,nazwa,sol,odcisk,utworzono) values(?,?,?,?,?)').run(nazwa, nazwa.toLowerCase(), sol, odcisk, Date.now());
    nowaSesja(res, Number(w.lastInsertRowid));
    json(res, 200, {zalogowany: true, nazwa: nazwa});
  },
  'POST /api/login': async function (req, res) {
    if (!dozwolonyZrodlo(req)) return json(res, 403, {blad: 'Nieznane źródło żądania.'});
    const b = await cialo(req), nazwa = czystaNazwa(b.nazwa), ip = (req.socket.remoteAddress || '?') + '|' + nazwa.toLowerCase();
    const minut = zaBlokowany(ip, Date.now());
    if (minut) return json(res, 429, {blad: `Za wiele prób logowania. Odczekaj ${minut} min.`});
    const k = POBIERZ_KONTO.get(nazwa.toLowerCase());
    // przy braku konta i tak liczymy odcisk — czas odpowiedzi nie zdradza, czy taka nazwa istnieje
    const ok = await sprawdzOdcisk(String(b.haslo || ''), k && k.sol, k && k.odcisk);
    if (!ok) { ZAP.run(ip, Date.now()); return json(res, 401, {blad: 'Nazwa albo hasło się nie zgadza.'}); }
    CZYST_BLOKADA.run(ip);
    db.prepare('delete from sesje where wazna_do<?').run(Date.now());
    nowaSesja(res, k.id);
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
    wyloguj(res, req);
    json(res, 200, {ok: true});
  }
};

/* ── serwer ──────────────────────────────────────────────────────── */
const serwer = createServer(async function (req, res) {
  const klucz = req.method + ' ' + req.url.split('?')[0];
  try {
    if (TRASY[klucz]) return await TRASY[klucz](req, res);
    if (klucz.startsWith('POST /api/') || klucz.startsWith('PUT /api/')) return json(res, 404, {blad: 'Nie ma takiego punktu API.'});
    if (req.method === 'GET' && (klucz === 'GET /' || klucz === 'GET /t-fiszki.html')) {
      const html = readFileSync(PLIK_APLIKACJI);
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-length': html.length, 'x-content-type-options': 'nosniff'});
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
  console.log(`T-Fiszki: http://${HOST}:${PORT}  (baza: dane/t-fiszki.db)`);
  if (!existsSync(PLIK_APLIKACJI)) console.log('UWAGA: brakuje pliku t-fiszki.html obok serwera.');
});

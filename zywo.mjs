// Test na żywo: dwa urządzenia (telefon + laptop na osobnych profilach Chrome),
// dodawanie fiszki z emotikoną przez formularz, synchronizacja w obie strony,
// postęp po wielu sesjach (pięć „dni” nauki symulowanych zegarem w stronie).
// Wymaga: BAZA=dane/testy.db node serwer.mjs
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URLA = 'http://127.0.0.1:8765/t-fiszki.html';
const OUT = 'D:\\Moje programowanie\\T-Fiszki\\shots';
const STEMP = Date.now().toString(36).slice(-5);
const NAZWA = 'Test Zyx ' + STEMP, HASLO = 'test-haslo-123';
mkdirSync(OUT, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAIL = [];
function check(nazwa, ok, opis) { console.log((ok ? 'PASS ' : 'FAIL ') + nazwa + (opis ? '  ' + opis : '')); if (!ok) FAIL.push(nazwa + (opis ? ' — ' + opis : '')); }

class Urzadzenie {
  constructor(nazwa, port, sz, wy, dpr, mobile) {
    this.nazwa = nazwa; this.port = port; this.sz = sz; this.wy = wy; this.dpr = dpr; this.mobile = mobile;
    this.profil = process.env.TEMP + '\\tfiszki-' + nazwa + '-' + STEMP;
    this.logi = [];
  }
  async start() {
    this.proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + this.port,
      '--user-data-dir=' + this.profil, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
    let lista = null;
    for (let i = 0; i < 60 && !lista; i++) { await sleep(300); try { lista = await (await fetch('http://127.0.0.1:' + this.port + '/json')).json(); } catch { } }
    if (!lista) throw new Error('brak CDP: ' + this.nazwa);
    this.ws = new WebSocket((lista.find(t => t.type === 'page') || lista[0]).webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.id = 0; this.pending = new Map();
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') this.logi.push('WYJATEK: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
        this.logi.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    };
    await this.send('Page.enable'); await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {width: this.sz, height: this.wy, deviceScaleFactor: this.dpr, mobile: this.mobile});
    await this.send('Page.navigate', {url: URLA});
    await sleep(2200);
  }
  send(method, params = {}) { return new Promise(res => { const i = ++this.id; this.pending.set(i, res); this.ws.send(JSON.stringify({id: i, method, params})); }); }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.result?.exceptionDetails) this.logi.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || 'błąd'));
    return r.result?.result?.value;
  }
  async js(expr) { return JSON.parse(await this.ev(expr)); }
  async click(sel, wait = 700) { const ok = await this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'BRAK: ${sel}';e.click();return 'ok'})()`); if (ok !== 'ok') this.logi.push(ok); await sleep(wait); return ok; }
  async wpisz(sel, wart) { return this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'BRAK';e.value=${JSON.stringify(wart)};e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`); }
  async shot(n) { const r = await this.send('Page.captureScreenshot', {format: 'png'}); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); }
  async stop() { this.ws?.close(); this.proc?.kill(); await sleep(600); try { rmSync(this.profil, {recursive: true, force: true}); } catch { } }
}

const tel = new Urzadzenie('telefon', 9401, 390, 844, 2, true);
const lap = new Urzadzenie('laptop', 9402, 1440, 900, 1, false);
await tel.start(); await lap.start();
console.log('URZADZENIA', JSON.stringify({telefon: await tel.ev(`innerWidth`), laptop: await lap.ev(`innerWidth`), web: await lap.ev(`document.documentElement.className`)}));

/* ── 1 · Konto na telefonie i nowa fiszka z emotikoną ─────────────── */
await tel.click('[data-act="loginTryb"][data-v="rejestracja"]', 400);
await tel.wpisz('#lName', NAZWA); await tel.wpisz('#lPass', HASLO);
await tel.click('[data-act="loginGo"]', 3200);
const kontoTel = await tel.ev(`konto`);
check('konto założone na telefonie', kontoTel === NAZWA, String(kontoTel));
await tel.ev(`deckOpen='sec';go('decks')`); await sleep(700);
await tel.click('[data-act="addcard"]', 700);
const PALETA = await tel.js(`JSON.stringify([...document.querySelectorAll('.znpick .ik')].map(b=>b.dataset.i).filter(x=>x&&x.trim()))`);
const IK1 = PALETA[3], IK2 = PALETA[12];
console.log('PALETA', JSON.stringify({ile: PALETA.length, IK1, IK2}));
await tel.wpisz('#cF', 'Ile bitów zajmuje adres IPv6?');
await tel.wpisz('#cB', '128 bitów, czyli osiem grup po cztery cyfry szesnastkowe.');
await tel.click(`.znpick .ik[data-i=${JSON.stringify(IK1)}]`, 350);
const pol = await tel.ev(`document.getElementById('cI').value`);
check('paleta wstawiła emotikonę do pola', pol === IK1, JSON.stringify({pol, IK1}));
await tel.shot('zywo-1-telefon-formularz');
await tel.click('[data-act="cardSave"]', 1200);
const nowa = await tel.js(`JSON.stringify((()=>{const c=S.cards.find(x=>/IPv6/.test(x.front));
  const w=[...document.querySelectorAll('.cardrow')].find(r=>/IPv6/.test(r.textContent));
  return c?{id:c.id,ikona:c.ikona||'',deck:c.deck,status:c.status,wKolumnie:!!(w&&w.querySelector('.iko'))}:null})())`);
check('fiszka zapisana z emotikoną', !!nowa && nowa.ikona === IK1 && nowa.wKolumnie, JSON.stringify(nowa));
await tel.shot('zywo-2-telefon-lista-z-emotikona');
await sleep(2600);   // debounce autosynchronizacji
const serwer1 = await tel.js(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,ik:s.dane.cards.find(c=>/IPv6/.test(c.front))?.ikona||'brak'}))`);
check('telefon wysłał nową fiszkę na serwer', serwer1.ik === IK1, JSON.stringify(serwer1));

/* ── 2 · Telefon → laptop ─────────────────────────────────────────── */
await lap.click('[data-act="loginTryb"][data-v="logowanie"]', 400);
await lap.wpisz('#lName', NAZWA); await lap.wpisz('#lPass', HASLO);
await lap.click('[data-act="loginGo"]', 3200);
const naLaptopie = await lap.js(`JSON.stringify((()=>{const c=S.cards.find(x=>/IPv6/.test(x.front));
  return{konto:konto,ikona:c?c.ikona||'':'BRAK KARTY',razem:S.cards.length,logi:S.log.length}})())`);
check('laptop pobrał fiszkę z emotikoną z serwera', naLaptopie.konto === NAZWA && naLaptopie.ikona === IK1, JSON.stringify(naLaptopie));
await lap.ev(`go('today')`); await sleep(700);
await lap.shot('zywo-3-laptop-po-pobraniu');

/* ── 3 · Laptop → telefon (automatyczne odświeżanie co 45 s) ──────── */
await lap.ev(`deckOpen='sec';go('decks')`); await sleep(700);
await lap.click('[data-act="addcard"]', 700);
await lap.wpisz('#cF', 'Czym różni się RAM od pamięci masowej?');
await lap.wpisz('#cB', 'RAM jest szybki i ulotny, pamięć masowa trzyma dane po wyłączeniu prądu.');
await lap.click(`.znpick .ik[data-i=${JSON.stringify(IK2)}]`, 350);
await lap.click('[data-act="cardSave"]', 1200);
await sleep(2800);
const serwer2 = await lap.js(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,ik:s.dane.cards.find(c=>/RAM/.test(c.front))?.ikona||'brak'}))`);
check('laptop zapisał drugą fiszkę na serwerze', serwer2.ik === IK2, JSON.stringify(serwer2));
const revPrzed = await tel.ev(`rev`);
console.log('CZEKAM 48 s na automatyczne odświeżanie na telefonie…');
await sleep(48000);
const naTelefonie = await tel.js(`JSON.stringify((()=>{const c=S.cards.find(x=>/RAM/.test(x.front));
  return{rev:rev,przed:${revPrzed},ikona:c?c.ikona||'':'BRAK KARTY'}})())`);
check('telefon sam zobaczył fiszkę z laptopa', naTelefonie.ikona === IK2 && naTelefonie.rev > revPrzed, JSON.stringify(naTelefonie));
await tel.ev(`go('today')`); await sleep(700);
await tel.shot('zywo-4-telefon-po-sync');

/* ── 4 · Kilkanaście sesji: dziesięć „dni” nauki symulowanych zegarem ─ */
const OCENY = [5, 4, 4, 3, 5, 4];
const sesje = await lap.js(`(async()=>{
  const prawda=Date.now, dni=[];
  for(let d=10;d>=1;d--){
    let ts=prawda()-d*864e5+9*36e5;
    Date.now=()=>ts;
    let n=0;
    for(let runda=0;runda<6;runda++){
      const q=queueFor(ts).list;
      if(!q.length)break;
      startSession(false);
      for(let i=0;i<q.length;i++){
        if(!session||session.i>=session.ids.length)break;
        reveal();
        grade(${JSON.stringify(OCENY)}[(i+runda)%6]);
        n++;
      }
      session=null;
      ts+=3*36e5;
    }
    dni.push(n);
  }
  Date.now=prawda;
  save();render();
  return JSON.stringify({dni,dzienDzis:dayIdx(Date.now()),logi:S.log.length,review:S.cards.filter(c=>c.status==='review').length,
    nowe:S.cards.filter(c=>c.status==='new').length,wKolejce:queueFor().list.length})})()`);
console.log('SESJE', JSON.stringify(sesje));
check('dziesięć dni sesji dało ponad 80 ocen', sesje.logi >= 80, JSON.stringify({logi: sesje.logi, dni: sesje.dni}));
check('SM-2 wyznaczył terminy i wyzerował kolejkę na „dziś”', sesje.review >= 15 && sesje.nowe <= 8, JSON.stringify({review: sesje.review, nowe: sesje.nowe}));
await sleep(2600);
const serwer3 = await lap.js(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,logi:s.dane.log.length}))`);
check('wyniki sesji poszły na serwer', serwer3.logi >= 80, JSON.stringify(serwer3));

/* ── 5 · Postęp po sesjach ────────────────────────────────────────── */
await lap.ev(`S.settings.motyw='jasny';save();applyTheme();go('today')`); await sleep(800);
await lap.shot('zywo-5-laptop-dzis-po-sesjach');
await lap.ev(`go('progress')`); await sleep(900);
await lap.shot('zywo-6-laptop-postep-jasny');
const postep = await lap.js(`JSON.stringify({kpi:[...document.querySelectorAll('.kpis .kpi')].map(k=>k.textContent.replace(/\\s+/g,' ')),
  slupki:document.querySelectorAll('.chart .col').length,heat:document.querySelectorAll('.heat16 i').length,
  aktywne:document.querySelectorAll('.heat16 i.l1,.heat16 i.l2,.heat16 i.l3').length,
  dz:document.querySelectorAll('.dz .w').length,prognoza:forecast().days.slice(0,7).join('/'),passa:streak()})`);
console.log('POSTEP', JSON.stringify(postep));
check('postęp: heatmapa pokazuje kilka dni z nauką', postep.aktywne >= 5, String(postep.aktywne));
check('postęp: dziennik i prognoza są wypełnione', postep.dz >= 10 && postep.prognoza.split('/').some(n => +n > 0), postep.dz + ' wierszy, prognoza ' + postep.prognoza);
await lap.ev(`S.settings.motyw='ciemny';save();applyTheme();render()`); await sleep(700);
await lap.shot('zywo-7-laptop-postep-ciemny');
await tel.ev(`S.settings.motyw='jasny';save();applyTheme();go('progress')`); await sleep(900);
await tel.shot('zywo-8-telefon-postep');
const karta = await tel.js(`(async()=>{const k=S.cards.find(c=>c.ikona);k.due=Date.now()-6e4;
  startSession(false);
  for(let i=0;i<40;i++){const c=session&&findCard(session.ids[session.i]);if(!c||c.id===k.id)break;reveal();grade(5)}
  const el=document.querySelector('.face.front .kapy .iko');
  return JSON.stringify({ikona:k.ikona,el:el?el.textContent.trim():'',
    rozmiar:el?Math.round(parseFloat(getComputedStyle(el).fontSize)):0})})()`);
check('karta w nauce pokazuje emotikonę dużą czcionką', karta.el === karta.ikona && karta.rozmiar >= 20, JSON.stringify(karta));
await tel.shot('zywo-9-telefon-nauka-z-emotikona');

/* ── 6 · Porządek i błędy ─────────────────────────────────────────── */
await tel.ev(`document.getElementById('syncChip').click()`); await sleep(700);
await tel.click('[data-act="kontoUsun"]', 900);
await tel.wpisz('#rmPass', HASLO);
await tel.click('[data-act="kontoUsunTak"]', 2200);
const poUsunieciu = await (await fetch('http://127.0.0.1:8765/api/health')).json();
check('konto testowe skasowane, baza testowa znowu pusta', poUsunieciu.konta === 0, JSON.stringify(poUsunieciu));
check('zero wyjątków na telefonie', tel.logi.length === 0, tel.logi.slice(0, 3).join(' | '));
check('zero wyjątków na laptopie', lap.logi.length === 0, lap.logi.slice(0, 3).join(' | '));
await tel.stop(); await lap.stop();
console.log(FAIL.length ? '\n=== ' + FAIL.length + ' NIEZADOWALAJACYCH ===\n' + FAIL.join('\n') : '\n=== TEST NA ZYWO: WSZYSTKO ZIELONO ===');
process.exit(FAIL.length ? 1 : 0);

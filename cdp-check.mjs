// CDP walkthrough: konto+serwer, telefon 390/320, układ webowy, oba motywy, pełny flow,
// edycja/usuwanie fiszek, bloki statystyk, konflikt 409 i scalanie, audyt kontrastu AA, błędy konsoli.
// Wymaga działającego `node serwer.mjs` (domyślnie 127.0.0.1:8765, własny port przez PORT=...).
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SERWER = 'http://127.0.0.1:' + (process.env.PORT || 8765);
const URL = SERWER + '/t-fiszki.html';
const OUT = 'D:\\Moje programowanie\\T-Fiszki\\shots';
const STEMP = Date.now().toString(36).slice(-5);
const ANIA = 'Test Ania ' + STEMP, HASLO = 'test-haslo-123', BART = 'Test Bart ' + STEMP;
mkdirSync(OUT, {recursive: true});
const profil = process.env.TEMP + '\\tfiszki-cdp-' + STEMP;
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  '--user-data-dir=' + profil, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function targets() { for (let i = 0; i < 40; i++) { try { return await (await fetch('http://127.0.0.1:9333/json')).json(); } catch { await sleep(250); } } throw new Error('brak CDP'); }
const list = await targets();
const ws = new WebSocket((list.find(t => t.type === 'page') || list[0]).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    logs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});

const ev = async expr => {
  const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (r.result?.exceptionDetails) logs.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || 'błąd'));
  return r.result?.result?.value;
};
const json = async expr => JSON.parse(await ev(expr));
const shot = async n => { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
const click = async (sel, wait = 650) => { const ok = await ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return 'BRAK: ${sel}';e.click();return 'ok'})()`); if (ok !== 'ok') logs.push(ok); await sleep(wait); };
const wpisz = (sel, wart) => ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return 'BRAK: ${sel}';e.value=${JSON.stringify(wart)};e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`);
const key = async (code, k) => {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: k.length === 1 ? k : undefined});
  await sleep(500);
};
// „drugie urządzenie”: zapis przez ten sam transport, z numerem rev, który serwer aktualnie ma
const laptopZapisz = daneJson => ev(`(async()=>{const r=await fetch('/api/state',{method:'PUT',credentials:'same-origin',
  headers:{'content-type':'application/json'},body:JSON.stringify({dane:${daneJson},rev:rev})});return r.status})()`);

// audyt WCAG: kontrast tekstu do realnego tła (szklane warstwy łączone z rodzicami)
const AUDIT = `(()=>{
const px=s=>{const m=s.match(/[\\d.]+/g);return m?[+m[0],+m[1],+m[2],m.length>3?+m[3]:1]:null};
const over=(f,b)=>{const a=f[3];return [f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1]};
const bgOf=el=>{let out=[240,236,244,1];const chain=[];let n=el;
  while(n){const cs=getComputedStyle(n);const b=px(cs.backgroundColor);
    if(cs.backgroundImage.indexOf('gradient')>=0&&(!b||b[3]<.99))return null;   // tła nieprzezroczystego nie da się policzyć — sprawdzamy na zrzucie
    if(b&&b[3]>0)chain.push(b);n=n.parentElement}
  for(let i=chain.length-1;i>=0;i--)out=over(chain[i],out);return out};
const L=c=>{const v=c.slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});
  return .2126*v[0]+.7152*v[1]+.0722*v[2]};
const CR=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const out=[];let zbadane=0,pominiety=0;
const els=[...document.querySelectorAll('#viewport *, .appbar *, .tabbar *, .sheet *')];
for(const el of els){
  if(!el.getClientRects().length)continue;
  const t=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');
  if(!t)continue;
  const cs=getComputedStyle(el);
  if(cs.visibility==='hidden'||+cs.opacity<.6)continue;
  const fg=px(cs.color),bg=bgOf(el);
  if(!fg||!bg){pominiety++;continue}
  zbadane++;
  const r=CR(fg,bg),fs=parseFloat(cs.fontSize),bold=+cs.fontWeight>=700;
  const need=(fs>=24||(fs>=19&&bold))?3:4.5;
  if(r<need)out.push({tekst:t.slice(0,24),px:+fs.toFixed(1),k:+r.toFixed(2),wymagane:need,element:(typeof el.className==='string'?el.className:el.tagName).slice(0,22)});
}
out.sort((a,b)=>a.k-b.k);
return JSON.stringify({zbadane,pominiety,zlych:out.length,najgorsze:out.slice(0,7)})})()`;

// przepełnienie poziome w oknie o zadanej szerokości
const przeleczenie = wide => `(()=>{const bad=[];document.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();
  if(r.right>${wide}+1||r.left<-1)bad.push(el.tagName+'.'+String(el.className).slice(0,20)+'→'+Math.round(r.right))});
  return JSON.stringify({scrollW:document.scrollingElement.scrollWidth,inner:innerWidth,bad:[...new Set(bad)].slice(0,6)})})()`;

const FAIL = [];
function check(nazwa, ok, opis) { console.log((ok ? 'PASS ' : 'FAIL ') + nazwa + (opis ? '  ' + opis : '')); if (!ok) FAIL.push(nazwa + (opis ? ' — ' + opis : '')); }
const start = await (await fetch(URL)).status;
const zdrowie0 = await (await fetch(SERWER + '/api/health')).json();
console.log('SERWER', JSON.stringify({start, kontaPrzed: zdrowie0.konta}));

/* ══ 0 · Ekran konta ═══════════════════════════════════════════════ */
await send('Page.navigate', {url: URL}); await sleep(1500);
const login = await json(`JSON.stringify({kontoWidok:document.documentElement.classList.contains('konto-widok'),
  name:!!document.getElementById('lName'),pass:document.getElementById('lPass')?.type,
  tabbar:getComputedStyle(document.querySelector('.tabbar')).display,
  chip:document.getElementById('syncChip').textContent.trim(),
  tryby:[...document.querySelectorAll('[data-act="loginTryb"]')].map(b=>b.textContent),
  dropne:document.querySelector('.konto .drobne').textContent.slice(0,46)})`);
console.log('KONTO', JSON.stringify(login));
check('ekran konta zamiast aplikacji', login.kontoWidok && login.name && login.pass === 'password', JSON.stringify(login));
check('nawigacja ukryta na ekranie konta', login.tabbar === 'none', login.tabbar);
check('chip mówi o braku konta', /Nie zalogowano/.test(login.chip), login.chip);
await shot('k0-ekran-konta-ciemny');

await click('[data-act="loginOko"]');
check('oko pokazuje hasło', (await ev(`document.getElementById('lPass').type`)) === 'text');
await click('[data-act="loginOko"]');
check('oko znowu ukrywa hasło', (await ev(`document.getElementById('lPass').type`)) === 'password');

await wpisz('#lName', ANIA); await wpisz('#lPass', '123');
await click('[data-act="loginGo"]', 400);
const bladHasla = await ev(`document.getElementById('lErr').textContent`);
check('krótkie hasło odrzucone', /co najmniej 8/.test(bladHasla), bladHasla);
check('bez konta aplikacja niedostępna', await ev(`document.documentElement.classList.contains('konto-widok')`) === true);
await wpisz('#lName', 'A'); await wpisz('#lPass', HASLO);
await click('[data-act="loginGo"]', 400);
const bladNazwy = await ev(`document.getElementById('lErr').textContent`);
check('za krótka nazwa odrzucona', /Podaj imię/.test(bladNazwy), bladNazwy);

await ev(`document.querySelectorAll('[data-act="loginTryb"]')[1].click()`); await sleep(350);
check('przełączenie na rejestrację', /Załóż konto/.test(await ev(`document.querySelector('[data-act="loginGo"]').textContent`)));
await wpisz('#lName', ANIA); await wpisz('#lPass', HASLO);
await ev(`document.getElementById('lPass').focus()`);
await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
await sleep(2300);
let po = await json(`JSON.stringify({kontoWidok:document.documentElement.classList.contains('konto-widok'),konto:konto,rev:rev,
  karty:S.cards.length,nfAcct:document.getElementById('nfAcct').textContent,tytul:document.getElementById('barTitle').textContent})`);
check('Enter w polu hasła rejestruje i loguje', !po.kontoWidok && po.konto === ANIA && po.karty > 0, JSON.stringify(po));
await sleep(3200);                                     // pierwszy zapis na serwer (debounce 1,4 s)
po = await json(`JSON.stringify({rev:rev,karty:S.cards.length})`);
const stanSerwera = await json(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,karty:s.dane?s.dane.cards.length:0,nazwa:s.nazwa}))`);
check('nowe konto ma własny stan na serwerze', stanSerwera.karty === po.karty && stanSerwera.rev > 0 && stanSerwera.nazwa === ANIA, JSON.stringify({po, stanSerwera}));
const chipPo = (await ev(`document.getElementById('syncChip').textContent`)).trim();
check('chip pokazuje zapis po synchronizacji', /Zapisano|Zapisuję/.test(chipPo), chipPo);
await ev(`S.settings.motyw='ciemny';S.settings.wyglad='auto';save();applyTheme();applyLayout()`); await sleep(1900);
await send('Page.reload', {ignoreCache: true}); await sleep(2200);
const poReload = await json(`JSON.stringify({widok:document.documentElement.classList.contains('konto-widok'),konto:konto,rev:rev,ile:S.cards.length,
  motyw:S.settings.motyw,atr:document.documentElement.getAttribute('data-motyw'),info:document.getElementById('railInfo').textContent})`);
check('odświeżenie strony nie wylogowuje (ciasteczko sesji)', poReload.widok === false && poReload.konto === ANIA && poReload.ile > 0, JSON.stringify(poReload));
check('motyw przeżywa przeładowanie', poReload.motyw === 'ciemny' && poReload.atr === 'ciemny', JSON.stringify({m: poReload.motyw, a: poReload.atr}));
check('panel boczny mówi, czyje są dane', /konto/.test(poReload.info), poReload.info);

/* ══ 1 · Telefon 390 · pełny flow (ciemny) ═════════════════════════ */
const of = await json(przeleczenie(390));
console.log('OVERFLOW', JSON.stringify(of));
check('brak przepełnienia przy 390 px', of.scrollW <= of.inner + 1 && of.bad.length === 0, JSON.stringify(of));
console.log('MOTYW-START', await ev(`JSON.stringify({atr:document.documentElement.getAttribute('data-motyw'),web:document.documentElement.classList.contains('web'),
  themeColor:document.getElementById('mTC').content})`));
let aud = await json(AUDIT); console.log('AUDYT CIEMNY 390', JSON.stringify(aud));
check('kontrast AA 390 ciemny', aud.zlych === 0, JSON.stringify(aud.najgorsze));

await shot('m1-dzis');
await click('button[data-act="start"]');
await shot('m2-przod');
await key('Space', ' ');
await shot('m3-tyl');
console.log('GRADES', await ev(`JSON.stringify([...document.querySelectorAll('.grade')].map(g=>g.textContent))`));
await key('Digit4', '4');
await shot('m4-po-ocenie');
await key('KeyZ', 'z');
await shot('m5-cofniete');
const st1 = await json(`JSON.stringify({done:session.done,i:session.i,card:cur().front.slice(0,28)})`);
console.log('PO COFNIECIU', JSON.stringify(st1));
check('Cofnij w sesji przywraca kartę', st1.done === 0 && st1.i === 0, JSON.stringify(st1));

await ev(`document.querySelectorAll('.tab')[2].click()`); await sleep(500);
await shot('m6-talie');
await click('[data-act="opendeck"]');
await shot('m7-talia-wnetrze');
await click('[data-act="alldecks"]');
await ev(`document.querySelectorAll('[data-act="opendeck"]')[3].click()`); await sleep(500);
await shot('m8-talia-pusta');
await click('[data-act="import"]', 400);
await shot('m9-import-krok1');
await click('[data-act="impTest"]', 1900);
await shot('m10-import-krok3');
await click('[data-act="impAll"]');
await ev(`document.querySelectorAll('[data-act="impSel"][data-i="0"]')[0].click()`); await sleep(200);
console.log('PRZCISK', await ev(`document.querySelector('#impGo').textContent`));
await click('[data-act="impMake"]');
await shot('m11-import-gotowe');
await click('[data-act="impGo2"]');
await shot('m12-nauka-nowych');
await ev(`document.querySelectorAll('.tab')[3].click()`); await sleep(500);
await shot('m13-postep');
await click('details.acc summary');
await shot('m14-sm2');
await ev(`document.getElementById('menuBtn').click()`); await sleep(500);
await shot('m15-menu');
await ev(`(()=>{const c=document.getElementById('mErr');c.checked=true;c.onchange({target:c})})()`); await sleep(400);
await click('[data-act="close"]', 400);
await click('[data-act="import"]', 400);
await click('[data-act="impTest"]', 1900);
await shot('m16-blad-synchronizacji');
await click('[data-act="impFix"]', 1900);
await shot('m17-po-naprawie');
await ev(`document.getElementById('sheetClose').click()`); await sleep(450);   // krok 3 nie ma własnego przycisku Zamknij
const st2 = await json(`JSON.stringify({cards:S.cards.length,due:queueFor().list.length,mistrz:S.cards.filter(c=>bucket(c)==='mistrz').length,
  najw:S.cards.map(c=>c.interval).sort((a,b)=>b-a)[0], jutro:queueFor(Date.now()+864e5).reviews.length})`);
console.log('STAN', JSON.stringify(st2));
check('import + oceny realnie ruszyły plan SM-2', st2.cards > po.karty && st2.najw >= 1 && st2.jutro > 0, JSON.stringify(st2));

/* ══ 2 · Edycja i usuwanie fiszki ══════════════════════════════════ */
await ev(`document.querySelectorAll('.tab')[2].click()`); await sleep(400);
await ev(`document.querySelector('[data-act="alldecks"]').click()`); await sleep(400);
await ev(`document.querySelectorAll('[data-act="opendeck"]')[0].click()`); await sleep(600);
const przedEdycja = await json(`JSON.stringify((()=>{const c=S.cards.find(x=>x.status!=='new')||S.cards[0];
  return{id:c.id,front:c.front,ef:c.ef,reps:c.reps,due:c.due,interval:c.interval,status:c.status,up:c.up||0}})())`);
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
const wFormularzu = await ev(`document.getElementById('cF')?.value`);
check('formularz edycji otwiera się z treścią karty', wFormularzu === przedEdycja.front, JSON.stringify({oczekiwane: przedEdycja.front, wFormularzu}));
await wpisz('#cF', 'Pytanie po edycji z testu CDP');
await wpisz('#cN', 'notatka z testu');
await click('[data-act="cardSave"]', 800);
const poEdycji = await json(`JSON.stringify((()=>{const c=findCard(${JSON.stringify(przedEdycja.id)});
  return{front:c.front,note:c.note,ef:c.ef,reps:c.reps,due:c.due,interval:c.interval,status:c.status,up:c.up}})())`);
check('treść zapisana, plan powtórki nietknięty', poEdycji.front === 'Pytanie po edycji z testu CDP' && poEdycji.note === 'notatka z testu'
  && poEdycji.ef === przedEdycja.ef && poEdycji.reps === przedEdycja.reps && poEdycji.due === przedEdycja.due
  && poEdycji.interval === przedEdycja.interval && poEdycji.status === przedEdycja.status && poEdycji.up > przedEdycja.up,
  JSON.stringify({przedEdycja, poEdycji}));
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
await wpisz('#cF', 'tylko pytanie');
await wpisz('#cB', '');
await ev(`document.querySelector('[data-act="cardSave"]').click()`); await sleep(400);
const bladForm = await ev(`document.getElementById('cErr')?.textContent||''`);
check('walidacja: żąda obu stron karty', /Wypełnij obie strony/.test(bladForm), bladForm);
check('nieudany zapis nie ruszył karty', await ev(`findCard(${JSON.stringify(przedEdycja.id)}).front`) === 'Pytanie po edycji z testu CDP');
await wpisz('#cB', 'poprawiona odpowiedź');
await click('[data-act="cardSave"]', 800);
check('poprawiony zapis przechodzi walidację', await ev(`findCard(${JSON.stringify(przedEdycja.id)}).front`) === 'tylko pytanie');
await ev(`document.getElementById('sheetClose')?.click()`); await sleep(450);
await shot('e1-talia-z-akcjami');

const przedUsunieciem = await json(`JSON.stringify((()=>{const c=S.cards[S.cards.length-1];return{ile:S.cards.length,id:c.id,front:c.front}})())`);
await click(`[data-act="delcard"][data-id="${przedUsunieciem.id}"]`, 800);
const wPotwierdzeniu = await ev(`document.querySelector('.sheet .panel .q')?.textContent`);
check('potwierdzenie usunięcia pokazuje tę fiszkę', wPotwierdzeniu === przedUsunieciem.front, JSON.stringify({oczekiwane: przedUsunieciem.front, wPotwierdzeniu}));
await shot('e2-potwierdz-usuniecie');
const duePrzed = await json(`queueFor().list.length`);
await click('[data-act="cardDelTak"]', 800);
const poUsunieciu = await json(`JSON.stringify({ile:S.cards.length,groby:S.usuniete.length,ma:findCard(${JSON.stringify(przedUsunieciem.id)})===null,due:queueFor().list.length})`);
check('fiszka usunięta i zapisana jako „grób”', poUsunieciu.ile === przedUsunieciem.ile - 1 && poUsunieciu.ma && poUsunieciu.groby === 1 && poUsunieciu.due <= duePrzed, JSON.stringify({poUsunieciu, duePrzed}));
await shot('e3-po-usunieciu-z-cofnij');
const toastLab = await ev(`document.querySelector('.toast .akcja')?.textContent`);
check('toast oferuje Cofnij', toastLab === 'Cofnij', String(toastLab));
await click('.toast .akcja', 800);
const poCofnieciu = await json(`JSON.stringify({ile:S.cards.length,groby:S.usuniete.length,ma:!!findCard(${JSON.stringify(przedUsunieciem.id)})})`);
check('Cofnij przywraca fiszkę i kasuje grób', poCofnieciu.ile === przedUsunieciem.ile && poCofnieciu.groby === 0 && poCofnieciu.ma, JSON.stringify(poCofnieciu));

await ev(`document.querySelectorAll('[data-act="alldecks"]')[0]?.click()`); await sleep(400);
await ev(`document.querySelectorAll('[data-act="opendeck"]')[3].click()`); await sleep(600);
const ileWTalii = await json(`JSON.stringify({wTalii:S.cards.filter(c=>c.deck===deckOpen).length})`);
await click('[data-act="addcard"]', 600);
await wpisz('#cF', 'Fiszka dopisana w teście CDP');
await wpisz('#cB', 'odpowiedź testowa');
await click('[data-act="cardSave"]', 900);
const nowa = await json(`JSON.stringify((()=>{const c=S.cards[S.cards.length-1];return{front:c.front,status:c.status,wTalii:S.cards.filter(x=>x.deck===c.deck).length}})())`);
check('nowa fiszka dopisana do wybranej talii', nowa.front === 'Fiszka dopisana w teście CDP' && nowa.status === 'new' && nowa.wTalii === ileWTalii.wTalii + 1, JSON.stringify({ileWTalii, nowa}));
await shot('e4-dodana-fiszka');

/* ══ 2b · Kolory: talia, stan wiedzy, własny znacznik ══════════════ */
await ev(`document.querySelector('[data-act="alldecks"]').click()`); await sleep(400);
await ev(`document.querySelectorAll('[data-act="opendeck"]')[0].click()`); await sleep(600);
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
await wpisz('#cZ', 'na egzamin');
await click('[data-act="znKolor"][data-c="#A3E635"]', 250);
check('wybrany kolor znacznika zostaje zaznaczony', await ev(`document.querySelectorAll('.znpick .znk.on').length===1&&document.querySelector('.znpick .znk.on').dataset.c==='#A3E635'`) === true);
await shot('k1-formularz-znacznik');
await click('[data-act="cardSave"]', 900);
const zn = await json(`JSON.stringify(findCard(${JSON.stringify(przedEdycja.id)}).zn||null)`);
check('znacznik zapisany na karcie', !!zn && zn.t === 'na egzamin' && zn.k === '#A3E635', JSON.stringify(zn));
const wListie = await json(`JSON.stringify((()=>{const id=${JSON.stringify(przedEdycja.id)};const r=[...document.querySelectorAll('.cardrow')].find(x=>x.querySelector('.zn'));
  const n=parseInt(deck(findCard(id).deck).color.slice(1),16);
  return{oczek:'rgb('+[(n>>16)&255,(n>>8)&255,n&255].join(', ')+')',pasek:r?getComputedStyle(r,'::before').backgroundColor:'',
    tekst:r?r.querySelector('.zn').textContent:'',tlo:r?getComputedStyle(r.querySelector('.zn')).backgroundColor:'',
    stan:r?r.querySelector('.kap').textContent:''}})())`);
check('lista fiszek: pasek w kolorze talii', wListie.pasek === wListie.oczek, JSON.stringify(wListie));
check('lista fiszek: pigułka znacznika w jego kolorze', wListie.tekst === 'na egzamin' && wListie.tlo === 'rgba(163, 230, 53, 0.133)', JSON.stringify(wListie));
check('pigułka stanu wiedzy na wierszu fiszki', ['NOWE', 'W NAUCE', 'POWTÓRKA', 'MISTRZOSTWO'].includes(wListie.stan.toUpperCase()), String(wListie.stan));
await shot('k2-lista-z-kolorami');
await ev(`findCard(${JSON.stringify(przedEdycja.id)}).due=Date.now()-1000;save();render()`); await sleep(400);
await ev(`session=null;startSession(false,'sec')`); await sleep(700);
const ktore = await ev(`session?session.ids.indexOf(${JSON.stringify(przedEdycja.id)}):-1`);
check('fiszka ze znacznikiem weszła do sesji swojej talii', ktore >= 0, String(ktore));
await ev(`session.i=${ktore};render()`); await sleep(500);
const naKarcie = await json(`JSON.stringify((()=>{const f=document.querySelector('.face.front');const n=parseInt(deck(cur().deck).color.slice(1),16);
  return{oczek:'rgb('+[(n>>16)&255,(n>>8)&255,n&255].join(', ')+')',pasek:getComputedStyle(f,'::before').backgroundColor,
    mycie:getComputedStyle(f).getPropertyValue('background-image').includes('color-mix')||getComputedStyle(f).getPropertyValue('background-image').includes('color('),
    zn:f.querySelector('.zn')?f.querySelector('.zn').textContent:'',stan:f.querySelector('.kap')?f.querySelector('.kap').textContent:''}})())`);
check('karta w nauce: pasek i nalot w kolorze talii', naKarcie.pasek === naKarcie.oczek && naKarcie.mycie === true, JSON.stringify(naKarcie));
check('karta w nauce: pigułki stanu i znacznika', naKarcie.zn === 'na egzamin' && naKarcie.stan.length > 0, JSON.stringify(naKarcie));
await shot('k3-karta-z-kolorami-ciemna');
aud = await json(AUDIT); check('kontrast AA 390 ciemny (kolorowe pigułki)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`S.settings.motyw='jasny';save();applyTheme();render()`); await sleep(600);
await shot('k4-karta-z-kolorami-jasna');
aud = await json(AUDIT); check('kontrast AA 390 jasny (znacznik na liście)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`S.settings.motyw='ciemny';save();applyTheme();session=null;deckOpen='sec';go('decks')`); await sleep(700);
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
await click('[data-act="znZero"]', 250);
check('„bez koloru” gasi wybór', await ev(`document.querySelectorAll('.znpick .znk.on').length===0`) === true);
await click('[data-act="znKolor"][data-c="#4F6BFF"]', 250);
await click('[data-act="cardSave"]', 900);
const znZmiana = await json(`JSON.stringify(findCard(${JSON.stringify(przedEdycja.id)}).zn||null)`);
check('znacznik można zmienić bez utraty tekstu', znZmiana && znZmiana.t === 'na egzamin' && znZmiana.k === '#4F6BFF', JSON.stringify(znZmiana));
await ev(`findCard(${JSON.stringify(przedEdycja.id)}).zn=null;save();render()`); await sleep(300);
check('znacznik można też całkowicie zdjąć', await ev(`findCard(${JSON.stringify(przedEdycja.id)}).zn===null&&document.querySelectorAll('.cardrow .zn').length===0`) === true);
await ev(`findCard(${JSON.stringify(przedEdycja.id)}).zn={t:'na egzamin',k:'#A3E635'};save();render()`); await sleep(400);

/* ══ 2c · Emotikona-skojarzenie ════════════════════════════════════ */
const IDK = JSON.stringify(przedEdycja.id);
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
const palette = await json(`JSON.stringify((()=>{const p=[...document.querySelectorAll('.znpick .ik')];
  return{liczba:p.length,wszystkieWidoczne:p.every(b=>b.getBoundingClientRect().width>20&&b.getBoundingClientRect().height>20),
    etykiety:p.every(b=>(b.getAttribute('aria-label')||'').startsWith('wybierz '))}})())`);
check('formularz ma paletę emotikon (≥20, wszystkie klikalne)', palette.liczba >= 20 && palette.wszystkieWidoczne === true && palette.etykiety === true, JSON.stringify(palette));
await ev(`document.querySelector('.znpick .ik[data-i="📚"]').click()`); await sleep(250);
check('kliknięcie palety wstawia emotikonę w pole', await ev(`document.getElementById('cI').value==='📚'`) === true);
check('wybrana emotikona zostaje podświetlona', await ev(`document.querySelectorAll('.znpick .ik.on').length===1&&document.querySelector('.znpick .ik.on').dataset.i==='📚'`) === true);
await shot('i1-formularz-z-emotikona');
await wpisz('#cI', 'skopiowane 🔥 z tekstu');
check('ręcznie wpisana emotikona nie zgasa w palecie, dopóki nie zapiszesz', await ev(`document.querySelectorAll('.znpick .ik.on').length===1`) === true);
await click('[data-act="cardSave"]', 900);
const ikonaZapisana = await json(`JSON.stringify(findCard(${IDK}).ikona||'')`);
check('emotikona zapisana razem z treścią', ikonaZapisana === '🔥', String(ikonaZapisana));
const ikonaWListie = await json(`JSON.stringify((()=>{const c=findCard(${IDK});
  const r=[...document.querySelectorAll('.cardrow')].find(x=>(x.querySelector('.q')||{}).textContent&&x.querySelector('.q').textContent.includes(c.front.slice(0,14)));
  return{ileEmotikon:document.querySelectorAll('.cardrow .q .iko').length,wSwoimWierszu:r&&r.querySelector('.iko')?r.querySelector('.iko').textContent:'',
    rozmiar:r&&r.querySelector('.iko')?getComputedStyle(r.querySelector('.iko')).fontSize:''}})())`);
check('lista fiszek pokazuje emotikonę przy pytaniu', ikonaWListie.wSwoimWierszu === '🔥' && ikonaWListie.ileEmotikon >= 2, JSON.stringify(ikonaWListie));
await ev(`findCard(${IDK}).due=Date.now()-1000;save();render()`); await sleep(400);
await ev(`session=null;startSession(false,'sec')`); await sleep(700);
const ktoreIk = await ev(`session?session.ids.indexOf(${IDK}):-1`);
await ev(`session.i=${ktoreIk};render()`); await sleep(500);
const naKarcieIk = await json(`JSON.stringify((()=>{const f=document.querySelector('.face.front'),b=document.querySelector('.face.back');
  return{naPrzodzie:f.querySelector('.iko')?f.querySelector('.iko').textContent:'',naTyle:b.querySelector('.iko')?b.querySelector('.iko').textContent:'',
    rozmiar:f.querySelector('.iko')?getComputedStyle(f.querySelector('.iko')).fontSize:'',
    obok:f.querySelector('.kap')?f.querySelector('.kap').textContent:'',zn:f.querySelector('.zn')?f.querySelector('.zn').textContent:''}})())`);
check('karta w nauce: emotikona na przodzie i na tyle', naKarcieIk.naPrzodzie === '🔥' && naKarcieIk.naTyle === '🔥', JSON.stringify(naKarcieIk));
const rozmiarIk = parseFloat(naKarcieIk.rozmiar);
check('emotikona jest większa od pigułek — widoczna jako znak', rozmiarIk >= 20 && naKarcieIk.zn === 'na egzamin', JSON.stringify({rozmiarIk, ...naKarcieIk}));
await shot('i2-karta-z-emotikona');
await ev(`document.querySelector('[data-act="reveal"]').click()`); await sleep(500);
check('po odsłonięciu emotikona zostaje przy odpowiedzi', await ev(`document.querySelector('.face.back .iko').textContent==='🔥'`) === true);
await shot('i3-odpowiedz-z-emotikona');
aud = await json(AUDIT); check('kontrast AA 390 ciemny (emotikona na karcie)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`S.settings.motyw='jasny';save();applyTheme();render()`); await sleep(600);
aud = await json(AUDIT); check('kontrast AA 390 jasny (emotikona na karcie)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await shot('i4-karta-z-emotikona-jasna');
await ev(`document.querySelectorAll('.tab')[3].click()`); await sleep(900);
const dziennikIk = await json(`JSON.stringify({wiersze:document.querySelectorAll('.dz .w').length,ikony:document.querySelectorAll('.dz .w .iko').length})`);
check('dziennik i „najtrudniejsze” też niosą emotikony', dziennikIk.wiersze > 0 && dziennikIk.ikony >= 1, JSON.stringify(dziennikIk));
await shot('i5-statystyki-z-emotikonami');
await ev(`session=null;go('today')`); await sleep(500);
const filtr = await json(`JSON.stringify([safeIkona('<b>x</b>'),safeIkona('sam tekst'),safeIkona('abc🔥def'),safeIkona('tablica 🗂️ i koszyk'),safeIkona(''),safeIkona('🔥'.repeat(9))])`);
check('emotikona z importu i z pola jest filtrowana', filtr[0] === '' && filtr[1] === '' && filtr[2] === '🔥' && filtr[3] === '🗂️' && filtr[4] === '' && filtr[5].length <= 8, JSON.stringify(filtr));
const zSeedu = await json(`JSON.stringify({ile:S.cards.filter(c=>c.ikona).length,keylogger:CARDS[1].ikona,haszy:CARDS[CARDS.length-2].ikona})`);
check('fiszki pokazowe startują z emotikonami', zSeedu.ile >= 15 && zSeedu.keylogger === '🕵️' && zSeedu.haszy === '🗂️', JSON.stringify(zSeedu));
await ev(`session=null;S.settings.motyw='ciemny';save();applyTheme();deckOpen='sec';go('decks')`); await sleep(700);
await click(`[data-act="editcard"][data-id="${przedEdycja.id}"]`, 600);
await click('[data-act="ikonaZero"]', 250);
check('„bez emotikony” czyści pole', await ev(`document.getElementById('cI').value===''&&document.querySelectorAll('.znpick .ik.on').length===0`) === true);
await click('[data-act="cardSave"]', 900);
const zdjęta = await json(`JSON.stringify((()=>{const c=findCard(${IDK});
  const r=[...document.querySelectorAll('.cardrow')].find(x=>(x.querySelector('.q')||{}).textContent&&x.querySelector('.q').textContent.includes(c.front.slice(0,14)));
  return{wDanych:c.ikona===undefined,wListie:!!(r&&r.querySelector('.iko')),ile:document.querySelectorAll('.cardrow .q .iko').length}})())`);
check('zdjęta emotikona znika z danych i ze swojego wiersza', zdjęta.wDanych === true && zdjęta.wListie === false, JSON.stringify(zdjęta));
await ev(`findCard(${IDK}).ikona='📚';save();render()`); await sleep(400);

/* ══ 3 · Statystyki ════════════════════════════════════════════════ */
await ev(`session=null;startSession(false)`); await sleep(600);
await click('[data-act="reveal"]', 400);
await click('[data-act="grade"][data-q="4"]', 800);
await ev(`document.querySelectorAll('.tab')[3].click()`); await sleep(800);
await shot('s1-postep-ciemny-390');
const bloki = await json(`JSON.stringify({kpi:document.querySelectorAll('.kpis .kpi').length,grid2:document.querySelectorAll('.grid2').length,
  heat:document.querySelectorAll('.heat16 i').length,heatKolor:document.querySelectorAll('.heat16 i.l1,.heat16 i.l2,.heat16 i.l3').length,
  mies:document.querySelectorAll('.mies span').length,dzis:document.querySelectorAll('.heat16 i.dzis').length,
  rzedy:document.querySelectorAll('.tabela .rz').length,sbary:document.querySelectorAll('.sbar').length,
  pasmy:document.querySelectorAll('.pasm').length,wezelce:document.querySelectorAll('.dz .w').length,
  dziennik:[...document.querySelectorAll('.panel')].some(p=>/Dziennik ocen/.test(p.textContent)),
  cofnij:document.querySelectorAll('[data-act="dzCofnij"]').length,teraz:document.querySelectorAll('[data-act="teraz"]').length,
  edytuj:document.querySelectorAll('.dz [data-act="editcard"]').length,
  naglowki:document.body.textContent.includes('Aktywność · 16 tygodni')&&document.body.textContent.includes('Postęp na talie')})`);
console.log('BLOKI STATYSTYK', JSON.stringify(bloki));
check('sześć wskaźników głównych', bloki.kpi === 6, String(bloki.kpi));
check('heatmapa 16 tygodni = 112 dni, dziś oznaczone', bloki.heat === 112 && bloki.dzis === 1 && bloki.mies >= 3, JSON.stringify({heat: bloki.heat, dzis: bloki.dzis, mies: bloki.mies}));
check('heatmapa pokazuje dni z nauką', bloki.heatKolor > 5, String(bloki.heatKolor));
check('postęp na talie: każdy wiersz ma pasek stanów', bloki.rzedy === bloki.sbary && bloki.rzedy >= 4, JSON.stringify({rzedy: bloki.rzedy, sbary: bloki.sbary}));
check('trudność: rozkład EF i najtrudniejsze z edycją', bloki.pasmy >= 2 && bloki.edytuj > 0 && bloki.teraz > 0, JSON.stringify({pasmy: bloki.pasmy, edytuj: bloki.edytuj, teraz: bloki.teraz}));
check('dziennik ocen z cofnięciem najnowszej oceny', bloki.dziennik && bloki.cofnij === 1, JSON.stringify({cofnij: bloki.cofnij, wezelce: bloki.wezelce}));
check('wszystkie cztery bloki statystyk na ekranie', bloki.naglowki && bloki.grid2 === 2, JSON.stringify({naglowki: bloki.naglowki, grid2: bloki.grid2}));
const przedCof = await json(`JSON.stringify((()=>{const l=S.log[S.log.length-1];return{logi:S.log.length,card:l.card,ef:l.p.ef,reps:l.p.reps,due:l.p.due,interval:l.p.interval}})())`);
await click('[data-act="dzCofnij"]', 800);
const poCof = await json(`JSON.stringify((()=>{const c=findCard(${JSON.stringify(przedCof.card)});return{logi:S.log.length,ef:c.ef,reps:c.reps,due:c.due,interval:c.interval}})())`);
check('cofnięcie z dziennika przywraca stan karty', poCof.logi === przedCof.logi - 1 && poCof.ef === przedCof.ef && poCof.reps === przedCof.reps && poCof.due === przedCof.due && poCof.interval === przedCof.interval, JSON.stringify({przedCof, poCof}));
const trudPrzed = await json(`JSON.stringify((()=>{const c=najtrudniejsze(1)[0];return c?{id:c.id}:{}})())`);
if (trudPrzed.id) {
  await click(`.dz [data-act="teraz"][data-id="${trudPrzed.id}"]`, 800);
  const poTeraz = await json(`JSON.stringify({due:findCard(${JSON.stringify(trudPrzed.id)}).due,wKolejce:queueFor().list.some(x=>x.id===${JSON.stringify(trudPrzed.id)})})`);
  check('„Powtórz dziś” wciąga kartę do dzisiejszej kolejki', poTeraz.due <= Date.now() && poTeraz.wKolejce, JSON.stringify({trudPrzed, poTeraz}));
} else console.log('TRUDNE — brak kart z wpadkami, pomijam „powtórz dziś”');
await ev(`go('today')`); await sleep(500);
const licznik = await json(`JSON.stringify({badge:!document.getElementById('badgeToday').hidden,due:queueFor().list.length})`);
check('licznik w nawigacji zgadza się z kolejką', licznik.badge === (licznik.due > 0), JSON.stringify(licznik));

/* ══ 4 · Konflikt 409 i scalanie (drugie urządzenie) ═══════════════ */
await ev(`clearTimeout(timerWysylki)`);
const cel = await json(`JSON.stringify((()=>{const c=S.cards.find(x=>x.status!=='new');return{id:c.id,front:c.front,ef:c.ef,reps:c.reps,due:c.due,ikona:c.ikona||'',logi:S.log.length}})())`);
console.log('SCALANIE · karta', JSON.stringify(cel));
// „laptop”: ten sam rekord, dalszy plan powtórki, ale starsza data edycji treści
const laptop1 = await json(`(()=>{const z=structuredClone(S);const k=z.cards.find(c=>c.id===${JSON.stringify(cel.id)});
  k.front='Treść nadpisana na laptopie';k.reps=${cel.reps}+3;k.ef=2.72;k.up=Date.now()-36e5;k.zn={t:'znacznik z laptopa',k:'#4F6BFF'};k.ikona='💡';
  z.log.push({ts:Date.now()-500,card:k.id,deck:k.deck,q:5,p:{ef:${cel.ef},reps:${cel.reps},interval:1,status:'review',due:${cel.due},lapses:0}});
  return JSON.stringify(z)})()`);
const kod1 = await laptopZapisz(JSON.stringify(laptop1));
await sleep(300);
// „telefon”: ta sama karta, treść teraz nowsza niż na serwerze
await ev(`(()=>{const k=findCard(${JSON.stringify(cel.id)});k.front='Treść z telefonu';k.up=Date.now();return 1})()`);
await ev(`wyslij(0)`); await sleep(1900);
const scal1 = await json(`JSON.stringify((()=>{const k=findCard(${JSON.stringify(cel.id)});
  return{front:k.front,ef:k.ef,reps:k.reps,zn:k.zn,ikona:k.ikona||'',logi:S.log.length,rev:rev,
  toast:[...document.querySelectorAll('.toast span')].map(s=>s.textContent).join('|')}})())`);
const serwerPo = await json(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,front:s.dane.cards.find(c=>c.id===${JSON.stringify(cel.id)}).front,logi:s.dane.log.length}))`);
console.log('SCALONE', JSON.stringify({kod1, scal1, serwerPo}));
check('konflikt 409 scalony: treść z telefonu, plan z laptopa', kod1 === 200 && scal1.toast.includes('Dane z drugiego urządzenia zostały połączone')
  && scal1.front === 'Treść z telefonu' && scal1.reps === cel.reps + 3 && Math.abs(scal1.ef - 2.72) < 1e-9, JSON.stringify({kod1, scal1, cel}));
check('znacznik jechał z treścią: starsza wersja z laptopa przegrała', scal1.zn && scal1.zn.t === 'na egzamin' && scal1.zn.k === '#A3E635', JSON.stringify(scal1.zn));
check('emotikona jechała z treścią: „💡” z laptopa nie nadpisała własnej', scal1.ikona === cel.ikona && scal1.ikona !== '💡', JSON.stringify({cel, scal1}));
check('scalony dziennik bez duplikatów', scal1.logi === cel.logi + 1, JSON.stringify({mamy: scal1.logi, oczekiwane: cel.logi + 1}));
check('serwer przyjął wynik scalenia', serwerPo.front === 'Treść z telefonu' && serwerPo.logi === cel.logi + 1 && serwerPo.rev === scal1.rev, JSON.stringify({serwerPo, rev: scal1.rev}));

// skasowana fiszka nie może wrócić z drugiego urządzenia
await ev(`clearTimeout(timerWysylki)`);
const skazony = await json(`JSON.stringify((()=>{const c=S.cards.find(x=>S.log.some(l=>l.card===x.id));return{id:c.id,obecnosc:S.log.filter(l=>l.card===c.id).length}})())`);
const kopiaSkazanego = await json(`JSON.stringify(findCard(${JSON.stringify(skazony.id)}))`);
await ev(`deleteCard(${JSON.stringify(skazony.id)})`); await sleep(500);
await ev(`clearTimeout(timerWysylki)`);
// „laptop” wciąż trzyma usuniętą fiszkę i nie zna grobów
const laptop2 = await json(`(()=>{const z=structuredClone(S);z.usuniete=[];z.cards.push(${JSON.stringify(kopiaSkazanego)});return JSON.stringify(z)})()`);
const kod2 = await laptopZapisz(JSON.stringify(laptop2));
await sleep(300);
await ev(`wyslij(0)`); await sleep(1900);
const groby = await json(`JSON.stringify({ma:findCard(${JSON.stringify(skazony.id)})!==null,groby:S.usuniete.filter(g=>g.id===${JSON.stringify(skazony.id)}).length,ile:S.cards.length,
  historia:S.log.filter(l=>l.card===${JSON.stringify(skazony.id)}).length})`);
check('skasowana fiszka nie zmartwychwstała po scaleniu', kod2 === 200 && !groby.ma && groby.groby === 1, JSON.stringify({kod2, groby}));
check('historia ocen usuniętej fiszki zostaje w dzienniku', groby.historia === skazony.obecnosc && groby.historia > 0, JSON.stringify({groby, skazony}));
await ev(`document.querySelectorAll('.tab')[3].click()`); await sleep(700);
const dziennikWidok = await json(`JSON.stringify({wiersze:document.querySelectorAll('.dz .w').length})`);
check('dziennik renderuje się po scaleniu', dziennikWidok.wiersze > 0, JSON.stringify(dziennikWidok));
await shot('s2-dziennik-po-scaleniu');

/* ══ 5 · Izolacja kont i usuwanie konta ════════════════════════════ */
await ev(`document.getElementById('syncChip').click()`); await sleep(600);
await shot('s3-konto-panel');
const panelKonta = await json(`JSON.stringify({naglowek:document.querySelector('.sheet .panel h3')?.textContent,pasm:[...document.querySelectorAll('.sheet .pasm .l')].length})`);
check('panel konta pokazuje nazwę i stan synchronizacji', panelKonta.naglowek === ANIA && panelKonta.pasm === 3, JSON.stringify(panelKonta));
await click('[data-act="wyloguj"]', 1000);
check('wylogowanie cofa do ekranu konta', await ev(`konto===null&&document.documentElement.classList.contains('konto-widok')`) === true);
await ev(`document.querySelectorAll('[data-act="loginTryb"]')[1].click()`); await sleep(400);
await wpisz('#lName', BART); await wpisz('#lPass', HASLO);
await click('[data-act="loginGo"]', 2600);
const bartIzolacja = await json(`ap('GET','/api/state').then(s=>JSON.stringify({rev:s.rev,nazwa:s.nazwa,konto:konto,
  daneInnejOsoby:s.dane.cards.some(c=>c.front==='Treść z telefonu'||c.front==='Fiszka dopisana w teście CDP'),
  groby:s.dane.usuniete.length}))`);check('drugie konto nie widzi danych pierwszego', bartIzolacja.nazwa === BART && bartIzolacja.konto === BART
  && bartIzolacja.daneInnejOsoby === false && bartIzolacja.groby === 0, JSON.stringify(bartIzolacja));
await ev(`document.getElementById('syncChip').click()`); await sleep(500);
await click('[data-act="kontoUsun"]', 700);
await wpisz('#rmPass', 'nie-to-haslo');
await ev(`document.querySelector('[data-act="kontoUsunTak"]').click()`); await sleep(1200);
const bladUsuniecia = await ev(`document.getElementById('rmErr')?.textContent||''`);
check('usunięcie konta żąda prawdziwego hasła', /nie zgadza/.test(bladUsuniecia), bladUsuniecia);
await shot('s4-usun-konto-potwierdzenie');
await wpisz('#rmPass', HASLO);
await ev(`document.querySelector('[data-act="kontoUsunTak"]').click()`); await sleep(1400);
const poUsunieciuKonta = await json(`JSON.stringify({konto:konto,chip:document.getElementById('syncChip').textContent.trim(),
  klucze:Object.keys(localStorage).filter(k=>/^tfiszki:dane/.test(k))})`);
check('konto razem z danymi znika z serwera i z urządzenia', poUsunieciuKonta.klucze.every(k=>!k.includes(BART.toLowerCase())) === true, JSON.stringify(poUsunieciuKonta));
await send('Page.navigate', {url: URL}); await sleep(1900);
const znowuLogin = await json(`JSON.stringify({widok:document.documentElement.classList.contains('konto-widok'),konto:konto})`);
check('po usunięciu konta aplikacja znowu prosi o logowanie', znowuLogin.widok === true && znowuLogin.konto === null, JSON.stringify(znowuLogin));
await wpisz('#lName', ANIA); await wpisz('#lPass', 'za-malo-albo-zle');
await click('[data-act="loginGo"]', 800);
const bladLogowania = await ev(`document.getElementById('lErr').textContent`);
check('złe hasło nie wpuszcza i mówi dlaczego', bladLogowania.length > 3 && /asło/.test(bladLogowania), bladLogowania);
await wpisz('#lPass', HASLO); await click('[data-act="loginGo"]', 3200);
const aniaPo = await json(`JSON.stringify({konto:konto,rev:rev,ile:S.cards.length,edytowana:findCard(${JSON.stringify(cel.id)})?.front,skazona:!!findCard(${JSON.stringify(skazony.id)}),groby:S.usuniete.length})`);
check('postęp wraca z serwera po zalogowaniu', aniaPo.konto === ANIA && aniaPo.edytowana === 'Treść z telefonu' && !aniaPo.skazona && aniaPo.rev > 0 && aniaPo.groby === 1, JSON.stringify(aniaPo));

/* ══ 6 · Tryb gościa (bez konta) ═══════════════════════════════════ */
await ev(`document.getElementById('syncChip').click()`); await sleep(500);
await click('[data-act="wyloguj"]', 1000);
await click('[data-act="loginGosc"]', 1000);
const gosc = await json(`JSON.stringify({widok:!document.documentElement.classList.contains('konto-widok'),chip:document.getElementById('syncChip').textContent.trim(),
  klucze:Object.keys(localStorage).filter(k=>/^tfiszki:dane/.test(k)),gosc:ustawienia().gosc,rev:rev,konto:konto})`);
check('tryb gościa działa bez konta', gosc.widok && /Nie zalogowano/.test(gosc.chip) && gosc.konto === null && gosc.gosc === true && gosc.klucze.some(k=>/lokalne$/.test(k)), JSON.stringify(gosc));
await click('[data-act="start"]', 700);
await click('[data-act="reveal"]', 400);
await click('[data-act="grade"][data-q="5"]', 900);
const goscBezSerwera = await json(`ap('GET','/api/state').then(()=>JSON.stringify({dane:1}),e=>JSON.stringify({kod:e.kod}))`);
check('praca gościa nie ma dostępu do serwera', goscBezSerwera.kod === 401, JSON.stringify(goscBezSerwera));
await shot('g1-tryb-goscia');
await ev(`session=null;go('today')`); await sleep(400);
await ev(`document.getElementById('syncChip').click()`); await sleep(500);
await click('[data-act="kontoLogin"]', 900);
check('z gościa można przejść do logowania', await ev(`document.documentElement.classList.contains('konto-widok')`) === true);
await ev(`document.querySelectorAll('[data-act="loginTryb"]')[0].click()`); await sleep(400);
await wpisz('#lName', ANIA); await wpisz('#lPass', HASLO);
await click('[data-act="loginGo"]', 3200);
const poGoscia = await json(`JSON.stringify({konto:konto,gosc:S.settings.gosc,ile:S.cards.length,edytowana:findCard(${JSON.stringify(cel.id)})?.front,skazona:!!findCard(${JSON.stringify(skazony.id)}),
  klucze:Object.keys(localStorage).filter(k=>/^tfiszki:dane/.test(k))})`);
check('powrót na konto przywraca dane z serwera', poGoscia.konto === ANIA && poGoscia.gosc === false && poGoscia.edytowana === 'Treść z telefonu' && !poGoscia.skazona, JSON.stringify(poGoscia));
check('dane gościa i dane konta trzymane osobno', poGoscia.klucze.length >= 2, JSON.stringify(poGoscia.klucze));

/* ══ 7 · Telefon w motywie jasnym ══════════════════════════════════ */
await ev(`S.settings.motyw='jasny';save();applyTheme();go('today')`); await sleep(700);
console.log('MOTYW-JASNY', await ev(`JSON.stringify({atr:document.documentElement.getAttribute('data-motyw'),
  tlo:getComputedStyle(document.body).backgroundColor, tekst:getComputedStyle(document.body).color,
  icone:JSON.stringify({sun:getComputedStyle(document.getElementById('icSun')).display,ksiezyc:getComputedStyle(document.getElementById('icMoon')).display}),
  tc:document.getElementById('mTC').content})`));
await shot('j1-dzis-jasny');
console.log('START-JASNY', await ev(`(()=>{startSession(false);return JSON.stringify({trasa:route,kart:session?session.ids.length:0,odsłonięta:session?session.revealed:null})})()`));
await sleep(500); await shot('j2-karta-jasny');
await key('Space', ' '); await shot('j3-karta-odpowiedz-jasny');
const gradesJasne = await json(`JSON.stringify({odslonieta:session.revealed,karty:[...document.querySelectorAll('.grade')].map(g=>g.textContent)})`);
console.log('GRADES-JASNE', JSON.stringify(gradesJasne));
check('jasny motyw: Spacja pokazuje odpowiedź i 4 oceny', gradesJasne.odslonieta === true && gradesJasne.karty.length === 4, JSON.stringify(gradesJasne));
check('jasny motyw: słońce w miejsce księżyca', await ev(`getComputedStyle(document.getElementById('icSun')).display!=='none'&&getComputedStyle(document.getElementById('icMoon')).display==='none'`) === true);
await ev(`session=null;deckOpen=null;go('decks')`); await sleep(500);
await click('[data-act="import"]', 500);
await shot('j4-import-jasny');
await click('[data-act="impTest"]', 1900); await shot('j5-import-lista-jasny');
await ev(`document.getElementById('sheetClose').click()`); await sleep(400);
await ev(`document.getElementById('menuBtn').click()`); await sleep(500);
await shot('j6-menu-jasny');
aud = await json(AUDIT); console.log('AUDYT JASNY 390', JSON.stringify(aud));
check('kontrast AA 390 jasny', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`document.getElementById('sheetClose').click();S.settings.motyw='auto';save();applyTheme()`); await sleep(400);

/* ══ 8 · Motyw auto podąża za systemem ═════════════════════════════ */
await ev(`S.settings.motyw='auto';save()`);
await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'light'}]});
await send('Page.navigate', {url: URL}); await sleep(1900);
const autoJ = await json(`JSON.stringify({swiatlo:mqLight.matches,atr:document.documentElement.getAttribute('data-motyw'),tlo:getComputedStyle(document.body).backgroundColor})`);
check('auto + system jasny → motyw jasny', autoJ.atr === 'jasny', JSON.stringify(autoJ));
await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});
await send('Page.navigate', {url: URL}); await sleep(1900);
const autoC = await json(`JSON.stringify({swiatlo:mqLight.matches,atr:document.documentElement.getAttribute('data-motyw'),tlo:getComputedStyle(document.body).backgroundColor})`);
check('auto + system ciemny → motyw ciemny', autoC.atr === 'ciemny', JSON.stringify(autoC));
await ev(`S.settings.motyw='ciemny';save();applyTheme()`); await sleep(300);

/* ══ 9 · Układ webowy 1280 ═════════════════════════════════════════ */
await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
await ev(`go('today')`); await sleep(900);
console.log('WEB-1280', await ev(`JSON.stringify({web:document.documentElement.classList.contains('web'),telefon:document.documentElement.classList.contains('telefon'),
  nawigacjaSzer:Math.round(document.querySelector('.tabbar').getBoundingClientRect().width),
  nawigacjaX:Math.round(document.querySelector('.tabbar').getBoundingClientRect().x),
  nawigacjaY:Math.round(document.querySelector('.tabbar').getBoundingClientRect().y),
  pozycje:[...document.querySelectorAll('.tab')].map(t=>Math.round(t.getBoundingClientRect().y)).join('/'),
  tytul:document.getElementById('barTitle').textContent,
  panelInfo:getComputedStyle(document.querySelector('.rail')).display!=='none',
  contentSzer:Math.round(document.querySelector('#viewport > *').getBoundingClientRect().width)})`));
await shot('w1-web-dzis-ciemny');
const dziWeb = await json(`JSON.stringify((()=>{const g=document.querySelector('.today-grid'),kids=[...g.children];
  const vb=document.querySelector('.viewport').getBoundingClientRect();
  return{kids:kids.map(k=>Math.round(k.getBoundingClientRect().width)).join('/'),ile:kids.length,
    szerokosc:Math.round(g.getBoundingClientRect().width),dostepne:Math.round(vb.width-64),
    slupki:document.querySelectorAll('.today-grid .chart .col').length,
    wiersze:document.querySelectorAll('.today-grid .dz .w').length,
    bloki:['Co dalej','Ostatnio oceniane','Z której talii','Import z testu'].filter(t=>document.body.textContent.includes(t)).length}})())`);
console.log('EKRAN-DZIS-1280', JSON.stringify(dziWeb));
const dzi = dziWeb;
check('„Dziś” układa się w dwie kolumny', dzi.ile === 2 && Math.abs(dzi.kids.split('/')[0] - dzi.kids.split('/')[1]) < 60, dzi.kids);
check('dwie kolumny wypełniają dostępną szerokość (bez pustego pasa)', dzi.szerokosc >= dzi.dostepne * 0.94, JSON.stringify({sz: dzi.szerokosc, dost: dzi.dostepne}));
check('na „Dziś” jest prognoza na 7 dni i cztery bloki', dzi.slupki === 7 && dzi.bloki === 4, JSON.stringify({slupki: dzi.slupki, bloki: dzi.bloki}));
await ev(`document.getElementById('menuBtn').click()`); await sleep(500);
console.log('WEB-MENU', await ev(`(()=>{const r=document.querySelector('.sheet').getBoundingClientRect();
  return JSON.stringify({szerokosc:Math.round(r.width),srodekX:Math.round(r.left+r.width/2),srodekY:Math.round(r.top+r.height/2),odGory:Math.round(r.top)})})()`));
await shot('w2-web-menu');
await ev(`document.getElementById('sheetClose').click()`); await sleep(400);
await ev(`startSession(false)`); await sleep(600); await shot('w3-web-nauka');
aud = await json(AUDIT); console.log('AUDYT CIEMNY 1280 NAUKA', JSON.stringify(aud));
check('kontrast AA 1280 ciemny (nauka)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
const sideBar = await json(`JSON.stringify({side:getComputedStyle(document.querySelector('.side')).display,dl:document.querySelectorAll('.side dl').length})`);
check('panel „Ta fiszka” widoczny w układzie web', sideBar.side !== 'none' && sideBar.dl >= 1, JSON.stringify(sideBar));
await ev(`document.querySelectorAll('.tab')[2].click()`); await sleep(600);
console.log('WEB-TALIE', await ev(`JSON.stringify({kolumny:new Set([...document.querySelectorAll('.list .item')].map(e=>Math.round(e.getBoundingClientRect().y))).size,
  licznik:document.querySelectorAll('.list .item').length})`));
await shot('w4-web-talie');
await ev(`S.settings.motyw='jasny';save();applyTheme();go('progress')`); await sleep(900);
await shot('w5-web-postep-jasny');
aud = await json(AUDIT); console.log('AUDYT JASNY 1280', JSON.stringify(aud));
check('kontrast AA 1280 jasny (postęp)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
const statWeb = await json(`JSON.stringify({slupki:document.querySelectorAll('.kpis .kpi').length,grid2:[...document.querySelectorAll('.grid2')].map(g=>Math.round(g.getBoundingClientRect().width)),
  heat:document.querySelectorAll('.heat16 i').length,kolumny:Math.round(document.querySelector('#viewport > *').getBoundingClientRect().width)})`);
check('statystyki w dwóch kolumnach na szerokim układzie', statWeb.grid2.every(w => w > 700) && statWeb.slupki === 6 && statWeb.heat === 112, JSON.stringify(statWeb));
await ev(`S.settings.motyw='ciemny';save();applyTheme()`); await sleep(400);

/* ══ 10 · Wymuszony podgląd na telefon + skróty klawiszowe ═════════ */
await ev(`S.settings.wyglad='telefon';save();applyLayout();go('today')`); await sleep(700);
console.log('TELEFON-1280', await ev(`JSON.stringify({telefon:document.documentElement.classList.contains('telefon'),web:document.documentElement.classList.contains('web'),
  ramka:getComputedStyle(document.querySelector('.phone')).borderRadius,
  panelInfo:getComputedStyle(document.querySelector('.rail')).display!=='none',
  szerokosc:Math.round(document.querySelector('.phone').getBoundingClientRect().width)})`));
await shot('w6-telefon-podglad-1280');
await ev(`S.settings.motyw='ciemny';S.settings.wyglad='telefon';save();applyTheme();applyLayout()`); await sleep(400);
const motywPrzed = await ev(`S.settings.motyw`);
await key('KeyL', 'l');
const motywPo = await json(`JSON.stringify({ustawienie:S.settings.motyw,atr:document.documentElement.getAttribute('data-motyw')})`);
check('klawisz L przełącza motyw', motywPo.ustawienie !== motywPrzed, JSON.stringify({motywPrzed, motywPo}));
const wygladPrzed = await ev(`S.settings.wyglad`);
const stanWidoku = `JSON.stringify({ustawienie:S.settings.wyglad,web:document.documentElement.classList.contains('web'),telefon:document.documentElement.classList.contains('telefon')})`;
await key('KeyW', 'w');
const wygladPo = await json(stanWidoku);
console.log('KLAWISZ-W', JSON.stringify({wygladPrzed, wygladPo}));
await key('KeyW', 'w');
const wygladPo2 = await json(stanWidoku);
console.log('KLAWISZ-W-2', JSON.stringify(wygladPo2));
await key('KeyW', 'w');
const wygladPo3 = await json(stanWidoku);
console.log('KLAWISZ-W-3', JSON.stringify(wygladPo3));
check('klawisz W na 1280 px: telefon ↔ komputer (auto)',
  wygladPrzed === 'telefon' && wygladPo.ustawienie === 'auto' && wygladPo.web === true && wygladPo.telefon === false
  && wygladPo2.ustawienie === 'telefon' && wygladPo2.web === false && wygladPo2.telefon === true
  && wygladPo3.ustawienie === 'auto' && wygladPo3.web === true,
  JSON.stringify({wygladPrzed, wygladPo, wygladPo2, wygladPo3}));
await ev(`S.settings.wyglad='auto';S.settings.motyw='ciemny';save();applyTheme();applyLayout()`); await sleep(400);

/* ══ 11 · Granica układu i szerokie ekrany ═════════════════════════ */
for (const w of [759, 760, 900, 1280, 1400, 1600, 2560]) {
  await send('Emulation.setDeviceMetricsOverride', {width: w, height: w === 2560 ? 1440 : 900, deviceScaleFactor: 1, mobile: false});
  await sleep(750);
  const x = await json(`JSON.stringify({web:document.documentElement.classList.contains('web'),scrollW:document.scrollingElement.scrollWidth,inner:innerWidth,
    panelInfo:getComputedStyle(document.querySelector('.rail')).display!=='none',
    szerokoscPanelu:Math.round(document.querySelector('.rail').getBoundingClientRect().width),
    contentSzer:Math.round(document.querySelector('#viewport > *').getBoundingClientRect().width),
    kolumna:Math.round(document.querySelector('.phone').getBoundingClientRect().width),
    nawigacja:Math.round(document.querySelector('.tabbar').getBoundingClientRect().width),
    bad:[...new Set([...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>el.tagName+'.'+String(el.className).slice(0,16)))].slice(0,4)})`);
  console.log('SZEROKOSC-' + w, JSON.stringify(x));
  check('bez przepełnienia na ' + w + ' px', x.scrollW <= x.inner + 1 && x.bad.length === 0, JSON.stringify(x));
  check('układ webowy od 760 px (' + w + ')', x.web === (w >= 760), JSON.stringify({web: x.web, kolumna: x.kolumna}));
  if (w >= 1400) check('panel informacyjny od 1400 px (' + w + ')', x.panelInfo === true && x.szerokoscPanelu > 300, JSON.stringify({panelInfo: x.panelInfo, szer: x.szerokoscPanelu}));
  if (w < 1400) check('panel informacyjny ukryty poniżej 1400 px (' + w + ')', x.panelInfo === false, String(x.panelInfo));
}
await send('Emulation.setDeviceMetricsOverride', {width: 2489, height: 1265, deviceScaleFactor: 1, mobile: false});
await ev(`go('progress')`); await sleep(1000);
const veryWide = await json(`JSON.stringify({content:Math.round(document.querySelector('#viewport > *').getBoundingClientRect().width),
  lewo:Math.round(document.querySelector('#viewport > *').getBoundingClientRect().left),
  heat:document.querySelectorAll('.heat16 i').length,slupki:document.querySelectorAll('.kpis .kpi').length,
  rail:Math.round(document.querySelector('.rail').getBoundingClientRect().left),
  kolizja:[...document.querySelectorAll('.panel,.grid2,.kpis')].some(e=>e.getBoundingClientRect().right>document.querySelector('.rail').getBoundingClientRect().left+1)})`);
console.log('2489 px', JSON.stringify(veryWide));
check('treść wykorzystuje ekran 2489 px', veryWide.content > 1000 && veryWide.content <= 1400, JSON.stringify(veryWide));
check('treść nie wchodzi pod panel boczny', veryWide.kolizja === false, JSON.stringify({rail: veryWide.rail, content: veryWide.content}));
await shot('z1-postep-2489');
await ev(`go('today')`); await sleep(800);
aud = await json(AUDIT); console.log('AUDYT CIEMNY 2489', JSON.stringify(aud));
check('kontrast AA 2489 ciemny', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await shot('z2-dzis-2489');
await ev(`S.settings.motyw='jasny';save();applyTheme();render()`); await sleep(900);
await shot('z3-dzis-2489-jasny');
aud = await json(AUDIT); console.log('AUDYT JASNY 2489', JSON.stringify(aud));
check('kontrast AA 2489 jasny', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`S.settings.motyw='ciemny';save();applyTheme();render()`); await sleep(400);

/* okno użytkownika 1752x1228: ekran „Dziś” ma wypełniać dostępną przestrzeń */
await send('Emulation.setDeviceMetricsOverride', {width: 1752, height: 1228, deviceScaleFactor: 1, mobile: false});
await ev(`go('today')`); await sleep(900);
const okno = await json(`JSON.stringify((()=>{const g=document.querySelector('.today-grid'),r=g.getBoundingClientRect(),
  vb=document.querySelector('.viewport').getBoundingClientRect(),rl=document.querySelector('.rail').getBoundingClientRect();
  const kids=[...g.children].map(k=>Math.round(k.getBoundingClientRect().width));
  return{ile:g.children.length,kids:kids.join('/'),sz:Math.round(r.width),dostepne:Math.round(vb.width-64),
    wys:Math.round(r.height),kolizja:r.right>rl.left+1}})())`);
const ok1752 = okno;
console.log('OKNO-1752', JSON.stringify(okno));
check('1752 px: „Dziś” w dwóch kolumnach bez pustego pasa', ok1752.ile === 2 && ok1752.sz >= ok1752.dostepne * 0.94 && ok1752.kolizja === false, JSON.stringify(okno));
check('1752 px: kolumny zbliżone szerokością', Math.abs(ok1752.kids.split('/')[0] - ok1752.kids.split('/')[1]) < 60, ok1752.kids);
await shot('z4-dzis-1752');

await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 940, deviceScaleFactor: 1, mobile: false});
await ev(`go('today')`); await sleep(600); await shot('d1-desktop');
await ev(`startSession(false)`); await sleep(500); await shot('d2-desktop-nauka');

/* ══ 11b · Przełącznik widoku na telefonie ═════════════════════════ */
const przepl = `przepełnienie:[...new Set([...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>el.tagName+'.'+String(el.className).slice(0,14)))].slice(0,4)`;
const IKONY = `ikonaTelefon:getComputedStyle(document.getElementById('icPhone')).display!=='none',
  ikonaMonitor:getComputedStyle(document.getElementById('icMonitor')).display!=='none'`;
await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
await ev(`S.settings.wyglad='auto';applyLayout();go('today')`); await sleep(800);
const telPrzycisk = await json(`JSON.stringify({widoczny:getComputedStyle(document.getElementById('layoutBtn')).display!=='none',
  etykieta:document.getElementById('layoutBtn').getAttribute('aria-label'),
  ${IKONY},
  prawyKrawedz:Math.round(document.querySelector('.appbar').getBoundingClientRect().right),
  dok:document.scrollingElement.scrollWidth, ${przepl}})`);
console.log('TELEFON-PRZYCISK', JSON.stringify(telPrzycisk));
check('na telefonie w pasku jest przycisk zmiany widoku', telPrzycisk.widoczny === true && /komputer/.test(telPrzycisk.etykieta), JSON.stringify(telPrzycisk));
check('na telefonie przycisk pokazuje telefon, nie monitor', telPrzycisk.ikonaTelefon === true && telPrzycisk.ikonaMonitor === false, JSON.stringify(telPrzycisk));
check('pasek telefonu mieści trzy przyciski (390 px)', telPrzycisk.prawyKrawedz <= 391 && telPrzycisk.dok <= 391, JSON.stringify(telPrzycisk));
await shot('p1-telefon-auto');
await click('#layoutBtn', 900);
const telWeb = await json(`JSON.stringify({ustawienie:S.settings.wyglad,web:document.documentElement.classList.contains('web'),
  canvas:Math.round(document.querySelector('.phone').getBoundingClientRect().width),
  stageSw:document.querySelector('.stage').scrollWidth, stageCw:document.querySelector('.stage').clientWidth,
  dok:document.scrollingElement.scrollWidth,
  tresc:Math.round(document.querySelector('.viewport').getBoundingClientRect().width),
  gorny:Math.round(document.querySelector('.appbar').getBoundingClientRect().width),
  nawigacjaNaDole:Math.round(document.querySelector('.tabbar').getBoundingClientRect().top),
  szerokoscNawigacji:Math.round(document.querySelector('.tabbar').getBoundingClientRect().width),
  ${IKONY},
  lokalnie:JSON.parse(localStorage.getItem(KSET)).wyglad})`);
console.log('TELEFON-WEB', JSON.stringify(telWeb));
check('telefon: kliknięcie włącza układ komputerowy (760 px)', telWeb.ustawienie === 'web' && telWeb.web === true && telWeb.canvas === 760, JSON.stringify(telWeb));
check('telefon: układ komputerowy przewija się w poziomie, a okno nie', telWeb.stageSw === 760 && telWeb.stageCw === 390 && telWeb.dok <= 391, JSON.stringify(telWeb));
check('telefon: treść dostaje pełną szerokość komputera', telWeb.tresc >= 700, String(telWeb.tresc));
check('telefon: pasek górny i nawigacja trzymają się krawędzi okna', telWeb.gorny === 390 && telWeb.nawigacjaNaDole > 700 && telWeb.szerokoscNawigacji === 390, JSON.stringify(telWeb));
check('telefon: wybór zapamiętany na tym urządzeniu', telWeb.lokalnie === 'web', String(telWeb.lokalnie));
check('telefon: po włączeniu układu komputerowego przycisk pokazuje monitor', telWeb.ikonaMonitor === true && telWeb.ikonaTelefon === false, JSON.stringify(telWeb));
aud = await json(AUDIT); console.log('AUDYT TELEFON-WEB', JSON.stringify(aud));
check('kontrast AA w telefonie w układzie komputerowym', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`go('decks')`); await sleep(600); await shot('p2-telefon-web-talie');
await ev(`go('today')`); await sleep(500); await shot('p3-telefon-web-dzis');
await click('#menuBtn', 700);
const menuTel = await json(`JSON.stringify({przyciski:[...document.querySelectorAll('#mLayout button')].map(b=>b.textContent.trim()),
  wybrany:(document.querySelector('#mLayout button[aria-pressed="true"]')||{}).dataset?.v,
  podpowiedz:(document.getElementById('mLayoutHint')||{}).textContent||''})`);
console.log('MENU-TELEFON', JSON.stringify(menuTel));
check('menu na telefonie ma nazwany przełącznik widoku', menuTel.przyciski.join('|') === 'Dopasuj do ekranu|Telefon|Komputer' && menuTel.wybrany === 'web', JSON.stringify(menuTel));
check('menu na telefonie wyjaśnia, co właśnie widać', /760/.test(menuTel.podpowiedz) && /przewij/i.test(menuTel.podpowiedz), menuTel.podpowiedz);
await click('[data-act="close"]', 600);
await click('#layoutBtn', 900);
const telZpowrotem = await json(`JSON.stringify({ustawienie:S.settings.wyglad,web:document.documentElement.classList.contains('web'),
  canvas:Math.round(document.querySelector('.phone').getBoundingClientRect().width)})`);
check('telefon: drugie kliknięcie wraca do widoku na telefon', telZpowrotem.ustawienie === 'telefon' && telZpowrotem.web === false && telZpowrotem.canvas === 390, JSON.stringify(telZpowrotem));

/* telefon obrócony (844x390) — tu układ komputerowy mieści się bez przewijania */
await send('Emulation.setDeviceMetricsOverride', {width: 844, height: 390, deviceScaleFactor: 2, mobile: true});
await ev(`S.settings.wyglad='auto';applyLayout();go('today')`); await sleep(700);
const obrAuto = await json(`JSON.stringify({web:document.documentElement.classList.contains('web'),
  pasek:Math.round(document.querySelector('.tabbar').getBoundingClientRect().width),
  tresc:Math.round(document.querySelector('.viewport').getBoundingClientRect().width),${przepl}})`);
console.log('OBRÓCONY-AUTO', JSON.stringify(obrAuto));
check('obrócony telefon w trybie auto mieści układ komputerowy', obrAuto.web === true && obrAuto.pasek === 252 && obrAuto.tresc >= 500 && obrAuto.przepełnienie.length === 0, JSON.stringify(obrAuto));
await click('#layoutBtn', 900);
const obrTel = await json(`JSON.stringify({ustawienie:S.settings.wyglad,web:document.documentElement.classList.contains('web'),
  ramka:document.documentElement.classList.contains('telefon'),
  canvas:Math.round(document.querySelector('.phone').getBoundingClientRect().width),${przepl}})`);
console.log('OBRÓCONY-TELEFON', JSON.stringify(obrTel));
check('obrócony telefon: wybór „Telefon” daje wąską kolumnę bez ramki', obrTel.ustawienie === 'telefon' && obrTel.web === false && obrTel.ramka === false && obrTel.canvas === 560, JSON.stringify(obrTel));
await click('#menuBtn', 800);
const obrMenu = await json(`JSON.stringify({gora:Math.round(document.querySelector('.scrim.open .sheet').getBoundingClientRect().top),
  dol:Math.round(document.querySelector('.scrim.open .sheet').getBoundingClientRect().bottom),
  tytuł:(document.querySelector('.scrim.open .sheet h3')||{}).textContent||''})`);
console.log('OBRÓCONY-MENU', JSON.stringify(obrMenu));
check('niskie okno: menu otwiera się w całości na ekranie', obrMenu.tytuł === 'Menu i ustawienia' && obrMenu.gora >= 0 && obrMenu.dol <= 391, JSON.stringify(obrMenu));
await shot('p4-telefon-obrocony-menu');
await click('[data-act="close"]', 600);
await ev(`S.settings.wyglad='web';applyLayout();render()`); await sleep(600);
await ev(`S.settings.motyw='jasny';applyTheme();render()`); await sleep(600);
await shot('p5-telefon-obrocony-web-jasny');
aud = await json(AUDIT); console.log('AUDYT OBRÓCONY-WEB', JSON.stringify(aud));
check('kontrast AA obrócony telefon web (jasny)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`S.settings.motyw='ciemny';applyTheme();S.settings.wyglad='auto';applyLayout();render()`); await sleep(500);

/* ══ 12 · Skrajny mały ekran + ograniczony ruch ════════════════════ */
await ev(`document.getElementById('sheetClose').click()`); await sleep(400);
await send('Emulation.setDeviceMetricsOverride', {width: 320, height: 700, deviceScaleFactor: 2, mobile: true});
await ev(`S.settings.wyglad='auto';applyLayout();go('today')`); await sleep(700);
const m320 = await json(przeleczenie(320));
console.log('320px', JSON.stringify(m320));
check('bez przepełnienia przy 320 px', m320.bad.length === 0 && m320.scrollW <= 321, JSON.stringify(m320));
await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}, {name: 'prefers-color-scheme', value: 'light'}]});
await ev(`S.settings.motyw='jasny';applyTheme();go('today')`); await sleep(500);
await ev(`session=null;startSession(false)`); await sleep(500); await click('[data-act="reveal"]');
await shot('x1-reduced-motion-320-jasny');
console.log('RM-320-JASNY', await ev(`JSON.stringify({wysokoscKarty:Math.round(document.querySelector('.card3d').getBoundingClientRect().height),
  odpowiedziWidoczna:!!document.querySelector('.face.back').offsetParent})`));
aud = await json(AUDIT); console.log('AUDYT JASNY 320', JSON.stringify(aud));
check('kontrast AA 320 jasny (ograniczony ruch)', aud.zlych === 0, JSON.stringify(aud.najgorsze));
await ev(`document.getElementById('menuBtn').click()`); await sleep(500);
await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape'});
await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape'}); await sleep(600);
const esc = await json(`JSON.stringify({scrimHidden:document.getElementById('scrim').hidden,focus:document.activeElement.id})`);
check('Escape zamyka panel', esc.scrimHidden === true, JSON.stringify(esc));
console.log('RM', await ev(`JSON.stringify({flipped:document.querySelector('.card3d').classList.contains('flipped'),
  backVisible:!!document.querySelector('.face.back').offsetParent})`));
const trwalosc = await json(`JSON.stringify({ustawienia:JSON.parse(localStorage.getItem('tfiszki:ustawienia:v1')),
  klucze:Object.keys(localStorage).filter(k=>/^tfiszki:/.test(k)),konto:konto})`);
console.log('TRWALOSC', JSON.stringify(trwalosc));
check('ustawienia urządzenia przeżywają w nowym kluczu', !!trwalosc.ustawienia && ['jasny', 'auto', 'ciemny'].includes(trwalosc.ustawienia.motyw), JSON.stringify(trwalosc.ustawienia));
check('dane konta trzymane pod kluczem z nazwą konta', trwalosc.klucze.some(k=>k.includes(ANIA.toLowerCase())), JSON.stringify(trwalosc.klucze));

/* ══ 13 · Sprzątanie kont testowych ════════════════════════════════ */
await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
await ev(`S.settings.motyw='ciemny';S.settings.wyglad='auto';save();applyTheme();applyLayout()`); await sleep(800);
const kasacja = await json(`ap('POST','/api/konto-usun',{haslo:${JSON.stringify(HASLO)}}).then(()=>JSON.stringify({ok:1}),e=>JSON.stringify({blad:e.message}))`);
check('konto testowe skasowane', kasacja.ok === 1, JSON.stringify(kasacja));
const zdrowie1 = await (await fetch(SERWER + '/api/health')).json();
check('baza kont po testach znowu pusta', zdrowie1.konta === 0, JSON.stringify(zdrowie1));
check('zero błędów konsoli i wyjątków', logs.length === 0, logs.slice(0, 8).join(' | '));
console.log('LOGI KONSOLI', logs.length ? logs : '— brak błędów —');
console.log(FAIL.length ? '\n=== ' + FAIL.length + ' NIEZADOWALAJACYCH SPRAWDZEN ===\n' + FAIL.map(f => ' * ' + f).join('\n') : '\n=== WSZYSTKIE SPRAWDZENIA NA ZIELONO ===');
ws.close(); proc.kill();
await sleep(1200);
try { rmSync(profil, {recursive: true, force: true}); }
catch (e) { console.log('NIE USUNĄŁEM PROFILU CHROME (Chrome wciąż go trzyma):', profil); }
process.exit(FAIL.length ? 1 : 0);

/* Sprawdza składnię obu bloków <script> w t-fiszki.html — bez uruchamiania przeglądarki. */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 't-fiszki.html'), 'utf8');
const bloki = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('bloków skryptu:', bloki.length);
bloki.forEach(function (b, i) {
  try { new Function(b); console.log(' blok ' + i + ': składnia OK (' + b.length + ' znaków)'); }
  catch (e) { console.log(' blok ' + i + ': BŁĄD ' + e.message); process.exitCode = 1; }
});

// Kontrola po edycji polskiego tekstu i kodu: obce pisma (CJK, cyrylica, greka, pełnoszerokościowe, prywatne).
const fs = require('fs');
const OBCE = new RegExp('[\\u3000-\\u303F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF01-\\uFF60\\uE000-\\uF8FF\\u0400-\\u04FF\\u0370-\\u03FF]', 'u');
for (const f of process.argv.slice(2)) {
  const linie = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const trafienia = [];
  linie.forEach((l, i) => { if (OBCE.test(l)) trafienia.push('  ' + (i + 1) + ': ' + l.trim().slice(0, 70)); });
  console.log(f + ': ' + (trafienia.length ? 'OBCE ZNAKI\n' + trafienia.join('\n') : 'czysto'));
}

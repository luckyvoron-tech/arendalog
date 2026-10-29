/* Тесты ядра АрендаЛог (Node): хеши, подписи, цепочка, ASN.1, ZIP */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CORE = path.join(__dirname, '..', 'app', 'js', 'core.js');

globalThis.window = globalThis;
const code = fs.readFileSync(CORE, 'utf8');
eval(code);
const AL = globalThis.AL;

if (!AL) { console.error('AL не загрузился'); process.exit(1); }

/* ── заглушка IndexedDB в памяти ── */
const mem = new Map();
AL.DB.get = async (s, k) => mem.get(s + '|' + k);
AL.DB.put = async (s, v) => { mem.set(s + '|' + v.k, v); return v; };
AL.DB.set = async (k, v) => { mem.set('settings|' + k, { k, v }); return { k, v }; };
AL.DB.getSet = async (k, def) => { const r = mem.get('settings|' + k); return r ? r.v : def; };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
async function t(name, fn) {
  try { await fn(); } catch (e) { fail++; console.log('  ✗ ' + name + ' — исключение: ' + e.message); }
}

(async () => {
  console.log('\n[1] Утилиты и хеши');
  await t('canonical JSON', async () => {
    const a = AL.U.canonical({ b: 1, a: 2 });
    const b = AL.U.canonical({ a: 2, b: 1 });
    ok('порядок ключей не влияет', a === b, a + ' vs ' + b);
  });
  const abc = await AL.U.sha256Hex('abc');
  ok('SHA-256("abc") по эталону',
    abc === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', abc);

  console.log('\n[2] Ключи и подписи ECDSA P-256');
  const kp = await AL.Crypto.ensureKeys();
  ok('ключ создан, отпечаток 64 hex', /^[0-9a-f]{64}$/.test(kp.pubHex), String(kp.pubHex).slice(0, 20));
  const h1 = await AL.U.sha256Hex('событие 1');
  const sig = await AL.Crypto.signHex(h1);
  ok('подпись получена', typeof sig === 'string' && sig.length > 60);
  ok('подпись верна', await AL.Crypto.verifyHex(h1, sig));
  ok('подпись не подходит к другому хешу', !(await AL.Crypto.verifyHex(await AL.U.sha256Hex('другое'), sig)));

  console.log('\n[3] Хеш-цепочка');
  async function buildChain(n) {
    let prev = '', events = [];
    for (let i = 1; i <= n; i++) {
      const ev = {
        journalId: 'j1', seq: i, type: 'defect', title: 'Событие ' + i, note: 'текст ' + i,
        amount: i * 100, room: 'Кухня', severity: 'средняя',
        tsDevice: new Date(Date.now() + i * 1000).toISOString()
      };
      const base = {
        journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title, note: ev.note,
        amount: ev.amount, room: ev.room, severity: ev.severity, tsDevice: ev.tsDevice,
        photos: [], meta: null
      };
      ev.prevHash = prev;
      ev.hash = await AL.U.sha256Hex(AL.U.canonical(Object.assign({}, base, { prevHash: prev })));
      ev.sig = await AL.Crypto.signHex(ev.hash);
      prev = ev.hash;
      events.push(ev);
    }
    return events;
  }
  async function verify(events) {
    let prev = '';
    for (const ev of events) {
      if ((ev.prevHash || '') !== prev) return 'разрыв на #' + ev.seq;
      const base = {
        journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title, note: ev.note,
        amount: ev.amount, room: ev.room, severity: ev.severity, tsDevice: ev.tsDevice,
        photos: [], meta: null
      };
      const h = await AL.U.sha256Hex(AL.U.canonical(Object.assign({}, base, { prevHash: ev.prevHash || '' })));
      if (h !== ev.hash) return 'хеш #' + ev.seq;
      if (!(await AL.Crypto.verifyHex(ev.hash, ev.sig))) return 'подпись #' + ev.seq;
      prev = h;
    }
    return 'ok';
  }
  const chain = await buildChain(4);
  ok('цепочка из 4 событий проверяется', (await verify(chain)) === 'ok');
  ok('события связаны', chain[1].prevHash === chain[0].hash && chain[3].prevHash === chain[2].hash);

  const tampered = JSON.parse(JSON.stringify(chain));
  tampered[2].title = 'Изменённая запись';
  ok('подмена текста обнаруживается', (await verify(tampered)) !== 'ok', await verify(tampered));

  const removed = chain.filter((_, i) => i !== 1);
  ok('удаление события обнаруживается', (await verify(removed)) !== 'ok');

  const reordered = [chain[0], chain[2], chain[1], chain[3]];
  ok('перестановка обнаруживается', (await verify(reordered)) !== 'ok');

  console.log('\n[4] ASN.1 / RFC 3161');
  const tsq = AL.Asn.timestampRequest(AL.U.hexToBytes(h1));
  ok('запрос начинается с SEQUENCE', tsq[0] === 0x30, '0x' + tsq[0].toString(16));
  const hexTsq = AL.U.bytesToHex(tsq);
  ok('содержит OID SHA-256 (2.16.840.1.101.3.4.2.1)',
    hexTsq.includes('0609608648016503040201'), hexTsq.slice(0, 80));
  ok('содержит хеш в OCTET STRING', hexTsq.includes('0420' + h1));
  ok('certReq = TRUE', hexTsq.includes('0101ff'));
  ok('длина DER разумная', tsq.length > 50 && tsq.length < 200, String(tsq.length));

  console.log('\n[5] ZIP');
  const files = [
    { name: 'a.txt', bytes: new TextEncoder().encode('привет') },
    { name: 'dir/b.json', bytes: new TextEncoder().encode('{"x":1}') }
  ];
  const blob = AL.Zip.build(files);
  const buf = Buffer.from(await blob.arrayBuffer());
  const zipPath = path.join(os.tmpdir(), 'arendalog-test.zip');
  fs.writeFileSync(zipPath, buf);
  ok('ZIP непустой', buf.length > 100, buf.length + ' байт');
  ok('сигнатура PK', buf[0] === 0x50 && buf[1] === 0x4b);
  console.log('  → ' + zipPath);

  console.log('\n[6] Метка времени (сеть)');
  try {
    const r = await AL.TSA.stamp(h1, 'https://freetsa.org/tsr');
    ok('TSA ответил, время получено', !!r.time, JSON.stringify(r).slice(0, 120));
    if (r.time) console.log('    время TSA: ' + r.time);
  } catch (e) {
    console.log('  ! TSA недоступен из этой сети: ' + e.message);
    console.log('    (на телефоне запрос идёт через нативный мост, минуя CORS)');
  }

  console.log('\n════════════════════════');
  console.log('Пройдено: ' + pass + ' · Провалено: ' + fail);
  process.exit(fail ? 1 : 0);
})();

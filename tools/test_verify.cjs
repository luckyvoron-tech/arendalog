/* Тест автономного верификатора: подлинный пакет, подмена файла, подмена содержимого */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const APP = path.join(__dirname, '..', 'app');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9500 + Math.floor(Math.random() * 400);
const PROFILE = path.join(os.tmpdir(), 'al-ver-' + Date.now());
const VERIFY_URL = 'file:///' + path.join(APP, 'verify.html').replace(/\\/g, '/');

/* ── загрузка ядра приложения для сборки пакета ── */
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(APP, 'js', 'core.js'), 'utf8'));
const AL = globalThis.AL;
const mem = new Map();
AL.DB.get = async (s, k) => mem.get(s + '|' + k);
AL.DB.put = async (s, v) => { mem.set(s + '|' + v.k, v); return v; };
AL.DB.set = async (k, v) => { mem.set('settings|' + k, { k, v }); return { k, v }; };
AL.DB.getSet = async (k, d) => { const r = mem.get('settings|' + k); return r ? r.v : d; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  }
}

/* ── сборка тестового пакета ── */
async function buildPackage(tamper) {
  const kp = await AL.Crypto.ensureKeys();
  const jwk = await AL.Crypto.publicJwk();
  const journal = {
    id: 'j1', title: 'Дом', address: 'Город, улица, 1', tenant: 'Иванова М. П.',
    landlord: 'Петров С. А.', deposit: 45000, rent: 65000, start: '2025-11-20', end: '2026-10-20'
  };
  const events = [];
  let prev = '';
  for (let i = 1; i <= 3; i++) {
    const ev = {
      id: 'e' + i, journalId: 'j1', seq: i, type: i === 2 ? 'receipt' : 'defect',
      title: 'Событие ' + i, note: 'описание ' + i, amount: i === 2 ? 3000 : 0,
      room: 'Кухня', severity: '', tsDevice: new Date(Date.now() + i * 1000).toISOString(),
      photos: [], meta: i === 2 ? { counterparty: 'Магазин «Строй»' } : null,
      prevHash: prev, hash: '', sig: '', tsa: null
    };
    const base = {
      journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title, note: ev.note,
      amount: ev.amount, room: ev.room, severity: ev.severity, tsDevice: ev.tsDevice,
      photos: ev.photos.slice(), meta: ev.meta
    };
    ev.hash = await AL.U.sha256Hex(AL.U.canonical(Object.assign({}, base, { prevHash: prev })));
    ev.sig = await AL.Crypto.signHex(ev.hash);
    prev = ev.hash;
    events.push(ev);
  }

  const enc = s => new TextEncoder().encode(s);
  const files = [];
  const manifest = {
    app: 'АрендаЛог 1.0', createdAt: new Date().toISOString(), journalId: 'j1',
    rootHash: prev, keyFingerprint: kp.pubHex, chainOk: true, files: [], publicKeyJwk: jwk
  };
  const add = async (name, bytes) => {
    files.push({ name, bytes });
    manifest.files.push({ name, sha256: await AL.U.sha256Hex(bytes) });
  };

  // фото: при подмене файла манифест сохраняет ИСХОДНЫЙ хеш — так выглядит реальная фальсификация
  const photoOrig = enc('fake-jpeg-content');
  const photoHash = await AL.U.sha256Hex(photoOrig);
  const photoBytes = tamper === 'file' ? enc('fake-jpeg-CONTENT-изменено') : photoOrig;
  files.push({ name: 'photos/p1.jpg', bytes: photoBytes });
  manifest.files.push({ name: 'photos/p1.jpg', sha256: photoHash });

  await add('docs/чек-1.pdf', enc('%PDF-1.4 fake receipt'));

  let journalJson = { format: 'arendalog/1', journal, events, handovers: [] };
  if (tamper === 'content') {
    journalJson = JSON.parse(JSON.stringify(journalJson));
    journalJson.events[1].title = 'ПОДМЕНЁННЫЙ ЗАГОЛОВОК';
  }
  await add('journal.json', enc(JSON.stringify(journalJson)));
  await add('README.txt', enc('пакет'));
  files.push({ name: 'manifest.json', bytes: enc(JSON.stringify(manifest)) });
  files.push({ name: 'verify.html', bytes: enc(fs.readFileSync(path.join(APP, 'verify.html'), 'utf8')) });

  const blob = AL.Zip.build(files);
  return Buffer.from(await blob.arrayBuffer());
}

(async () => {
  console.log('верификатор: ' + VERIFY_URL);

  const good = await buildPackage(null);
  const badFile = await buildPackage('file');
  const badContent = await buildPackage('content');
  console.log('пакеты собраны: ' + good.length + ' / ' + badFile.length + ' / ' + badContent.length + ' байт');

  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, VERIFY_URL
  ], { stdio: 'ignore', detached: true });
  child.unref();

  let ready = null;
  for (let i = 0; i < 60; i++) {
    try {
      const v = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/version'));
      if (v.Browser) { ready = v; break; }
    } catch (e) { }
    await sleep(400);
  }
  if (!ready) throw new Error('Chrome не запустился');

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
      page = list.find(t => t.type === 'page' && t.url.indexOf('verify.html') >= 0) || list.find(t => t.type === 'page');
      if (page) break;
    } catch (e) { }
    await sleep(400);
  }
  if (!page) throw new Error('нет вкладки верификатора');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await sleep(1200);

  const run = async (buf, name) => {
    const b64 = buf.toString('base64');
    const expr = `(async () => {
      const bin = atob(${JSON.stringify(b64)});
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const f = new File([arr], ${JSON.stringify(name)}, { type: 'application/zip' });
      await handleFile(f);
      return document.querySelector('#result').innerText;
    })()`;
    return await cdp.eval(expr);
  };

  let pass = 0, fail = 0;
  const check = (n, c, extra) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (extra ? ' — ' + String(extra).slice(0, 300) : '')); }
  };

  console.log('\n[1] Подлинный пакет');
  const r1 = await run(good, 'good.zip');
  check('вердикт «подлинный»', /Пакет подлинный и не изменён/.test(r1), r1.slice(0, 200));
  check('событий проверено 3', /Событий проверено\s*3 из 3/.test(r1.replace(/\n/g, ' ')), r1.replace(/\n/g, ' ').slice(0, 200));
  check('файлы сверены', /Файлов сверено/.test(r1));

  console.log('\n[2] Подменён файл фото');
  const r2 = await run(badFile, 'bad-file.zip');
  check('вердикт «расхождения»', /Обнаружены расхождения/.test(r2), r2.slice(0, 200));
  check('указан конкретный файл', /photos\/p1\.jpg/.test(r2), r2.slice(0, 300));

  console.log('\n[3] Подменено содержимое события');
  const r3 = await run(badContent, 'bad-content.zip');
  check('вердикт «расхождения»', /Обнаружены расхождения/.test(r3), r3.slice(0, 200));
  check('указано событие #2', /событие #2|#2/.test(r3), r3.slice(0, 300));

  console.log('\n════════════════════════');
  console.log('Пройдено: ' + pass + ' · Провалено: ' + fail);

  try { ws.close(); } catch (e) { }
  try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('ТЕСТ УПАЛ: ' + e.message);
  try { process.exit(2); } catch (x) { }
});

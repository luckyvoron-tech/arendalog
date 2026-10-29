/* Тест сервера синхронизации: пространство, права, приглашения, целостность, поток */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9600 + Math.floor(Math.random() * 300);
const DATA = path.join(os.tmpdir(), 'al-sync-' + Date.now());
const BASE = 'http://127.0.0.1:' + PORT;

/* ядро приложения для подписи событий */
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(ROOT, 'app', 'js', 'core.js'), 'utf8'));
const AL = globalThis.AL;
const mem = new Map();
AL.DB.get = async (s, k) => mem.get(s + '|' + k);
AL.DB.put = async (s, v) => { mem.set(s + '|' + v.k, v); return v; };
AL.DB.set = async (k, v) => { mem.set('settings|' + k, { k, v }); return { k, v }; };
AL.DB.getSet = async (k, d) => { const r = mem.get('settings|' + k); return r ? r.v : d; };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, p, body, token) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { }
  return { status: r.status, json, txt };
}

/* событие в формате клиента */
async function makeEvent(seq, prev, authorId, title) {
  const ev = {
    id: 'ev' + seq + '-' + Math.random().toString(16).slice(2, 8),
    journalId: 'j1', seq, authorId, type: 'defect', title, note: 'описание', amount: 0,
    room: 'Кухня', severity: '', tsDevice: new Date().toISOString(),
    photos: [], meta: null, prevHash: prev, hash: '', sig: '', tsa: null
  };
  const base = {
    journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title, note: ev.note,
    amount: ev.amount, room: ev.room, severity: ev.severity, tsDevice: ev.tsDevice,
    photos: [], meta: null, authorId
  };
  ev.hash = await AL.U.sha256Hex(AL.U.canonical(Object.assign({}, base, { prevHash: prev })));
  ev.sig = await AL.Crypto.signHex(ev.hash);
  return ev;
}

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 260) : '')); }
};

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'sync-server.js'), String(PORT)], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA }),
    stdio: 'ignore', detached: true
  });
  child.unref();

  let up = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await api('GET', '/api/health'); if (r.status === 200) { up = true; break; } } catch (e) { }
    await sleep(200);
  }
  if (!up) { console.error('сервер не поднялся'); process.exit(2); }
  console.log('сервер поднят на ' + BASE);

  console.log('\n[1] Создание пространства');
  const created = await api('POST', '/api/space', { title: 'Дом в Сочи', pubHex: 'abc123' });
  check('код 201', created.status === 201, created.txt);
  const spaceId = created.json && created.json.spaceId;
  const owner = created.json && created.json.token;
  const readCode = created.json && created.json.codes && created.json.codes.read;
  const writeCode = created.json && created.json.codes && created.json.codes.write;
  check('есть id пространства', !!spaceId, spaceId);
  check('есть токен владельца', !!owner);
  check('есть код для чтения', /#.*:/.test(readCode || ''), readCode);
  check('есть код для записи', /#.*:/.test(writeCode || ''), writeCode);

  const readToken = (readCode || '').split(':').pop();
  const writeToken = (writeCode || '').split(':').pop();

  console.log('\n[2] Метаданные и права');
  const metaPut = await api('PUT', '/api/space/' + spaceId + '/meta', {
    meta: { zones: [{ id: 'z1', name: 'Мангальная зона', note: 'во дворе', items: ['мангал', 'стол'] }], people: [{ id: 'p1', name: 'Катя', role: 'арендатор' }] },
    pubHex: 'abc123'
  }, owner);
  check('владелец может писать мету', metaPut.status === 200, metaPut.txt);

  const metaRo = await api('PUT', '/api/space/' + spaceId + '/meta', { meta: {} }, readToken);
  check('токен чтения не может писать мету', metaRo.status === 403, metaRo.status);

  const readInfo = await api('GET', '/api/space/' + spaceId, null, readToken);
  check('токен чтения читает пространство', readInfo.status === 200, readInfo.status);
  check('роль определена как read', readInfo.json && readInfo.json.role === 'read', readInfo.json && readInfo.json.role);
  check('зоны сохранены', readInfo.json && readInfo.json.meta && readInfo.json.meta.zones && readInfo.json.meta.zones[0].name === 'Мангальная зона');
  check('проживающие сохранены', readInfo.json && readInfo.json.meta.people && readInfo.json.meta.people[0].role === 'арендатор');

  const noAuth = await api('GET', '/api/space/' + spaceId);
  check('без токена — 401', noAuth.status === 401, noAuth.status);

  console.log('\n[3] Отправка событий');
  const e1 = await makeEvent(1, '', 'authorA', 'Проблема 1');
  const e2 = await makeEvent(2, e1.hash, 'authorA', 'Проблема 2');
  const push1 = await api('POST', '/api/space/' + spaceId + '/events', { events: [e1, e2] }, writeToken);
  check('события приняты', push1.status === 200 && push1.json.accepted === 2, push1.json);

  const pushRo = await api('POST', '/api/space/' + spaceId + '/events', { events: [e1] }, readToken);
  check('токен чтения не может добавлять события', pushRo.status === 403, pushRo.status);

  const dup = await api('POST', '/api/space/' + spaceId + '/events', { events: [e1] }, writeToken);
  check('повтор не дублируется', dup.status === 200 && dup.json.accepted === 0, dup.json);

  console.log('\n[4] Проверка целостности на сервере');
  const e3 = await makeEvent(3, e2.hash, 'authorA', 'Событие с испорченным хешем');
  e3.title = 'Подменённый заголовок'; // хеш уже посчитан от другого текста
  const badPush = await api('POST', '/api/space/' + spaceId + '/events', { events: [e3] }, writeToken);
  check('сервер принял пакет', badPush.status === 200, badPush.status);
  const got = await api('GET', '/api/space/' + spaceId + '/events?since=0', null, readToken);
  const bad = (got.json.events || []).find(e => e.id === e3.id);
  check('сервер пометил несоответствие хеша', bad && bad.serverCheck && bad.serverCheck.hashOk === false,
    bad && bad.serverCheck);
  check('цепочка события 2 проверена как верная',
    (got.json.events || []).filter(e => e.id === e2.id)[0].serverCheck.chainOk === true);

  console.log('\n[5] Выдача и приглашения');
  const since2 = await api('GET', '/api/space/' + spaceId + '/events?since=2', null, readToken);
  check('since=2 отдаёт только новые', (since2.json.events || []).length === 1, (since2.json.events || []).length);

  const inv = await api('POST', '/api/space/' + spaceId + '/invite', { role: 'write' }, owner);
  check('владелец создаёт приглашение', inv.status === 200 && /#.*:/.test(inv.json.code || ''), inv.txt);
  const invRo = await api('POST', '/api/space/' + spaceId + '/invite', { role: 'read' }, readToken);
  check('токен чтения не приглашает', invRo.status === 403, invRo.status);

  const newTok = (inv.json.code || '').split(':').pop();
  const writeByInvite = await api('POST', '/api/space/' + spaceId + '/events',
    { events: [await makeEvent(4, e3.hash, 'authorA', 'Через приглашение')] }, newTok);
  check('приглашённый может писать', writeByInvite.status === 200 && writeByInvite.json.accepted === 1, writeByInvite.json);

  console.log('\n[6] Поток реального времени (SSE)');
  const sse = await new Promise((resolve) => {
    const req = http.get(BASE + '/api/space/' + spaceId + '/stream?token=' + readToken, res => {
      let buf = '';
      res.on('data', c => {
        buf += c;
        if (buf.includes('event: hello')) { resolve({ ok: true, status: res.statusCode }); req.destroy(); }
      });
      setTimeout(() => resolve({ ok: buf.includes('event: hello'), status: res.statusCode }), 2500);
    });
    req.on('error', () => resolve({ ok: false }));
  });
  check('SSE отдаёт hello', sse.ok === true, sse);

  console.log('\n[7] Размер хранилища');
  const final = await api('GET', '/api/space/' + spaceId, null, owner);
  check('сервер считает размер', typeof final.json.bytes === 'number', final.json.bytes);
  check('событий на сервере 4', final.json.eventsCount === 4, final.json.eventsCount);

  console.log('\n════════════════════════');
  console.log('Пройдено: ' + pass + ' · Провалено: ' + fail);
  try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('ТЕСТ УПАЛ: ' + e.message);
  process.exit(2);
});

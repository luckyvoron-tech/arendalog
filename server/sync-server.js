'use strict';
/* АрендаЛог — сервер синхронизации.
   Без внешних зависимостей: HTTP, файловое хранилище, SSE для реального времени.

   Запуск:  node server/sync-server.js [порт]
   Переменные: PORT, DATA_DIR, MAX_SPACE_MB, PUBLIC_URL
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = Number(process.env.PORT || process.argv[2] || 8788);
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SPACES = path.join(DATA, 'spaces');
const BLOBS = path.join(DATA, 'blobs');
const MAX_SPACE_BYTES = Number(process.env.MAX_SPACE_MB || 500) * 1024 * 1024;
const MAX_BODY = 32 * 1024 * 1024;

for (const d of [DATA, SPACES, BLOBS]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const rnd = n => crypto.randomBytes(n).toString('hex');

/* ─────────── канонический JSON и хеш события: как в клиенте ─────────── */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
function eventBase(ev) {
  const base = {
    journalId: ev.journalId, seq: ev.seq, type: ev.type, title: ev.title || '',
    note: ev.note || '', amount: ev.amount || 0, room: ev.room || '',
    severity: ev.severity || '', tsDevice: ev.tsDevice,
    photos: (ev.photos || []).slice(), meta: ev.meta || null
  };
  if (ev.authorId) base.authorId = ev.authorId;
  return base;
}
function eventHash(ev) {
  return sha256(Buffer.from(canonical(Object.assign({}, eventBase(ev), { prevHash: ev.prevHash || '' })), 'utf8'));
}

/* ─────────── хранилище ─────────── */
const cache = new Map();

function spacePath(id) { return path.join(SPACES, id + '.json'); }

function loadSpace(id) {
  if (cache.has(id)) return cache.get(id);
  const p = spacePath(id);
  if (!fs.existsSync(p)) return null;
  const sp = JSON.parse(fs.readFileSync(p, 'utf8'));
  cache.set(id, sp);
  return sp;
}

function saveSpace(sp) {
  sp.updatedAt = new Date().toISOString();
  const p = spacePath(sp.id);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sp));
  fs.renameSync(tmp, p);
  cache.set(sp.id, sp);
}

function spaceSize(sp) {
  let n = 0;
  for (const sha of Object.keys(sp.photos || {})) {
    try { n += fs.statSync(path.join(BLOBS, sha)).size; } catch (e) { }
  }
  return n;
}

/* ─────────── токены ─────────── */
function newToken() { return rnd(24); }
function tokenHash(t) { return sha256(Buffer.from('arendalog:' + t, 'utf8')); }

function auth(sp, req, url) {
  const h = req.headers['authorization'] || '';
  let token = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '');
  if (!token) return null;
  const th = tokenHash(token);
  if (sp.tokens.owner === th) return 'owner';
  if ((sp.tokens.write || []).includes(th)) return 'write';
  if ((sp.tokens.read || []).includes(th)) return 'read';
  return null;
}

/* ─────────── SSE ─────────── */
const streams = new Map(); // spaceId -> Set(res)

function broadcast(id, payload) {
  const set = streams.get(id);
  if (!set) return;
  const data = 'event: events\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of set) {
    try { res.write(data); } catch (e) { }
  }
}

/* ─────────── HTTP ─────────── */
function send(req, res, code, obj, headers) {
  let body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj), 'utf8');
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {});
  const ae = String(req.headers['accept-encoding'] || '');
  if (body.length > 1024 && /gzip/.test(ae)) {
    body = zlib.gzipSync(body);
    h['Content-Encoding'] = 'gzip';
  }
  h['Content-Length'] = body.length;
  h['Cache-Control'] = 'no-store';
  h['Access-Control-Allow-Origin'] = '*';
  h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Sha256';
  h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
  res.writeHead(code, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > (limit || MAX_BODY)) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

/* создание пространства */
route('POST', '/api/space', async (req, res, m, body) => {
  const data = JSON.parse(body.toString('utf8') || '{}');
  const id = rnd(8);
  const owner = newToken(), write = newToken(), read = newToken();
  const sp = {
    id, createdAt: new Date().toISOString(),
    title: String(data.title || 'Журнал аренды').slice(0, 200),
    pubHex: data.pubHex || null,
    tokens: { owner: tokenHash(owner), write: [tokenHash(write)], read: [tokenHash(read)] },
    lastSeq: 0, metaVersion: 0,
    meta: { journal: data.journal || null, zones: [], people: [] },
    events: [], photos: {}, authors: {}
  };
  saveSpace(sp);
  log('space created', id);
  send(req, res, 201, {
    spaceId: id, token: owner, role: 'owner',
    codes: {
      read: publicUrl(req) + '#' + id + ':' + read,
      write: publicUrl(req) + '#' + id + ':' + write
    }
  });
});

function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.headers.host || ('127.0.0.1:' + PORT);
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + host;
}

/* метаданные */
route('GET', '/api/space/:id', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (!role) return send(req, res, 401, { error: 'нужен токен' });
  send(req, res, 200, {
    spaceId: sp.id, title: sp.title, role,
    pubHex: sp.pubHex, meta: sp.meta, metaVersion: sp.metaVersion,
    lastSeq: sp.lastSeq, eventsCount: sp.events.length,
    photos: Object.keys(sp.photos).length, bytes: spaceSize(sp)
  });
});

route('PUT', '/api/space/:id/meta', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return send(req, res, 403, { error: 'нет прав' });
  const data = JSON.parse(body.toString('utf8') || '{}');
  sp.meta = Object.assign({}, sp.meta, data.meta || {});
  if (data.pubHex) sp.pubHex = data.pubHex;
  sp.metaVersion = (sp.metaVersion || 0) + 1;
  saveSpace(sp);
  broadcast(sp.id, { type: 'meta', metaVersion: sp.metaVersion });
  send(req, res, 200, { ok: true, metaVersion: sp.metaVersion });
});

route('POST', '/api/space/:id/invite', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (role !== 'owner') return send(req, res, 403, { error: 'приглашать может только владелец' });
  const data = JSON.parse(body.toString('utf8') || '{}');
  const kind = data.role === 'read' ? 'read' : 'write';
  const token = newToken();
  if (kind === 'read') sp.tokens.read.push(tokenHash(token));
  else sp.tokens.write.push(tokenHash(token));
  saveSpace(sp);
  log('invite', sp.id, kind);
  send(req, res, 200, { role: kind, code: publicUrl(req) + '#' + sp.id + ':' + token });
});

/* приём событий */
route('POST', '/api/space/:id/events', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return send(req, res, 403, { error: 'нет прав на запись' });

  const data = JSON.parse(body.toString('utf8') || '{}');
  const incoming = Array.isArray(data.events) ? data.events.slice(0, 200) : [];
  const known = new Set(sp.events.map(e => e.id));
  const added = [];
  let rejected = 0;

  for (const ev of incoming) {
    if (!ev || !ev.id || !ev.hash || !ev.sig) { rejected++; continue; }
    if (known.has(ev.id)) continue;
    // независимая проверка хеша на сервере
    const calc = eventHash(ev);
    const hashOk = calc === ev.hash;
    const author = ev.authorId || 'anon';
    const last = sp.authors[author] || '';
    const chainOk = (ev.prevHash || '') === last;
    ev.sseq = ++sp.lastSeq;
    ev.serverCheck = { hashOk, chainOk, at: new Date().toISOString() };
    sp.events.push(ev);
    sp.authors[author] = ev.hash;
    known.add(ev.id);
    added.push(ev);
    if (!hashOk) log('!! hash mismatch', sp.id, ev.id);
  }

  if (data.photos && typeof data.photos === 'object') {
    for (const p of Object.values(data.photos)) {
      if (p && p.sha256) sp.photos[p.sha256] = { mime: p.mime, size: p.size || 0, ids: p.ids || [] };
    }
  }

  saveSpace(sp);
  if (added.length) {
    broadcast(sp.id, { type: 'events', lastSeq: sp.lastSeq, count: added.length });
    log('events', sp.id, '+', added.length, 'last', sp.lastSeq);
  }
  send(req, res, 200, { accepted: added.length, rejected, lastSeq: sp.lastSeq });
});

/* выдача событий */
route('GET', '/api/space/:id/events', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (!role) return send(req, res, 401, { error: 'нужен токен' });
  const since = Number(url.searchParams.get('since') || 0);
  const events = sp.events.filter(e => (e.sseq || 0) > since);
  send(req, res, 200, {
    events, lastSeq: sp.lastSeq, metaVersion: sp.metaVersion,
    meta: sp.meta, photos: sp.photos, pubHex: sp.pubHex
  });
});

/* поток изменений */
route('GET', '/api/space/:id/stream', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (!role) return send(req, res, 401, { error: 'нужен токен' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('event: hello\ndata: ' + JSON.stringify({ spaceId: sp.id, lastSeq: sp.lastSeq, role }) + '\n\n');
  if (!streams.has(sp.id)) streams.set(sp.id, new Set());
  streams.get(sp.id).add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { } }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = streams.get(sp.id);
    if (set) set.delete(res);
  });
});

/* вложения */
route('POST', '/api/space/:id/blob', async (req, res, m, body, url) => {
  const sp = loadSpace(m.id);
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return send(req, res, 403, { error: 'нет прав' });
  const got = sha256(body);
  const declared = String(req.headers['x-sha256'] || '').toLowerCase();
  if (declared && declared !== got) return send(req, res, 400, { error: 'хеш не совпадает' });
  const file = path.join(BLOBS, got);
  if (!fs.existsSync(file)) fs.writeFileSync(file, body);
  sp.photos[got] = { mime: req.headers['content-type'] || 'application/octet-stream', size: body.length };
  if (spaceSize(sp) > MAX_SPACE_BYTES) return send(req, res, 413, { error: 'пространство переполнено' });
  saveSpace(sp);
  send(req, res, 200, { ok: true, sha256: got, size: body.length });
});

route('GET', '/api/blob/:sha', async (req, res, m, body, url) => {
  const sp = loadSpace(String(url.searchParams.get('space') || ''));
  if (!sp) return send(req, res, 404, { error: 'нет пространства' });
  const role = auth(sp, req, url);
  if (!role) return send(req, res, 401, { error: 'нужен токен' });
  const file = path.join(BLOBS, m.sha);
  if (!fs.existsSync(file)) return send(req, res, 404, { error: 'нет файла' });
  const buf = fs.readFileSync(file);
  send(req, res, 200, buf, {
    'Content-Type': (sp.photos[m.sha] && sp.photos[m.sha].mime) || 'application/octet-stream'
  });
});

route('GET', '/api/health', async (req, res) => {
  send(req, res, 200, { ok: true, spaces: fs.readdirSync(SPACES).length, uptime: process.uptime() });
});

/* ─────────── сервер ─────────── */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(req, res, 204, {}, { 'Content-Length': 0 });
  }
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let body = Buffer.alloc(0);
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readBody(req);
    }
  } catch (e) {
    return send(req, res, 413, { error: 'слишком большой запрос' });
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const mm = r.re.exec(url.pathname);
    if (!mm) continue;
    const params = {};
    r.keys.forEach((k, i) => params[k] = decodeURIComponent(mm[i + 1]));
    try {
      await r.handler(req, res, params, body, url);
    } catch (e) {
      log('ошибка', e.message);
      try { send(req, res, 500, { error: e.message }); } catch (x) { }
    }
    return;
  }
  send(req, res, 404, { error: 'нет такого метода' });
});

server.listen(PORT, () => {
  log('АрендаЛог sync server на порту ' + PORT);
  log('данные: ' + DATA);
});

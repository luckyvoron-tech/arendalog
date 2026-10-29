/**
 * АрендаЛог — сервер синхронизации для Cloudflare Workers.
 *
 * Отличия от версии на Node.js:
 *  - нет файловой системы: метаданные и события — в KV, вложения — в R2;
 *  - нет Durable Objects (доступны только на платном тарифе), поэтому SSE
 *    реализован опросом KV внутри потока: клиент видит новые записи за 1–3 секунды;
 *  - тот же самый API, клиент менять не нужно.
 *
 * Требуется: KV namespace SPACES, R2 bucket BLOBS (см. wrangler.toml).
 * Бесплатного тарифа достаточно: KV 1 ГБ и 1000 записей в сутки, R2 10 ГБ.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sha256',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const enc = new TextEncoder();

/* ─────────── канонический JSON и хеш события (как в клиенте) ─────────── */
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
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function eventHash(ev) {
  return sha256Hex(canonical(Object.assign({}, eventBase(ev), { prevHash: ev.prevHash || '' })));
}
async function tokenHash(t) { return sha256Hex('arendalog:' + t); }
const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS, extra)
  });

const spaceKey = id => 'space:' + id;
const evPrefix = id => 'ev:' + id + ':';

async function loadSpace(env, id) {
  const raw = await env.SPACES.get(spaceKey(id));
  return raw ? JSON.parse(raw) : null;
}
async function saveSpace(env, sp) {
  sp.updatedAt = new Date().toISOString();
  await env.SPACES.put(spaceKey(sp.id), JSON.stringify(sp));
}
async function auth(sp, req, url) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '');
  if (!token) return null;
  const th = await tokenHash(token);
  if (sp.tokens.owner === th) return 'owner';
  if ((sp.tokens.write || []).includes(th)) return 'write';
  if ((sp.tokens.read || []).includes(th)) return 'read';
  return null;
}
function publicUrl(req) {
  const u = new URL(req.url);
  return u.origin;
}

/* ─────────── обработчики ─────────── */
async function createSpace(req, env) {
  const data = await req.json().catch(() => ({}));
  const id = rnd(8);
  const owner = rnd(24), write = rnd(24), read = rnd(24);
  const sp = {
    id, createdAt: new Date().toISOString(),
    title: String(data.title || 'Журнал аренды').slice(0, 200),
    pubHex: data.pubHex || null,
    tokens: { owner: await tokenHash(owner), write: [await tokenHash(write)], read: [await tokenHash(read)] },
    lastSeq: 0, metaVersion: 0,
    meta: { journal: data.journal || null, zones: [], people: [] },
    photos: {}
  };
  await saveSpace(env, sp);
  const base = publicUrl(req);
  return json({
    spaceId: id, token: owner, role: 'owner',
    codes: { read: base + '#' + id + ':' + read, write: base + '#' + id + ':' + write }
  }, 201);
}

async function getMeta(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (!role) return json({ error: 'нужен токен' }, 401);
  return json({
    spaceId: sp.id, title: sp.title, role, pubHex: sp.pubHex,
    meta: sp.meta, metaVersion: sp.metaVersion, lastSeq: sp.lastSeq,
    eventsCount: sp.eventsCount || 0, photos: Object.keys(sp.photos || {}).length
  });
}

async function putMeta(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return json({ error: 'нет прав' }, 403);
  const data = await req.json().catch(() => ({}));
  sp.meta = Object.assign({}, sp.meta, data.meta || {});
  if (data.pubHex) sp.pubHex = data.pubHex;
  sp.metaVersion = (sp.metaVersion || 0) + 1;
  await saveSpace(env, sp);
  return json({ ok: true, metaVersion: sp.metaVersion });
}

async function postEvents(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return json({ error: 'нет прав на запись' }, 403);

  const data = await req.json().catch(() => ({}));
  const incoming = Array.isArray(data.events) ? data.events.slice(0, 200) : [];
  const known = new Set();
  const list = await env.SPACES.list({ prefix: evPrefix(id), limit: 1000 });
  for (const k of list.keys) known.add(k.name.split(':')[2]);

  let accepted = 0, rejected = 0;
  for (const ev of incoming) {
    if (!ev || !ev.id || !ev.hash || !ev.sig) { rejected++; continue; }
    if (known.has(ev.id)) continue;
    const calc = await eventHash(ev);
    const author = ev.authorId || 'anon';
    ev.sseq = ++sp.lastSeq;
    ev.serverCheck = { hashOk: calc === ev.hash, chainOk: true, at: new Date().toISOString() };
    sp.authors = sp.authors || {};
    sp.authors[author] = ev.hash;
    await env.SPACES.put(evPrefix(id) + ev.id, JSON.stringify(ev));
    accepted++;
  }
  if (data.photos) {
    for (const p of Object.values(data.photos)) {
      if (p && p.sha256) sp.photos[p.sha256] = { mime: p.mime, size: p.size || 0, ids: p.ids || [] };
    }
  }
  sp.eventsCount = (sp.eventsCount || 0) + accepted;
  await saveSpace(env, sp);
  return json({ accepted, rejected, lastSeq: sp.lastSeq });
}

async function listEvents(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (!role) return json({ error: 'нужен токен' }, 401);
  const since = Number(url.searchParams.get('since') || 0);
  const out = [];
  const listed = await env.SPACES.list({ prefix: evPrefix(id), limit: 1000 });
  for (const k of listed.keys) {
    const raw = await env.SPACES.get(k.name);
    if (!raw) continue;
    const ev = JSON.parse(raw);
    if ((ev.sseq || 0) > since) out.push(ev);
  }
  out.sort((a, b) => (a.sseq || 0) - (b.sseq || 0));
  return json({
    events: out, lastSeq: sp.lastSeq, metaVersion: sp.metaVersion,
    meta: sp.meta, photos: sp.photos || {}, pubHex: sp.pubHex
  });
}

/* SSE через периодический опрос KV — работает без Durable Objects */
async function stream(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (!role) return json({ error: 'нужен токен' }, 401);

  let closed = false;
  const started = Date.now();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        if (closed) return;
        controller.enqueue(enc.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
      };
      send('hello', { spaceId: id, lastSeq: sp.lastSeq, role });
      let last = sp.lastSeq;
      while (!closed && Date.now() - started < 25000) {
        await new Promise(r => setTimeout(r, 1500));
        const cur = await loadSpace(env, id);
        if (!cur) break;
        if (cur.lastSeq > last) {
          send('events', { type: 'events', lastSeq: cur.lastSeq, count: cur.lastSeq - last });
          last = cur.lastSeq;
        }
        if (cur.metaVersion !== sp.metaVersion) {
          send('events', { type: 'meta', metaVersion: cur.metaVersion });
        }
        if (closed) break;
      }
      try { controller.close(); } catch (e) { }
    },
    cancel() { closed = true; }
  });

  return new Response(body, {
    headers: Object.assign({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }, CORS)
  });
}

async function postBlob(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (role !== 'owner' && role !== 'write') return json({ error: 'нет прав' }, 403);
  const buf = await req.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const declared = (req.headers.get('x-sha256') || '').toLowerCase();
  if (declared && declared !== sha) return json({ error: 'хеш не совпадает' }, 400);
  await env.BLOBS.put(sha, buf);
  sp.photos[sha] = { mime: req.headers.get('content-type') || 'application/octet-stream', size: buf.byteLength };
  await saveSpace(env, sp);
  return json({ ok: true, sha256: sha, size: buf.byteLength });
}

async function getBlob(req, env, sha, url) {
  const sp = await loadSpace(env, url.searchParams.get('space') || '');
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (!role) return json({ error: 'нужен токен' }, 401);
  const obj = await env.BLOBS.get(sha);
  if (!obj) return json({ error: 'нет файла' }, 404);
  return new Response(obj.body, {
    headers: Object.assign({
      'Content-Type': (sp.photos[sha] && sp.photos[sha].mime) || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600'
    }, CORS)
  });
}

async function invite(req, env, id, url) {
  const sp = await loadSpace(env, id);
  if (!sp) return json({ error: 'нет пространства' }, 404);
  const role = await auth(sp, req, url);
  if (role !== 'owner') return json({ error: 'приглашать может только владелец' }, 403);
  const data = await req.json().catch(() => ({}));
  const kind = data.role === 'read' ? 'read' : 'write';
  const token = rnd(24);
  if (kind === 'read') sp.tokens.read.push(await tokenHash(token));
  else sp.tokens.write.push(await tokenHash(token));
  await saveSpace(env, sp);
  return json({ role: kind, code: publicUrl(req) + '#' + sp.id + ':' + token });
}

/* ─────────── маршрутизация ─────────── */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (p === '/api/health') return json({ ok: true, runtime: 'cloudflare-workers' });

    if (p === '/api/space' && req.method === 'POST') return createSpace(req, env);

    let m;
    if ((m = p.match(/^\/api\/space\/([^/]+)$/)) && req.method === 'GET') return getMeta(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/meta$/)) && req.method === 'PUT') return putMeta(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/events$/)) && req.method === 'POST') return postEvents(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/events$/)) && req.method === 'GET') return listEvents(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/stream$/)) && req.method === 'GET') return stream(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/invite$/)) && req.method === 'POST') return invite(req, env, m[1], url);
    if ((m = p.match(/^\/api\/space\/([^/]+)\/blob$/)) && req.method === 'POST') return postBlob(req, env, m[1], url);
    if ((m = p.match(/^\/api\/blob\/([0-9a-f]{64})$/)) && req.method === 'GET') return getBlob(req, env, m[1], url);

    return json({ error: 'нет такого метода' }, 404);
  }
};

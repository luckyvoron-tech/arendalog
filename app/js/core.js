/* АрендаЛог — ядро: утилиты, хранилище, криптография, метки времени, ZIP */
(function (global) {
  'use strict';

  /* ══════════════════════ УТИЛИТЫ ══════════════════════ */
  const U = {
    uid() {
      const b = crypto.getRandomValues(new Uint8Array(9));
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    },
    nowISO() { return new Date().toISOString(); },
    pad(n) { return String(n).padStart(2, '0'); },
    fmtDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return '—';
      return `${U.pad(d.getDate())}.${U.pad(d.getMonth() + 1)}.${d.getFullYear()} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
    },
    fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return isNaN(d) ? '—' : `${U.pad(d.getDate())}.${U.pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    },
    money(v) {
      const n = Number(v || 0);
      return n.toLocaleString('ru-RU') + ' ₽';
    },
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    /* канонический JSON: ключи отсортированы, без пробелов */
    canonical(v) {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(U.canonical).join(',') + ']';
      const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + U.canonical(v[k])).join(',') + '}';
    },
    bytesToHex(b) {
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    },
    hexToBytes(h) {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
      return out;
    },
    b64(bytes) {
      let s = '';
      const b = new Uint8Array(bytes);
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s);
    },
    unb64(str) {
      const s = atob(str || '');
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
    async sha256Hex(data) {
      const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const d = await crypto.subtle.digest('SHA-256', buf);
      return U.bytesToHex(new Uint8Array(d));
    },
    debounce(fn, ms) {
      let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    }
  };

  /* ══════════════════════ INDEXEDDB ══════════════════════ */
  const DB = {
    _p: null,
    open() {
      if (DB._p) return DB._p;
      DB._p = new Promise((resolve, reject) => {
        const req = indexedDB.open('arendalog', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('journals')) db.createObjectStore('journals', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('events')) {
            const s = db.createObjectStore('events', { keyPath: 'id' });
            s.createIndex('journalId', 'journalId');
          }
          if (!db.objectStoreNames.contains('photos')) {
            const s = db.createObjectStore('photos', { keyPath: 'id' });
            s.createIndex('journalId', 'journalId');
          }
          if (!db.objectStoreNames.contains('handovers')) {
            const s = db.createObjectStore('handovers', { keyPath: 'id' });
            s.createIndex('journalId', 'journalId');
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'k' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return DB._p;
    },
    async _tx(store, mode, fn) {
      const db = await DB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const os = tx.objectStore(store);
        let out;
        try { out = fn(os); } catch (e) { reject(e); return; }
        tx.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async get(store, key) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const r = db.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async put(store, val) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val);
        tx.oncomplete = () => res(val);
        tx.onerror = () => rej(tx.error);
      });
    },
    async del(store, key) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      });
    },
    async all(store) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    },
    async byIndex(store, index, val) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const r = db.transaction(store).objectStore(store).index(index).getAll(val);
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    },
    async set(k, v) { return DB.put('settings', { k, v }); },
    async getSet(k, def) { const r = await DB.get('settings', k); return r ? r.v : def; },
    async clearAll() {
      const db = await DB.open();
      for (const s of ['journals', 'events', 'photos', 'handovers', 'settings']) {
        await new Promise((res, rej) => {
          const tx = db.transaction(s, 'readwrite');
          tx.objectStore(s).clear();
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
    }
  };

  /* ══════════════════════ КРИПТОГРАФИЯ ══════════════════════ */
  const Crypto = {
    async ensureKeys() {
      const rec = await DB.get('settings', 'keypair');
      if (rec && rec.v && rec.v.pair) return rec.v;
      const kp = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
      );
      const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
      const pubHex = U.bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', spki)));
      const val = { pair: kp, pubHex, createdAt: U.nowISO() };
      await DB.put('settings', { k: 'keypair', v: val });
      return val;
    },
    async signHex(hex) {
      const rec = await Crypto.ensureKeys();
      const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, rec.pair.privateKey, U.hexToBytes(hex)
      );
      return U.b64(new Uint8Array(sig));
    },
    async verifyHex(hex, sigB64) {
      try {
        const rec = await Crypto.ensureKeys();
        return await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' }, rec.pair.publicKey,
          U.unb64(sigB64), U.hexToBytes(hex)
        );
      } catch (e) { return false; }
    },
    async publicJwk() {
      const rec = await Crypto.ensureKeys();
      return crypto.subtle.exportKey('jwk', rec.pair.publicKey);
    },
    /* проверка подписи чужим открытым ключом (импортированный журнал) */
    async verifyWith(jwk, hex, sigB64) {
      try {
        const key = await crypto.subtle.importKey(
          'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
        );
        return await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' }, key, U.unb64(sigB64), U.hexToBytes(hex)
        );
      } catch (e) { return false; }
    }
  };

  /* ══════════════════════ ASN.1 / RFC 3161 ══════════════════════ */
  const Asn = {
    len(n) {
      if (n < 0x80) return [n];
      const b = [];
      while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
      return [0x80 | b.length].concat(b);
    },
    tlv(tag, content) {
      const c = content instanceof Uint8Array ? content : new Uint8Array(content);
      return new Uint8Array([tag].concat(Asn.len(c.length), Array.from(c)));
    },
    int(n) {
      const bytes = [];
      let v = n;
      do { bytes.unshift(v & 0xff); v >>= 8; } while (v > 0);
      if (bytes[0] & 0x80) bytes.unshift(0);
      return Asn.tlv(0x02, bytes);
    },
    oid(str) {
      const parts = str.split('.').map(Number);
      const out = [parts[0] * 40 + parts[1]];
      for (let i = 2; i < parts.length; i++) {
        let v = parts[i];
        const stack = [v & 0x7f];
        v >>= 7;
        while (v > 0) { stack.unshift(0x80 | (v & 0x7f)); v >>= 7; }
        out.push(...stack);
      }
      return Asn.tlv(0x06, out);
    },
    nullv() { return new Uint8Array([0x05, 0x00]); },
    octet(bytes) { return Asn.tlv(0x04, bytes); },
    seq(list) {
      const flat = [];
      for (const item of list) for (const b of item) flat.push(b);
      return Asn.tlv(0x30, flat);
    },
    /* TimeStampReq (RFC 3161) для уже посчитанного SHA-256 */
    timestampRequest(hashBytes) {
      const algId = Asn.seq([Asn.oid('2.16.840.1.101.3.4.2.1'), Asn.nullv()]);
      const imprint = Asn.seq([algId, Asn.octet(hashBytes)]);
      const bool = Asn.tlv(0x01, [0xff]); // certReq = TRUE
      return Asn.seq([Asn.int(1), imprint, bool]);
    }
  };

  const TSA = {
    /* извлекает время из токена ответа (GeneralizedTime) */
    extractTime(tokenBytes) {
      let s = '';
      for (let i = 0; i < tokenBytes.length; i++) s += String.fromCharCode(tokenBytes[i]);
      const m = s.match(/(\d{14})(?:\.\d+)?Z/);
      if (!m) return null;
      const t = m[1];
      return `${t.substr(0, 4)}-${t.substr(4, 2)}-${t.substr(6, 2)}T${t.substr(8, 2)}:${t.substr(10, 2)}:${t.substr(12, 2)}Z`;
    },
    async stamp(hashHex, tsaUrl) {
      const der = Asn.timestampRequest(U.hexToBytes(hashHex));
      const bodyB64 = U.b64(der);
      const out = await Bridge.postBinary(tsaUrl, bodyB64, 'application/timestamp-query', 'application/timestamp-reply');
      if (!out || !out.ok) throw new Error(out && out.error ? out.error : 'TSA недоступен');
      const token = U.unb64(out.bodyB64);
      const genTime = TSA.extractTime(token);
      if (!genTime) throw new Error('ответ TSA не распознан');
      return { token: out.bodyB64, time: genTime, tsa: tsaUrl, receivedAt: U.nowISO() };
    }
  };

  /* ══════════════════════ МОСТ С ANDROID ══════════════════════ */
  const Bridge = {
    get native() { return (typeof window !== 'undefined' && window.AndroidBridge) ? window.AndroidBridge : null; },
    isNative() { return !!Bridge.native; },
    async postBinary(url, b64, contentType, accept) {
      const n = Bridge.native;
      if (n && n.postBinary) {
        try {
          const raw = n.postBinary(url, b64, contentType || 'application/timestamp-query');
          const res = JSON.parse(raw);
          return res;
        } catch (e) { return { ok: false, error: 'мост: ' + e.message }; }
      }
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': contentType || 'application/timestamp-query', 'Accept': accept || 'application/timestamp-reply' },
          body: U.unb64(b64)
        });
        if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
        const buf = new Uint8Array(await resp.arrayBuffer());
        return { ok: true, bodyB64: U.b64(buf) };
      } catch (e) {
        return { ok: false, error: 'сеть/CORS: ' + e.message };
      }
    },
    async serverTime() {
      const n = Bridge.native;
      if (n && n.serverTime) {
        try { const t = Number(n.serverTime()); if (t > 1e12) return t; } catch (e) { /* ignore */ }
      }
      try {
        const r = await fetch('https://www.google.com/generate_204', { method: 'HEAD', mode: 'no-cors' });
        return Date.now();
      } catch (e) { return 0; }
    },
    async saveFile(name, b64, mime) {
      const n = Bridge.native;
      if (n && n.saveFile) {
        try { return JSON.parse(n.saveFile(name, b64, mime || 'application/octet-stream')); }
        catch (e) { return { ok: false, error: e.message }; }
      }
      try {
        const blob = new Blob([U.unb64(b64)], { type: mime || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return { ok: true, path: name };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    print() {
      const n = Bridge.native;
      if (n && n.printPage) { try { n.printPage(); return true; } catch (e) { /* fallthrough */ } }
      window.print();
      return false;
    },
    vibrate(ms) {
      const n = Bridge.native;
      if (n && n.vibrate) { try { n.vibrate(ms || 20); return; } catch (e) { /* ignore */ } }
      if (navigator.vibrate) navigator.vibrate(ms || 20);
    },
    deviceInfo() {
      const n = Bridge.native;
      if (n && n.deviceInfo) { try { return JSON.parse(n.deviceInfo()); } catch (e) { /* ignore */ } }
      return { model: 'браузер', android: navigator.userAgent };
    },
    serverDateHeader(url) {
      const n = Bridge.native;
      if (n && n.headUrl) {
        try { return JSON.parse(n.headUrl(url)); } catch (e) { return null; }
      }
      return null;
    }
  };

  /* ══════════════════════ ZIP (без сжатия) ══════════════════════ */
  const Zip = (function () {
    let table = null;
    function crc32(bytes) {
      if (!table) {
        table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
          table[n] = c >>> 0;
        }
      }
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    function enc(str) { return new TextEncoder().encode(str); }
    function dosTime(d) {
      const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
      const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
      return { time, date };
    }
    /* files: [{name, bytes}] → Blob */
    function build(files) {
      const chunks = [];
      const central = [];
      let offset = 0;
      const now = new Date();
      const dt = dosTime(now);
      for (const f of files) {
        const name = enc(f.name);
        const data = f.bytes instanceof Uint8Array ? f.bytes : enc(String(f.bytes));
        const crc = crc32(data);
        const local = new Uint8Array(30 + name.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 0, true);
        dv.setUint16(8, 0, true);
        dv.setUint16(10, dt.time, true);
        dv.setUint16(12, dt.date, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, name.length, true);
        dv.setUint16(28, 0, true);
        local.set(name, 30);
        chunks.push(local, data);

        const cen = new Uint8Array(46 + name.length);
        const cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, dt.time, true);
        cv.setUint16(14, dt.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cen.set(name, 46);
        central.push(cen);
        offset += local.length + data.length;
      }
      let cenSize = 0;
      for (const c of central) cenSize += c.length;
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, central.length, true);
      ev.setUint16(10, central.length, true);
      ev.setUint32(12, cenSize, true);
      ev.setUint32(16, offset, true);
      return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
    }
    return { build };
  })();

  /* ══════════════════════ СЖАТИЕ ФОТО ══════════════════════ */
  async function compressImage(file, maxSide) {
    maxSide = maxSide || 1600;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    return { blob, w, h };
  }

  global.AL = { U, DB, Crypto, Asn, TSA, Bridge, Zip, compressImage };
})(window);

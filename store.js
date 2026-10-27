/*
 * 区域訪問管理 — データと通信
 *   端末への保存（IndexedDB と localStorage の二重）、送信待ちの列、自動送信、
 *   区域データの読み込み、家・部屋ごとの状態の計算、地図の保存、お試し版のサーバー
 */
(function () {
  'use strict';
  const K = (window.K = window.K || {});
  K.VERSION = '0.12.0';

  K.cfg = Object.assign({
    gasUrl: '',                 // GASウェブアプリのURL（…/exec）。空ならお試し版だけ使える
    appUrl: '',                 // 利用カードのQRに入れるURL。空なら今開いているURL
    tileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    photoUrl: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    tileBounds: null,           // [[南,西],[北,東]] 地図を読む範囲を絞るとき
    basemapUrl: 'basemap/',     // 保存した地図（国土地理院のデータから前もって作った下地）の置き場所
    basemapOnly: false,         // true：国土地理院の地図を使わず、保存した地図だけを使う
    saveTiles: true,            // 担当区域の地図を端末に保存する（保存した地図を保存する）
    tileCache: 'kuiki-tiles-v2',
    demo: true,                 // お試し版を選べるようにする
    dataUrl: 'data/territories.json',
    demoBuildingsUrl: 'data/demo-buildings.json',
    backendUrl: 'gas/Code.gs',
    serviceWorker: true,
    canPrint: true,
  }, window.KUIKI_CONFIG || {});

  /* ---------- 小さな道具 ---------- */
  const listeners = {};
  K.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  K.emit = (ev, data) => { (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };
  K.sleep = ms => new Promise(r => setTimeout(r, ms));
  K.uid = function (prefix) {
    let rnd = '';
    try {
      const a = new Uint32Array(2); crypto.getRandomValues(a);
      rnd = a[0].toString(36) + a[1].toString(36);
    } catch (e) { rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    return (prefix || 'r') + '-' + Date.now().toString(36) + '-' + rnd.slice(0, 10);
  };
  K.normKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  K.fmtKey = k => K.normKey(k).replace(/(.{4})(?=.)/g, '$1-');
  function mkErr(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }
  function netErr(msg) { return mkErr('', msg || '電波がないか、つながりにくい状態です', { net: true }); }
  K.mkErr = mkErr;

  let chain = Promise.resolve();
  K.lock = function (fn) { const p = chain.then(() => fn()); chain = p.catch(() => {}); return p; };

  /* ---------- 端末への保存 ---------- */
  const LS = 'kuiki.';
  const mem = {};
  function lsGet(k) {
    try { const s = localStorage.getItem(LS + k); if (s !== null) return JSON.parse(s); } catch (e) { /* 使えない環境 */ }
    return mem[k];
  }
  function lsSet(k, v) {
    mem[k] = v;
    try { if (v === undefined) localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* 容量不足など */ }
  }
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const rq = indexedDB.open('kuiki', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
        rq.onblocked = () => resolve(null);
        setTimeout(() => resolve(null), 3000);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  K.kv = {
    async get(k) {
      const db = await idb();
      if (!db) return lsGet(k);
      return new Promise(resolve => {
        try {
          const rq = db.transaction('kv').objectStore('kv').get(k);
          rq.onsuccess = () => resolve(rq.result === undefined ? lsGet(k) : rq.result);
          rq.onerror = () => resolve(lsGet(k));
        } catch (e) { resolve(lsGet(k)); }
      });
    },
    async set(k, v) {
      lsSet(k, v);
      const db = await idb();
      if (!db) return;
      return new Promise(resolve => {
        try {
          const tx = db.transaction('kv', 'readwrite');
          if (v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
          tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
        } catch (e) { resolve(); }
      });
    },
    where: async function () { return (await idb()) ? 'IndexedDB と localStorage' : 'localStorage だけ'; },
  };

  K.state = { key: '', demo: false, me: null, outbox: [], sent: [], failed: [], savedMaps: {}, lastSync: '' };
  K.load = async function () {
    const s = K.state;
    s.key = (await K.kv.get('key')) || '';
    s.demo = !!(await K.kv.get('demo'));
    s.me = (await K.kv.get('me')) || null;
    s.outbox = (await K.kv.get('outbox')) || [];
    s.sent = (await K.kv.get('sent')) || [];
    s.failed = (await K.kv.get('failed')) || [];
    s.savedMaps = (await K.kv.get('savedMaps')) || {};
    s.lastSync = (await K.kv.get('lastSync')) || '';
    s.keyFrom = (await K.kv.get('keyFrom')) || '';
  };
  K.setKey = async function (key, demo, from) {
    const s = K.state;
    const changed = s.key && K.normKey(key) !== s.key;
    s.key = K.normKey(key); s.demo = !!demo; s.keyFrom = from || '';
    if (changed) { s.me = null; s.sent = []; await K.kv.set('me', null); await K.kv.set('sent', []); }
    await K.kv.set('key', s.key); await K.kv.set('demo', s.demo); await K.kv.set('keyFrom', s.keyFrom);
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* なくてもよい */ }
  };
  K.forget = async function () {
    const s = K.state;
    Object.assign(s, { key: '', demo: false, me: null, outbox: [], sent: [], failed: [] });
    for (const k of ['key', 'demo', 'me', 'outbox', 'sent', 'failed', 'keyFrom']) await K.kv.set(k, undefined);
  };

  /* ---------- 通信 ---------- */
  K.net = { get online() { return K.state.demo ? !K.demo.offline : navigator.onLine !== false; } };
  K.api = {
    async call(action, payload) {
      const body = Object.assign({ action: action, key: K.state.key || '' }, payload || {});
      if (K.state.demo) return K.demo.call(body);
      if (!K.cfg.gasUrl) throw mkErr('NO_SERVER', 'サーバーのアドレスがまだ設定されていません（js/config.js の gasUrl）');
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 30000);
      let res;
      try {
        res = await fetch(K.cfg.gasUrl, {
          method: 'POST', body: JSON.stringify(body), redirect: 'follow', cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (e) { throw netErr(); } finally { clearTimeout(timer); }
      if (!res.ok) throw netErr('サーバーから返事がありませんでした（' + res.status + '）');
      let j;
      try { j = await res.json(); } catch (e) { throw netErr('サーバーの返事が読めませんでした'); }
      if (!j.ok) throw mkErr(j.error || 'SERVER', j.message || 'うまくいきませんでした');
      return j;
    },
  };

  /** 自分のカードと記録を取り直す */
  K.refresh = async function () {
    const started = Date.now();
    const me = await K.api.call('me');
    me.fetchedAt = new Date().toISOString();
    const bm = K.basemap.useGsi();
    K.state.me = me;
    await K.kv.set('me', me);
    K.applyEdits();
    if (K.basemap.useGsi() !== bm) K.basemap.changed();
    await K.lock(async () => {
      K.state.sent = K.state.sent.filter(o => o.sentAt > started);
      await K.kv.set('sent', K.state.sent);
    });
    K.emit('data');
    return me;
  };

  /* ---------- 送信待ちの列 ---------- */
  K.enqueue = async function (op) {
    op.id = op.id || K.uid(op.type === 'void' ? 'v' : op.type === 'return' ? 'ret' : 'r');
    op.at = op.at || new Date().toISOString();
    op.by = (K.state.me && K.state.me.user && K.state.me.user.id) || '';
    await K.lock(async () => {
      K.state.outbox.push(op);
      await K.kv.set('outbox', K.state.outbox);
    });
    if (op.type === 'report' && op.lat !== undefined && op.lat !== null) K.applyEdits();
    K.emit('data');
    K.sync.kick(400);
    return op;
  };
  /** まだ送っていなければ、手元の列から消すだけで取り消せる */
  K.unqueue = async function (id) {
    if (K.sync.inflight.has(id)) return false;
    let removed = false;
    await K.lock(async () => {
      const n = K.state.outbox.length;
      K.state.outbox = K.state.outbox.filter(o => o.id !== id);
      removed = K.state.outbox.length < n;
      if (removed) await K.kv.set('outbox', K.state.outbox);
    });
    if (removed) K.emit('data');
    return removed;
  };

  K.sync = {
    busy: false, timer: null, failCount: 0, lastError: null, inflight: new Set(), again: false,
    kick(delay) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), delay || 0); },
    schedule() {
      const base = Math.min(120000, 5000 * Math.pow(2, Math.min(this.failCount, 5)));
      this.kick(base * (0.7 + Math.random() * 0.6)); // 一斉に送り直さないよう、間隔をずらす
    },
    async run() {
      if (this.busy) { this.again = true; return; }
      if (!K.state.key || !K.state.outbox.length) return;
      if (!K.net.online) { this.schedule(); K.emit('sync'); return; }
      this.busy = true;
      K.emit('sync');
      let pushed = false;
      try {
        for (let round = 0; round < 20 && K.state.outbox.length; round++) {
          const batch = K.state.outbox.slice(0, 100);
          batch.forEach(o => this.inflight.add(o.id));
          const r = await K.api.call('push', { ops: batch });
          const byId = {};
          (r.results || []).forEach(x => { byId[x.id] = x; });
          const now = Date.now();
          let progressed = 0;
          await K.lock(async () => {
            const done = new Set();
            batch.forEach(o => {
              const x = byId[o.id];
              if (!x) return;
              if (x.ok) { done.add(o.id); K.state.sent.push(Object.assign({}, o, { sentAt: now })); }
              else if (!x.retry) { done.add(o.id); K.state.failed.push(Object.assign({}, o, { error: x.error, message: x.message, failedAt: now })); }
            });
            progressed = done.size;
            K.state.outbox = K.state.outbox.filter(o => !done.has(o.id));
            await K.kv.set('outbox', K.state.outbox);
            await K.kv.set('sent', K.state.sent);
            await K.kv.set('failed', K.state.failed.slice(-200));
          });
          batch.forEach(o => this.inflight.delete(o.id));
          pushed = true;
          if (!progressed) throw mkErr('NO_PROGRESS', 'サーバーが記録を受け取れませんでした', { net: true });
        }
        this.failCount = 0;
        this.lastError = null;
        K.state.lastSync = new Date().toISOString();
        await K.kv.set('lastSync', K.state.lastSync);
      } catch (e) {
        this.inflight.clear();
        this.lastError = e;
        this.failCount++;
        if (e.code === 'BAD_KEY' || e.code === 'STOPPED') K.emit('auth', e);
        else this.schedule();
      } finally {
        this.busy = false;
        K.emit('sync');
        K.emit('data');
      }
      if (pushed) { try { await K.refresh(); } catch (e) { /* あとで取り直す */ } }
      if (this.again) { this.again = false; this.kick(300); }
    },
  };

  /* ---------- 区域データ（戸建て） ---------- */
  K.loadGeo = async function () {
    if (K.geo) return K.geo;
    const res = await fetch(K.cfg.dataUrl);
    if (!res.ok) throw new Error('区域のデータを読めませんでした');
    const d = await res.json();
    const terr = {}, block = {}, house = {}, byBlock = {}, byTerr = {};
    d.territories.forEach((t, i) => { t.i = i; t.base = { blocks: t.blocks.slice(), no: t.no, town: t.town, bb: t.bb, c: t.c, houses: t.houses }; terr[t.id] = t; byTerr[t.id] = []; });
    Object.keys(d.blocks).forEach(id => { block[id] = Object.assign({ id: id }, d.blocks[id]); block[id].t0 = block[id].t; byBlock[id] = []; });
    d.houses.forEach(h => {
      const o = { id: h[0], b: h[1], lat: h[2], lon: h[3], lat0: h[2], lon0: h[3], big: h[4] === 1, maybe: h[4] === 2 };
      house[o.id] = o;
      if (byBlock[o.b]) byBlock[o.b].push(o);
    });
    d.territories.forEach(t => {
      let n = 0;
      t.blocks.forEach((bid, i) => {
        block[bid].n = i + 1;
        block[bid].t = t.id;
        byBlock[bid].forEach(h => { h.t = t.id; if (!h.big) h.n = ++n; byTerr[t.id].push(h); });
      });
      t.baseN = n;
    });
    Object.keys(block).forEach(id => {
      let s = 90, w = 180, n = -90, e = -180;
      block[id].poly.forEach(p => p[0].forEach(q => { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }));
      block[id].bb = [s, w, n, e];
    });
    K.geo = { version: d.version, attribution: d.attribution, terr, block, house, byBlock, byTerr, list: d.territories, baseList: d.territories.slice(), overlay: [], moved: [] };
    K.applyEdits();
    return K.geo;
  };

  /* ---------- 区切りの手直し（0.12.0）：元の区域の区切りに、スプレッドシートの手直しを重ねる ---------- */
  /** 効いている区切りの手直し（古い順）。管理画面で読んだものがあれば、それを優先する */
  K.boundaryEdits = function () {
    const src = (K.adminData && K.adminData.boundaryEdits) || (K.state.me && K.state.me.boundaryEdits) || [];
    return src.filter(e => !e.off);
  };
  function bbOf(points) {
    let s = 90, w = 180, n = -90, e = -180;
    points.forEach(q => { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); });
    return s <= n ? [s, w, n, e] : null;
  }
  /** 区切りを元に戻してから、手直しを古い順に当てる。区域の家の並び（番号）と数、範囲も数え直す */
  function applyBounds(g) {
    g.list = g.baseList.slice();
    Object.keys(g.terr).forEach(id => {
      const t = g.terr[id];
      if (t.created) { delete g.terr[id]; delete g.byTerr[id]; return; }
      t.blocks = t.base.blocks.slice(); t.no = t.base.no; t.town = t.base.town; t.off = false; t.renamed = false;
    });
    Object.keys(g.block).forEach(id => {
      const b = g.block[id];
      if (b.added) { delete g.block[id]; delete g.byBlock[id]; } else b.t = b.t0;
    });
    Object.keys(g.house).forEach(id => { delete g.house[id].tOver; });
    K.boundaryEdits().forEach(e => {
      const to = g.terr[e.to];
      if (e.type === '区域を作る') {
        if (g.terr[e.targetId]) return;
        const t = { id: e.targetId, no: e.no, town: e.town, city: '', parent: 0, houses: 0, blocks: [], c: null, bb: null, created: true, i: g.list.length, editId: e.id };
        g.terr[t.id] = t; g.list.push(t);
      } else if (e.type === 'ブロックを足す') {
        if (!to || !e.shape || e.shape.length < 3 || g.block[e.targetId]) return;
        const ring = e.shape.map(p => [Number(p[0]), Number(p[1])]);
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0].slice());
        const b = { id: e.targetId, poly: [[ring]], t: to.id, t0: to.id, town: e.town || to.town, added: true, editId: e.id, bb: bbOf(ring) };
        g.block[b.id] = b; g.byBlock[b.id] = []; to.blocks.push(b.id);
      } else if (e.type === 'ブロックを移す') {
        const b = g.block[e.targetId];
        if (!b || !to) return;
        const from = g.terr[b.t];
        if (from) { const i = from.blocks.indexOf(b.id); if (i >= 0) from.blocks.splice(i, 1); }
        if (to.blocks.indexOf(b.id) < 0) to.blocks.push(b.id);
        b.t = to.id;
      } else if (e.type === '家を移す') {
        const h = g.house[e.targetId];
        if (!h || !to) return;
        h.tOver = to.id;
      } else if (e.type === '区域を外す') {
        if (g.terr[e.targetId]) g.terr[e.targetId].off = true;
      } else if (e.type === '番号を変える') {
        const t = g.terr[e.targetId];
        if (!t) return;
        t.no = e.no || t.no; if (e.town) t.town = e.town; t.renamed = !!t.base && (t.no !== t.base.no || t.town !== (t.base.town || ''));
      }
    });
    // 家の並びと番号：区域のブロックの順 → ブロックの中の順。別の区域に移した家は、その区域の最後に続ける
    const count = {};
    const later = [];
    g.list.forEach(t => { g.byTerr[t.id] = []; count[t.id] = 0; });
    g.list.forEach(t => {
      t.blocks.forEach((bid, i) => {
        const b = g.block[bid];
        if (!b) return;
        b.n = i + 1; b.t = t.id;
        (g.byBlock[bid] || []).forEach(h => {
          if (h.tOver && h.tOver !== t.id && g.terr[h.tOver]) { later.push(h); return; }
          h.t = t.id; h.n = h.big ? undefined : ++count[t.id]; g.byTerr[t.id].push(h);
        });
      });
    });
    later.forEach(h => { h.t = h.tOver; h.n = h.big ? undefined : ++count[h.t]; g.byTerr[h.t].push(h); });
    g.list.forEach(t => {
      t.baseN = count[t.id];
      const live = g.byTerr[t.id].filter(h => !h.big).length;
      t.liveHouses = live;
      t.houses = t.off ? 0 : live;
      const changed = t.created || t.blocks.length !== t.base.blocks.length || t.blocks.some((b, i) => b !== t.base.blocks[i]) || g.byTerr[t.id].some(h => h.tOver);
      if (!changed && t.base.bb) { t.bb = t.base.bb; t.c = t.base.c; return; }
      const pts = [];
      t.blocks.forEach(bid => { const b = g.block[bid]; if (b && b.bb) { pts.push([b.bb[0], b.bb[1]]); pts.push([b.bb[2], b.bb[3]]); } });
      g.byTerr[t.id].forEach(h => pts.push([h.lat, h.lon]));
      t.bb = bbOf(pts);
      t.c = t.bb ? [(t.bb[0] + t.bb[2]) / 2, (t.bb[1] + t.bb[3]) / 2] : null;
    });
  }
  /** 手直しで変わった区域（区切り・番号・外した）。管理の画面の印に使う */
  K.boundsChanged = function (t) { return !!(t.created || t.off || t.renamed || (t.base && (t.blocks.length !== t.base.blocks.length || t.blocks.some((b, i) => b !== t.base.blocks[i]))) || (K.geo.byTerr[t.id] || []).some(h => h.tOver)); };

  /* ---------- 地図の手直し（元のデータに、スプレッドシートの手直しを重ねる） ---------- */
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  K.inPoly = (pt, multi) => multi.some(poly => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h)));
  /** その場所のブロック。tid があれば、その区域のブロックから先に探す */
  K.blockAt = function (lat, lon, tid) {
    const g = K.geo;
    if (!g) return null;
    const hit = id => { const b = g.block[id]; return b && lat >= b.bb[0] && lat <= b.bb[2] && lon >= b.bb[1] && lon <= b.bb[3] && K.inPoly([lat, lon], b.poly); };
    if (tid && g.terr[tid]) { const f = g.terr[tid].blocks.find(hit); if (f) return f; }
    return Object.keys(g.block).find(hit) || null;
  };
  /** 地図に効く手直し（有効な「足す」「動かす」）。一般の人の分と管理画面の分をまとめる */
  K.houseEdits = function () {
    const out = new Map();
    const take = list => (list || []).forEach(e => { if (!e.off && (e.type === '足す' || e.type === '動かす')) out.set(e.id, e); });
    take(K.state.me && K.state.me.houseEdits);
    if (K.adminData && K.adminData.houseEdits) {
      const all = new Map(K.adminData.houseEdits.map(e => [e.id, e]));
      take(K.adminData.houseEdits);
      out.forEach((e, id) => { const a = all.get(id); if (a && a.off) out.delete(id); });
    }
    return Array.from(out.values());
  };
  /** 仮の家：「地図にない家」の知らせで、まだ確かめていないもの（サーバーの分と、この端末から送った分） */
  K.provisionalList = function () {
    const s = K.state;
    const out = new Map();
    ((s.me && s.me.provisional) || []).forEach(p => out.set(p.houseId, p));
    s.sent.concat(s.outbox).forEach(o => {
      if (o.type !== 'report' || o.lat === undefined || o.lat === null || String(o.note || '').indexOf('地図にない家') !== 0) return;
      const id = 'n-' + o.id;
      if (!out.has(id)) out.set(id, { houseId: id, reportId: o.id, territoryId: o.territoryId, lat: o.lat, lon: o.lon, by: '' });
    });
    return Array.from(out.values());
  };
  /** 元のデータに手直しを重ね直す（足した家・動かした家・仮の家）。何度呼んでも同じになる */
  K.applyEdits = function () {
    const g = K.geo;
    if (!g) return;
    const drop = (arr, h) => { const i = arr ? arr.indexOf(h) : -1; if (i >= 0) arr.splice(i, 1); };
    g.overlay.forEach(h => { if (g.house[h.id] === h) delete g.house[h.id]; drop(g.byBlock[h.b], h); drop(g.byTerr[h.t], h); });
    g.moved.forEach(h => { h.lat = h.lat0; h.lon = h.lon0; delete h.moved; });
    g.overlay = []; g.moved = [];
    applyBounds(g);
    const next = {};
    const add = o => {
      if (g.house[o.id]) return null;
      const b = o.b && g.block[o.b] ? o.b : K.blockAt(o.lat, o.lon, o.t);
      if (!b) return null;
      o.b = b; o.t = g.block[b].t;
      if (!g.terr[o.t]) return null;
      next[o.t] = next[o.t] || g.terr[o.t].baseN || 0;
      o.n = ++next[o.t];
      o.big = false; o.maybe = false;
      g.house[o.id] = o; g.byBlock[b].push(o); g.byTerr[o.t].push(o); g.overlay.push(o);
      return o;
    };
    const edits = K.houseEdits();
    edits.filter(e => e.type === '足す' && e.lat !== null).forEach(e => add({ id: e.houseId, b: e.blockId, t: e.territoryId, lat: e.lat, lon: e.lon, added: true, editId: e.id, note: e.note }));
    edits.filter(e => e.type === '動かす' && e.lat !== null).forEach(e => {
      const h = g.house[e.houseId];
      if (!h) return;
      h.lat = e.lat; h.lon = e.lon; h.moveEditId = e.id;
      if (!h.added) { h.moved = true; g.moved.push(h); }
    });
    K.provisionalList().forEach(p => add({ id: p.houseId, t: p.territoryId, lat: p.lat, lon: p.lon, prov: true, reportId: p.reportId, by: p.by }));
  };

  /* ---------- 画面に出す形 ---------- */
  /** サーバーの記録＋送った記録＋送信待ちを1つにまとめ、取り消されたものを外す */
  K.records = function () {
    const s = K.state;
    const server = (s.me && s.me.records) || [];
    const local = s.sent.concat(s.outbox);
    const voided = new Set(local.filter(o => o.type === 'void').map(o => o.target));
    const pending = new Set(s.outbox.map(o => o.id));
    const out = [];
    const seen = new Set();
    server.forEach(r => { if (!voided.has(r.id) && !seen.has(r.id)) { seen.add(r.id); out.push(r); } });
    local.forEach(o => {
      if (o.type !== 'visit' || voided.has(o.id) || seen.has(o.id)) return;
      seen.add(o.id);
      out.push({ id: o.id, distId: o.distId, territoryId: o.territoryId, houseId: o.houseId || '', roomId: o.roomId || '', blockId: o.blockId || '',
        result: o.result, at: o.at, by: o.by, local: true, pending: pending.has(o.id) });
    });
    return out;
  };

  /** 建物（集合住宅）の一覧。管理画面で読んだものがあれば、それを優先する */
  K.buildings = function () {
    const src = (K.adminData && K.adminData.buildings) || (K.state.me && K.state.me.buildings) || [];
    const out = {};
    src.forEach(b => { out[b.id] = b; });
    return out;
  };
  K.houseStates = function () {
    return Object.assign({}, (K.state.me && K.state.me.houseStates) || {}, (K.adminData && K.adminData.houseStates) || {});
  };

  /* ---------- 回収日 ---------- */
  K.today = function (at) { const d = at ? new Date(at) : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  /** 完全回収日を過ぎたか（この端末の日付で。電波がなくても、過ぎたら記録できないようにする） */
  K.pastForced = c => !!(c && c.forced && c.forced < K.today());
  /**
   * 回収日の段階：none（日付なし）・ok・soon（知らせを出す）・grace（回収日を過ぎ、完全回収日まで）・gone（完全回収日を過ぎた）
   */
  K.dueInfo = function (c) {
    if (!c || !c.due) return { phase: 'none' };
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const days = s => { const p = String(s).split('-').map(Number); return Math.round((new Date(p[0], p[1] - 1, p[2]) - t) / 864e5); };
    const nd = (K.state.me && K.state.me.settings && K.state.me.settings.noticeDays) || 7;
    const dd = days(c.due), df = c.forced ? days(c.forced) : dd;
    const phase = df < 0 ? 'gone' : dd < 0 ? 'grace' : dd <= nd ? 'soon' : 'ok';
    return { phase: phase, dd: dd, df: df, gather: !!c.gatheringId };
  };
  /** 自動で回収された区域（サーバーで回収したもの＋この端末で完全回収日を過ぎたもの） */
  K.collectedCards = function () {
    const s = K.state;
    const local = ((s.me && s.me.cards) || []).filter(K.pastForced);
    const seen = new Set(local.map(c => c.distId));
    return local.concat(((s.me && s.me.collected) || []).filter(c => !seen.has(c.distId)));
  };

  /**
   * 返した・戻した操作（送った分と送信待ち）を順に見て、区域ごとに最後の操作を返す。
   * 'return'（返した）・'reopen'（元に戻した）
   */
  K.returnOps = function () {
    const s = K.state;
    const last = {};
    s.sent.concat(s.outbox).filter(o => o.type === 'return' || o.type === 'reopen')
      .forEach(o => { last[o.distId] = o; });
    return last;
  };
  /** 持っているカード（戸建ての区域と集合住宅） */
  K.cards = function () {
    const s = K.state;
    const ops = K.returnOps();
    const bs = K.buildings();
    const list = ((s.me && s.me.cards) || []).slice();
    // 返したあとに「元に戻す」を押した区域は、サーバーから戻る前でも出す
    const have = new Set(list.map(c => c.distId));
    ((s.me && s.me.returned) || []).forEach(c => { const o = ops[c.distId]; if (o && o.type === 'reopen' && !have.has(c.distId)) list.push(c); });
    return list.filter(c => !(ops[c.distId] && ops[c.distId].type === 'return') && !K.pastForced(c)).map(c => {
      const b = bs[c.territoryId];
      if (b) return Object.assign({}, c, { isBuilding: true, building: b });
      return K.geo && K.geo.terr[c.territoryId] ? c : null;
    }).filter(Boolean);
  };
  /** 自分で返した区域（「元に戻す」で戻せるもの）。この端末で今返した分も入れる */
  K.returnedCards = function () {
    const s = K.state;
    const ops = K.returnOps();
    const out = [];
    const seen = new Set();
    ((s.me && s.me.cards) || []).forEach(c => { const o = ops[c.distId]; if (o && o.type === 'return') { out.push(Object.assign({}, c, { returnedAt: K.today(o.at), canUndo: true, local: true })); seen.add(c.distId); } });
    ((s.me && s.me.returned) || []).forEach(c => { const o = ops[c.distId]; if (!seen.has(c.distId) && !(o && o.type === 'reopen')) out.push(c); });
    return out;
  };
  /** 回り方（R1・R2…）の一覧と名前 */
  K.routes = function () {
    return (K.adminData && K.adminData.routes) || (K.state.me && K.state.me.routes) || [
      { id: 'R1', name: 'マンション訪問', mode: '部屋ごと', per: 5, perB: 2, cycle: 90, active: true },
      { id: 'R2', name: '夕方のアパート', mode: '一棟まとめて', per: 5, perB: 2, cycle: 90, active: true }];
  };
  K.route = function (id) { return K.routes().find(r => r.id === id) || null; };
  /** 配布の種別を画面に出す名前（通常は空） */
  K.kindLabel = function (kind) {
    if (!kind || kind === '通常') return '';
    const r = K.route(kind);
    return r ? r.name : kind;
  };

  function latest(list, keyOf) {
    const h = {}, b = {};
    list.forEach(r => {
      const k = keyOf(r);
      if (k) { if (!h[k] || h[k].at <= r.at) h[k] = r; }
      else if (r.blockId && r.result === '済') { if (!b[r.blockId] || b[r.blockId].at <= r.at) b[r.blockId] = r; }
    });
    return { h, b };
  }
  const STATE_KIND = { '家': 'house', '家ではない': 'gone', '空き家': 'empty', '集合住宅': 'apt', '確認待ち': 'wait', 'なくなった': 'gone' };

  /** 建物の扱い：house（家）・wait（確認待ち）・apt（集合住宅）・empty（空き家）・gone（家ではない） */
  K.houseKind = function (h, states) {
    const ov = (states || K.houseStates())[h.id];
    if (ov) return { kind: STATE_KIND[ov.state] || 'house', buildingId: ov.buildingId || '' };
    return { kind: h.big ? 'wait' : 'house', buildingId: '' };
  };

  /** 戸建ての区域：家ごとの状態（未・会えた・不在・拒否・済） */
  K.cardState = function (card, recs) {
    recs = recs || K.records();
    const states = K.houseStates();
    const houses = K.geo.byTerr[card.territoryId] || [];
    const cur = recs.filter(r => r.distId === card.distId);
    const prev = card.prevDistId ? recs.filter(r => r.distId === card.prevDistId) : [];
    const C = latest(cur, r => r.houseId), P = latest(prev, r => r.houseId);
    const refused = new Set(card.refused || []);
    // 家の拒否は家ごと（区切りを直して家がほかの区域に移っても、拒否は家について回る）
    ((K.state.me && K.state.me.refusedHouses) || []).forEach(id => { const h = K.geo.house[id]; if (h && h.t === card.territoryId) refused.add(id); });
    cur.slice().sort((a, b) => (a.at < b.at ? -1 : 1)).forEach(r => {
      if (!r.houseId) return;
      if (r.result === '拒否') refused.add(r.houseId);
      else if (r.result === '拒否解除') refused.delete(r.houseId);
    });
    const absent = card.kind === '不在宅訪問';
    const counts = { '未': 0, '会えた': 0, '不在': 0, '拒否': 0, '済': 0 };
    let total = 0, done = 0;
    const map = {};
    const shown = [];
    houses.forEach(h => {
      const hk = K.houseKind(h, states);
      if (hk.kind === 'gone') return;
      const hr = C.h[h.id];
      let s = '未', rec = null;
      if (refused.has(h.id)) { s = '拒否'; rec = hr && hr.result === '拒否' ? hr : null; }
      else if (hr && hr.result !== '拒否解除') { s = hr.result; rec = hr; }
      else if (C.b[h.b]) { s = '済'; rec = C.b[h.b]; }
      let prevS = '';
      let target = hk.kind === 'house';
      if (absent && target) {
        const ph = P.h[h.id];
        prevS = ph && ph.result !== '拒否解除' ? ph.result : (P.b[h.b] ? '済' : '未');
        target = !refused.has(h.id) && (prevS === '未' || prevS === '不在');
      }
      map[h.id] = { h: h, kind: hk.kind, buildingId: hk.buildingId, s: s, rec: rec, target: target, prev: prevS, refused: refused.has(h.id) };
      shown.push(h);
      if (target) {
        total++; counts[s]++;
        if (s !== '未') done++;
      }
    });
    return { map, houses: shown, total, done, counts, absent, refused };
  };

  /** 集合住宅：部屋ごとの状態。入口ごと・階ごとに並べる */
  K.buildingState = function (card, recs) {
    recs = recs || K.records();
    const bid = card.territoryId;
    // 部屋ごとに配られたカードは、その部屋だけ
    const only = card.rooms && card.rooms.length ? new Set(card.rooms) : null;
    const rooms = ((K.state.me && K.state.me.rooms && K.state.me.rooms[bid]) || []).filter(r => r.active !== false && (!only || only.has(r.id)));
    const cur = recs.filter(r => r.distId === card.distId);
    const C = latest(cur, r => r.roomId);
    const refused = new Set(card.refused || []);
    cur.slice().sort((a, b) => (a.at < b.at ? -1 : 1)).forEach(r => {
      if (!r.roomId) return;
      if (r.result === '拒否') refused.add(r.roomId);
      else if (r.result === '拒否解除') refused.delete(r.roomId);
    });
    const counts = { '未': 0, '会えた': 0, '不在': 0, '拒否': 0, '済': 0 };
    let done = 0;
    const map = {};
    const ents = {};
    rooms.forEach(room => {
      const hr = C.h[room.id];
      const ek = bid + '#' + (room.entrance || '');
      let s = '未', rec = null;
      if (refused.has(room.id)) { s = '拒否'; rec = hr && hr.result === '拒否' ? hr : null; }
      else if (hr && hr.result !== '拒否解除') { s = hr.result; rec = hr; }
      else if (C.b[ek]) { s = '済'; rec = C.b[ek]; }
      map[room.id] = { room: room, s: s, rec: rec, refused: refused.has(room.id) };
      counts[s]++;
      if (s !== '未') done++;
      const e = ents[room.entrance || ''] = ents[room.entrance || ''] || { entrance: room.entrance || '', key: ek, floors: {} };
      (e.floors[room.floor] = e.floors[room.floor] || []).push(room);
    });
    const entrances = Object.keys(ents).sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || (a < b ? -1 : 1)).map(k => {
      const e = ents[k];
      e.floorList = Object.keys(e.floors).map(Number).sort((a, b) => b - a).map(f => ({ floor: f, rooms: e.floors[f] }));
      return e;
    });
    return { map, rooms, entrances, total: rooms.length, done, counts };
  };

  /* ---------- 地図の下地：国土地理院の地図と、保存した地図 ----------
   * 保存した地図：国土地理院のベクトルタイル（提供実験）から前もって作った絵（app/basemap/）。
   *   アプリと同じ所（GitHub Pages）に置くので、国土地理院が地図の公開をやめても出る。
   * ふだんは国土地理院の地図を出し、読めないタイルは保存した地図で埋める。
   * 続けて読めないときは、しばらく保存した地図だけにする（設定で「保存した地図」にすると、いつもこちら）。 */
  K.basemap = {
    meta: null, metaP: null, done: false,
    packs: new Map(), order: [], MAX_PACKS: 8,
    fails: 0, downUntil: 0, DOWN_MIN: 30, layers: new Set(), told: false,
    init() {
      if (this.metaP) return this.metaP;
      try { this.downUntil = Number(localStorage.getItem('kuiki.gsiDown')) || 0; } catch (e) { this.downUntil = 0; }
      this.metaP = fetch(K.cfg.basemapUrl + 'meta.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : null))
        .then(m => (m && m.packs ? m : null))
        .catch(() => null)
        .then(m => { this.meta = m; this.done = true; this.changed(); return m; });
      return this.metaP;
    },
    /** 設定（上位管理者が決める）：「国土地理院」または「保存した地図」 */
    setting() {
      const a = K.adminData && K.adminData.settings, m = K.state.me && K.state.me.settings;
      const v = (a && a.basemap) || (m && m.basemap);
      return v === '保存した地図' ? '保存した地図' : '国土地理院';
    },
    /** 今、国土地理院の地図を使うか（使わないときは保存した地図） */
    useGsi() {
      if (this.done && !this.meta) return !!K.cfg.tileUrl;       // 保存した地図が置かれていない
      if (K.cfg.basemapOnly || !K.cfg.tileUrl) return false;
      if (this.setting() === '保存した地図') return false;
      if (this.offline()) return false;
      if (this.downUntil > Date.now()) return false;
      return true;
    },
    /** 今の下地の説明（設定と確認の画面・管理の画面） */
    why() {
      if (this.done && !this.meta) return '国土地理院の地図（保存した地図は置かれていません）';
      if (K.cfg.basemapOnly || !K.cfg.tileUrl) return '保存した地図';
      if (this.setting() === '保存した地図') return '保存した地図（設定）';
      if (this.offline()) return '保存した地図（電波がないため）';
      if (this.downUntil > Date.now()) return '保存した地図（国土地理院の地図が読めないため）';
      return '国土地理院の地図';
    },
    photoOk() { return !!K.cfg.photoUrl && this.useGsi(); },
    offline() { return navigator.onLine === false || !!(K.net && !K.net.online); },
    changed() { this.layers.forEach(l => { try { l.refreshSource(); } catch (e) { /* 消えた地図 */ } }); K.emit('basemap'); },
    gsiLoad() { this.fails = 0; },
    gsiError() {
      this.fails++;
      // 続けて3枚読めなければ、国土地理院が止まっている・つながらないとみなす（1枚でも読めれば数え直す）
      if (this.fails >= 3 && this.meta && !(this.downUntil > Date.now())) {
        this.downUntil = Date.now() + this.DOWN_MIN * 60000;
        try { localStorage.setItem('kuiki.gsiDown', String(this.downUntil)); } catch (e) { /* なくてもよい */ }
        this.fails = 0;
        this.changed();
        if (!this.told && K.ui && K.ui.toast) { this.told = true; K.ui.toast('国土地理院の地図が読めないため、保存した地図を出しています'); }
      }
    },
    /** 国土地理院に、今つながるか（管理の画面で確かめる） */
    async checkGsi() {
      if (!K.cfg.tileUrl) return false;
      const u = K.cfg.tileUrl.replace('{z}', 14).replace('{x}', 14615).replace('{y}', 6011) + '?t=' + Date.now();
      try {
        const r = await Promise.race([fetch(u, { mode: 'cors', cache: 'no-store' }), K.sleep(8000).then(() => null)]);
        const ok = !!(r && r.ok);
        if (ok && this.downUntil) { this.downUntil = 0; try { localStorage.removeItem('kuiki.gsiDown'); } catch (e) { /* なくてもよい */ } this.changed(); }
        return ok;
      } catch (e) { return false; }
    },
    packName(z, x, y) { if (z <= 14) return 'low'; const s = z - 14; return '14_' + (x >> s) + '_' + (y >> s); },
    packUrl(name) { return K.cfg.basemapUrl + name + (K.cfg.basemapExt || '.ktp'); },
    /** まとめたファイル（.ktp）を読む。形は tools/basemap/render.py の pack()。
     *  basemapExt が '.json' のとき（お試し版のページ）は、同じ中身を {t: 目次, b: base64} にしたもの */
    pack(name) {
      if (this.packs.has(name)) return this.packs.get(name);
      const asJson = K.cfg.basemapExt === '.json';
      const p = fetch(this.packUrl(name)).then(r => { if (!r.ok) throw new Error(String(r.status)); return asJson ? r.json() : r.arrayBuffer(); }).then(buf => {
        if (asJson) {
          const bin = atob(buf.b);
          const u = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          return { t: buf.t, buf: u.buffer, start: 0 };
        }
        const dv = new DataView(buf);
        const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
        if (sig !== 'KTP1') throw new Error('形がちがいます');
        const n = dv.getUint32(4, true);
        const head = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf, 8, n)));
        return { t: head.t, buf: buf, start: 8 + n };
      });
      p.catch(() => { this.packs.delete(name); });
      this.packs.set(name, p);
      this.order = this.order.filter(n => n !== name).concat([name]);
      while (this.order.length > this.MAX_PACKS) this.packs.delete(this.order.shift());
      return p;
    },
    /** 保存した地図の1枚（Blob の URL）。ない所は null */
    async tileUrl(z, x, y) {
      const m = this.meta || await this.init();
      if (!m || z < m.minZoom || z > m.maxZoom) return null;
      const name = this.packName(z, x, y);
      if (!m.packs[name]) return null;
      try {
        const p = await this.pack(name);
        const e = p.t[z + '/' + x + '/' + y];
        if (!e) return null;
        return URL.createObjectURL(new Blob([new Uint8Array(p.buf, p.start + e[0], e[1])], { type: 'image/png' }));
      } catch (err) { return null; }
    },
    /** 区域の範囲を覆うファイルの名前 */
    packsFor(bb) {
      const m = this.meta;
      if (!m) return [];
      const pad = 0.0016; // 約150m
      const out = ['low'];
      for (let x = K.tiles.x(bb[1] - pad * 1.4, 14); x <= K.tiles.x(bb[3] + pad * 1.4, 14); x++) {
        for (let y = K.tiles.y(bb[2] + pad, 14); y <= K.tiles.y(bb[0] - pad, 14); y++) {
          const n = '14_' + x + '_' + y;
          if (m.packs[n]) out.push(n);
        }
      }
      return out;
    },
  };

  /* ---------- 地図の保存（電波がない所でも出るように、担当区域の周りの保存した地図を端末に入れておく） ---------- */
  K.tiles = {
    x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); },
    y(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); },
    bbOf(card) {
      if (card.isBuilding) {
        const b = card.building;
        if (b.lat === null || b.lat === undefined) return null;
        return [b.lat, b.lon, b.lat, b.lon];
      }
      return K.geo.terr[card.territoryId].bb;
    },
    available() { return K.cfg.saveTiles && typeof caches !== 'undefined' && typeof fetch !== 'undefined'; },
    REFRESH_DAYS: 60,
    /** 担当区域の周りの「保存した地図」を端末に入れる。
     *  国土地理院の地図（地理院タイル）は端末に保存しない（ふだん見るときに、そのつど読む）。
     *  force：保存してあっても取り直す（保存した地図を作り直して置き換えたとき） */
    async saveCard(card, onProgress, force) {
      if (!this.available()) return { skipped: true };
      const bb = this.bbOf(card);
      if (!bb) return { skipped: true };
      const m = K.basemap.meta || await K.basemap.init();
      if (!m) return { skipped: true };
      const urls = [K.cfg.basemapUrl + 'meta.json'].concat(K.basemap.packsFor(bb).map(n => K.basemap.packUrl(n)));
      const cache = await caches.open(K.cfg.tileCache);
      let done = 0, fail = 0, got = 0;
      for (const u of urls) {
        try {
          if (force || u.slice(-9) === 'meta.json' || !(await cache.match(u))) {
            const r = await fetch(u, { cache: force ? 'no-cache' : 'default' });
            if (r.ok) { await cache.put(u, r); got++; } else fail++;
          }
        } catch (e) { fail++; }
        done++;
        if (onProgress) onProgress(done, urls.length);
      }
      const rec = { at: new Date().toISOString(), tiles: urls.length, ok: fail === 0, fail: fail, made: m.made };
      K.state.savedMaps[card.territoryId] = rec;
      await K.kv.set('savedMaps', K.state.savedMaps);
      return Object.assign({ got: got }, rec);
    },
    busy: false,
    progress: null,
    async saveAll() {
      if (this.busy || !this.available() || !K.net.online) return;
      this.busy = true;
      try {
        const meta = K.basemap.meta || await K.basemap.init();
        if (!meta) return;
        // 作り直した地図（作った日が変わった）・前の版の保存（国土地理院の地図）・60日たったものは取り直す
        const stale = m => m && (m.made !== meta.made || (m.at && Date.now() - Date.parse(m.at) > this.REFRESH_DAYS * 864e5));
        const cards = K.cards().filter(c => { const m = K.state.savedMaps[c.territoryId]; return !m || !m.ok || stale(m); });
        for (const c of cards) {
          this.progress = { territoryId: c.territoryId, done: 0, total: 0 };
          K.emit('tiles');
          await this.saveCard(c, (d, t) => { this.progress = { territoryId: c.territoryId, done: d, total: t }; K.emit('tiles'); }, stale(K.state.savedMaps[c.territoryId]));
          if (!K.net.online) break;
        }
      } finally {
        this.busy = false; this.progress = null; K.emit('tiles');
      }
    },
    async usage() {
      try {
        if (typeof caches === 'undefined') return null;
        const cache = await caches.open(K.cfg.tileCache);
        const keys = await cache.keys();
        return keys.length;
      } catch (e) { return null; }
    },
  };

  /* ---------- お試し版：本物の Code.gs をこの端末の中で動かす ---------- */
  K.demo = {
    backend: null, env: null, offline: false, STORE: 'kuiki.demo.db12',
    async init() {
      if (this.backend) return;
      const src = await (await fetch(K.cfg.backendUrl)).text();
      await K.loadGeo();
      let state = null;
      try { const s = localStorage.getItem(this.STORE); if (s) state = GasShim.deserialize(s); } catch (e) { state = null; }
      const fresh = !state;
      this.env = GasShim.createEnv({ state: state || { sheets: {} }, save: () => { clearTimeout(this.t); this.t = setTimeout(() => this.persist(), 150); } });
      this.backend = GasShim.loadBackend(src, this.env);
      if (fresh) {
        const bl = await (await fetch(K.cfg.demoBuildingsUrl)).json();
        this.backend.setup();
        this.seed(bl);
        this.persist();
      }
      try { this.offline = localStorage.getItem('kuiki.demo.offline') === '1'; } catch (e) { /* なくてもよい */ }
      // 画面を閉じる・切り替えるときは、待たずに保存する
      if (!this.hooked) { this.hooked = true; window.addEventListener('pagehide', () => { if (this.env) { clearTimeout(this.t); this.persist(); } }); }
    },
    persist() { try { localStorage.setItem(this.STORE, GasShim.serialize(this.env.state)); } catch (e) { /* 保存できない環境 */ } },
    raw(body) { return JSON.parse(this.backend.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()); },
    async call(body) {
      await this.init();
      await K.sleep(200 + Math.random() * 300);
      if (this.offline) throw netErr();
      const j = this.raw(body);
      if (!j.ok) throw mkErr(j.error || 'SERVER', j.message || 'うまくいきませんでした');
      return j;
    },
    setOffline(v) {
      this.offline = !!v;
      try { localStorage.setItem('kuiki.demo.offline', v ? '1' : '0'); } catch (e) { /* なくてもよい */ }
      K.emit('net');
      K.basemap.changed();
      if (!v) { K.sync.kick(300); }
    },
    sheet(name) { return this.env.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); },
    users() {
      const sh = this.sheet('利用者');
      return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().map(r => ({ id: r[0], name: r[1], group: r[3], role: r[4], key: r[5] }));
    },
    seed(buildingList) {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
      const day = (mo, d, h) => new Date(y, m + mo, Math.min(d, mo === 0 ? today : 28), h || 10, 0, 0);
      const top = this.users()[0].key;
      const api = body => { const j = this.raw(Object.assign({ key: top }, body)); if (!j.ok) throw new Error(j.message); return j; };
      // 人とグループ
      api({ action: 'savePerson', person: { id: 'U001', name: '佐藤 正', kana: 'さとう ただし', groupId: 'G1', role: '上位管理者', usual: 4 } });
      const people = [
        ['山田 花子', 'やまだ はなこ', 'G1', '一般', 4], ['鈴木 一郎', 'すずき いちろう', 'G1', '一般', 5],
        ['高橋 和子', 'たかはし かずこ', 'G1', '責任者', 4], ['中村 洋子', 'なかむら ようこ', 'G1', '副責任者', 3],
        ['小林 誠', 'こばやし まこと', 'G1', '一般', 3], ['伊藤 進', 'いとう すすむ', 'G2', '一般', 4],
        ['渡辺 幸子', 'わたなべ さちこ', 'G2', '責任者', 5], ['加藤 恵', 'かとう めぐみ', 'G2', '副責任者', 3],
        ['吉田 明', 'よしだ あきら', 'G2', '一般', 6], ['山本 修', 'やまもと おさむ', 'G3', '責任者', 4],
        ['松本 京子', 'まつもと きょうこ', 'G3', '副責任者', 3], ['井上 健', 'いのうえ けん', 'G3', '一般', 4],
        ['木村 和夫', 'きむら かずお', 'G3', '一般', 2],
      ];
      people.forEach(p => api({ action: 'savePerson', person: { name: p[0], kana: p[1], groupId: p[2], role: p[3], usual: p[4] } }));
      // 見本：木村さんは車がないので、家の近く（桂岡町）にまとめて配る
      api({ action: 'savePerson', person: { id: 'U014', name: '木村 和夫', kana: 'きむら かずお', groupId: 'G3', role: '一般', usual: 2, mode: '近く', near: 'T050' } });
      // 集合住宅（マンション訪問管理のマンションマスタ＋見本のアパート）
      const bid = {};
      buildingList.forEach(b => {
        // 見本：ジュネス銭函は、マンション訪問と夕方のアパートの両方で回る
        const bb = b.name === 'ジュネス銭函' ? Object.assign({}, b, { routes: ['マンション訪問', '夕方のアパート'] }) : b;
        const r = api({ action: 'saveBuilding', building: bb, rooms: b.rooms });
        bid[b.name] = r.id;
      });
      const B = this.raw({ action: 'admin', key: top }).buildings;
      const BNO = {};
      B.forEach(b => { BNO[b.id] = b.no; });
      const bno = name => B.find(b => b.id === bid[name]);
      const roomsOf = name => api({ action: 'building', id: bid[name] }).rooms.filter(x => x.active !== false);
      // これまでの配布（返却済み）と記録
      const T = K.geo.terr;
      const due = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const rel = n => new Date(y, m, today + n, 10, 0, 0);
      const plusD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
      const D = [];
      const add = (id, tid, kind, uid, name, dd, ret, g, dueAt, rooms) => {
        const du = dueAt || due(dd);
        D.push([id, tid, T[tid] ? T[tid].no : (BNO[tid] || tid), kind, uid, name, dd, du, ret || '', 'お試し版', false, '', g || '', '', '', ret ? '返却' : '', plusD(du, 14), (rooms || []).join(','), ret ? uid : '']);
      };
      const past = [['T043', -4], ['T047', -1], ['T048', -2], ['T049', -3], ['T052', -5], ['T053', -2], ['T054', -6], ['T055', -1], ['T056', -3], ['T060', -4], ['T061', -5], ['T062', -2]];
      past.forEach((p, i) => add('D-PAST-' + i, p[0], '通常', 'U003', '鈴木 一郎', day(p[1], 3 + i), day(p[1], 24, 15), 'G1'));
      // 一巡の見本（0.10.0）：2か月前の1日から4か月で一巡。札幌側の区域を少しずつ回ってある（進み具合と計画線を見るため）
      const ws = [['U007', '伊藤 進', 'G2'], ['U008', '渡辺 幸子', 'G2'], ['U009', '加藤 恵', 'G2'], ['U010', '吉田 明', 'G2'], ['U011', '山本 修', 'G3'], ['U012', '松本 京子', 'G3'], ['U013', '井上 健', 'G3']];
      const cyc = K.geo.list.filter(t => t.i >= 300 && t.houses > 0 && t.i % 3 === 0).slice(0, 150);
      const since = Math.round((now - new Date(y, m - 2, 1)) / 864e5);
      cyc.forEach((t, j) => { const w = ws[j % ws.length]; const back = Math.max(2, since - 2 - Math.floor(j * (since - 4) / cyc.length)); add('D-CYC-' + j, t.id, '通常', w[0], w[1], rel(-back - 18), rel(-back), w[2]); });
      add('D-DEMO-01', 'T051', '通常', 'U003', '鈴木 一郎', day(-1, 3), day(-1, 25, 15), 'G1');
      // 前の奉仕年度の記録（0.11.0：S-13 の見本。最後に完了した日付・1年に何回か）
      K.geo.list.filter(t => t.houses > 0 && t.i >= 40 && t.i < 70).forEach((t, j) => {
        const w = ws[j % ws.length], w2 = ws[(j + 3) % ws.length];
        add('D-OLD-A' + j, t.id, '通常', w[0], w[1], rel(-400 + j), rel(-385 + j), w[2]);
        if (j % 3 !== 1) add('D-OLD-B' + j, t.id, '通常', w2[0], w2[1], rel(-270 + j), rel(-250 + j), w2[2]);
        if (j % 4 === 0) add('D-OLD-C' + j, t.id, '通常', w[0], w[1], rel(-240 + j), rel(-228 + j), w[2]);
      });
      add('D-DEMO-02', 'T046', '通常', 'U003', '鈴木 一郎', day(-3, 5), day(-3, 27, 15), 'G1');
      // 山田さん：回収日を過ぎた区域（完全回収日まで記録できる）と、回収日が近い区域、自動で回収された区域
      add('D-DEMO-10', 'T045', '通常', 'U002', '山田 花子', rel(-26), '', 'G1', plusD(rel(-2), 0));
      add('D-DEMO-11', 'T046', '通常', 'U002', '山田 花子', rel(-20), '', 'G1', plusD(rel(3), 0));
      add('D-DEMO-16', 'T064', '通常', 'U002', '山田 花子', rel(-40), '', 'G1', plusD(rel(-17), 0));
      add('D-DEMO-12', 'T051', '不在宅訪問', 'U002', '山田 花子', day(0, 5), '', 'G1');
      add('D-DEMO-13', 'T044', '通常', 'U001', '佐藤 正', day(0, 2), '', 'G1');
      add('D-DEMO-14', 'T050', '通常', 'U004', '高橋 和子', day(0, 2), '', 'G1');
      add('D-DEMO-15', 'T063', '通常', 'U010', '吉田 明', day(0, 4), '', 'G2');
      // 山田さんが昨日返した区域（間違えて返したときに「元に戻す」を試せる）
      add('D-DEMO-17', 'T065', '通常', 'U002', '山田 花子', rel(-10), new Date(now.getTime() - 20 * 3600e3), 'G1', plusD(rel(20), 0));
      // マンション訪問：アークシティ星置壱番館は40日前に回った（会えた・不在の部屋がある）
      const arcRooms = roomsOf('アークシティ星置壱番館');
      add('D-PAST-M1', bid['アークシティ星置壱番館'], 'R1', 'U003', '鈴木 一郎', rel(-41), rel(-40), 'G1');
      // マンション訪問の巡回（部屋ごと。1日に1つの建物は1人・2部屋まで）
      //   北欧かもめⅠ：先月までに一巡（巡回が終わった）。プラージュ銭函：巡回の途中。アークシティ星置弐番館：3か月前から少しずつ
      const later = d => new Date(d.getTime() + 5 * 3600e3);
      const W = [['U003', '鈴木 一郎'], ['U005', '中村 洋子'], ['U006', '小林 誠'], ['U007', '伊藤 進'], ['U010', '吉田 明']];
      const km = roomsOf('北欧かもめⅠ').map(x => x.id);
      add('D-PAST-K1', bid['北欧かもめⅠ'], 'R1', 'U003', '鈴木 一郎', day(-2, 10, 10), day(-2, 10, 15), 'G1', day(-2, 10, 10), km.slice(0, 5));
      add('D-PAST-K2', bid['北欧かもめⅠ'], 'R1', 'U005', '中村 洋子', day(-1, 8, 10), day(-1, 8, 15), 'G1', day(-1, 8, 10), km.slice(5));
      const pl = roomsOf('プラージュ銭函').map(x => x.id);
      add('D-PAST-P1', bid['プラージュ銭函'], 'R1', 'U006', '小林 誠', day(-1, 12, 10), day(-1, 12, 15), 'G1', day(-1, 12, 10), pl.slice(0, 4));
      add('D-PAST-P2', bid['プラージュ銭函'], 'R1', 'U003', '鈴木 一郎', rel(-6), later(rel(-6)), 'G1', rel(-6), pl.slice(4, 8));
      const a2 = roomsOf('アークシティ星置弐番館').map(x => x.id);
      for (let k = 0; k < 12; k++) {
        const w = W[k % W.length];
        add('D-PAST-A' + k, bid['アークシティ星置弐番館'], 'R1', w[0], w[1], rel(-84 + k * 7), later(rel(-84 + k * 7)), 'G1', rel(-84 + k * 7), a2.slice(k * 2, k * 2 + 2));
      }
      this.sheet('配布').getRange(2, 1, D.length, 19).setValues(D);
      const recs = [];
      let n = 0;
      const rec = (dist, tid, hid, res, at, uid, name) => { n++; recs.push(['demo-rec-' + ('000' + n).slice(-4), dist, tid, hid, '', res, at, uid, name, at, false, '', '']); };
      const h34 = K.geo.byTerr.T051.filter(h => !h.big);
      ['会えた', '不在', '会えた', '不在', '会えた', '会えた', '不在', '拒否', '会えた', '不在', '会えた'].forEach((res, i) => rec('D-DEMO-01', 'T051', h34[i].id, res, day(-1, 10, 10 + (i % 5)), 'U003', '鈴木 一郎'));
      const h29 = K.geo.byTerr.T046.filter(h => !h.big);
      rec('D-DEMO-02', 'T046', h29[4].id, '拒否', day(-3, 12, 11), 'U003', '鈴木 一郎');
      const h28 = K.geo.byTerr.T045.filter(h => !h.big);
      ['会えた', '不在', '不在', '会えた', '不在', '会えた', '不在', '会えた'].forEach((res, i) => rec('D-DEMO-10', 'T045', h28[i].id, res, new Date(now.getTime() - 26 * 3600e3 + i * 240e3), 'U002', '山田 花子'));
      const h47 = K.geo.byTerr.T064.filter(h => !h.big);
      ['会えた', '不在', '会えた'].forEach((res, i) => rec('D-DEMO-16', 'T064', h47[i].id, res, rel(-22 + i), 'U002', '山田 花子'));
      const h65 = K.geo.byTerr.T065.filter(h => !h.big);
      ['会えた', '不在', '会えた', '会えた'].forEach((res, i) => rec('D-DEMO-17', 'T065', h65[i].id, res, rel(-2 + i * 0.01), 'U002', '山田 花子'));
      arcRooms.slice(0, 14).forEach((x, i) => { n++; recs.push(['demo-rec-' + ('000' + n).slice(-4), 'D-PAST-M1', bid['アークシティ星置壱番館'], '', '', i % 3 === 2 ? '不在' : '会えた', rel(-40), 'U003', '鈴木 一郎', rel(-40), false, '', x.id]); });
      this.sheet('訪問記録').getRange(2, 1, recs.length, 13).setValues(recs);
      // グループの手持ち・今日の集まり（夕方のアパート：一棟まとめて）
      api({ action: 'distribute', items: [
        { targetId: 'T057', no: T.T057.no, kind: '手持ち', groupId: 'G1' }, { targetId: 'T058', no: T.T058.no, kind: '手持ち', groupId: 'G1' },
        { targetId: 'T059', no: T.T059.no, kind: '手持ち', groupId: 'G2' },
      ] });
      api({ action: 'distribute', gathering: { kind: 'R2', name: '夕方のアパート' }, items: [
        { targetId: bid['（見本）ハイム桂岡'], no: bno('（見本）ハイム桂岡').no, kind: 'R2', userId: 'U002' },
        { targetId: bid['（見本）桂岡荘'], no: bno('（見本）桂岡荘').no, kind: 'R2', userId: 'U006' },
      ] });
      // 今日のマンション訪問：1人に、いくつかの建物から少しずつ（1つの建物は1人だけ）
      const pick = (name, a, b) => roomsOf(name).slice(a, b).map(x => x.id);
      api({ action: 'distribute', gathering: { kind: 'R1', name: 'マンション訪問' }, items: [
        { targetId: bid['ホープ銭函'], no: bno('ホープ銭函').no, kind: 'R1', userId: 'U002', rooms: pick('ホープ銭函', 0, 2) },
        { targetId: bid['シーサイドガーデン'], no: bno('シーサイドガーデン').no, kind: 'R1', userId: 'U002', rooms: pick('シーサイドガーデン', 0, 2) },
        { targetId: bid['リーセント銭函II'], no: bno('リーセント銭函II').no, kind: 'R1', userId: 'U002', rooms: pick('リーセント銭函II', 0, 1) },
        { targetId: bid['プラージュ銭函'], no: bno('プラージュ銭函').no, kind: 'R1', userId: 'U006', rooms: pl.slice(8, 10) },
        { targetId: bid['アークシティ星置弐番館'], no: bno('アークシティ星置弐番館').no, kind: 'R1', userId: 'U006', rooms: a2.slice(24, 26) },
      ] });
      // 地図の手直しの記録（元に戻す・もう一度反映するを試せるように）
      const h50 = K.geo.byTerr.T050.find(h => !h.big) || K.geo.byTerr.T050[0];
      api({ action: 'editHouse', edit: { type: '足す', lat: h50.lat + 0.00009, lon: h50.lon + 0.00006, blockId: h50.b, territoryId: 'T050', note: '新しく建った家（見本）' } });
      api({ action: 'logCompare', text: '2026年9月16日更新分まで・新しい建物3・なくなったかも1・更新された地図2/8枚' });
      const h52 = K.geo.byTerr.T052.filter(h => !h.big)[2] || K.geo.byTerr.T052[0];
      api({ action: 'setHouseState', houseId: h52.id, state: 'なくなった', note: '国土地理院の地図から消えた（国土地理院 2026年9月16日更新分）' });
      api({ action: 'saveSetting', name: '一巡の始まり', value: new Date(y, m - 2, 1).getFullYear() + '-' + String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0') });
      // 0.11.0：お知らせ・バックアップの見本（集合住宅の月ごとの組は、［一巡の計画］→［集合住宅（別枠）］で作って試せる）
      const until = new Date(y, m, today + 7);
      api({ action: 'saveNotice', text: '（見本）今週の土曜日は、集まりのあとに紙の区域カードも配ります。紙で回ったら、カードに日付と記録を書いて責任者に返してください。', until: until.getFullYear() + '-' + String(until.getMonth() + 1).padStart(2, '0') + '-' + String(until.getDate()).padStart(2, '0') });
      try { this.backend.backupNow(); } catch (e) { /* お試し版では見本だけ */ }
      // 現地からの報告（集合住宅かも）
      const hrep = K.geo.byTerr.T050.find(h => h.maybe) || K.geo.byTerr.T050[3];
      this.sheet('報告').getRange(2, 1, 1, 9).setValues([['demo-rep-0001', hrep.id, 'T050', '集合住宅（アパート・マンション）', 'U004', '高橋 和子', day(0, 2, 14), '未確認', '']]);
    },
    async reset() {
      try { localStorage.removeItem(this.STORE); localStorage.removeItem('kuiki.demo.offline'); } catch (e) { /* なくてもよい */ }
      this.backend = null; this.env = null; this.offline = false;
    },
  };
})();

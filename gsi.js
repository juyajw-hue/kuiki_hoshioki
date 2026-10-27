/*
 * 区域訪問管理 — 国土地理院の地図（ベクトルタイル）の建物を読み、前の地図と比べる
 *   地理院地図Vector（提供実験）の building レイヤーを、ズーム16のタイルで読む。
 *   ブラウザ（管理の画面）と Node（tools/make_gsi_base.js）の両方で使う。
 *
 * 比べ方（建物の地物ごとに、形の目印で比べる）
 *   新しい建物：基準の地図（data/gsi-base.json）になかった地物のうち、区域のブロックの中にあり、
 *               家の印とも、前に見送った場所とも重ならないもの（形が変わっただけのものは外す）
 *   なくなった家：家の印にかかっていた地物が消え、今の地図の地物がかからない家
 *   どちらも「候補」で、上位管理者が地図や写真で確かめてから決める
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KGSI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const Z = 16;
  const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf';
  const EARTH = 40075016.686;

  /* ---------- protobuf（必要なところだけ） ---------- */
  function Reader(buf) { this.b = buf; this.p = 0; }
  Reader.prototype.varint = function () {
    let v = 0, s = 1, b;
    do { b = this.b[this.p++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80);
    return v;
  };
  Reader.prototype.bytes = function () { const n = this.varint(); const st = this.p; this.p += n; return [st, this.p]; };
  Reader.prototype.skip = function (w) {
    if (w === 0) this.varint();
    else if (w === 1) this.p += 8;
    else if (w === 2) this.p += this.varint();
    else if (w === 5) this.p += 4;
    else throw new Error('protobuf: wire ' + w);
  };
  function utf8(b, s, e) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b.subarray(s, e));
    return Buffer.from(b.subarray(s, e)).toString('utf8');
  }
  function packed(b, s, e) {
    const r = new Reader(b); r.p = s;
    const out = [];
    while (r.p < e) out.push(r.varint());
    return out;
  }
  const zz = n => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

  /** タイル1枚から building レイヤーの地物を取り出す：[{fc, type, parts:[[x,y],...]}], extent */
  function decodeBuildings(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const r = new Reader(b);
    while (r.p < b.length) {
      const tag = r.varint();
      if ((tag >> 3) === 3 && (tag & 7) === 2) {
        const [s, e] = r.bytes();
        const layer = readLayer(b, s, e);
        if (layer) return layer;
      } else r.skip(tag & 7);
    }
    return { extent: 4096, feats: [] };
  }
  function readLayer(b, s, e) {
    const r = new Reader(b); r.p = s;
    let name = '', extent = 4096;
    const feats = [], keys = [], values = [];
    while (r.p < e) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1 && w === 2) { const [a, z] = r.bytes(); name = utf8(b, a, z); }
      else if (f === 2 && w === 2) feats.push(r.bytes());
      else if (f === 3 && w === 2) { const [a, z] = r.bytes(); keys.push(utf8(b, a, z)); }
      else if (f === 4 && w === 2) values.push(r.bytes());
      else if (f === 5 && w === 0) extent = r.varint();
      else r.skip(w);
    }
    if (name !== 'building') return null;
    const fk = keys.indexOf('ftCode');
    const val = i => {
      const [a, z] = values[i];
      const vr = new Reader(b); vr.p = a;
      while (vr.p < z) {
        const t = vr.varint(), f = t >> 3, w = t & 7;
        if (w === 0) { const v = vr.varint(); return f === 6 ? zz(v) : f === 7 ? !!v : v; }
        if (w === 2) { const [x, y] = vr.bytes(); return utf8(b, x, y); }
        if (w === 5) { const dv = new DataView(b.buffer, b.byteOffset + vr.p, 4); vr.p += 4; return dv.getFloat32(0, true); }
        if (w === 1) { const dv = new DataView(b.buffer, b.byteOffset + vr.p, 8); vr.p += 8; return dv.getFloat64(0, true); }
        vr.skip(w);
      }
      return null;
    };
    const out = [];
    feats.forEach(([fs, fe]) => {
      const fr = new Reader(b); fr.p = fs;
      let type = 0, tags = [], geom = [];
      while (fr.p < fe) {
        const t = fr.varint(), f = t >> 3, w = t & 7;
        if (f === 2 && w === 2) { const [a, z] = fr.bytes(); tags = packed(b, a, z); }
        else if (f === 3 && w === 0) type = fr.varint();
        else if (f === 4 && w === 2) { const [a, z] = fr.bytes(); geom = packed(b, a, z); }
        else fr.skip(w);
      }
      let fc = null;
      for (let i = 0; i + 1 < tags.length; i += 2) if (tags[i] === fk) fc = val(tags[i + 1]);
      const parts = [];
      let x = 0, y = 0, cur = null, i = 0;
      while (i < geom.length) {
        const c = geom[i++], id = c & 7, n = c >> 3;
        if (id === 1 || id === 2) {
          for (let k = 0; k < n; k++) {
            x += zz(geom[i++]); y += zz(geom[i++]);
            if (id === 1) { cur = [[x, y]]; parts.push(cur); } else if (cur) cur.push([x, y]);
          }
        } else if (id === 7) { if (cur && cur.length) cur.push([cur[0][0], cur[0][1]]); }
      }
      out.push({ fc: fc, type: type, parts: parts });
    });
    return { extent: extent, feats: out };
  }

  /* ---------- 座標 ---------- */
  function tileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function tileY(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  function toLL(gx, gy, N) { return [Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / N))) * 180 / Math.PI, gx / N * 360 - 180]; }
  function toG(lat, lon, N) { const r = lat * Math.PI / 180; return [(lon + 180) / 360 * N, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N]; }
  function metersPerUnit(lat, N) { return EARTH * Math.cos(lat * Math.PI / 180) / N; }

  /**
   * タイル1枚の建物を「点」にする。閉じた形は面積と重心、閉じていない（タイルの端で切れた）ものは頂点の平均。
   * 返す点：{lat, lon, a（㎡。閉じていないものは外接四角の面積）, closed, gx, gy（全体の座標）, ring（全体の座標の列）}
   */
  function tilePoints(tx, ty, decoded) {
    const E = decoded.extent, N = E * Math.pow(2, Z);
    const out = [];
    decoded.feats.forEach(f => {
      f.parts.forEach(pt => {
        if (pt.length < 2) return;
        const ring = pt.map(q => [tx * E + q[0], ty * E + q[1]]);
        const closed = pt.length >= 4 && pt[0][0] === pt[pt.length - 1][0] && pt[0][1] === pt[pt.length - 1][1];
        let A = 0, cx = 0, cy = 0;
        if (closed) {
          for (let i = 0; i < ring.length - 1; i++) {
            const k = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
            A += k; cx += (ring[i][0] + ring[i + 1][0]) * k; cy += (ring[i][1] + ring[i + 1][1]) * k;
          }
          A /= 2;
        }
        let gx, gy;
        if (closed && Math.abs(A) > 1) { gx = cx / (6 * A); gy = cy / (6 * A); }
        else { gx = 0; gy = 0; ring.forEach(q => { gx += q[0]; gy += q[1]; }); gx /= ring.length; gy /= ring.length; }
        const ll = toLL(gx, gy, N);
        const mpu = metersPerUnit(ll[0], N);
        let a;
        if (closed) a = Math.abs(A) * mpu * mpu;
        else {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          ring.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
          a = (x1 - x0) * (y1 - y0) * mpu * mpu;
        }
        out.push({ lat: ll[0], lon: ll[1], a: a, closed: closed, fc: f.fc, gx: gx, gy: gy, ring: ring, N: N });
      });
    });
    return out;
  }

  /* ---------- 近くを探すための升目 ---------- */
  function Grid(cell) { this.c = cell; this.m = new Map(); }
  Grid.prototype.key = function (lat, lon) { return Math.floor(lat / this.c) + ':' + Math.floor(lon / this.c); };
  Grid.prototype.add = function (lat, lon, v) { const k = this.key(lat, lon); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(v); };
  Grid.prototype.near = function (lat, lon) {
    const i = Math.floor(lat / this.c), j = Math.floor(lon / this.c), out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = this.m.get((i + di) + ':' + (j + dj)); if (a) for (const v of a) out.push(v); }
    return out;
  };
  function dist(lat1, lon1, lat2, lon2) {
    const k = Math.cos(lat1 * Math.PI / 180);
    return Math.hypot((lat2 - lat1) * 111320, (lon2 - lon1) * 111320 * k);
  }
  function inRingG(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  /* ---------- 区域のブロック（どこが区域の中か） ---------- */
  function blockIndex(blocks) {
    const list = Object.keys(blocks).map(id => {
      const b = blocks[id];
      let s = 90, w = 180, n = -90, e = -180;
      b.poly.forEach(p => p[0].forEach(q => { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }));
      return { id: id, t: b.t, poly: b.poly, bb: [s, w, n, e] };
    });
    const inRingLL = (lat, lon, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    };
    return {
      list: list,
      at(lat, lon) {
        for (const b of list) {
          if (lat < b.bb[0] || lat > b.bb[2] || lon < b.bb[1] || lon > b.bb[3]) continue;
          if (b.poly.some(p => inRingLL(lat, lon, p[0]) && !p.slice(1).some(h => inRingLL(lat, lon, h)))) return b;
        }
        return null;
      },
    };
  }

  /** 区域を覆うタイルの一覧 */
  function coverage(blocks) {
    const set = new Set();
    Object.keys(blocks).forEach(id => blocks[id].poly.forEach(p => {
      let s = 90, w = 180, n = -90, e = -180;
      p[0].forEach(q => { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); });
      for (let x = tileX(w, Z); x <= tileX(e, Z); x++) for (let y = tileY(n, Z); y <= tileY(s, Z); y++) set.add(x + '/' + y);
    }));
    return Array.from(set).sort().map(k => k.split('/').map(Number));
  }

  /* ---------- 地物ごとの目印（同じ形なら同じ値） ---------- */
  function fnv(nums) {
    let h = 0x811c9dc5;
    for (let i = 0; i < nums.length; i++) {
      let v = nums[i] | 0;
      for (let k = 0; k < 4; k++) { h ^= v & 0xff; h = Math.imul(h, 0x01000193); v >>>= 8; }
    }
    return (h >>> 0).toString(36);
  }
  /** タイル1枚の建物の地物：{h（目印）, bb:[x0,y0,x1,y1]（タイルの中の座標）, closed, a（㎡）, ring（全体の座標）, lat, lon} */
  function tileFeatures(tx, ty, decoded) {
    const E = decoded.extent, N = E * Math.pow(2, Z);
    return decoded.feats.map(f => {
      const nums = [f.type, f.parts.length];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      f.parts.forEach(pt => { nums.push(pt.length); pt.forEach(q => { nums.push(q[0], q[1]); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }); });
      const pts = tilePoints(tx, ty, { extent: E, feats: [f] });
      const closed = pts.length > 0 && pts.every(p => p.closed);
      const a = pts.reduce((n, p) => n + p.a, 0);
      const c = toLL(tx * E + (x0 + x1) / 2, ty * E + (y0 + y1) / 2, N);
      return { h: fnv(nums), bb: [x0, y0, x1, y1], closed: closed, a: a, rings: pts.map(p => p.ring), lat: c[0], lon: c[1], N: N, tx: tx, ty: ty, E: E };
    }).filter(f => f.bb[0] !== Infinity);
  }
  /** 地物の外接四角を、全体の座標で */
  const gbb = f => [f.tx * f.E + f.bb[0], f.ty * f.E + f.bb[1], f.tx * f.E + f.bb[2], f.ty * f.E + f.bb[3]];
  const inBB = (x, y, b, pad) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

  /* ---------- 基準の地図を作る（Node の道具で使う） ---------- */
  /**
   * tiles: [{x, y, buf, lastModified}]、blocks: territories.json の blocks
   * 区域のブロックにかかる建物の地物を、目印と外接四角だけ残す
   */
  /** ブロックの外接四角（全体の座標）。この近く（約10m）の地物だけを比べる */
  function regionOf(blocks) {
    const N0 = 4096 * Math.pow(2, Z);
    const bbs = Object.keys(blocks).map(id => {
      let s = 90, w = 180, n = -90, e = -180;
      blocks[id].poly.forEach(p => p[0].forEach(q => { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }));
      const a = toG(n, w, N0), b = toG(s, e, N0);
      return [a[0], a[1], b[0], b[1]];
    });
    const pad = 100;
    return g => bbs.some(b => g[2] >= b[0] - pad && g[0] <= b[2] + pad && g[3] >= b[1] - pad && g[1] <= b[3] + pad);
  }
  function makeBase(tiles, blocks, made) {
    const inRegion = regionOf(blocks);
    const out = {};
    const dates = {};
    let count = 0;
    tiles.forEach(t => {
      if (t.lastModified) { const k = new Date(t.lastModified).toISOString().slice(0, 10); dates[k] = (dates[k] || 0) + 1; }
      const list = [];
      tileFeatures(t.x, t.y, decodeBuildings(t.buf)).forEach(f => {
        if (!inRegion(gbb(f))) return;
        list.push([f.h].concat(f.bb));
      });
      out[t.x + '/' + t.y] = list;
      count += list.length;
    });
    return {
      version: 2, made: made || new Date().toISOString().slice(0, 10), z: Z,
      source: '国土地理院ベクトルタイル（地理院地図Vector提供実験 experimental_bvmap）の building',
      tileDates: dates, count: count, tiles: out,
    };
  }

  /* ---------- 比べる ---------- */
  /**
   * 基準の地図と、今の地図（読んだタイル）を地物ごとに比べる。
   *   増えた地物：基準になく、今ある。基準から消えた地物と重なるなら「形が変わっただけ」として外す
   *   消えた地物：基準にあり、今ない
   * opts: {base, tiles:[{x,y,buf}], blocks, houses:[{id, lat, lon, kind, added, t}], skips:[{lat,lon} | {houseId}], minArea, drop}
   *   drop：今の地図から外す地物の目印（お試し版で「なくなった」を見せるため）
   * 返す：{newCands:[{lat, lon, a, blockId, territoryId, rings:[[[lat,lon]...]]}], goneCands:[{houseId, lat, lon, territoryId}], checked, changedTiles}
   */
  function compare(opts) {
    const minArea = opts.minArea || 20;
    const bi = blockIndex(opts.blocks);
    const N0 = 4096 * Math.pow(2, Z);
    const inRegion = regionOf(opts.blocks);
    const drop = new Set(opts.drop || []);
    const skipG = new Grid(0.0001);
    const skipHouse = new Set();
    (opts.skips || []).forEach(s => { if (s.houseId) skipHouse.add(s.houseId); if (s.lat !== null && s.lat !== undefined && !s.houseId) skipG.add(s.lat, s.lon, s); });
    const houseG = new Grid(0.0002);
    opts.houses.forEach(h => houseG.add(h.lat, h.lon, h));

    const added = [], removed = [], present = [];
    const tileSet = new Set();
    let changedTiles = 0;
    opts.tiles.forEach(t => {
      const key = t.x + '/' + t.y;
      tileSet.add(key);
      const base = (opts.base.tiles && opts.base.tiles[key]) || [];
      const baseH = new Map(base.map(b => [b[0], b]));
      const cur = tileFeatures(t.x, t.y, decodeBuildings(t.buf)).filter(f => !drop.has(f.h) && inRegion(gbb(f)));
      const curH = new Set(cur.map(f => f.h));
      let changed = false;
      cur.forEach(f => { present.push(gbb(f)); if (!baseH.has(f.h)) { added.push(f); changed = true; } });
      base.forEach(b => { if (!curH.has(b[0])) { removed.push([t.x * 4096 + b[1], t.y * 4096 + b[2], t.x * 4096 + b[3], t.y * 4096 + b[4]]); changed = true; } });
      if (changed) changedTiles++;
    });

    // 新しい建物の候補
    const newCands = [];
    added.forEach(f => {
      const g = gbb(f);
      const blk = bi.at(f.lat, f.lon);
      if (!blk) return;
      const area = f.closed ? f.a : (g[2] - g[0]) * (g[3] - g[1]) * Math.pow(metersPerUnit(f.lat, N0), 2);
      if (area < minArea) return;
      const fa = Math.max(1, (g[2] - g[0]) * (g[3] - g[1]));
      if (removed.some(r => overlap(g, r) / Math.min(fa, Math.max(1, (r[2] - r[0]) * (r[3] - r[1]))) > 0.3)) return; // 形が変わっただけ
      const mpu = metersPerUnit(f.lat, N0);
      if (houseG.near(f.lat, f.lon).some(h => { const q = toG(h.lat, h.lon, N0); return inBB(q[0], q[1], g, 1.5 / mpu); })) return;
      if (skipG.near(f.lat, f.lon).some(s => dist(f.lat, f.lon, s.lat, s.lon) <= 6)) return;
      const rings = f.rings.map(r => r.map(q => toLL(q[0], q[1], N0)));
      const c = newCands.find(o => overlap(o.g, g) > 0 || dist(o.lat, o.lon, f.lat, f.lon) <= 6);
      if (c) { c.rings = c.rings.concat(rings); c.a = Math.max(c.a, Math.round(area)); c.g = [Math.min(c.g[0], g[0]), Math.min(c.g[1], g[1]), Math.max(c.g[2], g[2]), Math.max(c.g[3], g[3])]; return; }
      newCands.push({ lat: f.lat, lon: f.lon, a: Math.round(area), blockId: blk.id, territoryId: blk.t, rings: rings, g: g });
    });
    newCands.forEach(c => { const ll = toLL((c.g[0] + c.g[2]) / 2, (c.g[1] + c.g[3]) / 2, N0); c.lat = ll[0]; c.lon = ll[1]; delete c.g; });

    // なくなった家の候補：家の印にかかっていた地物が消え、今の地物がかからない
    const goneCands = [];
    if (removed.length) {
      const remG = new Grid(0.0004), preG = new Grid(0.0004);
      const center = b => toLL((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, N0);
      removed.forEach(r => { const c = center(r); remG.add(c[0], c[1], r); });
      present.forEach(r => { const c = center(r); preG.add(c[0], c[1], r); });
      opts.houses.forEach(h => {
        if (h.added || h.kind === 'gone' || skipHouse.has(h.id)) return;
        if (!tileSet.has(tileX(h.lon, Z) + '/' + tileY(h.lat, Z))) return;
        const q = toG(h.lat, h.lon, N0);
        const pad = 1 / metersPerUnit(h.lat, N0);
        if (!remG.near(h.lat, h.lon).some(r => inBB(q[0], q[1], r, pad))) return;
        if (preG.near(h.lat, h.lon).some(r => inBB(q[0], q[1], r, pad))) return;
        goneCands.push({ houseId: h.id, lat: h.lat, lon: h.lon, territoryId: h.t || '' });
      });
    }
    return { newCands: newCands, goneCands: goneCands, checked: opts.tiles.length, changedTiles: changedTiles, added: added.length, removed: removed.length };
  }

  return { Z, TILE_URL, decodeBuildings, tilePoints, tileFeatures, coverage, makeBase, compare, blockIndex, regionOf, tileX, tileY, dist };
});

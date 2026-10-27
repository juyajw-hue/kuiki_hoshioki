/*
 * 区域の全体地図：区域の形を色分けして並べ、さわって選ぶ。
 *   管理の「地図で見て配る」と、利用者の「全体の地図」（持っている区域が全体のどこか）で使う。
 *   区域が700以上あるので、線は canvas で描き、番号は見えている所だけに出す。
 */
(function () {
  'use strict';
  const K = window.K;

  /** 色（地図は明るい淡色地図なので、画面の明るさに関係なく同じ色） */
  const C = {
    other: { stroke: '#475569', fill: '#cbd5e1', fillOpacity: 0.4, weight: 1.2 },
    out: { stroke: '#6b7280', fill: '#9ca3af', fillOpacity: 0.55, weight: 1, dashArray: '4 3' },
    old: { stroke: '#166534', fill: '#15803d', fillOpacity: 0.5, weight: 1.2 },      // 長く配っていない（4か月以上・まだ配っていない）
    mid: { stroke: '#15803d', fill: '#4ade80', fillOpacity: 0.42, weight: 1.2 },     // 2〜4か月前に返った
    recent: { stroke: '#4d7c0f', fill: '#d9f99d', fillOpacity: 0.5, weight: 1.2 },  // 2か月のうちに返った
    sel: { stroke: '#1e3a8a', fill: '#2563eb', fillOpacity: 0.6, weight: 3 },
    held: { stroke: '#b45309', fill: '#f59e0b', fillOpacity: 0.55, weight: 2 },   // 配る相手が今持っている区域
    mine: { stroke: '#1e3a8a', fill: '#2563eb', fillOpacity: 0.5, weight: 2.5 },
  };
  /** 人ごとの色（割り当て案を地図で見るとき） */
  const PEOPLE = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d', '#7c3aed', '#0d9488'];

  /** 前回の返却からの日数で、候補の色を決める */
  function ageStyle(lastReturned) {
    if (!lastReturned) return C.old;
    const p = String(lastReturned).split('-').map(Number);
    const days = (Date.now() - new Date(p[0], p[1] - 1, p[2]).getTime()) / 864e5;
    return days >= 120 ? C.old : days >= 60 ? C.mid : C.recent;
  }

  /** 町ごとの中心（地図を引いたときに町名を出す） */
  let towns = null;
  function townCenters() {
    if (towns) return towns;
    const acc = {};
    K.geo.list.forEach(t => {
      if (!t.bb) return;
      const a = acc[t.town] = acc[t.town] || { n: 0, lat: 0, lon: 0 };
      a.n++; a.lat += (t.bb[0] + t.bb[2]) / 2; a.lon += (t.bb[1] + t.bb[3]) / 2;
    });
    towns = Object.keys(acc).map(k => ({ name: k, lat: acc[k].lat / acc[k].n, lon: acc[k].lon / acc[k].n, n: acc[k].n }));
    return towns;
  }

  /**
   * el に地図を作る。o:
   *   style(tid) → C の1つか {stroke, fill, fillOpacity, weight, dashArray}（null なら薄く出す）
   *   label(tid) → 番号の札の中身（HTML）。null なら出さない
   *   always(tid) → true ならどの縮尺でも札を出す（利用者の持っている区域）
   *   onTap(tid)、buildings: [{id, lat, lon, cls, html}]、onTapB(id)
   *   onTapPoint(latlng)：区域の上でも外でも、さわった場所を受け取る（あれば onTap より先）
   *   fit: 区域IDの配列（その範囲に合わせる）、view: {center, zoom}（前の表示に戻す）
   */
  function terrMap(el, o) {
    const U = K.ui;
    o = o || {};
    const map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19, minZoom: 11, zoomSnap: 0.5, wheelPxPerZoomLevel: 90, bounceAtZoomLimits: false });
    map.attributionControl.setPrefix(false);
    U.baseLayer(false).addTo(map);
    map.attributionControl.addAttribution(K.geo.attribution || '');
    const renderer = L.canvas({ padding: 0.4, tolerance: 4 });
    const layers = {};
    let opts = o;
    const look = tid => {
      const s = (opts.style && opts.style(tid)) || C.other;
      return { renderer: renderer, color: s.stroke, weight: s.weight || 1, opacity: 0.95, fillColor: s.fill, fillOpacity: s.fillOpacity === undefined ? 0.3 : s.fillOpacity, dashArray: s.dashArray || null, lineJoin: 'round' };
    };
    K.geo.list.forEach(t => {
      if (t.off) return;   // 外した区域は全体の地図に出さない
      const polys = [];
      t.blocks.forEach(bid => { const b = K.geo.block[bid]; if (b) b.poly.forEach(p => polys.push(p)); });
      if (!polys.length) return;
      const lay = L.polygon(polys, look(t.id)).addTo(map);
      lay.on('click', e => { L.DomEvent.stopPropagation(e); if (opts.onTapPoint) opts.onTapPoint(e.latlng); else if (opts.onTap) opts.onTap(t.id); });
      layers[t.id] = lay;
    });
    // 集合住宅（場所がある建物）
    const bLayer = L.layerGroup().addTo(map);
    function drawBuildings() {
      bLayer.clearLayers();
      (opts.buildings || []).forEach(b => {
        if (b.lat === null || b.lat === undefined || b.lon === null || b.lon === undefined) return;
        const mk = L.marker([b.lat, b.lon], { icon: L.divIcon({ className: 'tm-bld ' + (b.cls || ''), html: b.html || '<i>集</i>', iconSize: [34, 34] }), keyboard: false });
        mk.on('click', e => { L.DomEvent.stopPropagation(e); if (opts.onTapB) opts.onTapB(b.id); });
        mk.addTo(bLayer);
      });
    }
    drawBuildings();
    // 番号の札：見えている所だけ（区域が多いので）
    const lab = L.layerGroup().addTo(map);
    function drawLabels() {
      lab.clearLayers();
      const z = map.getZoom();
      const bounds = map.getBounds().pad(0.1);
      let n = 0;
      K.geo.list.forEach(t => {
        const always = opts.always && opts.always(t.id);
        if (!t.bb || t.off || (!always && z < (opts.labelZoom || 15))) return;
        const c = [(t.bb[0] + t.bb[2]) / 2, (t.bb[1] + t.bb[3]) / 2];
        if (!bounds.contains(c)) return;
        const html = opts.label ? opts.label(t.id) : null;
        if (!html || (!always && n > 260)) return;
        n++;
        L.marker(c, { icon: L.divIcon({ className: 'tm-label' + (always ? ' strong' : ''), html: '<span>' + html + '</span>', iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(lab);
      });
      if (opts.towns !== false && z < 15.5) {
        townCenters().forEach(tw => {
          if (!bounds.contains([tw.lat, tw.lon])) return;
          L.marker([tw.lat, tw.lon], { icon: L.divIcon({ className: 'tm-town', html: '<span>' + K.h.esc(tw.name) + '</span>', iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(lab);
        });
      }
    }
    map.on('moveend zoomend', drawLabels);
    // 場所をさわって決める（家の近くを地図で決めるとき）
    map.on('click', e => { if (opts.onTapPoint) opts.onTapPoint(e.latlng); });
    function fitTo(ids) {
      let s = 90, w = 180, n = -90, e = -180;
      (ids || []).forEach(id => {
        const t = K.geo.terr[id];
        if (t) { s = Math.min(s, t.bb[0]); w = Math.min(w, t.bb[1]); n = Math.max(n, t.bb[2]); e = Math.max(e, t.bb[3]); }
        else {
          const b = (opts.buildings || []).find(x => x.id === id);
          if (b && b.lat !== null && b.lat !== undefined) { s = Math.min(s, b.lat); n = Math.max(n, b.lat); w = Math.min(w, b.lon); e = Math.max(e, b.lon); }
        }
      });
      if (s > n) { // 何もなければ範囲全体
        K.geo.list.forEach(t => { if (!t.bb) return; s = Math.min(s, t.bb[0]); w = Math.min(w, t.bb[1]); n = Math.max(n, t.bb[2]); e = Math.max(e, t.bb[3]); });
      }
      map.fitBounds(L.latLngBounds([[s, w], [n, e]]), { padding: [24, 24], maxZoom: opts.fitMaxZoom || 17 });
    }
    if (o.view && o.view.center) map.setView(o.view.center, o.view.zoom);
    else fitTo(o.fit);
    setTimeout(() => { map.invalidateSize(); drawLabels(); }, 60);
    // 今いる場所
    let me = null;
    const ctl = {
      map: map,
      /** 色・札・さわったときの動きを入れ替える（地図はそのまま） */
      update(next) {
        opts = Object.assign({}, opts, next || {});
        Object.keys(layers).forEach(tid => layers[tid].setStyle(look(tid)));
        drawBuildings();
        drawLabels();
      },
      fit: fitTo,
      view() { return { center: map.getCenter(), zoom: map.getZoom() }; },
      locate(onFail) {
        if (!navigator.geolocation) { if (onFail) onFail(); return; }
        navigator.geolocation.getCurrentPosition(p => {
          const ll = [p.coords.latitude, p.coords.longitude];
          if (me) me.remove();
          me = L.marker(ll, { icon: L.divIcon({ className: 'tm-me', html: '<i></i>', iconSize: [22, 22] }), interactive: false, keyboard: false }).addTo(map);
          map.setView(ll, Math.max(map.getZoom(), 15));
        }, () => { if (onFail) onFail(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
      },
      invalidate() { map.invalidateSize(); },
      destroy() { try { map.remove(); } catch (e) { /* もう消えている */ } },
    };
    return ctl;
  }

  K.terrMap = terrMap;
  K.terrMap.C = C;
  K.terrMap.PEOPLE = PEOPLE;
  K.terrMap.ageStyle = ageStyle;
})();

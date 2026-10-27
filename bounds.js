/*
 * 区域訪問管理 — 区切りの手直し（0.12.0・上位管理者）
 *   区域の区切り（どの家・どのブロックがどの区域か）を、地図の上で直す。
 *     家を別の区域に移す／ブロックを別の区域に移す／選んだブロックで新しい区域を作る（分ける）／
 *     となりの区域を合わせてひとつにする／線を描いてブロックを足す（範囲を広げる）／区域を外す・戻す／番号を変える
 *   直した内容は「区切りの手直し」シートに残り、すぐに全員の地図に効く（元のデータは変えない）。
 *   記録は区域ID・家IDに付いているので、区切りを直しても残る。家の番号は並び直るので、区域カードは刷り直す。
 */
(function () {
  'use strict';
  const K = window.K;
  const app = document.getElementById('app');
  const H = K.h;
  const esc = H.esc;
  const U = K.ui;
  const I = U.I;
  const views = U.views;
  const act = U.act;
  const kit = () => K.adminKit;
  const data = () => kit().A.data;

  const TYPE_LABEL = { '家を移す': '家を移した', 'ブロックを移す': 'ブロックを移した', 'ブロックを足す': 'ブロックを足した', '区域を作る': '区域を作った', '区域を外す': '区域を外した', '番号を変える': '番号を変えた' };
  const tOf = id => K.geo.terr[id] || null;
  const noOf = id => { const t = tOf(id); return t ? t.no : id; };
  const BD = { q: '', view: null };   // view: {center, zoom} 直したあとも同じ場所を見せる

  /* ==================== 一覧（入口） ==================== */
  views.aBounds = async function () {
    const k = kit();
    if (!k.A.data || U.view().fresh) { k.shell('区切りの手直し', ''); await k.load(); U.view().fresh = false; }
    if (U.view().name !== 'aBounds') return;
    if (!k.top()) return k.shell('区切りの手直し', '<p class="notice">上位管理者だけが使えます。</p>');
    const q = BD.q.trim().toLowerCase();
    const hit = t => !q || (t.no + ' ' + t.town).toLowerCase().indexOf(q) >= 0 || t.no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0;
    const terrs = q ? K.geo.list.filter(hit).slice(0, 30) : [];
    const changed = K.geo.list.filter(t => !t.off && K.boundsChanged(t));
    const offs = K.geo.list.filter(t => t.off);
    const row = t => `<button class="trow" data-act="bdOpen" data-t="${t.id}"><b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}${t.created ? '<small class="tag">新しい区域</small>' : ''}${t.renamed ? '<small class="tag">番号を変えた</small>' : ''}</span><span class="h num">${t.liveHouses || 0}軒</span></button>`;
    k.shell('区切りの手直し', `
      <p class="muted small">区域の区切り（どの家・どのブロックがどの区域か）を、地図の上で直します。家やブロックをとなりの区域に移す、区域を分ける・合わせる、線を描いて新しいブロックを足す（範囲を広げる）、使わない区域を外す、番号を変える、ができます。直した内容はすぐに全員の地図に効きます。</p>
      <p class="notice info small">記録は家ごとに残るので、区切りを直しても消えません。家の番号は並び直るので、直した区域の<b>区域カードは刷り直して</b>ください（［まとめて印刷］）。配布中の区域も直せますが、持っている人の画面がその場で変わるので、返ってからのほうが分かりやすいです。</p>
      <h2 class="sec">区域の地図を開いて直す</h2>
      <input id="bd-q" class="sel" type="search" placeholder="区域の番号か町名（例：Z07、桂岡）" value="${esc(BD.q)}" autocomplete="off">
      ${terrs.length ? `<div class="tlist">${terrs.map(row).join('')}</div>` : (q ? '<p class="muted small">見つかりません。</p>' : '<p class="muted small">番号か町名を入れると、区域が出ます。地図を開いて、ブロックや家の印をさわります。</p>')}
      ${changed.length ? `<h2 class="sec">区切りを直した区域<small class="badge">${changed.length}</small></h2><div class="tlist">${changed.map(row).join('')}</div>` : ''}
      ${offs.length ? `<h2 class="sec">外した区域（配らない・数えない）</h2><div class="tlist">${offs.map(t => `<div class="trow static"><b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h"><button class="btn sm" data-act="bdRestore" data-t="${t.id}">戻す</button></span></div>`).join('')}</div>` : ''}
      <h2 class="sec">手直しの記録</h2>
      ${logHtml()}`);
  };
  function logHtml() {
    const all = ((data() && data().boundaryEdits) || []).slice();
    if (!all.length) return '<p class="muted small">まだありません。</p>';
    // 組（まとめて入れたもの）ごとにまとめ、新しい順
    const groups = [];
    const byBatch = {};
    all.forEach(e => {
      const key = e.batch || e.id;
      if (!byBatch[key]) { byBatch[key] = { key: key, batch: e.batch, at: e.at, by: e.by, items: [], off: true }; groups.push(byBatch[key]); }
      byBatch[key].items.push(e);
      if (!e.off) byBatch[key].off = false;
    });
    groups.reverse();
    const line = e => {
      if (e.type === '家を移す') { const h = K.geo.house[e.targetId]; return '家' + (h && h.n ? ' ' + h.n : '') + ' を ' + esc(noOf(e.to)) + ' へ'; }
      if (e.type === 'ブロックを移す') { const b = K.geo.block[e.targetId]; return 'ブロック' + (b && b.t === e.to && b.n ? ' ' + b.n : '') + '（' + ((K.geo.byBlock[e.targetId] || []).length) + '軒）を ' + esc(noOf(e.to)) + ' へ'; }
      if (e.type === 'ブロックを足す') return esc(noOf(e.to)) + ' に線を描いてブロックを足した';
      if (e.type === '区域を作る') return '区域 ' + esc(e.no) + '（' + esc(e.town) + '）を作った';
      if (e.type === '区域を外す') return esc(noOf(e.targetId)) + ' を外した';
      if (e.type === '番号を変える') {
        // 変える前の番号：それより前の「作る」「番号を変える」、なければ元のデータ
        let prev = '';
        all.forEach(x => { if (x === e || x.off) return; if (x.id < e.id || all.indexOf(x) < all.indexOf(e)) { if ((x.type === '番号を変える' || x.type === '区域を作る') && x.targetId === e.targetId) prev = x.no; } });
        if (!prev) { const t = tOf(e.targetId); prev = t && t.base ? t.base.no : e.targetId; }
        return esc(prev) + ' の番号を ' + esc(e.no) + ' にした';
      }
      return esc(e.type);
    };
    return `<div class="blist">${groups.slice(0, 60).map(g => `<div class="brow ${g.off ? 'off' : ''}"><span><b>${esc(H.md(g.at))}</b>　${esc(g.by)}さん${g.off ? '　<small class="tag">元に戻した</small>' : ''}<br><small class="muted">${g.items.map(line).join('、')}${g.items[0].note ? '（' + esc(g.items[0].note) + '）' : ''}</small></span>
      <button class="btn sm ${g.off ? '' : 'ghost'}" data-act="bdToggle" data-key="${esc(g.batch ? 'b:' + g.batch : 'i:' + g.items[0].id)}" data-off="${g.off ? '' : '1'}">${g.off ? 'もう一度反映する' : '元に戻す'}</button></div>`).join('')}</div>`;
  }
  document.addEventListener('input', e => { if (e.target && e.target.id === 'bd-q') { BD.q = e.target.value; U.render(); const el = document.getElementById('bd-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } });
  act.bdOpen = el => U.go('aBoundsEdit', { tid: el.dataset.t });
  act.bdRestore = async el => {
    const t = tOf(el.dataset.t);
    const e = (data().boundaryEdits || []).slice().reverse().find(x => !x.off && x.type === '区域を外す' && x.targetId === el.dataset.t);
    if (!t || !e) return;
    if (!kit().sure(el, 'もう一度押すと戻す')) return;
    await toggle(e.batch ? { batch: e.batch } : { editIds: [e.id] }, true, t.no + ' を戻しました');
  };
  act.bdToggle = async el => {
    const off = !!el.dataset.off;    // 効いているものは「元に戻す」、戻したものは「もう一度反映する」
    if (off && !kit().sure(el, 'もう一度押すと元に戻す')) return;
    const key = el.dataset.key;
    await toggle(key.indexOf('b:') === 0 ? { batch: key.slice(2) } : { editIds: [key.slice(2)] }, off, off ? '元に戻しました' : 'もう一度反映しました');
  };
  async function toggle(sel, off, msg) {
    try {
      await kit().api('toggleBoundary', Object.assign({ off: off }, sel));
      kit().toast(msg);
      await kit().load();
      K.refresh().catch(() => {});
      U.render();
      return true;
    } catch (e) { return false; }
  }

  /* ==================== 地図で直す ==================== */
  let E = null;   // {map, t, blocks:{bid: layer}, labels:[], markers:{}, sel:Set, draw:null|[], line, pts:[]}
  function destroyE() { if (E) { try { E.map.remove(); } catch (e) { /* もう消えている */ } E = null; } }
  U.leaveHooks.push(destroyE);
  K.on('data', () => { if (E) refreshE(); });

  views.aBoundsEdit = async function (v) {
    const k = kit();
    if (!k.A.data) { k.shell('区切りの手直し', ''); await k.load(); if (U.view().name !== 'aBoundsEdit') return; }
    const t = tOf(v.tid);
    if (!t) { U.go('aBounds', null, true); return; }
    app.classList.add('fill');
    app.innerHTML = `
      ${U.demoBar()}
      <div class="cardview">
        ${U.topBar({ back: true, title: `<b class="num">${esc(t.no)}</b>`, sub: esc(t.town) + '・区切りの手直し' + (t.off ? '（外した区域）' : '') })}
        <div class="mapwrap">
          <div id="map" aria-label="${esc(t.no)}の区切り"></div>
          <div class="map-ctrl">
            <button data-act="bdZin" aria-label="大きくする">${I.plus}</button>
            <button data-act="bdZout" aria-label="小さくする">${I.minus}</button>
            <button data-act="bdFit" aria-label="区域の全体を見る">${I.fit}</button>
          </div>
          <div class="ed-bar bd-bar" data-bdbar></div>
        </div>
      </div>`;
    mountE(v);
  };

  /** となりの区域（この区域の範囲を少し広げた中に入るもの。近い順）。外した区域は入れない */
  function neighbors(t) {
    const g = K.geo;
    const bb = t.bb || g.list.filter(x => x.bb).reduce((a, x) => a ? [Math.min(a[0], x.bb[0]), Math.min(a[1], x.bb[1]), Math.max(a[2], x.bb[2]), Math.max(a[3], x.bb[3])] : x.bb.slice(), null);
    if (!bb) return [];
    const pad = 0.0025;   // 約250m
    const c = t.c || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    return g.list.filter(x => x.id !== t.id && !x.off && x.bb && x.bb[0] < bb[2] + pad && x.bb[2] > bb[0] - pad && x.bb[1] < bb[3] + pad && x.bb[3] > bb[1] - pad)
      .map(x => ({ t: x, d: x.c ? Math.hypot((x.c[0] - c[0]) * 111, (x.c[1] - c[1]) * 81) : 9 }))
      .sort((a, b) => a.d - b.d).slice(0, 14).map(x => x.t);
  }
  function mountE(v) {
    destroyE();
    if (!window.L) return;
    const t = tOf(v.tid);
    const map = L.map('map', { zoomControl: false, maxZoom: 20, minZoom: 12, zoomSnap: 0.5, wheelPxPerZoomLevel: 90, bounceAtZoomLimits: false });
    map.attributionControl.setPrefix(false);
    U.baseLayer(false).addTo(map);
    E = { map: map, t: t, v: v, blocks: {}, labels: [], markers: {}, sel: new Set(), draw: null, line: null, pts: [], nbrs: neighbors(t) };
    drawBlocks();
    if (BD.view && BD.view.tid === t.id) map.setView(BD.view.center, BD.view.zoom);
    else if (t.bb) map.fitBounds(L.latLngBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 });
    else if (E.nbrs.length && E.nbrs[0].bb) { const b = E.nbrs[0].bb; map.fitBounds(L.latLngBounds([[b[0], b[1]], [b[2], b[3]]]), { padding: [30, 30], maxZoom: 17 }); }
    else map.setView([43.14, 141.2], 13);
    BD.view = null;
    const zc = () => { const z = map.getZoom(), el = map.getContainer(); el.classList.toggle('z-lo', z < 17); el.classList.toggle('z-17', z >= 17 && z < 18); el.classList.toggle('z-18', z >= 18 && z < 19); };
    map.on('zoomend', zc);
    map.on('click', onClick);
    zc();
    refreshE();
    window.__bdCenter = (ll, z) => { if (E) E.map.setView(ll, z || E.map.getZoom(), { animate: false }); };   // 試験用
    setTimeout(() => { if (E && E.map === map) map.invalidateSize(); }, 60);
  }
  /** この区域のブロック（青）と、となりの区域のブロック（うすい灰）を描く */
  function drawBlocks() {
    const g = K.geo;
    Object.keys(E.blocks).forEach(id => E.blocks[id].remove());
    E.labels.forEach(l => l.remove());
    E.blocks = {}; E.labels = [];
    E.nbrs.forEach(n => {
      n.blocks.forEach(bid => { const b = g.block[bid]; if (b) E.blocks[bid] = L.polygon(b.poly, { className: 'blk bd-nb', interactive: false }).addTo(E.map); });
      if (n.c) E.labels.push(L.marker(n.c, { icon: L.divIcon({ className: 'blk-label bd-nbl', html: '<span>' + esc(n.no) + '</span>', iconSize: [70, 24] }), interactive: false, keyboard: false }).addTo(E.map));
    });
    E.t.blocks.forEach(bid => {
      const b = g.block[bid];
      if (!b) return;
      E.blocks[bid] = L.polygon(b.poly, { className: 'blk bd-mine' + (E.sel.has(bid) ? ' bd-sel' : '') + (b.added ? ' bd-added' : ''), interactive: false }).addTo(E.map);
      const c = [(b.bb[0] + b.bb[2]) / 2, (b.bb[1] + b.bb[3]) / 2];
      E.labels.push(L.marker(c, { icon: L.divIcon({ className: 'blk-label', html: '<span>ブロック' + b.n + '</span>', iconSize: [76, 24] }), interactive: false, keyboard: false }).addTo(E.map));
    });
  }
  function refreshE() {
    if (!E) return;
    const t = tOf(E.t.id);
    if (!t) { U.go('aBounds', null, true); return; }
    E.t = t;
    E.nbrs = neighbors(t);
    E.sel.forEach(bid => { if (t.blocks.indexOf(bid) < 0) E.sel.delete(bid); });
    drawBlocks();
    const st = K.houseStates();
    const hs = (K.geo.byTerr[t.id] || []).filter(h => !h.prov);
    const ids = new Set(hs.map(h => h.id));
    Object.keys(E.markers).forEach(id => { if (!ids.has(id)) { E.markers[id].remove(); delete E.markers[id]; } });
    hs.forEach(h => {
      const kind = K.houseKind(h, st).kind;
      const cls = kind === 'gone' ? 'hm k-gone' : kind === 'apt' ? 'hm big k-apt' : kind === 'wait' ? 'hm big k-wait' : kind === 'empty' ? 'hm k-empty' : 'hm s-未' + (h.tOver ? ' bd-over' : '');
      const html = '<i>' + (kind === 'gone' ? '×' : kind === 'apt' ? '集' : kind === 'wait' ? '?' : kind === 'empty' ? '空' : (h.n || '')) + '</i>';
      let mk = E.markers[h.id];
      if (!mk) mk = E.markers[h.id] = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: cls, html: html, iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(E.map);
      else if (mk._sig !== cls + html) mk.setIcon(L.divIcon({ className: cls, html: html, iconSize: [30, 30] }));
      mk._sig = cls + html;
    });
    drawLine();
    bar();
  }
  function drawLine() {
    if (!E) return;
    if (E.line) { E.line.remove(); E.line = null; }
    (E.pts || []).forEach(p => p.remove());
    E.pts = [];
    if (!E.draw) return;
    E.draw.forEach(ll => E.pts.push(L.circleMarker(ll, { radius: 6, className: 'bd-pt' }).addTo(E.map)));
    if (E.draw.length >= 2) E.line = L.polygon(E.draw, { className: 'blk bd-draw', interactive: false }).addTo(E.map);
  }
  /** 下の帯：今の状態に合わせて、できることを出す */
  function bar() {
    const el = document.querySelector('[data-bdbar]');
    if (!el || !E) return;
    const t = E.t;
    if (E.draw) {
      el.innerHTML = `<p><b>線を描いています</b>（${E.draw.length}点）。ブロックにしたい範囲の角を、順にさわってください。</p>
        <div class="row-btns"><button class="btn sm" data-act="bdDrawBack" ${E.draw.length ? '' : 'disabled'}>1つ戻す</button><button class="btn sm" data-act="bdDrawCancel">やめる</button><button class="btn sm primary" data-act="bdDrawDone" ${E.draw.length >= 3 ? '' : 'disabled'}>ここまで（線を閉じる）</button></div>`;
      return;
    }
    if (E.sel.size) {
      const n = Array.from(E.sel).reduce((a, bid) => a + (K.geo.byBlock[bid] || []).filter(h => !h.big).length, 0);
      el.innerHTML = `<p><b>ブロック ${E.sel.size} 個（${n}軒）</b>を選んでいます。${E.sel.size === t.blocks.length ? '（この区域の全部）' : ''}</p>
        <div class="row-btns"><button class="btn sm" data-act="bdSelClear">選び直す</button><button class="btn sm" data-act="bdMoveSel">となりの区域へ移す</button><button class="btn sm primary" data-act="bdSplit" ${E.sel.size === t.blocks.length ? 'disabled' : ''}>新しい区域にする（分ける）</button></div>`;
      return;
    }
    el.innerHTML = `<p class="small">${t.off ? '<b>外した区域です。</b>戻すときは一覧の［戻す］。' : 'ブロックをさわると選べます（となりの区域のブロックも）。家の印をさわると、その家だけ移せます。'}</p>
      <div class="row-btns"><button class="btn sm" data-act="bdDraw">線を描いてブロックを足す</button><button class="btn sm" data-act="bdTerrMenu">この区域…</button></div>`;
  }

  function onClick(e) {
    if (!E) return;
    const ll = [e.latlng.lat, e.latlng.lng];
    if (E.draw) { E.draw.push(ll); drawLine(); bar(); return; }
    // 家の印が近ければ家。そうでなければ、さわった所のブロック
    const p = E.map.latLngToContainerPoint(e.latlng);
    const z = E.map.getZoom();
    const thr = z >= 19 ? 22 : z >= 18 ? 18 : 14;
    let best = null, bd = 1e9;
    (K.geo.byTerr[E.t.id] || []).forEach(h => {
      const q = E.map.latLngToContainerPoint([h.lat, h.lon]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = h; }
    });
    if (best && bd <= thr) return openHouse(best);
    const bid = K.blockAt(ll[0], ll[1], E.t.id);
    if (!bid) return;
    const b = K.geo.block[bid];
    if (b.t === E.t.id) { if (E.sel.has(bid)) E.sel.delete(bid); else E.sel.add(bid); drawBlocks(); bar(); return; }
    openNeighborBlock(b);
  }

  /* ---------- 家を移す ---------- */
  function openHouse(h) {
    const b = K.geo.block[h.b];
    const home = b && b.t !== h.t ? tOf(b.t) : null;
    U.openSheet(U.sheetTitle('家 ' + esc(h.n || '')), `
      <p class="small">${esc(E.t.no)}・ブロック${b ? b.n : ''}${h.tOver && home ? '（もとは ' + esc(home.no) + ' の家。移してあります）' : ''}${h.added ? '・足した家' : ''}</p>
      <p class="muted small">この家だけを、となりの区域の家にします。家の印の場所は変わりません。記録はそのまま残ります。</p>
      ${nbrButtons('bdMoveHouse', { h: h.id })}
      ${h.tOver ? `<button class="btn ghost wide" data-act="bdHouseBack" data-h="${esc(h.id)}">もとの区域（${esc(home ? home.no : '')}）に戻す</button>` : ''}`);
  }
  function nbrButtons(actName, ds) {
    const extra = Object.keys(ds).map(k => `data-${k}="${esc(ds[k])}"`).join(' ');
    if (!E.nbrs.length) return '<p class="notice">となりに区域がありません。</p>';
    return `<div class="lbl">移す先</div><div class="blist">${E.nbrs.map(n => `<button class="brow btnrow" data-act="${actName}" data-to="${n.id}" ${extra}><b class="num">${esc(n.no)}</b><span class="town">${esc(n.town)}</span><span class="h num">${n.liveHouses || 0}軒</span></button>`).join('')}</div>`;
  }
  act.bdMoveHouse = async el => {
    const h = K.geo.house[el.dataset.h];
    const to = tOf(el.dataset.to);
    if (!h || !to) return;
    if (!kit().sure(el, '「' + to.no + '」に移す')) return;
    await save([{ type: '家を移す', targetId: h.id, to: to.id }], '家を ' + to.no + ' に移しました');
  };
  act.bdHouseBack = async el => {
    const e = (data().boundaryEdits || []).slice().reverse().find(x => !x.off && x.type === '家を移す' && x.targetId === el.dataset.h);
    if (!e) return;
    await toggleOnMap(e.batch ? { batch: e.batch } : { editIds: [e.id] }, '元の区域に戻しました');
  };

  /* ---------- ブロックを移す・分ける ---------- */
  function openNeighborBlock(b) {
    const t = tOf(b.t);
    const n = (K.geo.byBlock[b.id] || []).filter(h => !h.big).length;
    U.openSheet(U.sheetTitle(esc(t ? t.no : '') + ' <small>のブロック' + (b.n || '') + '</small>'), `
      <p class="small">${esc(t ? t.town : '')}・${n}軒${b.added ? '・線を描いて足したブロック' : ''}</p>
      <p class="muted small">このブロックを、いま開いている区域 <b>${esc(E.t.no)}</b> のブロックにします。中の家の記録はそのまま残ります。</p>
      <button class="btn primary big wide" data-act="bdTakeBlock" data-b="${esc(b.id)}">${esc(E.t.no)} に移す</button>`);
  }
  act.bdTakeBlock = async el => {
    const b = K.geo.block[el.dataset.b];
    if (!b) return;
    if (!kit().sure(el, 'もう一度押すと移す')) return;
    await save([{ type: 'ブロックを移す', targetId: b.id, to: E.t.id }], 'ブロックを ' + E.t.no + ' に移しました');
  };
  act.bdSelClear = () => { if (E) { E.sel.clear(); drawBlocks(); bar(); } };
  act.bdMoveSel = () => {
    if (!E || !E.sel.size) return;
    U.openSheet(U.sheetTitle('ブロックを移す'), `<p class="small">選んだ ${E.sel.size} 個のブロックを、となりの区域に移します。</p>${nbrButtons('bdMoveSelTo', {})}`);
  };
  act.bdMoveSelTo = async el => {
    const to = tOf(el.dataset.to);
    if (!E || !to) return;
    if (!kit().sure(el, '「' + to.no + '」に移す')) return;
    const items = Array.from(E.sel).map(bid => ({ type: 'ブロックを移す', targetId: bid, to: to.id }));
    if (await save(items, 'ブロック ' + items.length + ' 個を ' + to.no + ' に移しました')) E.sel.clear();
  };
  /** 新しい番号の候補：同じ親番号（Z07 など）の枝番の次 */
  function suggestNo(t) {
    const m = String(t.no).match(/^([A-Z]+\d+)(-(\d+))?$/);
    if (!m) return '';
    const head = m[1];
    let mx = 0;
    K.geo.list.forEach(x => { const q = String(x.no).match(/^([A-Z]+\d+)-(\d+)$/); if (q && q[1] === head) mx = Math.max(mx, Number(q[2])); });
    return head + '-' + (mx + 1);
  }
  function noTaken(no, exceptId) { return K.geo.list.some(x => !x.off && x.id !== exceptId && x.no === no); }
  act.bdSplit = () => {
    if (!E || !E.sel.size) return;
    const t = E.t;
    U.openSheet(U.sheetTitle('新しい区域にする'), `
      <p class="small">選んだ ${E.sel.size} 個のブロックで、新しい区域を作ります（${esc(t.no)} から分けます）。</p>
      <label class="lbl" for="bd-no">新しい区域の番号</label>
      <input id="bd-no" class="sel" value="${esc(suggestNo(t))}" placeholder="例：${esc(suggestNo(t) || 'Z07-9')}" autocomplete="off">
      <label class="lbl" for="bd-town">町</label>
      <input id="bd-town" class="sel" value="${esc(t.town)}" autocomplete="off">
      <button class="btn primary big wide" data-act="bdSplitGo">この番号で作る</button>`);
  };
  act.bdSplitGo = async el => {
    const no = String((document.getElementById('bd-no') || {}).value || '').trim().toUpperCase();
    const town = String((document.getElementById('bd-town') || {}).value || '').trim() || E.t.town;
    if (!/^[A-Z]{1,2}\d{1,3}(-\d{1,3})?$/.test(no)) { kit().toast('番号は「Z07-9」のような形にしてください'); return; }
    if (noTaken(no)) { kit().toast('その番号は、もう使っています'); return; }
    const items = [{ type: '区域を作る', no: no, town: town, note: E.t.no + ' から分けた' }].concat(Array.from(E.sel).map(bid => ({ type: 'ブロックを移す', targetId: bid, to: '$new' })));
    el.disabled = true;
    const r = await save(items, '区域 ' + no + ' を作りました');
    if (r) { E.sel.clear(); if (r.newId) U.go('aBoundsEdit', { tid: r.newId }, true); } else el.disabled = false;
  };

  /* ---------- 線を描いてブロックを足す ---------- */
  act.bdDraw = () => { if (!E) return; E.draw = []; drawLine(); bar(); kit().toast('ブロックにしたい範囲の角を、順にさわってください'); };
  act.bdDrawBack = () => { if (E && E.draw) { E.draw.pop(); drawLine(); bar(); } };
  act.bdDrawCancel = () => { if (E) { E.draw = null; drawLine(); bar(); } };
  act.bdDrawDone = () => {
    if (!E || !E.draw || E.draw.length < 3) return;
    const t = E.t;
    U.openSheet(U.sheetTitle('ブロックを足す'), `
      <p class="small">描いた線の中を、新しいブロックにします（${E.draw.length}点）。できたあと、［地図の手直し］で中に家を足せます。</p>
      <div class="seg two" id="bd-draw-to"><button data-v="here" aria-pressed="true">${esc(t.no)} のブロックにする</button><button data-v="new" aria-pressed="false">新しい区域にする</button></div>
      <div id="bd-new" hidden>
        <label class="lbl" for="bd-no">新しい区域の番号</label>
        <input id="bd-no" class="sel" value="${esc(suggestNo(t))}" autocomplete="off">
        <label class="lbl" for="bd-town">町</label>
        <input id="bd-town" class="sel" value="${esc(t.town)}" autocomplete="off">
      </div>
      <label class="lbl" for="bd-note">メモ（なくてもよい）</label>
      <input id="bd-note" class="sel" placeholder="例：新しい住宅地（2026年）" autocomplete="off">
      <button class="btn primary big wide" data-act="bdDrawSave">ブロックを足す</button>`);
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('#bd-draw-to button');
    if (!b) return;
    document.querySelectorAll('#bd-draw-to button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    const n = document.getElementById('bd-new');
    if (n) n.hidden = b.dataset.v !== 'new';
  });
  act.bdDrawSave = async el => {
    if (!E || !E.draw) return;
    const isNew = (document.querySelector('#bd-draw-to button[aria-pressed="true"]') || {}).dataset.v === 'new';
    const note = String((document.getElementById('bd-note') || {}).value || '');
    const items = [];
    if (isNew) {
      const no = String((document.getElementById('bd-no') || {}).value || '').trim().toUpperCase();
      const town = String((document.getElementById('bd-town') || {}).value || '').trim() || E.t.town;
      if (!/^[A-Z]{1,2}\d{1,3}(-\d{1,3})?$/.test(no)) { kit().toast('番号は「Z07-9」のような形にしてください'); return; }
      if (noTaken(no)) { kit().toast('その番号は、もう使っています'); return; }
      items.push({ type: '区域を作る', no: no, town: town, note: note });
      items.push({ type: 'ブロックを足す', to: '$new', shape: E.draw, town: town, note: note });
    } else items.push({ type: 'ブロックを足す', to: E.t.id, shape: E.draw, town: E.t.town, note: note });
    el.disabled = true;
    const r = await save(items, 'ブロックを足しました');
    if (r) { E.draw = null; if (r.newId) U.go('aBoundsEdit', { tid: r.newId }, true); } else el.disabled = false;
  };

  /* ---------- この区域：番号を変える・外す・合わせる ---------- */
  act.bdTerrMenu = () => {
    if (!E) return;
    const t = E.t;
    U.openSheet(U.sheetTitle(esc(t.no) + ' <small>' + esc(t.town) + '</small>'), `
      <p class="small">ブロック ${t.blocks.length} 個・${t.liveHouses || 0}軒${t.created ? '・新しく作った区域' : ''}${t.renamed ? '・番号を変えてあります' : ''}</p>
      <button class="btn wide" data-act="bdRename">番号・町を変える</button>
      <button class="btn wide" data-act="bdMerge">となりの区域を合わせてひとつにする</button>
      ${t.off ? '' : `<button class="btn ghost wide" data-act="bdRetire">この区域を外す（配らない・数えない）</button>`}
      <p class="muted small">外した区域は、記録を残したまま、配る候補・一巡の計画・印刷から外れます。一覧の［戻す］でいつでも戻せます。</p>`);
  };
  act.bdRename = () => {
    const t = E.t;
    U.openSheet(U.sheetTitle('番号・町を変える'), `
      <label class="lbl" for="bd-no">区域の番号</label>
      <input id="bd-no" class="sel" value="${esc(t.no)}" autocomplete="off">
      <label class="lbl" for="bd-town">町</label>
      <input id="bd-town" class="sel" value="${esc(t.town)}" autocomplete="off">
      <p class="muted small">今までの配布と記録は、そのまま新しい番号で出ます（S-13 も）。利用カードは変わりません。</p>
      <button class="btn primary big wide" data-act="bdRenameGo">変える</button>`);
  };
  act.bdRenameGo = async el => {
    const no = String((document.getElementById('bd-no') || {}).value || '').trim().toUpperCase();
    const town = String((document.getElementById('bd-town') || {}).value || '').trim();
    if (!/^[A-Z]{1,2}\d{1,3}(-\d{1,3})?$/.test(no)) { kit().toast('番号は「Z07-9」のような形にしてください'); return; }
    if (noTaken(no, E.t.id)) { kit().toast('その番号は、ほかの区域が使っています'); return; }
    if (no === E.t.no && town === E.t.town) { U.closeSheet(); return; }
    el.disabled = true;
    if (!await save([{ type: '番号を変える', targetId: E.t.id, no: no, town: town }], '番号を ' + no + ' にしました')) el.disabled = false;
  };
  act.bdMerge = () => {
    U.openSheet(U.sheetTitle('区域を合わせる'), `<p class="small">選んだとなりの区域の全部のブロックを <b>${esc(E.t.no)}</b> に移し、その区域を外します（記録は残ります）。</p>${nbrButtons('bdMergeGo', {})}`);
  };
  act.bdMergeGo = async el => {
    const o = tOf(el.dataset.to);
    if (!E || !o) return;
    if (!kit().sure(el, '「' + o.no + '」を合わせる')) return;
    const items = o.blocks.map(bid => ({ type: 'ブロックを移す', targetId: bid, to: E.t.id })).concat([{ type: '区域を外す', targetId: o.id, note: E.t.no + ' に合わせた' }]);
    (K.geo.byTerr[o.id] || []).forEach(h => { if (h.tOver === o.id) items.push({ type: '家を移す', targetId: h.id, to: E.t.id }); });
    await save(items, o.no + ' を ' + E.t.no + ' に合わせました');
  };
  act.bdRetire = async el => {
    if (!kit().sure(el, 'もう一度押すと外す')) return;
    const t = E.t;
    if (await save([{ type: '区域を外す', targetId: t.id }], t.no + ' を外しました')) U.go('aBounds', null, true);
  };

  /* ---------- 送る ---------- */
  async function save(items, msg) {
    try {
      if (E) BD.view = { tid: E.t.id, center: E.map.getCenter(), zoom: E.map.getZoom() };
      const r = await kit().api('editBoundary', { items: items });
      kit().toast(msg);
      U.closeSheet();
      await kit().load();
      K.refresh().catch(() => {});
      if (E) { mountE(E.v); }
      return r;
    } catch (e) { BD.view = null; return null; }
  }
  async function toggleOnMap(sel, msg) {
    if (E) BD.view = { tid: E.t.id, center: E.map.getCenter(), zoom: E.map.getZoom() };
    U.closeSheet();
    const ok = await toggle(sel, true, msg);
    if (!ok) BD.view = null;
  }
  Object.assign(act, {
    bdZin: () => E && E.map.zoomIn(1),
    bdZout: () => E && E.map.zoomOut(1),
    bdFit: () => { if (E && E.t.bb) E.map.fitBounds(L.latLngBounds([[E.t.bb[0], E.t.bb[1]], [E.t.bb[2], E.t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 }); },
  });
})();

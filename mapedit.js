/*
 * 区域訪問管理 — 地図の手直し（上位管理者）
 *   現地からの「地図にない家」の知らせ → 地図で確かめて家を足す／見送る
 *   区域の地図を開いて、家を足す・場所を直す・建物の扱いを変える
 *   国土地理院の地図（ベクトルタイル）の更新と比べて、新しい建物・なくなった家の候補を出す
 * 直した内容は「家の手直し」シートに残り、すぐに全員の地図に重なる（元のデータは変えない）
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

  /* ==================== 一覧 ==================== */
  const CMP = { running: false, done: 0, total: 0, result: null, err: null, at: '', latest: '', baseMade: '', baseLatest: '', failed: 0 };
  function mapReports() {
    return ((data() && data().reports) || []).filter(r => !r.houseId && !r.roomId && r.lat !== null && r.lat !== undefined);
  }
  function terrOf(id) { return K.geo.terr[id] || { no: id || '—', town: '' }; }
  function editLabel(e) {
    if (e.type === '足す') return '家を足した';
    if (e.type === '動かす') return '場所を直した';
    return e.houseId ? '候補を見送った（家はある）' : '候補を見送った（家ではない）';
  }

  views.aMap = async function () {
    const k = kit();
    if (!k.A.data || U.view().fresh) { k.shell('地図の手直し', ''); await k.load(); U.view().fresh = false; }
    if (U.view().name !== 'aMap') return;
    if (!k.top()) return k.shell('地図の手直し', '<p class="notice">上位管理者だけが使えます。</p>');
    const d = data();
    const reps = mapReports();
    const q = k.S['m-q'].trim().toLowerCase();
    const terrs = q ? K.geo.list.filter(t => (t.no + ' ' + t.town).toLowerCase().indexOf(q) >= 0 || t.no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0).slice(0, 30) : [];
    const edits = (d.houseEdits || []).slice().reverse();
    k.shell('地図の手直し', `
      <p class="muted small">地図の家の印は、国土地理院の地図をもとに作ったものです。新しく建った家や、なくなった家は、ここで直します。直した内容は、すぐに全員の地図に出ます（元のデータは変えずに、上に重ねます）。</p>

      <h2 class="sec">現地からの知らせ${reps.length ? `<small class="badge">${reps.length}</small>` : ''}</h2>
      ${reps.length ? `<div class="tlist">${reps.map(r => { const t = terrOf(r.territoryId); return `<button class="trow" data-act="mxRep" data-rep="${esc(r.id)}">
        <b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h">${I.chev}</span><span class="st">${esc(r.note)}・${esc(r.by)}さん・${esc(H.mdShort(r.at))}</span></button>`; }).join('')}</div>` : '<p class="muted small">今はありません。区域の画面の「地図にない家を知らせる」から届きます。</p>'}

      <h2 class="sec">国土地理院の地図と比べる</h2>
      ${cmpBlock()}

      <h2 class="sec">区域の地図を開いて直す</h2>
      <input id="m-q" class="sel" type="search" placeholder="区域の番号か町名（例：Z05、桂岡）" value="${esc(k.S['m-q'])}" autocomplete="off">
      ${terrs.length ? `<div class="tlist">${terrs.map(t => `<button class="trow" data-act="mxOpen" data-t="${t.id}"><b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h num">${(K.geo.byTerr[t.id] || []).length}軒</span></button>`).join('')}</div>` : (q ? '<p class="muted small">見つかりません。</p>' : '<p class="muted small">地図をさわると家を足せます。家の印をさわると、場所を直したり、扱いを変えたりできます。</p>')}

      <h2 class="sec">手直しと更新の記録</h2>
      <p class="muted small">家を足した・場所を直した・見送った・「なくなった」にした、などを、日ごと・国土地理院の回ごとに見られます。1件ずつでも、その日の分をまとめてでも<b>元に戻す</b>ことができ、戻したものを<b>もう一度反映する</b>こともできます（記録は消えません）。</p>
      <div class="ml-sum">
        <div><span class="muted small">今効いている手直し</span><b>${edits.filter(e => !e.off).length}</b></div>
        <div><span class="muted small">元に戻したもの</span><b>${edits.filter(e => e.off).length}</b></div>
        <div><span class="muted small">いちばん新しい</span><b class="small">${edits.length ? esc(H.mdShort(edits[0].at)) : '—'}</b></div>
      </div>
      <button class="btn primary wide" data-act="aGo" data-v="aMapLog">${I.map}<span>記録を見る・元に戻す・もう一度反映する</span></button>`);
  };

  function cmpBlock() {
    const r = CMP.result;
    const intro = `<p class="muted small">国土地理院の地図が新しくなったときに、区域の中に新しい建物や、消えた建物がないかを確かめます。区域を覆う約150枚の地図（約2MB）を読むので、Wi-Fi のある所で使ってください。</p>
      <details class="report"><summary>国土地理院の地図は、どう新しくなる？</summary>
        <p class="muted small">国土地理院の地図（地理院地図Vector）は、およそ3か月ごとにまとめて新しくなります（1月・4月・7月・10月の時点の内容が、2〜3か月あとに出ます）。ただ、ふつうの家が載るのは、市の地図を作り直すとき（都市計画区域ではおよそ5年ごと）なので、建ってから載るまで何年もかかることがあります。道路や大きな建物は早めに載ります。</p>
        <p class="muted small">そのため、新しく建った家に気づいたら、先に「地図にない家を知らせる」や、区域の地図で直接足しておきます。ここでは、見落としがないかを確かめます。比べる基準の地図は、区域の割り方を作り直すときに作り直します。</p>
      </details>
      ${K.cfg.gsiPack ? '<p class="notice info">お試し版では、見本の区域の地図（10枚）で比べます。変化は見本として入れてあります。</p>' : ''}`;
    if (CMP.running) {
      const pct = CMP.total ? Math.round(CMP.done / CMP.total * 100) : 0;
      return `${intro}<div class="progress" aria-label="読み込み"><i style="width:${pct}%"></i></div><p class="muted small">地図を読んでいます（${CMP.done} / ${CMP.total || '…'}枚）</p>`;
    }
    if (CMP.err) {
      const gone = CMP.err.gsi;
      return `${intro}<div class="notice">比べられませんでした：${esc(CMP.err.message || CMP.err)}</div>
        ${gone ? `<p class="muted small">国土地理院につながらないか、データの公開をやめた・置き場所が変わった、ということも考えられます。比べられなくても、区域の地図・記録・地図の手直し・「地図にない家を知らせる」は、これまでどおり使えます（地図の下地は、保存した地図で出ます）。国土地理院が新しい場所で同じ形のデータを出したときは、js/config.js の gsiVtUrl にその場所を書くと、また比べられます。</p>` : ''}
        <button class="btn" data-act="mxCompare">もう一度比べる</button>`;
    }
    if (!r) return `${intro}<button class="btn primary" data-act="mxCompare">${I.map}<span>国土地理院の地図と比べる</span></button>`;
    const nc = r.newCands, gc = r.goneCands;
    const left = x => !x.done;
    const fmtLM = s => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
    return `${intro}
      <div class="cmp-sum">
        <div><span class="muted small">新しい建物</span><b>${nc.filter(left).length}</b></div>
        <div><span class="muted small">なくなったかも</span><b>${gc.filter(left).length}</b></div>
        <div><span class="muted small">更新された地図</span><b>${r.changedTiles}<small class="muted"> / ${r.checked}枚</small></b></div>
      </div>
      <p class="muted small">基準の地図は${esc(fmtLM(CMP.baseMade))}に作ったもの（国土地理院の地図の${esc(fmtLM(CMP.baseLatest))}更新分まで）。今回読んだ地図でいちばん新しい更新は${esc(fmtLM(CMP.latest))}です。${CMP.failed ? '<b>' + CMP.failed + '枚は読めませんでした。</b>' : ''}</p>
      ${!nc.length && !gc.length ? '<p class="notice info">変わったところは見つかりませんでした。</p>' : ''}
      ${nc.length ? `<h3 class="ghead">新しい建物（家かどうか確かめる）</h3><div class="tlist">${nc.map((c, i) => { const t = terrOf(c.territoryId); return `<button class="trow ${c.done ? 'out' : ''}" data-act="mxCand" data-k="new" data-i="${i}">
        <b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h">${c.done ? esc(c.done) : I.chev}</span><span class="st">約${c.a}㎡の建物${c.done ? '・さわると元に戻せます' : ''}</span></button>`; }).join('')}</div>` : ''}
      ${gc.length ? `<h3 class="ghead">なくなったかもしれない家</h3><div class="tlist">${gc.map((c, i) => { const t = terrOf(c.territoryId); const h = K.geo.house[c.houseId]; return `<button class="trow ${c.done ? 'out' : ''}" data-act="mxCand" data-k="gone" data-i="${i}">
        <b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h">${c.done ? esc(c.done) : I.chev}</span><span class="st">${h && h.n ? '家 ' + h.n : '建物'}の印のところに、建物がなくなっています${c.done ? '・さわると元に戻せます' : ''}</span></button>`; }).join('')}</div>` : ''}
      <button class="btn ghost" data-act="mxCompare">もう一度比べる</button>`;
  }

  const fmtJ = s => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
  /** 国土地理院から反映したことが分かるメモ（記録の画面で「国土地理院の回」にまとめる） */
  const gsiTag = () => '（国土地理院 ' + fmtJ(CMP.latest) + '更新分）';
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' を読めませんでした'); return r.json(); }
  function b64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  let cmpPaint = 0;
  function cmpRender() {
    if (U.view().name !== 'aMap') return;
    const now = Date.now();
    if (CMP.running && now - cmpPaint < 250) return;
    cmpPaint = now;
    U.render();
  }
  async function runCompare() {
    if (CMP.running) return;
    if (!window.KGSI) { CMP.err = new Error('比べる部品を読めませんでした'); return cmpRender(); }
    Object.assign(CMP, { running: true, done: 0, total: 0, result: null, err: null, failed: 0, latest: '' });
    cmpRender();
    try {
      const base = await fetchJSON(K.cfg.gsiBaseUrl || 'data/gsi-base.json');
      const pack = K.cfg.gsiPack ? await fetchJSON(K.cfg.gsiPack) : null;
      let keys = Object.keys(base.tiles);
      if (pack) keys = keys.filter(k => pack[k]);
      CMP.total = keys.length;
      CMP.baseMade = base.made;
      CMP.baseLatest = Object.keys(base.tileDates || {}).sort().pop() || '';
      const tiles = [];
      const q = keys.slice();
      let latest = 0;
      const worker = async () => {
        while (q.length) {
          const key = q.shift();
          const [x, y] = key.split('/').map(Number);
          try {
            let buf, lm = '';
            if (pack) { buf = b64(pack[key][0]); lm = pack[key][1] || ''; }
            else {
              const r = await fetch((K.cfg.gsiVtUrl || KGSI.TILE_URL).replace('{z}', KGSI.Z).replace('{x}', x).replace('{y}', y), { mode: 'cors', cache: 'no-store' });
              if (!r.ok) throw new Error(String(r.status));
              lm = r.headers.get('last-modified') || '';
              buf = new Uint8Array(await r.arrayBuffer());
            }
            const t = Date.parse(lm);
            if (t > latest) latest = t;
            tiles.push({ x: x, y: y, buf: buf });
          } catch (e) { CMP.failed++; }
          CMP.done++;
          cmpRender();
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (!tiles.length) throw Object.assign(new Error(K.net.online ? '国土地理院のデータを1枚も読めませんでした' : '電波がありません。電波のある所で、もう一度押してください'), { gsi: K.net.online });
      const st = K.houseStates();
      const houses = Object.keys(K.geo.house).map(id => { const h = K.geo.house[id]; return { id: id, lat: h.lat, lon: h.lon, t: h.t, added: !!(h.added || h.prov), kind: K.houseKind(h, st).kind }; });
      const edits = (data().houseEdits || []).filter(e => !e.off);
      const skips = edits.filter(e => e.type === '見送り').map(e => e.houseId ? { houseId: e.houseId } : { lat: e.lat, lon: e.lon })
        .concat(edits.filter(e => e.type === '足す' && e.lat !== null).map(e => ({ lat: e.lat, lon: e.lon })))
        .concat(mapReports().map(r => ({ lat: r.lat, lon: r.lon })));
      await K.sleep(30);
      const res = KGSI.compare({ base: base, tiles: tiles, blocks: K.geo.block, houses: houses, skips: skips, drop: K.cfg.gsiDemoDrop || [] });
      CMP.result = res;
      CMP.latest = latest ? new Date(latest).toISOString() : '';
      CMP.at = new Date().toISOString();
      // 比べたことを記録に残す（いつ・何月の更新分まで・候補の数）
      kit().api('logCompare', { text: fmtJ(CMP.latest) + '更新分まで・新しい建物' + res.newCands.length + '・なくなったかも' + res.goneCands.length + '・更新された地図' + res.changedTiles + '/' + res.checked + '枚' }).catch(() => {});
    } catch (e) { CMP.err = e; }
    CMP.running = false;
    cmpPaint = 0;
    cmpRender();
  }

  act.mxCompare = () => runCompare();
  act.mxOpen = el => U.go('aMapEdit', { tid: el.dataset.t });
  act.mxRep = el => {
    const r = mapReports().find(x => x.id === el.dataset.rep);
    if (!r) return;
    const tid = r.territoryId && K.geo.terr[r.territoryId] ? r.territoryId : (K.geo.block[K.blockAt(r.lat, r.lon)] || {}).t;
    if (!tid) { kit().toast('区域が分かりませんでした'); return; }
    U.go('aMapEdit', { tid: tid, rep: r.id });
  };
  act.mxCand = el => {
    const list = el.dataset.k === 'new' ? CMP.result.newCands : CMP.result.goneCands;
    const c = list[Number(el.dataset.i)];
    if (!c) return;
    if (c.done && c.ref) {
      const t = terrOf(c.territoryId || (K.geo.house[c.houseId] || {}).t);
      U.openSheet(U.sheetTitle(esc(t.no) + ' <small>' + esc(t.town) + '</small>'), `
        <p>この候補は「<b>${esc(c.done)}</b>」にしました。</p>
        <p class="muted small">元に戻すと、地図はその前にもどり、この候補をもう一度決められます。あとで「手直しと更新の記録」から、もう一度反映することもできます。</p>
        <button class="btn primary big wide" data-act="mxCandUndo" data-k="${esc(el.dataset.k)}" data-i="${esc(el.dataset.i)}">元に戻す</button>`);
      return;
    }
    const tid = c.territoryId || (K.geo.house[c.houseId] || {}).t;
    if (!tid) return;
    U.go('aMapEdit', { tid: tid, cand: el.dataset.k, ci: Number(el.dataset.i) });
  };
  act.mxCandUndo = async el => {
    const list = el.dataset.k === 'new' ? CMP.result.newCands : CMP.result.goneCands;
    const c = list[Number(el.dataset.i)];
    if (!c || !c.ref) return;
    el.disabled = true;
    try {
      await kit().api('toggleMapChanges', { items: [c.ref], off: true });
      kit().toast('「' + c.done + '」を元に戻しました');
      c.done = ''; c.ref = null;
      U.closeSheet();
      await kit().load();
      K.refresh().catch(() => {});
      U.render();
    } catch (e) { el.disabled = false; }
  };
  act.mxShow = el => {
    const e = (data().houseEdits || []).find(x => x.id === el.dataset.e);
    if (!e) return;
    const h = K.geo.house[e.houseId];
    const tid = e.territoryId || (h && h.t) || (e.lat !== null ? (K.geo.block[K.blockAt(e.lat, e.lon)] || {}).t : '');
    if (!tid) { kit().toast('区域が分かりませんでした'); return; }
    U.go('aMapEdit', { tid: tid, focus: e.lat !== null ? [e.lat, e.lon] : null, focusHouse: e.houseId || '' });
  };
  act.mxUndo = async el => {
    if (!kit().sure(el, 'もう一度押すと取り消す')) return;
    await undoEdit(el.dataset.e);
    U.render();
  };
  async function undoEdit(id) {
    try {
      await kit().api('undoHouseEdit', { editId: id });
      kit().toast('手直しを取り消しました');
      await kit().load();
      K.refresh().catch(() => {});
      return true;
    } catch (e) { return false; }
  }

  /* ==================== 手直しと更新の記録（元に戻す・もう一度反映する） ==================== */
  const ML = { data: null, err: null, loading: false, src: 'all', show: 'all' };
  const STATE_LABEL = { 'なくなった': '「なくなった」にした', '家ではない': '「家ではない」にした', '空き家': '「空き家」にした', '集合住宅': '「集合住宅」にした', '確認待ち': '「確認待ち」にした', '家': '「家」にもどした' };
  /** どこから来た変更か：国土地理院・現地の知らせ・建物の仕分け（集合住宅・家ではない など）・手で直した */
  const sourceOf = x => (/国土地理院/.test(x.note || '') ? 'gsi' : (x.reportId || /知らせ/.test(x.note || '')) ? 'report' : x.kind === 'state' && x.state !== 'なくなった' ? 'sort' : 'hand');
  const SRC = { gsi: '国土地理院から', report: '現地の知らせから', sort: '建物の仕分け', hand: '手で直した' };
  const dayOf = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const hm = iso => { const d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dayJ = day => { const p = day.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2]); return p[0] + '年' + p[1] + '月' + p[2] + '日（' + '日月火水木金土'[d.getDay()] + '）'; };
  function mlEntries() {
    const d = ML.data;
    const es = d.edits.map(e => ({
      kind: 'edit', id: e.id, at: e.at, houseId: e.houseId, territoryId: e.territoryId, note: e.note, by: e.by, off: e.off, offAt: e.offAt, offBy: e.offBy,
      label: e.type === '足す' ? '家を足した' : e.type === '動かす' ? '家の場所を直した' : e.houseId ? '見送った（家はまだある）' : '見送った（家ではない）',
      src: sourceOf(Object.assign({ kind: 'edit' }, e)), lat: e.lat, lon: e.lon,
    }));
    const ss = d.states.map(x => ({
      kind: 'state', id: x.id, at: x.at, houseId: x.houseId, territoryId: (K.geo.house[x.houseId] || {}).t || '', note: x.note, by: x.by, off: x.off, offAt: x.offAt, offBy: x.offBy,
      label: STATE_LABEL[x.state] || '「' + x.state + '」にした', src: sourceOf(Object.assign({ kind: 'state' }, x)), prev: x.prev, current: x.current, now: x.now, state: x.state,
    }));
    return es.concat(ss).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  views.aMapLog = async function () {
    const k = kit();
    if (!k.top()) return k.shell('手直しと更新の記録', '<p class="notice">上位管理者だけが使えます。</p>');
    if (U.view().fresh) { ML.data = null; ML.err = null; U.view().fresh = false; }
    if (!ML.data) {
      if (!ML.loading && !ML.err) {
        ML.loading = true;
        k.api('mapHistory', {}).then(r => { ML.data = r; }).catch(e => { ML.err = e; }).finally(() => { ML.loading = false; if (U.view().name === 'aMapLog') U.render(); });
      }
      return k.shell('手直しと更新の記録', ML.err ? `<div class="notice">${esc(ML.err.message || '読めませんでした')}</div><button class="btn" data-act="mlReload">もう一度読む</button>` : '<p class="muted">読んでいます…</p>');
    }
    const all = mlEntries();
    const list = all.filter(x => (ML.src === 'all' || x.src === ML.src) && (ML.show === 'all' || (ML.show === 'on' ? !x.off : x.off)));
    const days = [];
    const byDay = {};
    list.forEach(x => { const dd = dayOf(x.at); if (!byDay[dd]) { byDay[dd] = []; days.push(dd); } byDay[dd].push(x); });
    const cmpByDay = {};
    (ML.data.compares || []).forEach(c => { const dd = dayOf(c.at); (cmpByDay[dd] = cmpByDay[dd] || []).push(c); });
    const lastCmp = (ML.data.compares || []).slice(-1)[0];
    const row = x => {
      const t = terrOf(x.territoryId);
      const stale = x.kind === 'state' && !x.off && !x.current;
      return `<div class="rrow ml-row ${x.off ? 'off' : ''}"><div class="rmain"><b>${esc(x.label)}</b><span class="num">${esc(t.no)}</span><span class="muted small">${esc(t.town)}・${esc(hm(x.at))}・${esc(x.by)}${x.note ? '・' + esc(x.note) : ''}</span>
        ${x.off ? `<span class="tag">元に戻した${x.offAt ? '（' + esc(hm(x.offAt)) + (x.offBy ? '・' + esc(x.offBy) : '') + '）' : ''}</span>` : '<span class="tag ok">反映中</span>'}
        ${x.kind === 'state' && !x.off ? `<span class="muted small">${stale ? 'あとで「' + esc(x.now) + '」にしたので、今の地図には効いていません' : 'その前は「' + esc(x.prev) + '」'}</span>` : ''}</div>
        <div class="ractions"><button class="btn sm" data-act="mlShow" data-k="${x.kind}" data-id="${esc(x.id)}">地図で見る</button>${x.off ? `<button class="btn sm" data-act="mlToggle" data-k="${x.kind}" data-id="${esc(x.id)}" data-h="${esc(x.houseId)}" data-off="">もう一度反映する</button>` : `<button class="btn sm" data-act="mlToggle" data-k="${x.kind}" data-id="${esc(x.id)}" data-h="${esc(x.houseId)}" data-off="1">元に戻す</button>`}</div></div>`;
    };
    // まとめて戻すのは、選んでいる種類の分だけ（「すべて」のときは国土地理院から反映した分だけ）
    const bulkSrc = ML.src === 'all' ? 'gsi' : ML.src;
    const body = days.map(dd => {
      const xs = byDay[dd];
      const bx = xs.filter(x => x.src === bulkSrc);
      const on = bx.filter(x => !x.off).length, off = bx.length - on;
      const gsi = xs.some(x => x.src === 'gsi');
      return `<section class="ml-day"><h3 class="ghead">${esc(dayJ(dd))}<small>${xs.length}件${gsi ? '・国土地理院から' : ''}</small></h3>
        ${(cmpByDay[dd] || []).map(c => `<p class="small bk-note">国土地理院の地図と比べた（${esc(hm(c.at))}・${esc(c.by)}）：${esc(c.text)}</p>`).join('')}
        ${xs.map(row).join('')}
        <div class="row wrap ml-acts">${on ? `<button class="btn sm" data-act="mlDay" data-d="${dd}" data-off="1">この日の「${SRC[bulkSrc]}」の分をまとめて元に戻す（${on}件）</button>` : ''}${off ? `<button class="btn sm" data-act="mlDay" data-d="${dd}" data-off="">「${SRC[bulkSrc]}」の戻したものを、まとめてもう一度反映する（${off}件）</button>` : ''}</div></section>`;
    }).join('');
    const onN = all.filter(x => !x.off).length;
    k.shell('手直しと更新の記録', `
      <p class="muted small">地図の手直しと、国土地理院の地図からの反映の記録です。どれも記録は消さずに、<b>元に戻す</b>・<b>もう一度反映する</b>を何度でもできます。建物の状態（なくなった・家ではない など）は、元に戻すとその前の状態にもどります。まとめて戻すのは、上で選んでいる種類の分だけです（「すべて」のときは国土地理院から反映した分）。</p>
      <div class="ml-sum">
        <div><span class="muted small">反映中</span><b>${onN}</b></div>
        <div><span class="muted small">元に戻したもの</span><b>${all.length - onN}</b></div>
        <div><span class="muted small">最後に比べた日</span><b class="small">${lastCmp ? esc(hm(lastCmp.at)) : '—'}</b></div>
      </div>
      ${lastCmp ? `<p class="muted small">最後に国土地理院の地図と比べたとき：${esc(lastCmp.text)}</p>` : ''}
      <div class="seg wrap">${[['all', 'すべて'], ['gsi', '国土地理院から'], ['report', '現地の知らせから'], ['sort', '建物の仕分け'], ['hand', '手で直した']].map(o => `<button data-act="mlSrc" data-v="${o[0]}" aria-pressed="${ML.src === o[0]}">${o[1]}<small>${o[0] === 'all' ? all.length : all.filter(x => x.src === o[0]).length}</small></button>`).join('')}</div>
      <div class="seg three">${[['all', '全部'], ['on', '反映中'], ['off', '元に戻したもの']].map(o => `<button data-act="mlShowF" data-v="${o[0]}" aria-pressed="${ML.show === o[0]}">${o[1]}</button>`).join('')}</div>
      ${body || '<p class="empty">ありません。</p>'}`);
  };
  async function mlApply(items, off, msg) {
    if (!items.length) return;
    try {
      const r = await kit().api('toggleMapChanges', { items: items, off: off });
      kit().toast(msg.replace('{n}', r.changed));
      ML.data = null;
      await kit().load();
      K.refresh().catch(() => {});
      U.render();
    } catch (e) { /* api が知らせる */ }
  }
  act.mlReload = () => { ML.err = null; ML.data = null; U.render(); };
  act.mlSrc = el => { ML.src = el.dataset.v; U.render(); };
  act.mlShowF = el => { ML.show = el.dataset.v; U.render(); };
  act.mlToggle = async el => {
    const off = !!el.dataset.off;
    el.disabled = true;
    await mlApply([{ kind: el.dataset.k, id: el.dataset.id, houseId: el.dataset.h }], off, off ? '元に戻しました' : 'もう一度反映しました');
    el.disabled = false;
  };
  act.mlDay = async el => {
    const off = !!el.dataset.off;
    if (!kit().sure(el, off ? 'もう一度押すと、まとめて元に戻します' : 'もう一度押すと、まとめてもう一度反映します')) return;
    const src = ML.src === 'all' ? 'gsi' : ML.src;
    const xs = mlEntries().filter(x => dayOf(x.at) === el.dataset.d && x.src === src && (off ? !x.off : x.off));
    // 状態の変更は、新しいものから戻す（同じ家を何度か変えていても、前の状態にもどる）
    el.disabled = true;
    await mlApply(xs.map(x => ({ kind: x.kind, id: x.id, houseId: x.houseId })), off, off ? '{n}件を元に戻しました' : '{n}件をもう一度反映しました');
  };
  act.mlShow = el => {
    const x = mlEntries().find(y => y.kind === el.dataset.k && y.id === el.dataset.id);
    if (!x) return;
    const h = K.geo.house[x.houseId];
    const tid = x.territoryId || (h && h.t) || (x.lat !== null && x.lat !== undefined ? (K.geo.block[K.blockAt(x.lat, x.lon)] || {}).t : '');
    if (!tid) { kit().toast('区域が分かりませんでした'); return; }
    U.go('aMapEdit', { tid: tid, focus: x.lat !== null && x.lat !== undefined ? [x.lat, x.lon] : null, focusHouse: x.houseId || '' });
  };

  /* ==================== 区域の地図で直す ==================== */
  let E = null;
  let photo = false;
  function destroyE() { if (E) { try { E.map.remove(); } catch (e) { /* もう消えている */ } E = null; } }
  U.leaveHooks.push(destroyE);
  K.on('houseEdit', () => { if (E) refreshE(); });
  K.on('data', () => { if (E) refreshE(); });

  views.aMapEdit = async function (v) {
    const k = kit();
    if (!k.A.data) { k.shell('地図の手直し', ''); await k.load(); if (U.view().name !== 'aMapEdit') return; }
    const t = K.geo.terr[v.tid];
    if (!t) { U.go('aMap', null, true); return; }
    app.classList.add('fill');
    app.innerHTML = `
      ${U.demoBar()}
      <div class="cardview">
        ${U.topBar({ back: true, title: `<b class="num">${esc(t.no)}</b>`, sub: esc(t.town) + '・地図の手直し' })}
        <div class="mapwrap">
          <div id="map" aria-label="${esc(t.no)}の地図"></div>
          <div class="map-ctrl">
            <button data-act="meZin" aria-label="大きくする">${I.plus}</button>
            <button data-act="meZout" aria-label="小さくする">${I.minus}</button>
            <button data-act="meFit" aria-label="区域の全体を見る">${I.fit}</button>
          </div>
          ${K.basemap.photoOk() || photo ? `<button class="layer-btn" data-act="meLayer">${I.layers}<span>${photo ? '地図' : '写真'}</span></button>` : ''}
          <p class="map-hint">何もない所をさわると家を足せます。家の印をさわると直せます。</p>
          <div class="map-pick" data-mpick hidden><span>新しい場所をさわってください</span><button class="btn sm" data-act="mePickCancel">やめる</button></div>
          ${candBar(v)}
        </div>
      </div>`;
    mountE(v);
  };

  function candInfo(v) {
    if (v.cand && CMP.result) {
      const list = v.cand === 'new' ? CMP.result.newCands : CMP.result.goneCands;
      const c = list[v.ci];
      if (c) return { kind: v.cand, c: c };
    }
    if (v.rep) {
      const r = mapReports().find(x => x.id === v.rep);
      if (r) return { kind: 'rep', c: r };
    }
    return null;
  }
  function candBar(v) {
    const x = candInfo(v);
    if (!x || x.c.done) return '';
    if (x.kind === 'new') return `<div class="ed-bar"><p><b>国土地理院の地図に、新しい建物が出ています</b>（約${x.c.a}㎡・オレンジの線）。${K.basemap.photoOk() ? '「写真」や' : ''}現地で、人が住む家かどうか確かめてください。</p>
      <div class="row2 tight"><button class="btn" data-act="meCandSkip">家ではない（見送る）</button><button class="btn primary" data-act="meCandAdd">家として足す</button></div></div>`;
    if (x.kind === 'gone') return `<div class="ed-bar"><p><b>国土地理院の地図から、この家の建物が消えています。</b>取り壊されたかどうか確かめてください。</p>
      <div class="row2 tight"><button class="btn" data-act="meGoneSkip">まだある（見送る）</button><button class="btn primary" data-act="meGoneSet">なくなった</button></div></div>`;
    return `<div class="ed-bar"><p><b>地図にない家の知らせ</b>（${esc(x.c.by)}さん・${esc(H.md(x.c.at))}）。オレンジの丸の場所です。</p>
      <div class="row2 tight"><button class="btn" data-act="meRepSkip" data-rep="${esc(x.c.id)}">見送る</button><button class="btn primary" data-act="meRepAdd">ここに家を足す</button></div></div>`;
  }

  function mountE(v) {
    destroyE();
    if (!window.L) return;
    const t = K.geo.terr[v.tid];
    const map = L.map('map', { zoomControl: false, maxZoom: 20, minZoom: 12, zoomSnap: 0.5, wheelPxPerZoomLevel: 90, bounceAtZoomLimits: false });
    map.attributionControl.setPrefix(false);
    const base = U.baseLayer(photo).addTo(map);
    t.blocks.forEach(bid => L.polygon(K.geo.block[bid].poly, { className: 'blk', interactive: false }).addTo(map));
    E = { map: map, t: t, v: v, base: base, markers: {}, extra: [], pick: null, tmp: null };
    const x = candInfo(v);
    let focus = v.focus || null;
    if (v.focusHouse && K.geo.house[v.focusHouse]) { const h = K.geo.house[v.focusHouse]; focus = [h.lat, h.lon]; }
    if (x) {
      focus = [x.c.lat, x.c.lon];
      if (x.kind === 'new') (x.c.rings || []).forEach(r => E.extra.push(L.polyline(r, { className: 'cand-ring', interactive: false }).addTo(map)));
      E.extra.push(L.marker(focus, { icon: L.divIcon({ className: 'hm cand', html: '<i></i>', iconSize: [34, 34] }), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map));
    }
    if (focus) map.setView(focus, 19);
    else map.fitBounds(L.latLngBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 });
    const zc = () => { const z = map.getZoom(), el = map.getContainer(); el.classList.toggle('z-lo', z < 17); el.classList.toggle('z-17', z >= 17 && z < 18); el.classList.toggle('z-18', z >= 18 && z < 19); };
    map.on('zoomend', zc);
    map.on('click', onEClick);
    zc();
    refreshE();
    setTimeout(() => { if (E && E.map === map) map.invalidateSize(); }, 60);
  }

  const KIND_TEXT = { house: '家', wait: '確認待ち（大きな建物）', apt: '集合住宅', empty: '空き家', gone: '地図から外した（家ではない・なくなった）' };
  function lookE(h, kind) {
    if (kind === 'gone') return { cls: 'hm k-gone', html: '<i>×</i>' };
    if (kind === 'wait') return { cls: 'hm big k-wait', html: '<i>?</i>' };
    if (kind === 'apt') return { cls: 'hm big k-apt', html: '<i>集</i>' };
    if (kind === 'empty') return { cls: 'hm k-empty', html: '<i>空</i>' };
    return { cls: 'hm s-未' + (h.big ? ' big' : '') + (h.added || h.moved ? ' added' : '') + (h.prov ? ' prov' : ''), html: '<i>' + (h.added ? '新' : '') + '</i>' };
  }
  function eHouses() {
    const list = (K.geo.byTerr[E.t.id] || []).slice();
    // 知らせ（まだ確かめていない「地図にない家」）も、この区域の分は印で出す
    mapReports().filter(r => (r.territoryId === E.t.id || (K.geo.block[K.blockAt(r.lat, r.lon, E.t.id)] || {}).t === E.t.id) && !K.geo.house['n-' + r.id])
      .forEach(r => list.push({ id: 'rep:' + r.id, lat: r.lat, lon: r.lon, rep: r, t: E.t.id }));
    return list;
  }
  function refreshE() {
    if (!E) return;
    const st = K.houseStates();
    const hs = eHouses();
    const ids = new Set(hs.map(h => h.id));
    Object.keys(E.markers).forEach(id => { if (!ids.has(id)) { E.markers[id].remove(); delete E.markers[id]; } });
    hs.forEach(h => {
      const look = h.rep ? { cls: 'hm prov s-未', html: '<i>?</i>' } : lookE(h, K.houseKind(h, st).kind);
      let mk = E.markers[h.id];
      if (!mk) mk = E.markers[h.id] = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: look.cls, html: look.html, iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(E.map);
      else {
        const ll = mk.getLatLng();
        if (ll.lat !== h.lat || ll.lng !== h.lon) mk.setLatLng([h.lat, h.lon]);
        if (mk._sig !== look.cls + look.html) mk.setIcon(L.divIcon({ className: look.cls, html: look.html, iconSize: [30, 30] }));
      }
      mk._sig = look.cls + look.html;
    });
  }

  function onEClick(e) {
    if (!E) return;
    const ll = [e.latlng.lat, e.latlng.lng];
    if (E.pick) return pickMove(ll);
    const p = E.map.latLngToContainerPoint(e.latlng);
    const z = E.map.getZoom();
    const thr = z >= 19 ? 24 : z >= 18 ? 20 : 16;
    let best = null, bd = 1e9;
    eHouses().forEach(h => {
      const q = E.map.latLngToContainerPoint([h.lat, h.lon]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = h; }
    });
    if (best && bd <= thr) return best.rep ? openRepSheet(best.rep) : openHouseE(best);
    if (z < 18) { E.map.setView(e.latlng, 19); kit().toast('大きくしました。家を足す場所を、もう一度さわってください'); return; }
    openAddSheet(ll);
  }
  function tempPin(ll) {
    if (E.tmp) E.tmp.remove();
    E.tmp = L.marker(ll, { icon: L.divIcon({ className: 'hm pin', html: '<i></i>', iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(E.map);
  }
  function clearPin() { if (E && E.tmp) { E.tmp.remove(); E.tmp = null; } }

  function openAddSheet(ll) {
    const bid = K.blockAt(ll[0], ll[1], E.t.id);
    tempPin(ll);
    if (!bid) {
      U.openSheet(U.sheetTitle('家を足す'), '<p class="notice">区域のブロックの外です。家を足せるのは、区域の線の中だけです。</p>', clearPin);
      return;
    }
    const b = K.geo.block[bid];
    const t = K.geo.terr[b.t];
    U.openSheet(U.sheetTitle('ここに家を足す'), `
      <p class="muted">${esc(t.no)} ${esc(t.town)}${t.blocks.length > 1 ? '・ブロック' + b.n : ''}${b.t !== E.t.id ? '（となりの区域）' : ''}</p>
      <label class="lbl" for="me-note">メモ（なくてもよい）</label>
      <input id="me-note" class="sel" placeholder="例：新築（2026年秋）" autocomplete="off">
      <button class="btn primary big wide" data-act="meAdd" data-lat="${ll[0]}" data-lon="${ll[1]}" data-b="${esc(bid)}">家を足す</button>
      <p class="muted small">足した家は、すぐに全員の地図に出ます。間違えたときは、家の印をさわって消せます。</p>`, clearPin);
  }
  function openHouseE(h) {
    const st = K.houseStates();
    const kind = K.houseKind(h, st).kind;
    const k = kit();
    const title = h.prov ? '仮の家' : h.added ? '足した家' : h.big ? '大きな建物' : '家 ' + (h.n || '');
    U.openSheet(U.sheetTitle(esc(title)), `
      <p class="small">${esc(KIND_TEXT[kind] || '家')}${h.moved ? '・場所を直してあります' : ''}${h.added && h.note ? '・' + esc(h.note) : ''}</p>
      ${k.sortButtons(h.id, '')}
      <button class="btn wide" data-act="meMove" data-h="${esc(h.id)}">${I.map}<span>場所を直す</span></button>
      ${h.moved && h.moveEditId ? `<button class="btn ghost wide" data-act="meUndo" data-e="${esc(h.moveEditId)}">場所を元に戻す</button>` : ''}
      ${h.added && h.editId ? `<button class="btn danger wide" data-act="meUndo" data-e="${esc(h.editId)}">この家を消す（足したのを取り消す）</button>` : ''}`);
  }
  function openRepSheet(r) {
    U.openSheet(U.sheetTitle('地図にない家<small>（知らせ）</small>'), `
      <p>${esc(r.by)}さん・${esc(H.md(r.at))}</p>
      <p class="muted small">知らせた人のスマホでは「仮の家」として記録できます。足すと、記録はそのまま、この家の記録になります。</p>
      <div class="row2"><button class="btn big" data-act="meRepSkip" data-rep="${esc(r.id)}">見送る</button><button class="btn primary big" data-act="meRepAddId" data-rep="${esc(r.id)}">家を足す</button></div>`);
  }

  function pickMove(ll) {
    const h = K.geo.house[E.pick.houseId];
    if (!h) { setMovePick(null); return; }
    const bid = K.blockAt(ll[0], ll[1], h.t);
    if (!bid) { kit().toast('区域のブロックの外です。線の中をさわってください'); return; }
    tempPin(ll);
    U.openSheet(U.sheetTitle('ここに動かす'), `<p>家の印を、この場所に動かします。</p>
      <div class="row2"><button class="btn big" data-act="closeSheet">やめる</button><button class="btn primary big" data-act="meMoveDo" data-h="${esc(h.id)}" data-lat="${ll[0]}" data-lon="${ll[1]}" data-b="${esc(bid)}">動かす</button></div>`, clearPin);
  }
  function setMovePick(hid) {
    if (!E) return;
    E.pick = hid ? { houseId: hid } : null;
    const el = document.querySelector('[data-mpick]');
    if (el) el.hidden = !hid;
    const hint = document.querySelector('.map-hint');
    if (hint) hint.hidden = !!hid;
  }

  async function saveEdit(edit, msg) {
    try {
      const r = await kit().api('editHouse', { edit: edit });
      kit().toast(msg);
      U.closeSheet();
      await kit().load();
      K.refresh().catch(() => {});
      refreshE();
      return r;
    } catch (e) { return null; }
  }
  function markCand(done, ref) {
    const x = E && candInfo(E.v);
    if (x && x.kind !== 'rep') { x.c.done = done; x.c.ref = ref || null; }
  }
  function afterCand() { if (U.view().name === 'aMapEdit') U.back(); }

  Object.assign(act, {
    meZin: () => E && E.map.zoomIn(1),
    meZout: () => E && E.map.zoomOut(1),
    meFit: () => E && E.map.fitBounds(L.latLngBounds([[E.t.bb[0], E.t.bb[1]], [E.t.bb[2], E.t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 }),
    meLayer: el => {
      if (!photo && !K.basemap.photoOk()) { U.toast('今は写真を出せません（国土地理院の地図を読めません）'); el.hidden = true; return; }
      photo = !photo;
      if (E) E.base.setPhoto(photo);
      el.querySelector('span').textContent = photo ? '地図' : '写真';
    },
    meAdd: async el => {
      const b = K.geo.block[el.dataset.b];
      const note = (document.getElementById('me-note') || {}).value || '';
      el.disabled = true;
      const r = await saveEdit({ type: '足す', lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), blockId: el.dataset.b, territoryId: b.t, note: note }, '家を足しました');
      if (!r) el.disabled = false;
    },
    meMove: el => { U.closeSheet(); setMovePick(el.dataset.h); kit().toast('新しい場所を、地図の上でさわってください'); },
    mePickCancel: () => { setMovePick(null); clearPin(); },
    meMoveDo: async el => {
      el.disabled = true;
      const h = K.geo.house[el.dataset.h];
      const r = await saveEdit({ type: '動かす', houseId: el.dataset.h, lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), blockId: el.dataset.b, territoryId: h ? h.t : '' }, '場所を直しました');
      setMovePick(null);
      clearPin();
      if (!r) el.disabled = false;
    },
    meUndo: async el => {
      if (!kit().sure(el, 'もう一度押すと取り消す')) return;
      U.closeSheet();
      if (await undoEdit(el.dataset.e)) refreshE();
    },
    meCandAdd: async el => {
      const x = candInfo(E.v);
      if (!x) return;
      el.disabled = true;
      const r = await saveEdit({ type: '足す', lat: x.c.lat, lon: x.c.lon, blockId: x.c.blockId, territoryId: x.c.territoryId, note: '国土地理院の地図の新しい建物（約' + x.c.a + '㎡）' + gsiTag() }, '家を足しました');
      if (r) { markCand('足した', { kind: 'edit', id: r.edit.id }); afterCand(); } else el.disabled = false;
    },
    meCandSkip: async el => {
      const x = candInfo(E.v);
      if (!x) return;
      el.disabled = true;
      const r = await saveEdit({ type: '見送り', lat: x.c.lat, lon: x.c.lon, territoryId: x.c.territoryId, note: '家ではない（国土地理院の新しい建物・約' + x.c.a + '㎡）' + gsiTag() }, '見送りました。次からは出しません');
      if (r) { markCand('見送った', { kind: 'edit', id: r.edit.id }); afterCand(); } else el.disabled = false;
    },
    meGoneSet: async el => {
      const x = candInfo(E.v);
      if (!x) return;
      el.disabled = true;
      try {
        const r = await kit().api('setHouseState', { houseId: x.c.houseId, state: 'なくなった', note: '国土地理院の地図から消えた' + gsiTag() });
        await kit().afterHouseState(x.c.houseId, 'なくなった', '');
        kit().toast('「なくなった」にしました。地図から外れます');
        await kit().load();
        K.refresh().catch(() => {});
        markCand('なくなった', r.id ? { kind: 'state', id: r.id, houseId: x.c.houseId } : null);
        afterCand();
      } catch (e) { el.disabled = false; }
    },
    meGoneSkip: async el => {
      const x = candInfo(E.v);
      if (!x) return;
      el.disabled = true;
      const r = await saveEdit({ type: '見送り', houseId: x.c.houseId, territoryId: x.c.territoryId, note: 'まだある（国土地理院の地図から消えていた）' + gsiTag() }, '見送りました。この家は次から出しません');
      if (r) { markCand('見送った', { kind: 'edit', id: r.edit.id }); afterCand(); } else el.disabled = false;
    },
    meRepAdd: async el => {
      const x = candInfo(E.v);
      if (!x || x.kind !== 'rep') return;
      await addFromReport(x.c, el);
    },
    meRepAddId: async el => {
      const r = mapReports().find(q => q.id === el.dataset.rep);
      if (r) await addFromReport(r, el);
    },
    meRepSkip: async el => {
      if (!kit().sure(el, 'もう一度押すと見送る')) return;
      try {
        await kit().api('resolveReport', { reportId: el.dataset.rep, result: '見送り' });
        kit().toast('知らせを見送りました');
        U.closeSheet();
        await kit().load();
        refreshE();
        if (E && E.v.rep === el.dataset.rep) afterCand();
      } catch (e) { /* api が知らせる */ }
    },
  });
  async function addFromReport(r, el) {
    const bid = K.blockAt(r.lat, r.lon, r.territoryId);
    if (!bid) { kit().toast('区域のブロックの外の知らせです。地図をさわって、正しい場所に家を足してください'); return; }
    el.disabled = true;
    const res = await saveEdit({ type: '足す', lat: r.lat, lon: r.lon, blockId: bid, territoryId: K.geo.block[bid].t, reportId: r.id, note: '知らせ（' + r.by + 'さん）から' }, '家を足しました');
    if (res) { if (E && E.v.rep === r.id) afterCand(); } else el.disabled = false;
  }
})();

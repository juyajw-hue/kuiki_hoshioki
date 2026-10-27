/*
 * 区域訪問管理 — 代理入力（0.11.0）
 *   紙の区域カード・集合住宅カードに書かれた記録を、日付を指定してアプリに入れる（管理者）。
 *   家の番号は、まとめて印刷の区域カードの番号と同じ。記録はその区域を持っていた人の記録として入り、
 *   「入れた人」に自分の名前が残る。紙で返ってきた区域は、返した日を選んで返却にできる。
 *   責任者・副責任者は、自分のグループの人の分だけ。
 */
(function () {
  'use strict';
  const K = window.K;
  const H = K.h;
  const esc = H.esc;
  const U = K.ui;
  const I = U.I;
  const views = U.views;
  const act = U.act;
  const AK = () => K.adminKit;

  const GLYPH = { '会えた': '会', '不在': '不', '拒否': '拒', '済': '済', '消す': '×' };
  const BRUSHES = ['会えた', '不在', '拒否', '済', '消す'];
  const PX = { tab: 'out', list: null, loading: false, err: null, dist: '', rec: null, recLoading: false, day: '', brush: '会えた', pend: {}, saving: false };

  views.aProxy = async function () {
    const k = AK();
    if (!k.A.data) await k.load();
    if (!('px-q' in k.S)) k.S['px-q'] = '';
    if (U.view().fresh) { Object.assign(PX, { list: null, err: null, dist: '', rec: null, pend: {} }); U.view().fresh = false; }
    if (!PX.list && !PX.loading && !PX.err) {
      PX.loading = true;
      k.api('proxyList', {}).then(r => { PX.list = r; }).catch(e => { PX.err = e; }).finally(() => { PX.loading = false; if (U.view().name === 'aProxy') U.render(); });
    }
    if (PX.dist) return editView();
    const all = (PX.list && PX.list.dists) || [];
    const q = String(k.S['px-q'] || '').trim().toLowerCase();
    const outs = all.filter(x => !x.returnedAt), backs = all.filter(x => x.returnedAt);
    let list = PX.tab === 'out' ? outs : backs;
    if (q) list = list.filter(x => (x.no + ' ' + x.name + ' ' + placeName(x)).toLowerCase().indexOf(q) >= 0 || x.no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0);
    k.shell('代理入力（紙の記録）', `
      <p class="muted small">紙の区域カードに書かれた記録（会えた・不在・拒否）を、回った日を選んで入れます。家の番号は、印刷した区域カードの番号と同じです。記録は、その区域を持っていた人の記録として入り、あなたの名前が「入れた人」に残ります。</p>
      ${PX.err ? `<div class="notice">${esc(PX.err.message || '読めませんでした')}</div><button class="btn" data-act="pxReload">もう一度読む</button>` : ''}
      <div class="seg two"><button data-act="pxTab" data-v="out" aria-pressed="${PX.tab === 'out'}">配布中<small>${outs.length}</small></button><button data-act="pxTab" data-v="back" aria-pressed="${PX.tab === 'back'}">返ってきた（200日のうち）<small>${backs.length}</small></button></div>
      <input id="px-q" class="sel" type="search" placeholder="番号か名前で探す" value="${esc(k.S['px-q'] || '')}" autocomplete="off">
      ${PX.loading && !PX.list ? '<p class="muted">読んでいます…</p>' : list.length ? `<div class="tlist">${list.slice(0, 120).map(x => `<button class="trow" data-act="pxOpen" data-id="${esc(x.distId)}">
        <b class="num">${esc(x.no)}</b><span class="town">${esc(placeName(x))}${x.roomNos && x.roomNos.length ? '<small>' + esc(x.roomNos.join('・')) + '</small>' : ''}</span><span class="h">${I.chev}</span>
        <span class="st">${esc(x.name)}さん・${esc(H.mdShort(x.distributedAt))}〜${x.returnedAt ? esc(H.mdShort(x.returnedAt)) : '配布中'}・記録 ${x.recs}${x.proxy ? '（代理 ' + x.proxy + '）' : ''}</span></button>`).join('')}</div>
        ${list.length > 120 ? '<p class="muted small">ほか ' + (list.length - 120) + '件。番号か名前で探してください。</p>' : ''}` : '<p class="empty">当てはまる配布はありません。</p>'}
      <p class="muted small">台帳に書いた配布そのもの（だれに・いつ配って・いつ返ったか）は、［1枚ずつ配る］の「台帳から入れる」で入れます。</p>`);
  };
  function placeName(x) {
    const t = K.geo.terr[x.territoryId];
    if (t) return t.town;
    const b = (AK().A.data.buildings || []).find(y => y.id === x.territoryId);
    return b ? b.name : '';
  }
  act.pxTab = el => { PX.tab = el.dataset.v; U.render(); };
  act.pxReload = () => { PX.err = null; PX.list = null; U.render(); };
  act.pxOpen = el => {
    PX.dist = el.dataset.id; PX.rec = null; PX.pend = {}; PX.day = ''; PX.brush = '会えた';
    loadRec();
    U.render(); window.scrollTo(0, 0);
  };
  act.pxBack = () => { PX.dist = ''; PX.rec = null; PX.pend = {}; U.render(); };
  function loadRec() {
    PX.recLoading = true;
    AK().api('distRecords', { distId: PX.dist }).then(r => { PX.rec = r; if (!PX.day) PX.day = defaultDay(r.dist, r.today); })
      .catch(() => { PX.dist = ''; }).finally(() => { PX.recLoading = false; if (U.view().name === 'aProxy') U.render(); });
  }
  function defaultDay(d, today) { const t = d.returnedAt || today || H.todayStr(); return t < d.distributedAt ? d.distributedAt : t; }

  /** 家・部屋ごとの今の記録（この配布の、いちばん新しい記録） */
  function current() {
    const out = {};
    ((PX.rec && PX.rec.records) || []).forEach(r => {
      const key = r.roomId ? 'r:' + r.roomId : r.houseId ? 'h:' + r.houseId : 'b:' + r.blockId;
      if (!out[key] || out[key].at <= r.at) out[key] = r;
    });
    return out;
  }

  function editView() {
    const k = AK();
    const r = PX.rec;
    if (!r) return k.shell('代理入力', '<p class="muted">読んでいます…</p>', { right: '' });
    const d = r.dist;
    const isB = !!r.building;
    const cur = current();
    const refused = new Set(r.refused || []);
    const today = H.todayStr();
    const maxDay = d.returnedAt || today;
    const pendN = Object.keys(PX.pend).length;
    let grid = '';
    let blank = 0;
    if (isB) {
      const mine = d.rooms && d.rooms.length ? new Set(d.rooms) : null;
      const rooms = (r.rooms || []).filter(x => !mine || mine.has(x.id));
      const ents = {};
      rooms.forEach(x => { const e = ents[x.entrance || ''] = ents[x.entrance || ''] || {}; (e[x.floor] = e[x.floor] || []).push(x); });
      const ek = Object.keys(ents).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
      grid = ek.map(e => `<section class="ent">${ek.length > 1 ? '<h3>入口' + esc(e) + '</h3>' : ''}<div class="grid">${Object.keys(ents[e]).map(Number).sort((a, b) => b - a).map(f => `<div class="floor"><span class="fl num">${f}階</span><div class="cells">${ents[e][f].map(x => {
        const key = 'r:' + x.id;
        const c = cur[key], p = PX.pend[key];
        if (!c && !p) blank++;
        return cell(key, x.no, c, p, refused.has(x.id));
      }).join('')}</div></div>`).join('')}</div></section>`).join('');
    } else {
      const hs = K.printKit.housesOf(d.territoryId).filter(x => x.kind === 'house');
      // ブロックの「全部回った」（済）は、家の記録がない家に効く
      const blockDone = {};
      Object.keys(cur).forEach(key => { if (key.indexOf('b:') === 0 && cur[key].result === '済') blockDone[key.slice(2)] = cur[key]; });
      grid = `<div class="px-grid">${hs.map(x => {
        const key = 'h:' + x.h.id;
        const c = cur[key] || (blockDone[x.h.b] ? Object.assign({ block: true }, blockDone[x.h.b]) : null);
        const p = PX.pend[key];
        if (!c && !p) blank++;
        return cell(key, x.label, c, p, refused.has(x.h.id));
      }).join('')}</div>`;
    }
    const brushes = `<div class="seg px-brush">${BRUSHES.map(b => `<button class="pxb-${b}" data-act="pxBrush" data-v="${b}" aria-pressed="${PX.brush === b}"><i>${GLYPH[b]}</i><span>${b === '消す' ? '記録を消す' : b}</span></button>`).join('')}</div>`;
    const body = `
      <button class="link" data-act="pxBack">${I.back}<span>配布の一覧にもどる</span></button>
      <div class="px-head"><p><b class="num">${esc(d.no)}</b>　${esc(placeName(d))}${d.roomNos && d.roomNos.length ? '（' + esc(d.roomNos.join('・')) + '）' : ''}</p>
        <p class="small">${esc(d.name)}さん・${esc(H.md(d.distributedAt))}に配布・${d.returnedAt ? esc(H.md(d.returnedAt)) + 'に返却' : '<b>配布中</b>'}</p></div>
      <label class="lbl" for="px-day">回った日（紙に書かれた日）</label>
      <input id="px-day" type="date" class="sel" value="${esc(PX.day)}" min="${esc(d.distributedAt)}" max="${esc(maxDay)}">
      <p class="muted small">配った日から${d.returnedAt ? '返した日' : '今日'}までの日を選べます。日付がちがう記録は、日付を変えてから続けて入れてください。</p>
      <div class="lbl">記録を選んで、${isB ? '部屋' : '家の番号'}をさわる</div>
      ${brushes}
      <div class="row"><button class="btn sm" data-act="pxRest" ${blank ? '' : 'disabled'}>印のない${isB ? '部屋' : '家'}を全部「済」にする（${blank}）</button>${pendN ? '<button class="btn sm ghost" data-act="pxClear">さわった分をやめる</button>' : ''}</div>
      <div class="rooms px-cells">${grid || '<p class="empty">' + (isB ? '部屋が登録されていません。' : '家がありません。') + '</p>'}</div>
      <p class="muted small">印：会＝会えた・不＝不在・拒＝拒否・済＝回った・×＝消す。点線の枠は、まだ入れていない（さわった）ものです。<b>拒</b>の赤い枠は、前から「拒否」の家・部屋です。代理入力した記録には「代」が付きます。</p>
      ${d.returnedAt ? '' : `<h2 class="sec">紙の区域カードが返ってきたら</h2>
        <div class="row"><input id="px-ret" type="date" class="sel" value="${esc(PX.day || today)}" min="${esc(d.distributedAt)}" max="${esc(today)}"><button class="btn" data-act="pxReturn">この日に返却にする</button></div>`}`;
    k.shell('代理入力', body, { bar: k.bottomBar(pendN ? `<b class="num">${pendN}</b>件を、<b>${esc(H.md(PX.day))}</b>の記録として入れます` : 'まだ、さわった家・部屋はありません', `<button class="btn primary" data-act="pxSave" ${pendN && !PX.saving ? '' : 'disabled'}>${PX.saving ? '入れています…' : '入れる'}</button>`) });
  }
  function cell(key, label, c, p, ref) {
    const show = p || (c ? c.result : '');
    const cls = ['cell', 'px-c'];
    if (show) cls.push('s-' + (show === '消す' ? '未' : show));
    if (p) cls.push('pend');
    if (ref) cls.push('ref0');
    const mark = p ? GLYPH[p] : c ? GLYPH[c.result] || '' : '';
    const sub = !p && c ? (c.proxyBy ? '代' : c.block ? 'ブ' : '') : '';
    const at = c ? new Date(c.at) : null;
    const title = c ? c.result + '（' + (at.getMonth() + 1) + '/' + at.getDate() + (c.proxyBy ? '・代理 ' + c.proxyBy : c.byName ? '・' + c.byName : '') + '）' : '';
    return `<button class="${cls.join(' ')}" data-act="pxTap" data-k="${esc(key)}" title="${esc(title)}"><b class="num">${esc(label)}</b><span class="mk">${mark}${sub ? '<small>' + sub + '</small>' : ''}</span></button>`;
  }
  act.pxBrush = el => { PX.brush = el.dataset.v; keepDay(); U.render(); };
  act.pxTap = el => {
    keepDay();
    const key = el.dataset.k;
    const c = current()[key];
    if (PX.pend[key] === PX.brush || (!PX.pend[key] && c && c.result === PX.brush)) delete PX.pend[key];
    else if (PX.brush === '消す' && !c) delete PX.pend[key];
    else PX.pend[key] = PX.brush;
    U.render();
  };
  act.pxRest = () => {
    keepDay();
    document.querySelectorAll('.px-c').forEach(b => { if (!b.querySelector('.mk').textContent.trim()) PX.pend[b.dataset.k] = '済'; });
    U.render();
  };
  act.pxClear = () => { PX.pend = {}; keepDay(); U.render(); };
  function keepDay() { const e = document.getElementById('px-day'); if (e && e.value) PX.day = e.value; }
  document.addEventListener('change', e => { if (e.target && e.target.id === 'px-day') { PX.day = e.target.value; if (U.view().name === 'aProxy') U.render(); } });
  act.pxSave = async el => {
    keepDay();
    const k = AK();
    const items = Object.keys(PX.pend).map(key => {
      const v = PX.pend[key];
      const id = key.slice(2);
      return key[0] === 'r' ? { roomId: id, result: v } : key[0] === 'h' ? { houseId: id, result: v } : { blockId: id, result: v };
    });
    if (!items.length) return;
    el.disabled = true; PX.saving = true;
    try {
      const r = await k.api('proxyVisits', { distId: PX.dist, at: PX.day, items: items });
      k.toast(r.added ? r.added + '件を入れました' + (r.cleared ? '（前の記録 ' + r.cleared + '件を取り消し）' : '') : '記録を' + r.cleared + '件消しました');
      PX.pend = {}; PX.list = null;
      loadRec();
    } catch (e) { /* api が知らせる */ }
    PX.saving = false;
    U.render();
  };
  act.pxReturn = async el => {
    const k = AK();
    const day = (document.getElementById('px-ret') || {}).value;
    if (!day) { k.toast('返した日を選んでください'); return; }
    if (!k.sure(el, 'もう一度押すと返却にします')) return;
    el.disabled = true;
    try {
      await k.api('returnCards', { distIds: [PX.dist], at: day });
      k.toast(H.md(day) + 'に返却にしました');
      PX.list = null;
      await k.load();
      loadRec();
    } catch (e) { el.disabled = false; }
  };
})();

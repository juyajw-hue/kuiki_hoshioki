/*
 * 区域訪問管理 — まとめて印刷（0.10.0）
 *   区域カード（戸建て）・集合住宅カード・S-13（区域割り当ての記録。0.11.0：Word・書き込める PDF でも）・
 *   訪問しない家と部屋の一覧・配布中の一覧・人とグループの一覧・配布と回収の台帳。
 *   紙は A4・A5・B5・B6（日本の B 判）の縦。地図は「保存した地図」（国土地理院ベクトルタイル提供実験を加工して作成）で描く
 *   （地理院タイルをそのまま印刷して配らないため。「権利と規約」を参照）。
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

  /** 紙の大きさ（mm）と、まわりの余白・文字の大きさ */
  const PAPERS = {
    A4: { w: 210, h: 297, m: 10, f: 3.6, label: 'A4（210×297）' },
    B5: { w: 182, h: 257, m: 9, f: 3.4, label: 'B5（182×257）' },
    A5: { w: 148, h: 210, m: 8, f: 3.1, label: 'A5（148×210）' },
    B6: { w: 128, h: 182, m: 7, f: 2.8, label: 'B6（128×182）' },
  };
  const WHATS = [
    ['cards', '区域カード', '戸建ての区域1つに1枚。地図・家の番号・訪問しない家・記録欄'],
    ['bcards', '集合住宅カード', '建物ごとに部屋の一覧・拒否の部屋・記録欄（小さな建物は1枚にいくつか）'],
    ['s13', 'S-13（区域割り当ての記録）', '奉仕年度ごと。Word と、書き込める PDF でも保存できる'],
    ['refused', '訪問しない一覧', '拒否の家と部屋。区域番号の順'],
    ['out', '配布中の一覧', '今だれが、どの区域を持っているか'],
    ['people', '人とグループの一覧', 'グループ・責任者・いつもの枚数（鍵は載せない）'],
    ['ledger', '配布と回収の台帳', '紙で配るときに書く表（配布中を書き入れておける）'],
  ];
  const BATCH = 50;   // 区域カードを一度に印刷する枚数（地図の絵が多いので）
  const PX = 96 / 25.4; // 1mm の画面の点の数
  const TS = 256;

  const PR = { what: 'cards', paper: 'A5', range: 'all', town: '', nos: '', month: 1, route: 'all', bmonth: 0, batch: 0, rec: true, qr: true, fill: true, blank: 2, data: null, loading: false, err: null,
    s13Year: 0, s13Kind: 'h', s13Range: 'all', s13: {}, s13Loading: false, s13Err: null, saving: '' };
  /** 今の奉仕年度（9月から。2026年10月なら2027） */
  const thisYear = () => { const d = new Date(); return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear(); };

  /* ==================== 画面：まとめて印刷 ==================== */
  views.aPrint = async function () {
    const k = AK();
    if (!k.A.data) await k.load();
    if (U.view().fresh) { PR.data = null; PR.err = null; PR.batch = 0; U.view().fresh = false; if (k.aptOnly() && PR.what === 'cards') PR.what = 'bcards'; }
    if (!PR.data && !PR.loading && !PR.err) {
      PR.loading = true;
      k.api('printData', {}).then(r => { PR.data = r; }).catch(e => { PR.err = e; }).finally(() => { PR.loading = false; if (U.view().name === 'aPrint') U.render(); });
    }
    const whats = WHATS.filter(w => !(k.aptOnly() && w[0] === 'cards'));
    const isS13 = PR.what === 's13';
    if (isS13) {
      if (!PR.s13Year) PR.s13Year = thisYear();
      if (k.aptOnly()) PR.s13Kind = 'b';
      if (!K.s13.SHEETS[PR.paper]) PR.paper = 'A4';
      if (!PR.s13[PR.s13Year] && !PR.s13Loading && !PR.s13Err) {
        PR.s13Loading = true;
        const y = PR.s13Year;
        k.api('s13', { year: y }).then(r => { PR.s13[y] = r; }).catch(e => { PR.s13Err = e; }).finally(() => { PR.s13Loading = false; if (U.view().name === 'aPrint') U.render(); });
      }
    }
    const paper = PAPERS[PR.paper];
    const list = PR.what === 'cards' ? cardIds() : PR.what === 'bcards' ? bldgIds() : null;
    const batches = list && list.length > BATCH ? Math.ceil(list.length / BATCH) : 0;
    if (PR.batch >= Math.max(1, batches)) PR.batch = 0;
    const canPrint = K.cfg.canPrint && !H.inFrame;
    const body = `
      <p class="muted small">紙に印刷して、アプリが使えないときの控えや、スマホを持たない人の区域カードにします。印刷する前に、画面で見本を確かめられます。</p>
      <div class="lbl">印刷するもの</div>
      <div class="pr-whats">${whats.map(w => `<button class="pr-what" data-act="prWhat" data-v="${w[0]}" aria-pressed="${PR.what === w[0]}"><b>${w[1]}</b><small>${w[2]}</small></button>`).join('')}</div>
      <div class="lbl">紙の大きさ（縦）</div>
      <div class="seg wrap">${Object.keys(PAPERS).filter(p => !isS13 || K.s13.SHEETS[p]).map(p => `<button data-act="prPaper" data-v="${p}" aria-pressed="${PR.paper === p}">${p}<small class="pr-mm">${PAPERS[p].w}×${PAPERS[p].h}mm</small></button>`).join('')}</div>
      ${isS13 ? '<p class="muted small">S-13 は A4（様式と同じ。1枚に20区域）か B5（1枚に17区域）です。</p>' : ''}
      ${isS13 ? s13Box() : rangeBox()}
      ${optsBox()}
      ${list ? `<p class="pr-count"><b class="num">${list.length}</b>枚${batches ? '（地図が多いので、' + BATCH + '枚ずつ印刷します）' : ''}</p>` : ''}
      ${batches ? `<div class="seg wrap">${Array.from({ length: batches }, (_, i) => `<button data-act="prBatch" data-v="${i}" aria-pressed="${PR.batch === i}">${i * BATCH + 1}〜${Math.min(list.length, (i + 1) * BATCH)}</button>`).join('')}</div>` : ''}
      ${PR.err ? `<p class="notice">${esc(PR.err.message || '印刷に使う記録を読めませんでした')}</p>` : ''}
      ${isS13 && PR.s13Err ? `<p class="notice">${esc(PR.s13Err.message || 'S-13 の記録を読めませんでした')}</p><button class="btn" data-act="prS13Reload">もう一度読む</button>` : ''}
      <button class="btn primary big wide" data-act="prMake" ${(isS13 ? PR.s13[PR.s13Year] && s13Count() : PR.data && (!list || list.length)) ? '' : 'disabled'}>${I.print}<span>${(isS13 ? PR.s13Loading : PR.loading) ? '読んでいます…' : '見本を作る（' + esc(paper.label) + '）'}</span></button>
      ${isS13 ? `<div class="row-btns pr-save"><button class="btn" data-act="prSave" data-v="docx" ${PR.s13[PR.s13Year] && s13Count() && !PR.saving ? '' : 'disabled'}>${I.doc || ''}<span>${PR.saving === 'docx' ? '作っています…' : 'Word で保存（.docx）'}</span></button><button class="btn" data-act="prSave" data-v="pdf" ${PR.s13[PR.s13Year] && s13Count() && !PR.saving ? '' : 'disabled'}>${I.doc || ''}<span>${PR.saving === 'pdf' ? '作っています…' : 'PDF で保存（書き込める）'}</span></button></div>
        <p class="muted small">Word は、表の欄にそのまま書き足せます。PDF は、どの欄にも入力できます（Acrobat Reader・Edge・Chrome などで開き、欄をさわって入力）。${K.h.canSave() ? '' : '<b>この画面（お試し版）では保存できません。</b>見本で形を確かめられます。'}</p>` : ''}
      ${canPrint ? '' : '<p class="muted small">この画面（お試し版）では、見本は見られますが、印刷はできません。</p>'}
      <p class="muted small">${isS13 ? 'S-13 には人の名前が入ります。会員の中だけで扱ってください。' : '地図は「保存した地図」（国土地理院ベクトルタイル提供実験を加工して作成）で描きます。カードは会員の中だけで使い、訪問先に渡さないでください。'}</p>`;
    k.shell('まとめて印刷', body);
  };
  function rangeBox() {
    if (PR.what === 'cards') {
      const k = AK();
      const cy = K.plan ? K.plan.cycle() : { set: false };
      const hasPlan = cy.set && K.plan.hasGroups('h');
      const towns = [];
      K.geo.list.forEach(t => { if (towns.indexOf(t.town) < 0) towns.push(t.town); });
      const opts = [['all', 'すべて'], ['town', '町を選ぶ'], ['nos', '番号で選ぶ'], ['out', '配布中の区域']].concat(hasPlan ? [['month', '月ごとの組'], ['left', 'この一巡でまだの区域']] : []);
      return `<div class="lbl">どの区域</div>
        <div class="seg wrap">${opts.map(o => `<button data-act="prRange" data-v="${o[0]}" aria-pressed="${PR.range === o[0]}">${o[1]}</button>`).join('')}</div>
        ${PR.range === 'town' ? `<select id="pr-town" class="sel">${towns.map(t => `<option ${PR.town === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        ${PR.range === 'nos' ? `<input id="pr-nos" class="sel" value="${esc(PR.nos)}" placeholder="例：Z07-1〜Z07-8, Z12, H03-2" autocomplete="off"><p class="muted small">カンマで区切ります。「Z07」は Z07-1、Z07-2…の全部、「Z07-1〜Z07-8」は間の全部です。</p>` : ''}
        ${PR.range === 'month' ? `<div class="seg wrap">${Array.from({ length: cy.months }, (_, i) => `<button data-act="prMonth" data-v="${i + 1}" aria-pressed="${PR.month === i + 1}">${i + 1}か月目</button>`).join('')}</div>` : ''}`;
    }
    if (PR.what === 'bcards') {
      const routes = [['all', 'すべて']].concat(K.routes().map(r => [r.id, r.name]));
      const acy = K.plan ? K.plan.cycle(null, 'b') : { set: false };
      const hasG = acy.set && K.plan.hasGroups('b');
      return `<div class="lbl">どの建物</div><div class="seg wrap">${routes.map(o => `<button data-act="prRoute" data-v="${esc(o[0])}" aria-pressed="${PR.route === o[0]}">${esc(o[1])}</button>`).join('')}</div>
        ${hasG ? `<div class="lbl">集合住宅の月ごとの組</div><div class="seg wrap"><button data-act="prBMonth" data-v="0" aria-pressed="${!PR.bmonth}">すべて</button>${Array.from({ length: acy.months }, (_, i) => `<button data-act="prBMonth" data-v="${i + 1}" aria-pressed="${PR.bmonth === i + 1}">${i + 1}か月目</button>`).join('')}</div>` : ''}`;
    }
    return '';
  }
  function optsBox() {
    if (PR.what === 'cards') {
      return `<div class="lbl">カードに入れるもの</div><div class="pr-opts">
        <label><input type="checkbox" data-pr-opt="rec" ${PR.rec ? 'checked' : ''}> 記録欄（家の番号ごとに書く所）</label>
        <label><input type="checkbox" data-pr-opt="qr" ${PR.qr ? 'checked' : ''}> 場所の QR コード（Google マップで開く）</label></div>`;
    }
    if (PR.what === 'bcards') return `<div class="lbl">カードに入れるもの</div><div class="pr-opts"><label><input type="checkbox" data-pr-opt="qr" ${PR.qr ? 'checked' : ''}> 場所の QR コード（Google マップで開く）</label></div>`;
    if (PR.what === 'ledger') {
      return `<div class="lbl">台帳</div><div class="pr-opts"><label><input type="checkbox" data-pr-opt="fill" ${PR.fill ? 'checked' : ''}> 今配っている区域を、はじめに書き入れておく</label></div>
        <div class="seg wrap">${[1, 2, 5, 10].map(n => `<button data-act="prBlank" data-v="${n}" aria-pressed="${PR.blank === n}">白紙 ${n}ページ</button>`).join('')}</div>`;
    }
    return '';
  }
  document.addEventListener('change', e => {
    const el = e.target;
    if (!el) return;
    if (el.dataset && el.dataset.prOpt) { PR[el.dataset.prOpt] = el.checked; return; }
    if (el.id === 'pr-town') { PR.town = el.value; PR.batch = 0; U.render(); }
    if (el.id === 'pr-nos') { PR.nos = el.value; PR.batch = 0; U.render(); }
  });
  act.prWhat = el => { PR.what = el.dataset.v; PR.batch = 0; U.render(); };
  act.prPaper = el => { PR.paper = el.dataset.v; U.render(); };
  act.prRange = el => { PR.range = el.dataset.v; PR.batch = 0; if (PR.range === 'town' && !PR.town) PR.town = K.geo.list[0].town; U.render(); };
  act.prMonth = el => { PR.month = Number(el.dataset.v); PR.batch = 0; U.render(); };
  act.prRoute = el => { PR.route = el.dataset.v; U.render(); };
  act.prBatch = el => { PR.batch = Number(el.dataset.v); U.render(); };
  act.prBlank = el => { PR.blank = Number(el.dataset.v); U.render(); };
  act.prBMonth = el => { PR.bmonth = Number(el.dataset.v); U.render(); };

  /* ---------- S-13（0.11.0） ---------- */
  function s13Box() {
    const k = AK();
    const y = PR.s13Year;
    const years = [thisYear() - 1, thisYear()];
    const d = PR.s13[y];
    const n = s13Count();
    const pages = n ? Math.ceil(s13Entries().reduce((t, e) => t + Math.max(1, Math.ceil(e.items.length / K.s13.PER)), 0) / K.s13.SHEETS[PR.paper].rows) : 0;
    const yr = v => (v - 1) + '年9月〜' + v + '年8月';
    return `<div class="lbl">奉仕年度</div>
      <div class="seg wrap">${years.map(v => `<button data-act="prS13Year" data-v="${v}" aria-pressed="${y === v}">${v}<small class="pr-mm">${yr(v)}</small></button>`).join('')}</div>
      ${k.aptOnly() ? '' : `<div class="lbl">どの区域</div><div class="seg two"><button data-act="prS13Kind" data-v="h" aria-pressed="${PR.s13Kind === 'h'}">戸建ての区域</button><button data-act="prS13Kind" data-v="b" aria-pressed="${PR.s13Kind === 'b'}">集合住宅</button></div>`}
      ${PR.s13Kind === 'h' ? `<div class="seg wrap">${[['all', 'すべて'], ['town', '町を選ぶ'], ['nos', '番号で選ぶ']].map(o => `<button data-act="prS13Range" data-v="${o[0]}" aria-pressed="${PR.s13Range === o[0]}">${o[1]}</button>`).join('')}</div>
        ${PR.s13Range === 'town' ? townSelect() : ''}
        ${PR.s13Range === 'nos' ? `<input id="pr-nos" class="sel" value="${esc(PR.nos)}" placeholder="例：Z07-1〜Z07-8, Z12, H03-2" autocomplete="off">` : ''}` : ''}
      <p class="pr-count">${d ? `<b class="num">${n}</b>${PR.s13Kind === 'h' ? '区域' : '棟'}・<b class="num">${pages}</b>枚` : PR.s13Loading ? '読んでいます…' : ''}</p>
      <p class="muted small">割り当てられた人・割り当てた日付（配った日）・完了した日付（返した日）を、${yr(y)}の分だけ並べます。前の年度から持ち越した分も入ります。「最後に完了した日付」は、${y - 1}年8月までに最後に返した日です。${PR.s13Kind === 'b' ? '集合住宅は、全部の部屋を一通り回るまでを1回とし、始めた日・終わった日を書きます。' : '不在宅訪問とグループの手持ちは入れません。'}4回より多い区域は、次の行に続けます。</p>`;
  }
  function townSelect() {
    const towns = [];
    K.geo.list.forEach(t => { if (towns.indexOf(t.town) < 0) towns.push(t.town); });
    if (!PR.town) PR.town = towns[0];
    return `<select id="pr-town" class="sel">${towns.map(t => `<option ${PR.town === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  }
  /** S-13 に並べる区域・建物と、その年度の割り当て */
  function s13Entries() {
    const k = AK();
    const d = PR.s13[PR.s13Year];
    if (!d) return [];
    if (PR.s13Kind === 'b') {
      const by = {};
      (d.buildings || []).forEach(x => { by[x.id] = x; });
      return (k.A.data.buildings || []).slice().sort((a, b) => (k.noKey(a.no) < k.noKey(b.no) ? -1 : 1))
        .map(b => ({ no: b.no, last: (by[b.id] || {}).last || '', items: (by[b.id] || {}).items || [] }));
    }
    const by = {};
    (d.terrs || []).forEach(x => { by[x.id] = x; });
    // 外した区域も、その年度に割り当てがあれば載せる
    const all = K.geo.list.filter(t => t.houses > 0 || (t.off && by[t.id] && (by[t.id].items || []).length));
    const ids = PR.s13Range === 'town' ? all.filter(t => t.town === PR.town).map(t => t.id) : PR.s13Range === 'nos' ? parseNos(PR.nos) : all.map(t => t.id);
    return ids.map(id => ({ no: K.geo.terr[id].no, last: (by[id] || {}).last || '', items: (by[id] || {}).items || [] }));
  }
  function s13Count() { return s13Entries().length; }
  function s13Model() {
    const d = PR.s13[PR.s13Year];
    return K.s13.model(s13Entries(), { year: String(PR.s13Year), paper: PR.paper, sub: PR.s13Kind === 'b' ? '集合住宅' : '', made: '区域訪問管理　' + ((d && d.today) || H.todayStr()) + ' 現在' });
  }
  act.prS13Year = el => { PR.s13Year = Number(el.dataset.v); PR.s13Err = null; U.render(); };
  act.prS13Kind = el => { PR.s13Kind = el.dataset.v; U.render(); };
  act.prS13Range = el => { PR.s13Range = el.dataset.v; U.render(); };
  act.prS13Reload = () => { PR.s13Err = null; delete PR.s13[PR.s13Year]; U.render(); };
  act.prSave = async el => {
    const nos = document.getElementById('pr-nos');
    if (nos) PR.nos = nos.value;
    if (!K.h.canSave()) { AK().toast('この画面（お試し版）では保存できません。見本で形を確かめられます'); return; }
    const kind = el.dataset.v;
    PR.saving = kind; U.render();
    try {
      const m = s13Model();
      const blob = kind === 'docx' ? await K.s13.docx(m) : await K.s13.pdf(m);
      const name = 'S-13_' + m.year + '奉仕年度_' + (PR.s13Kind === 'b' ? '集合住宅' : '戸建て') + (PR.s13Kind === 'h' && PR.s13Range === 'town' ? '_' + PR.town : '') + '_' + PR.paper + '.' + kind;
      const res = await K.h.saveFile(blob, name);
      AK().toast(res === 'declined' ? '保存をやめました' : name + ' を保存しました（' + Math.max(1, Math.round(blob.size / 1024)) + 'KB）');
    } catch (e) { AK().toast('作れませんでした：' + (e.message || e)); }
    PR.saving = ''; U.render();
  };

  /* ---------- 選んだ区域・建物 ---------- */
  function noKey(no) { const m = String(no).match(/^([A-Z]+)(\d+)(?:-(\d+))?$/); return m ? [m[1], Number(m[2]), m[3] === undefined ? null : Number(m[3])] : null; }
  /** 「Z07-1〜Z07-8, Z12, H03-2」を区域の一覧に */
  function parseNos(text) {
    const all = K.geo.list.filter(t => t.houses > 0);
    const out = new Set();
    String(text || '').normalize('NFKC').toUpperCase().split(/[,、\s]+/).map(s => s.trim()).filter(Boolean).forEach(part => {
      const r = part.split(/[〜~]/);
      if (r.length === 2) {
        const a = noKey(r[0]), b = noKey(r[1]);
        if (!a || !b || a[0] !== b[0]) return;
        const ka = a[1] * 1000 + (a[2] || 0), kb = b[1] * 1000 + (b[2] === null ? 999 : b[2]);
        all.forEach(t => { const x = noKey(t.no); if (x && x[0] === a[0]) { const kx = x[1] * 1000 + (x[2] || 0); if (kx >= Math.min(ka, kb) && kx <= Math.max(ka, kb)) out.add(t.id); } });
        return;
      }
      const a = noKey(part);
      if (!a) return;
      all.forEach(t => { const x = noKey(t.no); if (x && x[0] === a[0] && x[1] === a[1] && (a[2] === null || x[2] === a[2])) out.add(t.id); });
    });
    return all.filter(t => out.has(t.id)).map(t => t.id);
  }
  function cardIds() {
    const k = AK();
    const all = K.geo.list.filter(t => t.houses > 0);
    if (PR.range === 'town') return all.filter(t => t.town === PR.town).map(t => t.id);
    if (PR.range === 'nos') return parseNos(PR.nos);
    if (PR.range === 'out') { const out = k.outMap(); return all.filter(t => out[t.id]).map(t => t.id); }
    if (PR.range === 'month' && K.plan) return all.filter(t => K.plan.groupOf(t.id) === PR.month).map(t => t.id);
    if (PR.range === 'left' && K.plan) { const S = K.plan.summary(); const left = new Set(S.left.concat(Object.keys(k.outMap()).filter(id => K.plan.tier(id) !== 9 && K.geo.terr[id]))); return all.filter(t => left.has(t.id)).map(t => t.id); }
    return all.map(t => t.id);
  }
  function bldgIds() {
    const k = AK();
    return (k.A.data.buildings || []).filter(b => (PR.route === 'all' || k.routesOf(b).indexOf(PR.route) >= 0) && (!PR.bmonth || (K.plan && K.plan.groupOf(b.id, null, null, 'b') === PR.bmonth)))
      .sort((a, b) => (k.noKey(a.no) < k.noKey(b.no) ? -1 : 1)).map(b => b.id);
  }

  /* ==================== 見本（印刷する形） ==================== */
  const JOB = { urls: new Map(), total: 0, done: 0 };
  act.prMake = () => {
    const nos = document.getElementById('pr-nos');
    if (nos) PR.nos = nos.value;
    const paper = PAPERS[PR.paper];
    let html = '';
    if (PR.what === 's13') {
      if (!s13Count()) { AK().toast('区域が選ばれていません'); return; }
      const g = K.s13.SHEETS[PR.paper];
      openDoc(K.s13.html(s13Model()), { w: g.w, h: g.h, m: 9, f: 3, label: PAPERS[PR.paper].label + '・S-13' });
      return;
    }
    if (PR.what === 'cards') {
      let ids = cardIds();
      if (ids.length > BATCH) ids = ids.slice(PR.batch * BATCH, (PR.batch + 1) * BATCH);
      if (!ids.length) { AK().toast('区域が選ばれていません'); return; }
      html = ids.map(id => terrCard(id, paper)).join('');
    } else if (PR.what === 'bcards') {
      const ids = bldgIds();
      if (!ids.length) { AK().toast('建物がありません'); return; }
      html = ids.map((id, i) => bldgCard(id, paper, i === ids.length - 1)).join('');
    } else if (PR.what === 'refused') html = refusedList(paper);
    else if (PR.what === 'out') html = outList(paper);
    else if (PR.what === 'people') html = peopleList(paper);
    else html = ledger(paper);
    openDoc(html, paper);
  };
  function openDoc(html, paper) {
    closeDoc();
    const canPrint = K.cfg.canPrint && !H.inFrame;
    const root = document.createElement('div');
    root.id = 'print-root';
    root.className = 'pr-screen';
    const w = Math.min(window.innerWidth - 24, 900);
    const pz = Math.min(1, w / (paper.w * PX));
    root.innerHTML = `<div class="pr-bar"><b>見本（${esc(paper.label)}）</b><span class="pr-status"></span>
        <button class="btn primary" data-act="prPrint" ${canPrint ? '' : 'disabled'}>${I.print}<span>印刷する</span></button><button class="btn" data-act="prClose">閉じる</button></div>
      <div class="pr-doc" style="--pw:${paper.w}mm;--ph:${paper.h}mm;--pm:${paper.m}mm;--pf:${paper.f}mm;--pz:${pz.toFixed(3)}">${html}</div>`;
    document.body.appendChild(root);
    document.body.classList.add('pr-on');
    let st = document.getElementById('pr-page-style');
    if (!st) { st = document.createElement('style'); st.id = 'pr-page-style'; document.head.appendChild(st); }
    st.textContent = `@page { size: ${paper.w}mm ${paper.h}mm; margin: ${paper.m}mm; }`;
    window.scrollTo(0, 0);
    loadTiles(root);
  }
  function closeDoc() {
    const r = document.getElementById('print-root');
    if (r) r.remove();
    document.body.classList.remove('pr-on');
    JOB.urls.forEach(p => p.then(u => { if (u) URL.revokeObjectURL(u); }));
    JOB.urls = new Map();
  }
  act.prClose = () => closeDoc();
  act.prPrint = () => {
    if (JOB.done < JOB.total && !confirmLater()) return;
    try { window.print(); } catch (e) { AK().toast('この画面では印刷できません'); }
  };
  function confirmLater() { AK().toast('地図を読み終えてから印刷します。少し待ってください'); return false; }
  U.leaveHooks.push(closeDoc);

  /** 地図の絵（保存した地図）を、見本の中の img に入れる */
  function loadTiles(root) {
    const imgs = Array.from(root.querySelectorAll('img[data-t]'));
    JOB.total = imgs.length; JOB.done = 0;
    const status = () => { const s = root.querySelector('.pr-status'); if (s) s.textContent = JOB.done < JOB.total ? '地図を読んでいます ' + JOB.done + '/' + JOB.total : ''; };
    status();
    let i = 0;
    const next = () => {
      if (i >= imgs.length || !root.isConnected) return;
      const img = imgs[i++];
      const key = img.dataset.t;
      if (!JOB.urls.has(key)) { const p = key.split('/').map(Number); JOB.urls.set(key, K.basemap.tileUrl(p[0], p[1], p[2])); }
      JOB.urls.get(key).then(u => {
        const fin = () => { JOB.done++; status(); next(); };
        if (!u) { img.remove(); fin(); return; }
        img.onload = fin; img.onerror = () => { img.remove(); fin(); };
        img.src = u;
      });
    };
    for (let n = 0; n < 6; n++) next();
  }

  /* ---------- 地図（区域カード） ---------- */
  const lon2x = (lon, z) => (lon + 180) / 360 * TS * Math.pow(2, z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TS * Math.pow(2, z); };
  const x2lon = (x, z) => x / (TS * Math.pow(2, z)) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (TS * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const polyPath = (multi, P) => multi.map(poly => poly.map(ring => ring.map((q, i) => (i ? 'L' : 'M') + P(q).map(v => v.toFixed(1)).join(' ')).join(' ') + 'Z').join(' ')).join(' ');

  /**
   * 区域の地図を、幅 w・高さ h（mm）の枠に描く。保存した地図の絵の上に、区域とブロックの線・家の印を重ねる。
   *   縮尺は、区域が枠に入るいちばん細かいズーム（地図の文字が小さくなりすぎないよう、縮めるのは0.7倍まで）
   */
  function mapBox(t, w, h, look) {
    const meta = K.basemap.meta || { minZoom: 12, maxZoom: 18 };
    const bw = w * PX, bh = h * PX;
    let s = t.bb[0], wl = t.bb[1], n = t.bb[2], e = t.bb[3];
    const padY = Math.max(0.0004, (n - s) * 0.12), padX = Math.max(0.0005, (e - wl) * 0.12);
    s -= padY; n += padY; wl -= padX; e += padX;
    let z = meta.maxZoom, sc = 1;
    for (z = meta.maxZoom; z >= meta.minZoom; z--) {
      const sx = lon2x(e, z) - lon2x(wl, z), sy = lat2y(s, z) - lat2y(n, z);
      sc = Math.min(bw / sx, bh / sy);
      if (sc >= 0.7) break;
    }
    sc = Math.min(sc, 2);
    const iw = bw / sc, ih = bh / sc;
    const cx = (lon2x(wl, z) + lon2x(e, z)) / 2, cy = (lat2y(s, z) + lat2y(n, z)) / 2;
    const x0 = cx - iw / 2, y0 = cy - ih / 2;
    const P = q => [lon2x(q[1], z) - x0, lat2y(q[0], z) - y0];
    const mm = v => v * PX / sc;   // 印刷で v mm になる長さ（地図の中の点で）
    // 絵（保存した地図のタイル）
    const tiles = [];
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x0 + iw) / TS); tx++) {
      for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y0 + ih) / TS); ty++) {
        tiles.push(`<img data-t="${z}/${tx}/${ty}" alt="" style="left:${(tx * TS - x0).toFixed(1)}px;top:${(ty * TS - y0).toFixed(1)}px">`);
      }
    }
    // まわりの区域（うすい線と番号）
    const vs = y2lat(y0 + ih, z), vn = y2lat(y0, z), vw = x2lon(x0, z), ve = x2lon(x0 + iw, z);
    const near = K.geo.list.filter(o => o.id !== t.id && o.bb[0] < vn && o.bb[2] > vs && o.bb[1] < ve && o.bb[3] > vw);
    const others = near.map(o => o.blocks.map(bid => K.geo.block[bid] ? `<path d="${polyPath(K.geo.block[bid].poly, P)}" class="pm-oth" style="stroke-width:${mm(0.25)}"/>` : '').join('')).join('');
    const otherLabels = near.map(o => { const c = P([(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2]); return `<text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" class="pm-olab" style="font-size:${mm(2.4)}px;stroke-width:${mm(0.5)}px">${esc(o.no)}</text>`; }).join('');
    // この区域のブロック
    const mine = t.blocks.map(bid => K.geo.block[bid] ? `<path d="${polyPath(K.geo.block[bid].poly, P)}" class="pm-blk" style="stroke-width:${mm(0.55)}"/>` : '').join('');
    // 家の印
    const r = look.r, f = look.f;
    const marks = look.houses.map(x => {
      const c = P([x.h.lat, x.h.lon]);
      if (x.kind === 'apt' || x.kind === 'wait') {
        const a = mm(r * 1.9);
        return `<g class="pm-h ${x.kind}"><rect x="${(c[0] - a / 2).toFixed(1)}" y="${(c[1] - a / 2).toFixed(1)}" width="${a.toFixed(1)}" height="${a.toFixed(1)}" style="stroke-width:${mm(0.3)}"/><text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" style="font-size:${mm(f * 0.9)}px">${x.kind === 'apt' ? '集' : '確'}</text></g>`;
      }
      return `<g class="pm-h ${x.refused ? 'ref' : x.kind}"><circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${mm(r)}" style="stroke-width:${mm(0.3)}"/><text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" style="font-size:${mm(x.label.length > 2 ? f * 0.78 : f)}px">${esc(x.label)}</text></g>`;
    }).join('');
    // 縮尺の線（地図の左下）と北
    const mpp = 156543.03392 * Math.cos((s + n) / 2 * Math.PI / 180) / Math.pow(2, z);   // 1点あたりのm（ズーム z）
    const mPerMm = mpp * PX / sc;
    const nice = [20, 50, 100, 200, 300, 500, 1000];
    const len = nice.find(v => v / mPerMm >= Math.min(22, w * 0.18)) || 1000;
    return `<div class="pmap" style="width:${w}mm;height:${h}mm">
      <div class="pm-in" style="width:${iw.toFixed(1)}px;height:${ih.toFixed(1)}px;transform:scale(${sc.toFixed(4)})">${tiles.join('')}
        <svg class="pm-svg" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}" viewBox="0 0 ${iw.toFixed(1)} ${ih.toFixed(1)}">${others}${mine}${otherLabels}${marks}</svg></div>
      <div class="pm-scale"><i style="width:${(len / mPerMm).toFixed(1)}mm"></i>${len >= 1000 ? len / 1000 + 'km' : len + 'm'}</div>
      <div class="pm-north">↑北</div></div>`;
  }

  /** 区域の家：印の形と、記録欄に出す番号 */
  /** その区域で今「訪問しない」の家（サーバーは家ごとに返す。どの区域かは、今の区切りで決める） */
  function refusedIn(tid) {
    const all = (PR.data && PR.data.houses) || [];
    const list = Array.isArray(all) ? all : Object.keys(all).reduce((a, k) => a.concat(all[k].map(x => Object.assign({ tid: k }, x))), []);
    return list.filter(x => { const h = K.geo.house[x.h]; return h ? h.t === tid : x.tid === tid; });
  }
  function housesOf(tid) {
    const st = K.houseStates();
    const refused = new Set(refusedIn(tid).map(x => x.h));
    const hs = (K.geo.byTerr[tid] || []).filter(h => !h.prov);
    let extra = Math.max(0, ...hs.map(h => h.n || 0));
    return hs.map(h => {
      const kind = K.houseKind(h, st).kind;
      if (kind === 'gone') return null;
      let n = h.n;
      if (kind === 'house' && !n) n = ++extra;   // 大きな建物を「家」と決めたもの：印刷のための番号
      return { h: h, kind: kind, n: n || 0, label: kind === 'empty' ? '空' : String(n || ''), refused: kind === 'house' && refused.has(h.id) };
    }).filter(Boolean).sort((a, b) => a.n - b.n);
  }

  /* ---------- 区域カード ---------- */
  function terrCard(tid, P) {
    const k = AK();
    const t = K.geo.terr[tid];
    const lr = (k.A.data.lastReturned || {})[tid];
    const out = k.outMap()[tid];
    const hs = housesOf(tid);
    const targets = hs.filter(x => x.kind === 'house');
    const refused = targets.filter(x => x.refused);
    const cw = P.w - 2 * P.m, ch = P.h - 2 * P.m - 0.6;
    const f = P.f;
    const headH = f * 3.4, legH = f * 1.6, footH = PR.qr ? Math.max(12, f * 4) : f * 2.2, gap = f * 0.6;
    const cols = Math.max(2, Math.floor(cw / (f * 10)));
    const rows = Math.ceil(targets.length / cols);
    let rowH = f * 2;
    let gridH = PR.rec ? f * 1.8 + rows * rowH : 0;
    let mapH = ch - headH - legH - footH - gridH - gap * 4;
    if (PR.rec && mapH < ch * 0.42) { rowH = Math.max(f * 1.35, (ch * 0.58 - headH - legH - footH - gap * 4 - f * 1.8) / Math.max(1, rows)); gridH = f * 1.8 + rows * rowH; mapH = ch - headH - legH - footH - gridH - gap * 4; }
    const g = K.plan ? K.plan.groupOf(tid) : 0;
    const map = mapBox(t, cw, mapH, { houses: hs, r: f * 0.62, f: f * 0.72 });
    const c = [(t.bb[0] + t.bb[2]) / 2, (t.bb[1] + t.bb[3]) / 2];
    const grid = PR.rec ? `<div class="pc-grid" style="--cols:${cols};--rh:${rowH.toFixed(2)}mm">
        <p class="pc-gh">家の番号と記録（会＝会えた・不＝不在・拒＝拒否）。日付も書いてください。</p>
        ${targets.map(x => `<div class="pc-cell ${x.refused ? 'ref' : ''}"><b>${esc(x.label)}</b><span>${x.refused ? '訪問しない' : ''}</span></div>`).join('')}</div>` : '';
    return `<section class="pr-card pc" style="--f:${f}mm">
      <header class="pc-head" style="height:${headH}mm">
        <div class="pc-no"><b>${esc(t.no)}</b><span>${esc(t.town)}</span></div>
        <div class="pc-meta"><span>家 <b>${targets.length}</b>軒${refused.length ? '・訪問しない <b>' + refused.length + '</b>' : ''}</span>
          <span>${g ? '一巡の ' + g + 'か月目・' : ''}${lr ? '前回の返却 ' + esc(lr) : 'まだ配っていません'}${out && out.name ? '・配布中（' + esc(out.name) + '）' : ''}</span></div>
      </header>
      ${map}
      <p class="pc-leg" style="height:${legH}mm"><span class="lg h">1</span>家（番号）<span class="lg ref">2</span>訪問しない<span class="lg apt">集</span>集合住宅（別に回る）<span class="lg wait">確</span>確かめ中<span class="lg emp">空</span>空き家　${refused.length ? '<b>訪問しない：' + refused.map(x => esc(x.label)).join('・') + '</b>' : ''}</p>
      ${grid}
      <footer class="pc-foot" style="height:${footH}mm">
        ${PR.qr && window.qrcode ? `<div class="pc-qr">${qr(U.gmapsUrl(c[0], c[1], 17))}<small>場所の地図</small></div>` : ''}
        <p>地図：保存した地図（国土地理院ベクトルタイル提供実験を加工して作成）<br>区域訪問管理　印刷 ${esc(H.todayStr())}　会員の中だけで使い、訪問先に渡さないでください</p>
      </footer></section>`;
  }
  function qr(text) { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); }

  /* ---------- 集合住宅カード ---------- */
  function bldgCard(bid, P, last) {
    const k = AK();
    const b = (k.A.data.buildings || []).find(x => x.id === bid);
    const rooms = ((PR.data && PR.data.rooms && PR.data.rooms[bid]) || []);
    const ents = {};
    rooms.forEach(r => { (ents[r.entrance || ''] = ents[r.entrance || ''] || []).push(r); });
    const refused = rooms.filter(r => r.refused);
    const lr = (k.A.data.lastReturned || {})[bid];
    const cw = P.w - 2 * P.m;
    const per = Math.max(4, Math.floor(cw / (P.f * 6.2)));
    // 入口ごとに、部屋を階の順に並べる（部屋番号で階が分かるので、階ごとの行は作らない）
    const body = Object.keys(ents).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })).map(e => {
      const list = ents[e].slice().sort((a, b) => (a.floor || 0) - (b.floor || 0));
      return `<div class="pb-ent">${e ? '<h4>入口 ' + esc(e) + '（' + list.length + '部屋）</h4>' : ''}<div class="pb-rooms" style="--per:${per}">${list.map(r => `<div class="pb-room ${r.refused ? 'ref' : ''}"><b>${esc(r.no)}</b><span>${r.refused ? '訪問しない' : ''}</span></div>`).join('')}</div></div>`;
    }).join('');
    return `<section class="pr-flow pb${last ? ' pb-last' : ''}" style="--f:${P.f}mm">
      <header class="pc-head"><div class="pc-no"><b>${esc(b.no)}</b><span>${esc(b.name)}</span></div>
        <div class="pc-meta"><span>${esc(b.type || '')}${b.autolock ? '・オートロック ' + esc(b.autolock) : ''}・${rooms.length}部屋${refused.length ? '・訪問しない <b>' + refused.length + '</b>' : ''}</span><span>${esc((k.routesOf(b).map(k.rName).join('・')) || '回り方なし')}${lr ? '・前回の返却 ' + esc(lr) : ''}</span>${b.address ? '<span>' + esc(b.address) + '</span>' : ''}</div></header>
      <p class="pc-gh">部屋ごとに記録（会＝会えた・不＝不在・拒＝拒否）。日付も書いてください。</p>
      ${body || '<p>部屋が登録されていません。</p>'}
      <footer class="pc-foot pb-foot">${PR.qr && window.qrcode && b.lat !== null && b.lat !== undefined && b.lat !== '' ? `<div class="pc-qr">${qr(U.gmapsUrl(b.lat, b.lon, 18))}<small>場所の地図</small></div>` : ''}
        <p>区域訪問管理　印刷 ${esc(H.todayStr())}　会員の中だけで使い、訪問先に渡さないでください</p></footer></section>`;
  }

  /* ---------- 一覧 ---------- */
  function docHead(title, note) {
    return `<header class="pl-dochead"><h1>${esc(title)}</h1><p>${esc(H.todayStr())} 現在${note ? '　' + note : ''}</p></header>`;
  }
  function refusedList(P) {
    const k = AK();
    const d = PR.data || { houses: [], rooms: {} };
    const rowsT = K.geo.list.map(t => {
      const list = refusedIn(t.id);
      if (!list.length) return '';
      const hs = housesOf(t.id);
      const byId = {};
      hs.forEach(x => { byId[x.h.id] = x; });
      const items = list.map(x => ({ n: byId[x.h] ? byId[x.h].n : 0, label: byId[x.h] ? byId[x.h].label : '（地図にない家）', at: x.at })).sort((a, b) => a.n - b.n);
      return `<tr><th class="num">${esc(t.no)}</th><td>${esc(t.town)}</td><td>${items.map(x => '<b class="num">' + esc(x.label) + '</b><small>（' + esc(x.at) + '）</small>').join('　')}</td></tr>`;
    }).join('');
    const bl = (k.A.data.buildings || []).slice().sort((a, b) => (k.noKey(a.no) < k.noKey(b.no) ? -1 : 1));
    const rowsB = bl.map(b => {
      const list = (d.rooms[b.id] || []).filter(r => r.refused);
      if (!list.length) return '';
      return `<tr><th class="num">${esc(b.no)}</th><td>${esc(b.name)}</td><td>${list.map(r => '<b class="num">' + esc((r.entrance ? r.entrance + '-' : '') + r.no) + '</b><small>（' + esc(r.at) + '）</small>').join('　')}</td></tr>`;
    }).join('');
    return `<section class="pr-flow pl" style="--f:${P.f}mm">${docHead('訪問しない家・部屋の一覧', '番号は区域カード・集合住宅カードの番号です')}
      <h2>戸建ての区域</h2>${rowsT ? `<table class="pl-t"><thead><tr><th>区域</th><th>町</th><th>訪問しない家（拒否にした日）</th></tr></thead><tbody>${rowsT}</tbody></table>` : '<p>ありません。</p>'}
      <h2>集合住宅</h2>${rowsB ? `<table class="pl-t"><thead><tr><th>建物</th><th>名前</th><th>訪問しない部屋（拒否にした日）</th></tr></thead><tbody>${rowsB}</tbody></table>` : '<p>ありません。</p>'}
      <p class="pl-note">この一覧は会員の中だけで使い、訪問先に見せないでください。古くなったものは処分してください。</p></section>`;
  }
  function outList(P) {
    const k = AK();
    const d = k.A.data;
    const users = {};
    d.users.forEach(u => { users[u.id] = u; });
    const dists = d.dists.filter(x => !x.other);
    const by = {};
    dists.forEach(x => { const key = x.userId || ('g:' + (x.groupId || '')); (by[key] = by[key] || []).push(x); });
    const order = k.usersSorted(d.users).map(u => u.id).concat(d.groups.map(g => 'g:' + g.id)).filter(key => by[key]);
    const kindTxt = x => (x.kind === '通常' ? '' : K.kindLabel(x.kind) || x.kind);
    const rows = order.map(key => {
      const list = by[key].slice().sort((a, b) => (a.no < b.no ? -1 : 1));
      const who = key.indexOf('g:') === 0 ? k.groupName(key.slice(2)) + '（手持ち）' : (users[key] ? users[key].name : '');
      const grp = key.indexOf('g:') === 0 ? '' : k.groupName((users[key] || {}).groupId);
      return list.map((x, i) => `<tr>${i ? '' : `<th rowspan="${list.length}">${esc(who)}<small>${esc(grp)}</small></th>`}<td class="num">${esc(x.no)}${x.roomNos ? '<small>' + esc(x.roomNos.join('・')) + '</small>' : ''}</td><td>${esc(kindTxt(x))}</td><td class="num">${esc(x.distributedAt || '')}</td><td class="num">${esc(x.due || '')}</td><td class="num">${esc(x.forced || '')}</td></tr>`).join('');
    }).join('');
    return `<section class="pr-flow pl" style="--f:${P.f}mm">${docHead('配布中の一覧', dists.length + '件')}
      <table class="pl-t"><thead><tr><th>持っている人</th><th>区域</th><th>種別</th><th>配布日</th><th>回収日</th><th>完全回収日</th></tr></thead><tbody>${rows || '<tr><td colspan="6">配布中の区域はありません。</td></tr>'}</tbody></table></section>`;
  }
  function peopleList(P) {
    const k = AK();
    const d = k.A.data;
    const def = (d.settings && d.settings.usualDefault) || 4;
    const groups = d.groups.concat([{ id: '', name: 'グループなし' }]);
    const body = groups.map(g => {
      const us = k.usersSorted(d.users.filter(u => u.active && (u.groupId || '') === g.id));
      if (!us.length) return '';
      return `<h2>${esc(g.name)}${g.area ? '<small>（' + esc(g.area) + '）</small>' : ''}　${us.length}人</h2>
        <table class="pl-t"><thead><tr><th>名前</th><th>ふりがな</th><th>役割</th><th>いつもの枚数</th><th>配り方</th></tr></thead><tbody>
        ${us.map(u => `<tr><th>${esc(u.name)}</th><td>${esc(u.kana || '')}</td><td>${esc(u.role)}</td><td class="num">${u.usual === null || u.usual === undefined || u.usual === '' ? def + '（決めていない）' : esc(u.usual)}</td><td>${u.mode === '近く' ? '家の近く' : '散らばる'}</td></tr>`).join('')}</tbody></table>`;
    }).join('');
    return `<section class="pr-flow pl" style="--f:${P.f}mm">${docHead('人とグループの一覧', '利用カードの番号（鍵）は載せていません')}${body}</section>`;
  }
  function ledger(P) {
    const k = AK();
    const d = k.A.data;
    const rows = [];
    if (PR.fill) {
      d.dists.filter(x => !x.other).slice().sort((a, b) => (a.distributedAt < b.distributedAt ? -1 : a.distributedAt > b.distributedAt ? 1 : a.no < b.no ? -1 : 1)).forEach(x => {
        rows.push(`<tr><td class="num">${esc(x.distributedAt || '')}</td><td class="num">${esc(x.no)}</td><td>${esc(x.kind === '手持ち' ? k.groupName(x.groupId) + '（手持ち）' : x.name || '')}</td><td>${esc(x.kind === '通常' ? '' : K.kindLabel(x.kind) || x.kind)}</td><td class="num">${esc(x.due || '')}</td><td></td><td></td></tr>`);
      });
    }
    const perPage = Math.max(10, Math.floor((P.h - 2 * P.m - 30) / (P.f * 2.4)));
    for (let i = 0; i < PR.blank * perPage; i++) rows.push('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
    return `<section class="pr-flow pl pl-ledger" style="--f:${P.f}mm">${docHead('配布と回収の台帳', 'アプリが使えないあいだ、配ったとき・返ってきたときに1行ずつ書きます')}
      <table class="pl-t"><thead><tr><th>配布日</th><th>区域番号</th><th>相手</th><th>種別</th><th>回収日</th><th>返却日</th><th>確認</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <p class="pl-note">アプリに戻ったら、この台帳の分を入れます（手引き「使えないときの運用」）。</p></section>`;
  }

  K.printKit = { parseNos, PAPERS, mapBox, housesOf };
})();

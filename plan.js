/*
 * 区域訪問管理 — 一巡の計画（0.10.0。0.11.0：冬の前倒し・集合住宅の別枠）
 *   一巡の長さと始めた月・月ごとの組（自動：地域ごと／散らばる。地図で手で直す）・
 *   進み具合と計画線・遅れと取り残しの知らせ・配る枚数の目安。
 *   配る画面の候補は、遅れている組 → 今月の組 → 次の月からの組 → この一巡で回った区域 の順に並ぶ（K.plan.tier）
 *
 *   枠（frame）は2つ：'h' 戸建ての区域（家の数で数える）・'b' 集合住宅（建物ごと。部屋の数で数える）。
 *   集合住宅は戸建てとは別に、一巡の月数・月ごとの組・進み具合を持つ（始まりの月は同じ）。
 *   月ごとの配りやすさ（1月〜12月の%）：冬を少なめにすると、ほかの月の組が大きくなる（冬の前倒し）。
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

  /** 組の色（1か月目〜12か月目） */
  const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#65a30d', '#0d9488', '#b45309'];
  const colorOf = g => COLORS[(g - 1) % COLORS.length];
  const gStyle = (g, sel) => (sel ? { stroke: '#111827', fill: g ? colorOf(g) : '#94a3b8', fillOpacity: 0.75, weight: 3.2 }
    : g ? { stroke: colorOf(g), fill: colorOf(g), fillOpacity: 0.38, weight: 1.2 } : { stroke: '#64748b', fill: '#cbd5e1', fillOpacity: 0.35, weight: 1, dashArray: '3 3' });

  /* ---------- 月の計算 ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  const ymAdd = (ym, n) => { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  const ymDiff = (a, b) => { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return (pb[0] - pa[0]) * 12 + (pb[1] - pa[1]); };
  const lastDay = ym => { const p = ym.split('-').map(Number); return ym + '-' + pad2(new Date(p[0], p[1], 0).getDate()); };
  const ymJ = ym => { const p = String(ym).split('-'); return p[0] + '年' + Number(p[1]) + '月'; };
  const mJ = ym => Number(String(ym).split('-')[1]) + '月';
  const dayNum = s => { const p = String(s).split('-').map(Number); return Math.round(new Date(p[0], p[1] - 1, p[2]).getTime() / 864e5); };

  const data = () => K.adminData || {};
  const planOf = () => data().plan || { months: 4, start: '', groups: {} };
  const terrs = () => K.geo.list.filter(t => t.houses > 0);
  const bldgs = () => (data().buildings || []).filter(b => b.active !== false);
  /** 枠：区域IDか建物IDか */
  const frameOf = id => (/^AP/.test(String(id)) ? 'b' : 'h');
  /** 枠ごとの「区域」：{id, no, name, size（家・部屋の数）, order} */
  function itemsOf(frame) {
    if (frame === 'b') {
      const k = AK();
      return bldgs().map(b => ({ id: b.id, no: b.no, name: b.name, size: Math.max(1, b.rooms || 0), order: k ? k.target(b.id).order : 0, b: b }))
        .sort((a, b) => (AK().noKey(a.no) < AK().noKey(b.no) ? -1 : 1));
    }
    return terrs().map(t => ({ id: t.id, no: t.no, name: t.town, size: t.houses, order: t.i }));
  }
  const UNIT = { h: '区域', b: '棟' };
  const SIZE = { h: '軒', b: '部屋' };
  const monthsOf = frame => {
    const p = planOf();
    const m = frame === 'b' ? Number(p.aptMonths) || Number(p.months) || 4 : Number(p.months) || 4;
    return frame === 'b' ? Math.max(2, Math.min(12, m)) : Math.max(2, Math.min(6, m));
  };
  const weightsOf = frame => { const w = frame === 'b' ? planOf().aptWeights : planOf().weights; return Array.isArray(w) && w.length === 12 ? w : null; };
  function hasGroups(frame) {
    frame = frame || 'h';
    const g = planOf().groups || {};
    return Object.keys(g).some(id => frameOf(id) === frame);
  }

  /**
   * 今の一巡。{set:false} なら始めた月を決めていない。
   *   n：何回目の一巡、month：今月は何か月目（まだ始まっていなければ 0）、from・to：一巡の最初と最後の日
   */
  function cycle(today, frame) {
    frame = frame || 'h';
    const p = planOf();
    const months = monthsOf(frame);
    if (!p.start) return { set: false, months: months, frame: frame };
    today = today || H.todayStr();
    const diff = ymDiff(p.start, today.slice(0, 7));
    const before = diff < 0;
    const k = before ? 0 : Math.floor(diff / months);
    const s = ymAdd(p.start, k * months), e = ymAdd(s, months - 1);
    const from = s + '-01', to = lastDay(e);
    return {
      set: true, frame: frame, months: months, n: k + 1, before: before, startYm: s, endYm: e, from: from, to: to,
      month: before ? 0 : diff - k * months + 1,
      days: dayNum(to) - dayNum(from) + 1,
      dayIdx: before ? 0 : dayNum(today) - dayNum(from) + 1,
      daysLeft: before ? dayNum(to) - dayNum(from) + 1 : dayNum(to) - dayNum(today) + 1,
      today: today,
    };
  }
  const monthYm = (cy, m) => ymAdd(cy.startYm, m - 1);
  /** 一巡の月ごとの配りやすさ（1か月目〜。決めていなければ全部 100） */
  function cycleWeights(cy, frame, w) {
    w = w || weightsOf(frame);
    const out = [];
    for (let m = 1; m <= cy.months; m++) {
      if (!w || !cy.set) { out.push(100); continue; }
      out.push(Number(w[Number(monthYm(cy, m).slice(5)) - 1]) || 0);
    }
    if (!out.some(x => x > 0)) return out.map(() => 100);
    return out;
  }
  /** 区域・建物の組（1〜一巡の月数）。決まっていなければ 0 */
  function groupOf(id, groups, months, frame) {
    frame = frame || frameOf(id);
    const g = Number((groups || planOf().groups || {})[id]) || 0;
    return g ? Math.min(g, months || monthsOf(frame)) : 0;
  }
  /** この一巡で回ったか（戸建て：返した日が一巡の中。集合住宅：全部の部屋を一巡の中で回った） */
  function doneIn(id, cy, lr) {
    if (!cy.set) return false;
    if (frameOf(id) === 'b') {
      const p = planOf();
      const a = p.apt && p.apt[id];
      return !!(a && a[2] && p.aptFrom === cy.from && a[2] >= cy.from);
    }
    return !!(lr[id] && lr[id] >= cy.from);
  }
  /** いつ回ったか（この一巡の中で。グラフに使う） */
  function doneAt(id, cy) {
    const p = planOf();
    if (frameOf(id) === 'b') { const a = p.apt && p.apt[id]; return a && a[2] && p.aptFrom === cy.from ? a[2] : ''; }
    const lr = data().lastReturned || {};
    return lr[id] && lr[id] >= cy.from ? lr[id] : '';
  }

  /**
   * 配る候補の並びの段（小さいほど先）。一巡と組が決まっていなければ全部 0（今までどおり「長く配っていない順」だけ）
   *   0：前の月の組で、まだ回っていない（遅れ）　1：今月の組（組のない区域も）　2〜：次の月からの組　9：この一巡で回った
   */
  function tier(id) {
    const frame = frameOf(id);
    const cy = cycle(null, frame);
    if (!cy.set || !hasGroups(frame)) return 0;
    const lr = data().lastReturned || {};
    if (doneIn(id, cy, lr)) return 9;
    const g = groupOf(id, null, cy.months, frame);
    const m = Math.max(1, cy.month);
    if (!g || g === m) return 1;
    return g < m ? 0 : 1 + (g - m);
  }

  /** 今の状態のまとめ。groups を渡すと、その組で数える（保存する前の案） */
  function summary(groups, frame) {
    frame = frame || 'h';
    const cy = cycle(null, frame);
    const lr = data().lastReturned || {};
    const out = AK().outMap();
    groups = groups || planOf().groups || {};
    const by = [];
    for (let m = 0; m <= cy.months; m++) by.push({ m: m, n: 0, h: 0, done: 0, out: 0, todo: 0, todoIds: [] });
    let done = 0, doneH = 0, totalH = 0;
    const list = itemsOf(frame);
    list.forEach(t => {
      const g = groupOf(t.id, groups, cy.months, frame);
      const x = by[g];
      x.n++; x.h += t.size; totalH += t.size;
      if (doneIn(t.id, cy, lr)) { x.done++; done++; doneH += t.size; } else if (out[t.id]) x.out++; else { x.todo++; x.todoIds.push(t.id); }
    });
    const m = Math.max(1, cy.month);
    const late = cy.set && !cy.before ? by.filter(x => x.m >= 1 && x.m < m).reduce((a, x) => a.concat(x.todoIds), []) : [];
    const nowTodo = cy.set ? by.filter(x => x.m === m || x.m === 0).reduce((a, x) => a.concat(x.todoIds), []) : [];
    const lastMonth = cy.set && !cy.before && cy.month === cy.months;
    const left = by.reduce((a, x) => a.concat(x.todoIds), []);
    return { frame: frame, cy: cy, by: by, total: list.length, totalH: totalH, done: done, doneH: doneH, late: late, nowTodo: nowTodo, lastMonth: lastMonth, left: left, outN: by.reduce((n, x) => n + x.out, 0), w: cycleWeights(cy, frame) };
  }
  /** 計画線：一巡の d 日目までに回っている予定の数（組があれば月ごとの組の数、なければ配りやすさで分ける） */
  function plannedAt(S, d) {
    const cy = S.cy;
    const span = m => { const ym = monthYm(cy, m); return [dayNum(ym + '-01') - dayNum(cy.from), dayNum(lastDay(ym)) - dayNum(cy.from) + 1]; };
    const sumW = S.w.reduce((a, b) => a + b, 0) || 1;
    // 組のない分は、配りやすさの割合で月ごとに足す
    const share = n => { let cum = 0; for (let m = 1; m <= cy.months; m++) { const ab = span(m); const part = n * S.w[m - 1] / sumW; if (d >= ab[1]) cum += part; else { if (d > ab[0]) cum += part * (d - ab[0]) / (ab[1] - ab[0]); break; } } return cum; };
    if (!hasGroups(S.frame)) return share(S.total);
    let cum = 0;
    for (let m = 1; m <= cy.months; m++) {
      const ab = span(m);
      const n = S.by[m].n;
      if (d >= ab[1]) cum += n;
      else { if (d > ab[0]) cum += n * (d - ab[0]) / (ab[1] - ab[0]); break; }
    }
    return cum + share(S.by[0].n);
  }
  /** 今月あと配る必要がある数（遅れ＋今月の組のまだ。最後の月は残り全部） */
  function needNow(S) {
    if (!S.cy.set || S.cy.before) return { n: 0, late: 0, now: 0 };
    if (!hasGroups(S.frame)) {
      // 組がないときは「残り × 今月の配りやすさ ÷ 残りの月の配りやすさ」
      const rest = S.w.slice(S.cy.month - 1);
      const sw = rest.reduce((a, b) => a + b, 0) || 1;
      return { n: Math.ceil(S.left.length * (rest[0] / sw)), late: 0, now: 0, even: true };
    }
    if (S.lastMonth) return { n: S.left.length, late: S.late.length, now: S.left.length - S.late.length };
    return { n: S.late.length + S.nowTodo.length, late: S.late.length, now: S.nowTodo.length };
  }

  /* ---------- 月ごとの組を自動で作る ---------- */
  /**
   * mode：'area'（地域ごと。番号の並び＝町ごと・西から東を、家の数がそろうように月の数に切る）
   *       'spread'（散らばる。並びの上で月の数ずつ取り、まだ足りない組から順に入れる。どの月も全体に少しずつ）
   * w：月ごとの配りやすさ（1か月目〜の数）。大きい月ほど組が大きくなる（冬の前倒し）。0 の月には入れない
   */
  function autoGroups(mode, months, frame, w) {
    frame = frame || 'h';
    const list = itemsOf(frame).slice().sort((a, b) => a.order - b.order);
    const total = list.reduce((n, t) => n + t.size, 0);
    w = (w && w.length === months ? w : new Array(months).fill(100)).map(x => Math.max(0, Number(x) || 0));
    if (!w.some(x => x > 0)) w = w.map(() => 100);
    const sw = w.reduce((a, b) => a + b, 0);
    const out = {};
    if (mode === 'area') {
      const bounds = [];
      let c = 0;
      w.forEach(x => { c += x; bounds.push(total * c / sw); });
      let acc = 0;
      list.forEach(t => {
        const mid = acc + t.size / 2;
        let g = bounds.findIndex(b => mid < b) + 1;
        if (g <= 0) g = months;
        while (w[g - 1] === 0 && g < months) g++;
        while (w[g - 1] === 0 && g > 1) g--;
        out[t.id] = g;
        acc += t.size;
      });
      return out;
    }
    const sum = new Array(months + 1).fill(0);
    const ratio = g => sum[g] / (w[g - 1] / sw);
    const usable = [];
    for (let g = 1; g <= months; g++) if (w[g - 1] > 0) usable.push(g);
    for (let i = 0; i < list.length; i += usable.length) {
      const chunk = list.slice(i, i + usable.length).sort((a, b) => b.size - a.size);
      const order = usable.slice().sort((a, b) => ratio(a) - ratio(b) || a - b);
      chunk.forEach((t, j) => { const g = order[j]; out[t.id] = g; sum[g] += t.size; });
    }
    return out;
  }

  /* ==================== 画面：一巡の計画 ==================== */
  const PL = { tab: 'prog', frame: 'h', draft: null, sel: new Set(), months: null, start: null, aptMonths: null, wdraft: null, cov: null, covLoading: false, covErr: null, how: '' };

  views.aPlan = async function () {
    const k = AK();
    if (!k.A.data) await k.load();
    if (U.view().fresh) { Object.assign(PL, { draft: null, sel: new Set(), months: null, start: null, aptMonths: null, wdraft: null, cov: null, covErr: null, how: '' }); if (U.view().frame) PL.frame = U.view().frame; U.view().fresh = false; }
    if (k.aptOnly()) PL.frame = 'b';
    if (PL.frame === 'b' && !bldgs().length) PL.frame = 'h';
    const fr = PL.frame;
    const cy = cycle(null, fr);
    if (!cy.set && PL.tab === 'prog') PL.tab = 'set';
    const frames = !k.aptOnly() && bldgs().length ? `<div class="seg two pl-frames"><button data-act="plFrame" data-v="h" aria-pressed="${fr === 'h'}">戸建ての区域</button><button data-act="plFrame" data-v="b" aria-pressed="${fr === 'b'}">${I.bldg}<span>集合住宅（別枠）</span></button></div>` : '';
    const tabs = `<div class="seg three">${[['prog', '進み具合'], ['groups', '月ごとの組'], ['set', '一巡の設定']].map(x => `<button data-act="plTab" data-v="${x[0]}" aria-pressed="${PL.tab === x[0]}">${x[1]}</button>`).join('')}</div>`;
    let body = '', bar = '';
    if (PL.tab === 'set') body = fr === 'b' ? aptSetView(cy) : setView(cy);
    else if (PL.tab === 'groups') { const r = groupsView(cy); body = r.body; bar = r.bar; } else body = progView(cy);
    const lead = fr === 'b'
      ? '集合住宅を、戸建てとは別に、決めた月数で一巡するための計画です（建物の全部の部屋を回ったら「回った」）。集まりと1枚ずつ配るの候補は、遅れている組 → 今月の組 → 次の月の組 の順に出ます。'
      : '戸建ての区域を、決めた月数で一巡するための計画です。配る画面の候補は、遅れている組 → 今月の組 → 次の月の組 → この一巡で回った区域 の順に出ます。';
    k.shell('一巡の計画', `${frames}<p class="muted small">${lead}</p>${tabs}${body}`, { bar: bar });
    if (fr === 'h' && PL.tab === 'prog' && cy.set && !cy.before && !PL.cov && !PL.covLoading && !PL.covErr) loadCov(cy);
  };
  function loadCov(cy) {
    PL.covLoading = true;
    const months = Math.min(24, Math.max(cy.months, ymDiff(cy.startYm, H.todayStr().slice(0, 7)) + 1));
    AK().api('coverage', { months: months }).then(r => { PL.cov = r; }).catch(e => { PL.covErr = e; }).finally(() => { PL.covLoading = false; if (U.view().name === 'aPlan') U.render(); });
  }
  act.plTab = el => { PL.tab = el.dataset.v; PL.sel = new Set(); U.render(); window.scrollTo(0, 0); };
  act.plFrame = el => { if (PL.frame === el.dataset.v) return; PL.frame = el.dataset.v; PL.draft = null; PL.sel = new Set(); PL.wdraft = null; PL.how = ''; U.render(); };

  /* ---------- 一巡の設定 ---------- */
  function setView(cy) {
    const p = planOf();
    const months = PL.months || p.months || 4;
    const start = PL.start !== null ? PL.start : (p.start || H.todayStr().slice(0, 7));
    const endYm = start ? ymAdd(start, months - 1) : '';
    return `<h2 class="sec">一巡の設定</h2>
      ${cy.set ? `<p class="notice info">今は<b>${cy.n}回目の一巡</b>（${ymJ(cy.startYm)}〜${ymJ(cy.endYm)}・${cy.months}か月）${cy.before ? 'が始まる前です' : 'の<b>' + cy.month + 'か月目</b>です'}。</p>` : '<p class="notice">まだ一巡の始まりを決めていません。決めると、進み具合と月ごとの組が使えます。</p>'}
      <div class="lbl">一巡の長さ</div>
      <div class="seg wrap">${[2, 3, 4, 5, 6].map(n => `<button data-act="plMonths" data-v="${n}" aria-pressed="${months === n}">${n}か月</button>`).join('')}</div>
      <label class="lbl" for="pl-start">最初の一巡を始める月</label>
      <input id="pl-start" type="month" class="sel" value="${esc(start)}">
      <p class="muted small">${start ? '1回目の一巡は ' + ymJ(start) + '〜' + ymJ(endYm) + '。' : ''}一巡が終わると、同じ長さで次の一巡が自動で始まります（${start ? ymJ(ymAdd(start, months)) + 'から2回目' : ''}）。あとで長さを変えると、最初の月から数え直します。</p>
      <button class="btn primary wide" data-act="plSaveSet">保存する</button>
      ${p.start ? '<button class="btn wide" data-act="plStop">一巡の計画を使わない（始まりを消す）</button>' : ''}
      ${weightBox('h', cy)}
      <h2 class="sec">ひと月に配る数の目安</h2>
      ${guideBox(months)}`;
  }
  function aptSetView(cy) {
    const p = planOf();
    const same = PL.aptMonths === null ? !!p.aptSame : PL.aptMonths === 0;
    const months = PL.aptMonths === null ? (p.aptSame ? 0 : p.aptMonths) : PL.aptMonths;
    const bl = bldgs();
    const rooms = bl.reduce((n, b) => n + (b.rooms || 0), 0);
    const mm = months || p.months || 4;
    return `<h2 class="sec">集合住宅の一巡</h2>
      ${cy.set ? `<p class="notice info">集合住宅は今<b>${cy.n}回目の一巡</b>（${ymJ(cy.startYm)}〜${ymJ(cy.endYm)}・${cy.months}か月）${cy.before ? 'が始まる前です' : 'の<b>' + cy.month + 'か月目</b>です'}。</p>` : '<p class="notice">一巡の始まりは、戸建てと同じ月です。［戸建ての区域］→［一巡の設定］で決めてください。</p>'}
      <div class="lbl">集合住宅の一巡の長さ</div>
      <div class="seg wrap"><button data-act="plAptMonths" data-v="0" aria-pressed="${same}">戸建てと同じ（${p.months || 4}か月）</button>${[2, 3, 4, 5, 6, 8, 10, 12].map(n => `<button data-act="plAptMonths" data-v="${n}" aria-pressed="${!same && months === n}">${n}か月</button>`).join('')}</div>
      <p class="muted small">集合住宅は、戸建てとは別に数えます（月ごとの組・進み具合・遅れ）。始まりの月は戸建てと同じで、長さだけ変えられます。建物の全部の部屋（拒否をのぞく）を、その一巡のあいだに回ったら「回った」です。</p>
      <button class="btn primary wide" data-act="plSaveApt">保存する</button>
      ${weightBox('b', cy)}
      <h2 class="sec">ひと月の目安</h2>
      <p>${bl.length}棟（${rooms}部屋）を${mm}か月で一巡するには、<b>ひと月に約${Math.ceil(bl.length / mm)}棟・${Math.ceil(rooms / mm)}部屋</b>を回る必要があります（配りやすさを決めていれば、月ごとに上下します）。</p>`;
  }
  /** 月ごとの配りやすさ（冬の前倒し） */
  const PRESET_WINTER = [60, 60, 80, 100, 100, 100, 100, 100, 100, 120, 120, 70];
  function wDraft(frame) {
    if (!PL.wdraft || PL.wdraft.frame !== frame) PL.wdraft = { frame: frame, w: (weightsOf(frame) || new Array(12).fill(100)).slice() };
    return PL.wdraft.w;
  }
  function weightBox(frame, cy) {
    const w = wDraft(frame);
    const saved = weightsOf(frame) || new Array(12).fill(100);
    const changed = w.some((x, i) => x !== saved[i]);
    const cw = cy.set ? cycleWeights(cy, frame, w) : null;
    const items = itemsOf(frame);
    const sw = cw ? cw.reduce((a, b) => a + b, 0) || 1 : 1;
    const prev = cw ? cw.map((x, i) => `<span class="pl-wp"><b>${i + 1}か月目</b>${mJ(monthYm(cy, i + 1))}<i class="num">約${Math.round(items.length * x / sw)}${UNIT[frame]}</i></span>`).join('') : '';
    return `<h2 class="sec">月ごとの配りやすさ（冬の前倒し）</h2>
      <p class="muted small">${frame === 'b' ? '集合住宅' : '戸建て'}の、1月〜12月の回りやすさを%で決めます。雪や寒さで回りにくい月を少なめにすると、その分ほかの月（雪の前の10・11月など）の組が大きくなります。月ごとの組を「自動で作る」ときと、計画線・今月の目安に使います。</p>
      <div class="pl-wgrid">${w.map((x, i) => `<div class="pl-wcell ${x !== 100 ? 'on' : ''}"><b>${i + 1}月</b><span class="stepper"><button data-act="plW" data-m="${i}" data-d="-10" aria-label="${i + 1}月を減らす" ${x <= 0 ? 'disabled' : ''}>−</button><b class="num">${x}%</b><button data-act="plW" data-m="${i}" data-d="10" aria-label="${i + 1}月を増やす" ${x >= 200 ? 'disabled' : ''}>＋</button></span></div>`).join('')}</div>
      <div class="row-btns"><button class="btn sm" data-act="plWPreset" data-v="same">どの月も同じ</button><button class="btn sm" data-act="plWPreset" data-v="winter">冬を少なめ（例：12〜2月を6〜7割・10・11月を多め）</button></div>
      ${cy.set ? `<div class="pl-wprev"><p class="small">この一巡（${ymJ(cy.startYm)}〜${ymJ(cy.endYm)}）の月ごとの目安：</p>${prev}</div>` : ''}
      <button class="btn ${changed ? 'primary' : ''} wide" data-act="plWSave" data-v="${frame}" ${changed ? '' : 'disabled'}>${changed ? '配りやすさを保存する' : '配りやすさは保存済みです'}</button>
      ${changed ? '' : (weightsOf(frame) ? '<p class="muted small">月ごとの組を作り直すと、この割合で組の大きさが変わります（［月ごとの組］→［自動で作る］）。</p>' : '')}`;
  }
  act.plW = el => { const w = wDraft(PL.frame); const m = Number(el.dataset.m); w[m] = Math.max(0, Math.min(200, w[m] + Number(el.dataset.d))); keepStart(); U.render(); };
  act.plWPreset = el => { const w = wDraft(PL.frame); const src = el.dataset.v === 'winter' ? PRESET_WINTER : new Array(12).fill(100); src.forEach((x, i) => { w[i] = x; }); keepStart(); U.render(); };
  act.plWSave = async el => {
    const k = AK();
    const frame = el.dataset.v;
    const w = wDraft(frame);
    if (!w.some(x => x > 0)) { k.toast('どれか1つの月は0より大きくしてください'); return; }
    el.disabled = true;
    try {
      await k.api('saveSetting', { name: frame === 'b' ? '集合住宅の月ごとの配りやすさ' : '月ごとの配りやすさ', value: w.join(',') });
      await k.load();
      PL.wdraft = null;
      k.toast('配りやすさを保存しました' + (hasGroups(frame) ? '。組を作り直すと、この割合になります' : ''));
      U.render();
    } catch (e) { el.disabled = false; }
  };
  function guideBox(months) {
    const d = data();
    const n = terrs().length;
    const cy = cycle(null, 'h');
    const cw = cy.set ? cycleWeights(cy, 'h') : new Array(months).fill(100);
    const sw = cw.reduce((a, b) => a + b, 0) || 1;
    const per = Math.ceil(n / months);
    const peak = Math.ceil(n * Math.max.apply(null, cw) / sw);
    const def = (d.settings && d.settings.usualDefault) || 4;
    const cap = (d.users || []).filter(u => u.active).reduce((s, u) => s + (u.usual === null || u.usual === undefined || u.usual === '' ? def : Number(u.usual)), 0);
    const uneven = cw.some(x => x !== cw[0]);
    return `<p>${n}区域を${months}か月で一巡するには、<b>ひと月に約${per}区域</b>を配って返してもらう必要があります${uneven ? '（配りやすさで分けると、いちばん多い月は約' + peak + '区域）' : ''}。</p>
      <p class="muted small">全員の「いつもの枚数」の合計は <b class="num">${cap}</b>枚です。回収日が月末なら、ひと月に配れるのはおよそこの数です（集合住宅・不在宅訪問の分は別）。${cap < (uneven ? peak : per) ? '<b class="warn-t">計画より少ないので、一巡が延びそうです。いつもの枚数を見直すか、一巡を長くしてください。</b>' : 'この数なら計画に足ります。'}</p>`;
  }
  act.plMonths = el => { keepStart(); PL.months = Number(el.dataset.v); U.render(); };
  act.plAptMonths = el => { PL.aptMonths = Number(el.dataset.v); U.render(); };
  function keepStart() { const s = document.getElementById('pl-start'); if (s) PL.start = s.value; }
  act.plSaveSet = async el => {
    keepStart();
    const k = AK();
    const p = planOf();
    const months = PL.months || p.months || 4;
    const start = PL.start !== null ? PL.start : (p.start || '');
    if (!/^\d{4}-\d{2}$/.test(start)) { k.toast('始める月を選んでください'); return; }
    el.disabled = true;
    try {
      if (months !== p.months) await k.api('saveSetting', { name: '一巡の月数', value: months });
      if (start !== p.start) await k.api('saveSetting', { name: '一巡の始まり', value: start });
      await k.load();
      PL.months = null; PL.start = null; PL.cov = null;
      k.toast('一巡の設定を保存しました');
      PL.tab = hasGroups('h') ? 'prog' : 'groups';
      U.render(); window.scrollTo(0, 0);
    } catch (e) { el.disabled = false; }
  };
  act.plSaveApt = async el => {
    const k = AK();
    const p = planOf();
    const v = PL.aptMonths === null ? (p.aptSame ? 0 : p.aptMonths) : PL.aptMonths;
    el.disabled = true;
    try {
      await k.api('saveSetting', { name: '集合住宅の一巡の月数', value: v ? v : '' });
      await k.load();
      PL.aptMonths = null;
      k.toast('集合住宅の一巡の長さを保存しました');
      PL.tab = hasGroups('b') ? 'prog' : 'groups';
      U.render(); window.scrollTo(0, 0);
    } catch (e) { el.disabled = false; }
  };
  act.plStop = async el => {
    const k = AK();
    if (!k.sure(el, 'もう一度押すと、一巡の計画を使わなくなります（組は残ります）')) return;
    el.disabled = true;
    try { await k.api('saveSetting', { name: '一巡の始まり', value: '' }); await k.load(); k.toast('一巡の計画を止めました'); U.render(); } catch (e) { el.disabled = false; }
  };

  /* ---------- 進み具合 ---------- */
  function progView(cy) {
    if (!cy.set) return '';
    const fr = PL.frame;
    const S = summary(null, fr);
    if (cy.before) {
      return `<p class="notice info">${cy.n}回目の一巡は <b>${ymJ(cy.startYm)}</b> に始まります（${ymJ(cy.startYm)}〜${ymJ(cy.endYm)}）。</p>${groupTable(S)}`;
    }
    const planned = Math.round(plannedAt(S, cy.dayIdx));
    const diff = S.done - planned;
    const need = needNow(S);
    const pct = S.total ? Math.round(S.done * 100 / S.total) : 0;
    const u = UNIT[fr];
    return `
      <div class="pl-head">
        <p class="pl-cycle">${fr === 'b' ? '集合住宅・' : ''}${cy.n}回目の一巡　${ymJ(cy.startYm)}〜${ymJ(cy.endYm)}　<b>${cy.month}か月目</b>（あと${cy.daysLeft}日）</p>
        <div class="cy-sum">
          <span><b class="num">${S.done}</b><small>回った${fr === 'b' ? '建物' : '区域'}（全${S.total}・${pct}%）</small></span>
          <span><b class="num ${diff < 0 ? 'warn-t' : 'ok-t'}">${diff < 0 ? diff : '+' + diff}</b><small>計画（今日まで${planned}${u}）との差</small></span>
          <span><b class="num">${S.outN}</b><small>今配っている${fr === 'b' ? '建物' : '区域'}</small></span>
          ${fr === 'b' ? aptRooms() : ''}
        </div>
      </div>
      ${chart(S)}
      ${needBox(S, need)}
      ${lateBox(S)}
      ${groupTable(S)}
      ${fr === 'h' && bldgs().length && !AK().aptOnly() ? '<p class="muted small">集合住宅の進み具合は、上の［集合住宅（別枠）］で見られます。</p>' : ''}`;
  }
  /** 集合住宅：この一巡で回った部屋の数 */
  function aptRooms() {
    const p = planOf();
    const a = p.apt || {};
    let c = 0, r = 0;
    bldgs().forEach(b => { const x = a[b.id]; if (x) { c += x[0]; r += x[1]; } else r += b.rooms || 0; });
    return `<span><b class="num">${c}</b><small>回った部屋（全${r}部屋）</small></span>`;
  }
  function needBox(S, need) {
    const d = data();
    const u = UNIT[S.frame];
    if (!need.n) return `<p class="notice info">今月の分は配り終えています。</p>`;
    if (S.frame === 'b') {
      return `<div class="pl-need"><p><b>今月あと ${need.n}棟</b>を回ると計画どおりです${need.even ? '（組を決めていないので、残りを配りやすさで分けた数）' : S.lastMonth ? '（一巡の最後の月なので、まだの建物すべて）' : '（遅れ ' + need.late + '・今月の組 ' + need.now + '）'}。</p>
        <p class="muted small">集まりと1枚ずつ配るの候補は、遅れている組・今月の組の建物が先に出ます。</p>
        <div class="row-btns"><button class="btn primary" data-act="aGo" data-v="aGather">${I.bldg}<span>集まりで割り振る</span></button><button class="btn" data-act="aGo" data-v="aOne">${I.check}<span>1枚ずつ配る</span></button></div></div>`;
    }
    const def = (d.settings && d.settings.usualDefault) || 4;
    const cap = (d.users || []).filter(x => x.active).reduce((s, x) => s + Math.max(0, (x.usual === null || x.usual === undefined || x.usual === '' ? def : Number(x.usual)) - (x.cards || 0)), 0);
    return `<div class="pl-need"><p><b>今月あと ${need.n}${u}</b>を配ると計画どおりです${need.even ? '（組を決めていないので、残りを配りやすさで分けた数）' : S.lastMonth ? '（一巡の最後の月なので、まだの区域すべて）' : '（遅れ ' + need.late + '・今月の組 ' + need.now + '）'}。</p>
      <p class="muted small">いま全員に「いつもの枚数」まで配ると <b class="num">${cap}</b>枚です${cap < need.n ? '。<b class="warn-t">足りない分は、集まりや1枚ずつ配るで補ってください</b>' : ''}。</p>
      <div class="row-btns"><button class="btn primary" data-act="aGo" data-v="aAll">${I.users}<span>全員に配る</span></button><button class="btn" data-act="aGo" data-v="aOne">${I.check}<span>1枚ずつ配る</span></button></div></div>`;
  }
  function lateBox(S) {
    const ids = S.lastMonth ? S.left : S.late;
    if (!ids.length) return '';
    const lr = data().lastReturned || {};
    const fr = S.frame;
    const by = {};
    itemsOf(fr).forEach(x => { by[x.id] = x; });
    const list = ids.map(id => by[id]).filter(Boolean).sort((a, b) => ((lr[a.id] || '') < (lr[b.id] || '') ? -1 : 1) || a.order - b.order);
    const what = fr === 'b' ? '建物' : '区域';
    const pa = planOf().apt || {};
    return `<h2 class="sec">${S.lastMonth ? 'この一巡でまだの' + what + '（配っていない）' : '遅れている' + what + '（前の月の組で、まだ配っていない）'}　<span class="badge">${ids.length}</span></h2>
      <p class="muted small">配る画面では、この${what}がいちばん先に出ます。${S.lastMonth ? '一巡の終わりまでに配り切れない分は、次の一巡の最初に回ります。' : ''}</p>
      <div class="tlist">${list.slice(0, 80).map(t => `<div class="trow"><b class="num">${esc(t.no)}</b><span class="town">${esc(t.name)}</span><span class="h num">${t.size}${SIZE[fr]}</span><span class="st">${groupOf(t.id) ? groupOf(t.id) + 'か月目・' : ''}${fr === 'b' && pa[t.id] && pa[t.id][0] ? 'この一巡で ' + pa[t.id][0] + '/' + pa[t.id][1] + '部屋' : lr[t.id] ? '前回 ' + esc(H.mdShort(lr[t.id])) : 'まだ配っていません'}</span></div>`).join('')}</div>
      ${list.length > 80 ? '<p class="muted small">ほか ' + (list.length - 80) + UNIT[fr] + '</p>' : ''}`;
  }
  function groupTable(S) {
    const cy = S.cy;
    const fr = S.frame;
    if (!hasGroups(fr)) return `<p class="notice">${fr === 'b' ? '集合住宅の' : ''}月ごとの組をまだ作っていません。［月ごとの組］で作ると、今月どの${fr === 'b' ? '建物' : '区域'}を配ればよいかが分かります。</p>`;
    const sw = S.w.reduce((a, b) => a + b, 0) || 1;
    // 目安とのずれ：大きな建物は1つで目安を超えることがあるので、いちばん大きい区域・建物の分までは「合っている」とする
    const big = itemsOf(fr).reduce((m, t) => Math.max(m, t.size), 0);
    const isOff = (h, t) => t && Math.abs(h - t) > Math.max(t * 0.15, big);
    const rows = [];
    for (let m = 1; m <= cy.months; m++) {
      const x = S.by[m];
      const cur = !cy.before && m === cy.month;
      const late = !cy.before && m < cy.month && x.todo > 0;
      const target = Math.round(S.totalH * S.w[m - 1] / sw);
      const off = isOff(x.h, target);
      rows.push(`<tr class="${cur ? 'cur' : ''}"><th><i class="pl-sw" style="background:${colorOf(m)}"></i>${m}か月目<small>${mJ(monthYm(cy, m))}</small></th><td class="num">${x.n}<small>${x.h}${SIZE[fr]}</small></td><td class="num ${off ? 'warn-t' : ''}">${target}<small>${SIZE[fr]}</small></td><td class="num">${x.done}</td><td class="num">${x.out}</td><td class="num ${late ? 'warn-t' : ''}">${x.todo}</td></tr>`);
    }
    if (S.by[0].n) rows.push(`<tr><th>組なし</th><td class="num">${S.by[0].n}</td><td></td><td class="num">${S.by[0].done}</td><td class="num">${S.by[0].out}</td><td class="num">${S.by[0].todo}</td></tr>`);
    const offAny = S.w.some((w, i) => isOff(S.by[i + 1].h, S.totalH * w / sw));
    return `<h2 class="sec">月ごとの組</h2>
      <div class="cy-wrap"><table class="pl-tbl"><thead><tr><th>組</th><th>${UNIT[fr] === '棟' ? '建物' : '区域'}</th><th>目安</th><th>回った</th><th>配布中</th><th>まだ</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      ${offAny ? `<p class="muted small"><b class="warn-t">組の大きさが、月ごとの配りやすさの目安と合っていない月があります</b>（一巡の月が変わったときなど）。［月ごとの組］→［自動で作る］で作り直せます。</p>` : ''}`;
  }
  /** 計画線（点線）と、回った数（実線）。横は一巡の日、縦は数 */
  function chart(S) {
    const cy = S.cy;
    const W = 640, Hh = 230, L0 = 44, R0 = 12, T0 = 14, B0 = 34;
    const x = d => L0 + (W - L0 - R0) * d / cy.days;
    const y = n => T0 + (Hh - T0 - B0) * (1 - n / Math.max(1, S.total));
    // 回った日（一巡の中で最初に返した日。集合住宅は全部の部屋を回った日）
    const firstIn = {};
    if (S.frame === 'h' && PL.cov && PL.cov.terrs) PL.cov.terrs.forEach(t => { (t.hist || []).forEach(h => { if (h.to >= cy.from && h.to <= cy.to && (!firstIn[t.id] || h.to < firstIn[t.id])) firstIn[t.id] = h.to; }); });
    itemsOf(S.frame).forEach(t => { if (!firstIn[t.id]) { const d = doneAt(t.id, cy); if (d) firstIn[t.id] = d; } });
    const perDay = new Array(cy.days + 2).fill(0);
    Object.keys(firstIn).forEach(id => { const d = dayNum(firstIn[id]) - dayNum(cy.from) + 1; if (d >= 1 && d <= cy.days) perDay[d]++; });
    let cum = 0;
    const act0 = [[x(0), y(0)]];
    for (let d = 1; d <= Math.min(cy.dayIdx, cy.days); d++) { cum += perDay[d]; act0.push([x(d), y(cum)]); }
    const plan = [];
    for (let d = 0; d <= cy.days; d += Math.max(1, Math.round(cy.days / 60))) plan.push([x(d), y(plannedAt(S, d))]);
    plan.push([x(cy.days), y(plannedAt(S, cy.days))]);
    const grid = [];
    const small = cy.months > 6;
    for (let m = 0; m <= cy.months; m++) {
      const d = m === cy.months ? cy.days : dayNum(monthYm(cy, m + 1) + '-01') - dayNum(cy.from);
      grid.push(`<line x1="${x(d)}" y1="${T0}" x2="${x(d)}" y2="${Hh - B0}" class="pl-grid"/>`);
      if (m < cy.months) { const d2 = dayNum(lastDay(monthYm(cy, m + 1))) - dayNum(cy.from) + 1; grid.push(`<text x="${(x(d) + x(d2)) / 2}" y="${Hh - 14}" class="pl-ax" text-anchor="middle">${small ? mJ(monthYm(cy, m + 1)) : (m + 1) + 'か月目（' + mJ(monthYm(cy, m + 1)) + '）'}</text>`); }
    }
    const yt = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(S.total * f));
    const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const today = cy.dayIdx;
    const what = S.frame === 'b' ? '全部回った建物' : '回った区域';
    return `<figure class="pl-chart"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="計画線と${what}の数">
      ${yt.map(n => `<line x1="${L0}" y1="${y(n)}" x2="${W - R0}" y2="${y(n)}" class="pl-grid"/><text x="${L0 - 6}" y="${y(n) + 4}" class="pl-ax" text-anchor="end">${n}</text>`).join('')}
      ${grid.join('')}
      <path d="${path(plan)}" class="pl-plan"/>
      <path d="${path(act0)}" class="pl-act"/>
      <line x1="${x(today)}" y1="${T0}" x2="${x(today)}" y2="${Hh - B0}" class="pl-today"/>
      <text x="${x(today) + 4}" y="${T0 + 10}" class="pl-ax">今日</text>
    </svg><figcaption><span class="pl-key act"></span>${what}　<span class="pl-key plan"></span>計画線${S.w.some(v => v !== S.w[0]) ? '（月ごとの配りやすさで傾きが変わります）' : ''}${PL.covLoading ? '（くわしい日付を読んでいます…）' : ''}</figcaption></figure>`;
  }

  /* ---------- 月ごとの組（自動で作る・地図で直す） ---------- */
  function draft() {
    if (!PL.draft || PL.draft.frame !== PL.frame) {
      const g = {};
      const all = planOf().groups || {};
      Object.keys(all).forEach(id => { if (frameOf(id) === PL.frame) g[id] = all[id]; });
      PL.draft = { frame: PL.frame, g: g };
    }
    return PL.draft.g;
  }
  function changedN() {
    const all = planOf().groups || {}, b = draft();
    const ids = new Set(Object.keys(all).filter(id => frameOf(id) === PL.frame).concat(Object.keys(b)));
    let n = 0;
    ids.forEach(id => { if ((Number(all[id]) || 0) !== (Number(b[id]) || 0)) n++; });
    return n;
  }
  function groupsView(cy) {
    const k = AK();
    const fr = PL.frame;
    const months = cy.months;
    const g = draft();
    const S = summary(g, fr);
    const sw = S.w.reduce((a, b) => a + b, 0) || 1;
    const rows = [];
    for (let m = 1; m <= months; m++) rows.push(`<tr><th><i class="pl-sw" style="background:${colorOf(m)}"></i>${m}か月目${cy.set ? '<small>' + mJ(monthYm(cy, m)) + '</small>' : ''}</th><td class="num">${S.by[m].n}</td><td class="num">${S.by[m].h}${SIZE[fr]}</td><td class="num">${Math.round(S.totalH * S.w[m - 1] / sw)}${SIZE[fr]}</td></tr>`);
    if (S.by[0].n) rows.push(`<tr><th>組なし</th><td class="num">${S.by[0].n}</td><td class="num">${S.by[0].h}${SIZE[fr]}</td><td></td></tr>`);
    const nSel = PL.sel.size;
    const ch = changedN();
    const MV = k.MV;
    const items = itemsOf(fr);
    const legendHtml = `<div class="tm-legend">${Array.from({ length: months }, (_, i) => `<span><i style="background:${colorOf(i + 1)};border-color:${colorOf(i + 1)}"></i>${i + 1}か月目</span>`).join('')}<span><i style="background:#cbd5e1;border-color:#64748b"></i>組なし</span></div>`;
    let pick = '';
    const mvKey = fr === 'b' ? 'plgb' : 'plg';
    if (MV[mvKey] === 'map') {
      if (fr === 'b') {
        const withLoc = items.filter(x => x.b.lat !== null && x.b.lat !== undefined && x.b.lat !== '');
        pick = legendHtml + k.mapSlot('plan-groups-b', {
          style: () => ({ stroke: '#94a3b8', fill: '#e2e8f0', fillOpacity: 0.12, weight: 0.6 }), label: null, onTap: null, labelZoom: 99,
          buildings: withLoc.map(x => { const gg = groupOf(x.id, g, months, 'b'); return { id: x.id, lat: x.b.lat, lon: x.b.lon, html: `<i style="background:${gg ? colorOf(gg) : '#94a3b8'}">${esc(x.no)}</i>`, cls: 'plan' + (PL.sel.has(x.id) ? ' sel' : '') }; }),
          onTapB: id => { if (PL.sel.has(id)) PL.sel.delete(id); else PL.sel.add(id); U.render(); },
          fit: withLoc.map(x => x.id),
        }) + `<p class="muted small">建物の印をさわって選び（もう一度で外す）、下のボタンで何か月目に入れるかを決めます。${items.length - withLoc.length ? '地図の場所がない建物（' + (items.length - withLoc.length) + '棟）は「一覧で選ぶ」から選んでください。' : ''}</p>`;
      } else {
        pick = legendHtml + k.mapSlot('plan-groups', {
          style: id => gStyle(groupOf(id, g, months, 'h'), PL.sel.has(id)),
          label: id => esc(K.geo.terr[id].no) + (groupOf(id, g, months, 'h') ? '<small>' + groupOf(id, g, months, 'h') + '</small>' : ''),
          onTap: id => { if (!K.geo.terr[id].houses) return; if (PL.sel.has(id)) PL.sel.delete(id); else PL.sel.add(id); U.render(); },
          fit: null,
        }) + '<p class="muted small">区域をさわって選び（もう一度で外す）、下のボタンで何か月目に入れるかを決めます。</p>';
      }
    } else {
      const sec = [];
      for (let m = 0; m <= months; m++) {
        const ids = items.filter(t => groupOf(t.id, g, months, fr) === m);
        if (!ids.length) continue;
        sec.push(`<h3 class="ghead"><i class="pl-sw" style="background:${m ? colorOf(m) : '#cbd5e1'}"></i>${m ? m + 'か月目' : '組なし'}（${ids.length}${UNIT[fr]}）</h3>
          <div class="chips">${ids.map(t => `<button class="chip plc ${PL.sel.has(t.id) ? 'sel' : ''}" data-act="plSel" data-id="${t.id}" ${fr === 'b' ? 'title="' + esc(t.name) + '"' : ''}>${esc(t.no)}${fr === 'b' ? '<small>' + esc(t.name) + '</small>' : ''}</button>`).join('')}</div>`);
      }
      pick = sec.join('');
    }
    const w = cycleWeights(cy, fr);
    const uneven = w.some(x => x !== w[0]);
    const body = `
      <h2 class="sec">${fr === 'b' ? '集合住宅の' : ''}月ごとの組</h2>
      <p class="muted small">${months}か月で一巡するように、${fr === 'b' ? '建物' : '区域'}を「1か月目」〜「${months}か月目」の組に分けます。今月の組が、配る画面で先に出ます。${uneven ? '<b>月ごとの配りやすさ</b>に合わせて、組の大きさ（目安）を変えています。' : ''}</p>
      <div class="cy-wrap"><table class="pl-tbl"><thead><tr><th>組</th><th>${fr === 'b' ? '建物' : '区域'}</th><th>${fr === 'b' ? '部屋' : '家'}</th><th>目安</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <div class="lbl">自動で作る（今の組を置き換えます。保存するまでは決まりません）</div>
      <div class="row-btns"><button class="btn" data-act="plAuto" data-v="area">地域ごとにまとめる</button><button class="btn" data-act="plAuto" data-v="spread">全体に散らばる</button></div>
      <p class="muted small">${fr === 'b' ? '<b>地域ごと</b>：番号の並び（小樽側→札幌側）で近い建物を同じ月にします。<b>散らばる</b>：どの月も全体から少しずつ。どちらも、月ごとの部屋の数が目安にそろうように分けます。' : '<b>地域ごと</b>：1か月目は' + esc(areaHint(months, w)) + 'のように、となりどうしの区域を同じ月にします（責任者が地域で分けやすい）。<b>散らばる</b>：どの月も、小樽側から星置まで少しずつ回ります（家の近くの人に配りやすい）。どちらも、月ごとの家の数が目安にそろうように分けます。'}</p>
      <h2 class="sec">手で直す</h2>
      ${k.viewSeg(mvKey, '地図で見て直す')}
      ${pick}`;
    const moveBtns = Array.from({ length: months }, (_, i) => `<button class="btn sm" data-act="plMove" data-v="${i + 1}">${i + 1}か月目</button>`).join('');
    const bar = nSel
      ? k.bottomBar(`選んだ <b class="num">${nSel}</b>${UNIT[fr]}を`, `<div class="pl-move">${moveBtns}<button class="btn sm ghost" data-act="plSelNone">やめる</button></div>`, 'stack')
      : k.bottomBar(ch ? `<b class="num">${ch}</b>${UNIT[fr]}の組を変えています${PL.how ? '<small>' + esc(PL.how) + '</small>' : ''}` : '変えたところはまだありません', `<button class="btn" data-act="plUndo" ${ch ? '' : 'disabled'}>元にもどす</button><button class="btn primary" data-act="plSave" ${ch ? '' : 'disabled'}>保存する</button>`);
    return { body: body, bar: bar };
  }
  function areaHint(months, w) {
    const g = autoGroups('area', months, 'h', w);
    const towns = [];
    terrs().filter(t => g[t.id] === 1).forEach(t => { const base = t.town.replace(/[一二三四五六七八九十]+条?[一二三四五六七八九十]*丁目$/, ''); if (towns.indexOf(base) < 0) towns.push(base); });
    return towns.slice(0, 3).join('・') + (towns.length > 3 ? 'など' : '');
  }
  act.plSel = el => { const id = el.dataset.id; if (PL.sel.has(id)) PL.sel.delete(id); else PL.sel.add(id); U.render(); };
  act.plSelNone = () => { PL.sel = new Set(); U.render(); };
  act.plMove = el => {
    const m = Number(el.dataset.v);
    const g = draft();
    PL.sel.forEach(id => { g[id] = m; });
    AK().toast(PL.sel.size + UNIT[PL.frame] + 'を' + m + 'か月目にしました（保存するまで決まりません）');
    PL.sel = new Set(); PL.how = '手で直した';
    U.render();
  };
  act.plAuto = el => {
    const fr = PL.frame;
    const cy = cycle(null, fr);
    PL.draft = { frame: fr, g: autoGroups(el.dataset.v, cy.months, fr, cycleWeights(cy, fr)) };
    PL.sel = new Set();
    PL.how = el.dataset.v === 'area' ? '自動（地域ごと）' : '自動（散らばる）';
    AK().toast(PL.how + 'で組を作りました。確かめて［保存する］を押してください');
    U.render();
  };
  act.plUndo = () => { PL.draft = null; PL.sel = new Set(); PL.how = ''; U.render(); };
  act.plSave = async el => {
    const k = AK();
    const fr = PL.frame;
    const g = draft();
    const nos = {};
    const by = {};
    itemsOf(fr).forEach(x => { by[x.id] = x; });
    Object.keys(g).forEach(id => { if (by[id]) nos[id] = by[id].no; });
    el.disabled = true;
    try {
      await k.api('savePlan', { frame: fr, groups: g, nos: nos, how: PL.how || '保存' });
      await k.load();
      PL.draft = null; PL.how = '';
      k.toast((fr === 'b' ? '集合住宅の' : '') + '月ごとの組を保存しました');
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* ---------- 管理のトップと「全員に配る」に出すもの ---------- */
  /** 管理のトップのタイルの説明と、知らせ（遅れ・一巡の終わり。集合住宅の遅れも） */
  function homeInfo() {
    const k = AK();
    const fr0 = k && k.aptOnly() ? 'b' : 'h';
    const cy = cycle(null, fr0);
    if (!cy.set) return { sub: '一巡の長さと始める月・月ごとの組を決める', badge: '', notice: '' };
    if (cy.before) return { sub: ymJ(cy.startYm) + 'から' + cy.months + 'か月で一巡', badge: '', notice: '' };
    const S = summary(null, fr0);
    const planned = Math.round(plannedAt(S, cy.dayIdx));
    const diff = S.done - planned;
    const u = UNIT[fr0];
    const sub = cy.n + '回目の一巡の' + cy.month + 'か月目・' + S.done + '/' + S.total + u + (diff < 0 ? '・計画より' + (-diff) + '遅れ' : '');
    const notes = [];
    if (S.lastMonth && S.left.length) notes.push('一巡の残り' + cy.daysLeft + '日：まだ配っていない' + (fr0 === 'b' ? '建物' : '区域') + 'が <b>' + S.left.length + '</b> あります');
    else if (S.late.length && hasGroups(fr0)) notes.push('前の月の組で、まだ配っていない' + (fr0 === 'b' ? '建物' : '区域') + 'が <b>' + S.late.length + '</b> あります');
    let badge = (S.lastMonth ? S.left.length : S.late.length) || 0;
    if (fr0 === 'h' && bldgs().length && hasGroups('b')) {
      const cb = cycle(null, 'b');
      if (cb.set && !cb.before) {
        const SB = summary(null, 'b');
        const nb = SB.lastMonth ? SB.left.length : SB.late.length;
        if (nb) { notes.push('集合住宅：' + (SB.lastMonth ? 'この一巡でまだの建物' : '遅れている建物') + 'が <b>' + nb + '</b> 棟あります'); badge += nb; }
      }
    }
    return { sub: sub, badge: badge || '', notice: notes.join('<br>') };
  }
  /** 全員に配る：配る枚数の目安 */
  function allGuide(total) {
    const cy = cycle(null, 'h');
    if (!cy.set || cy.before) return '';
    const S = summary(null, 'h');
    const need = needNow(S);
    if (!need.n) return '<p class="notice info">一巡の計画では、今月の分はもう配り終えています。</p>';
    const short = need.n - total;
    return `<p class="notice ${short > 0 ? '' : 'info'}">一巡の計画（${cy.month}か月目）では、今月あと<b>${need.n}区域</b>を配る必要があります${need.even ? '' : '（遅れ ' + need.late + '・今月の組 ' + need.now + '）'}。今回の合計は${total}枚${short > 0 ? '、<b>' + short + '枚足りません</b>（枚数を増やすか、集まり・1枚ずつ配るで補います）' : 'で足ります'}。</p>`;
  }

  K.plan = { cycle, tier, summary, autoGroups, groupOf, homeInfo, allGuide, COLORS, colorOf, needNow, plannedAt, ymJ, hasGroups, cycleWeights, frameOf, monthsOf };
})();

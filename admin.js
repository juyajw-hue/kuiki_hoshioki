/*
 * 区域訪問管理 — 管理の画面
 *   上位管理者：全員に配る（一律配布）・集まりで割り振る・グループに預ける・1枚ずつ配る・配布中と回収（回収日を変える）
 *              建物の仕分け・地図の手直し・集合住宅・回り方・人とグループ・利用カード
 *              返ってきた区域を元に戻す（間違えて返したとき）
 *   責任者・副責任者：手持ちを配る・配布中と回収（自分のグループ）・グループの人
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

  const A = { data: null, loading: false, err: null };
  async function load() {
    A.loading = true; A.err = null;
    try { A.data = await K.api.call('admin'); K.adminData = A.data; K.applyEdits(); } catch (e) { A.err = e; }
    A.loading = false;
    return A.data;
  }
  function top() { return !!(A.data && A.data.top); }
  function toast(m) { U.toast(m); }
  async function api(action, payload) {
    try { return await K.api.call(action, payload); } catch (e) { toast(e.net ? '電波のある所で、もう一度押してください' : e.message); throw e; }
  }
  /** 2回押して確かめるボタン */
  function sure(el, label) {
    if (el.dataset.sure === '1') return true;
    el.dataset.sure = '1';
    el.dataset.label = el.dataset.label || el.textContent;
    el.textContent = label || 'もう一度押すと決まります';
    el.classList.add('sure');
    setTimeout(() => { if (el.isConnected) { el.dataset.sure = ''; el.textContent = el.dataset.label; el.classList.remove('sure'); } }, 5000);
    return false;
  }

  /* ---------- 区域・建物の見え方 ---------- */
  function target(id) {
    const t = K.geo.terr[id];
    if (t) return { id: id, no: t.no, name: t.town, size: t.houses, unit: '軒', isBuilding: false, order: t.i, city: t.no[0] };
    const b = (A.data && A.data.buildings || []).find(x => x.id === id);
    if (b) return { id: id, no: b.no, name: b.name, size: b.rooms, unit: '部屋', isBuilding: true, b: b, order: 100000 + noOrder(b.no), city: b.city };
    return { id: id, no: id, name: '', size: 0, unit: '', isBuilding: false, order: 999999 };
  }
  function noKey(no) { const m = String(no).match(/^([A-Z]+)(\d+)/); return m ? m[1].padEnd(4, '_') + m[2].padStart(5, '0') : String(no); }
  function noOrder(no) {
    const list = (A.data && A.data.buildings || []).map(b => b.no).sort((a, b) => (noKey(a) < noKey(b) ? -1 : 1));
    const i = list.indexOf(no);
    return i < 0 ? 9999 : i;
  }
  /** 今配っているもの。部屋ごとに配っている建物は partial（一部の部屋） */
  function outMap() {
    const m = {};
    (A.data.dists || []).forEach(d => {
      if (!d.rooms || !d.rooms.length) { m[d.territoryId] = d; return; }
      if (m[d.territoryId] && !m[d.territoryId].partial) return;
      const p = m[d.territoryId] || (m[d.territoryId] = { partial: true, territoryId: d.territoryId, names: [], uids: [], rooms: 0 });
      if (p.names.indexOf(d.name) < 0) p.names.push(d.name);
      if (p.uids.indexOf(d.userId || d.name) < 0) p.uids.push(d.userId || d.name);
      p.rooms += d.rooms.length;
      p.name = '一部の部屋（' + p.names.join('・') + '）';
    });
    return m;
  }
  /* ---------- 回り方（R1・R2…。名前は「回り方」の画面で変えられる） ---------- */
  const allRoutes = () => K.routes();
  const activeRoutes = () => allRoutes().filter(r => r.active);
  const isBKind = k => !!K.route(k);
  const rName = id => K.kindLabel(id) || id;
  const routesOf = b => (b.routes || []).filter(id => K.route(id));
  const routeTags = b => { const r = routesOf(b); return r.length ? r.map(x => `<span class="tag apt">${esc(rName(x))}</span>`).join(' ') : '<span class="tag">決めていない</span>'; };
  /** 渡し方が「一棟まとめて」の回り方か */
  const wholeRoute = id => { const r = K.route(id); return !!r && r.mode === '一棟まとめて'; };
  /** 部屋ごとに割り振るとき、1人に1つの建物から何部屋まで（回り方ごと。前の版のGASなら2） */
  const perBOf = r => { const x = typeof r === 'string' ? K.route(r) : r; return Math.max(1, Number(x && x.perB) || 2); };
  const firstRoute = mode => { const a = activeRoutes(); return (a.find(r => r.mode === mode) || a[0] || {}).id || ''; };
  function scope() { return (A.data && A.data.settings && A.data.settings.scope) || 'すべて'; }
  const aptOnly = () => scope() === '集合住宅だけ';
  function groupName(id) { const g = (A.data.groups || []).find(x => x.id === id); return g ? g.name : 'グループなし'; }
  function usersSorted(list) {
    const order = {};
    (A.data.groups || []).forEach((g, i) => { order[g.id] = i; });
    return list.slice().sort((a, b) => ((order[a.groupId] ?? 99) - (order[b.groupId] ?? 99)) || ((a.kana || a.name) < (b.kana || b.name) ? -1 : 1));
  }
  function stepper(id, val, min, max) {
    return `<span class="stepper"><button data-act="step" data-id="${esc(id)}" data-d="-1" aria-label="減らす" ${val <= min ? 'disabled' : ''}>−</button><b class="num">${val}</b><button data-act="step" data-id="${esc(id)}" data-d="1" aria-label="増やす" ${val >= max ? 'disabled' : ''}>＋</button></span>`;
  }
  /* ---------- 回収日・完全回収日 ---------- */
  const ymdStr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDaysStr = (s, n) => { const p = String(s).split('-').map(Number); return ymdStr(new Date(p[0], p[1] - 1, p[2] + Number(n || 0))); };
  function forcedDays() { const v = A.data && A.data.settings && A.data.settings.forcedDays; return v === undefined || v === null ? 14 : Number(v); }
  function defaultDue() {
    const rule = String((A.data && A.data.settings && A.data.settings.due) || '月末');
    const t = new Date();
    const m = rule.match(/(\d+)\s*か?ヶ?カ?月/);
    return ymdStr(m ? new Date(t.getFullYear(), t.getMonth() + Number(m[1]), t.getDate()) : new Date(t.getFullYear(), t.getMonth() + 1, 0));
  }
  const DT = { due: '', forced: '', touched: false };
  function datesReset() { DT.due = defaultDue(); DT.forced = addDaysStr(DT.due, forcedDays()); DT.touched = false; }
  function datesBox(prefix, st, note) {
    return `<div class="dates"><label>回収日<input type="date" id="${prefix}-due" value="${esc(st.due)}" min="${esc(H.todayStr())}"></label>
      <label>完全回収日<input type="date" id="${prefix}-forced" value="${esc(st.forced)}" min="${esc(st.due || H.todayStr())}"></label>
      <p class="muted small">${note || '回収日を過ぎても、完全回収日までは記録できます。完全回収日を過ぎると、返していない区域を自動で回収します。'}</p></div>`;
  }
  function dueLine(x) {
    if (!x.due) return '';
    const dl = H.daysLeft(x.due), fl = x.forced ? H.daysLeft(x.forced) : dl;
    const nd = (A.data.settings && A.data.settings.noticeDays) || 7;
    const cls = dl < 0 ? 'grace' : dl <= nd ? 'soon' : '';
    return `<span class="due ${cls}">回収日 ${esc(H.mdShort(x.due))}${dl < 0 ? '（過ぎた）' : ''}${x.forced ? '・強制 ' + esc(H.mdShort(x.forced)) + (fl <= 3 && fl >= 0 ? '（あと' + fl + '日）' : '') : ''}</span>`;
  }
  document.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'dt-due' || id === 'ds-due') {
      const st = id === 'dt-due' ? DT : DS;
      st.due = e.target.value;
      if (!st.touched) st.forced = st.due ? addDaysStr(st.due, forcedDays()) : st.forced;
      else if (st.forced && st.forced < st.due) st.forced = st.due;
      const f = document.getElementById(id.replace('due', 'forced'));
      if (f) { f.value = st.forced; f.min = st.due; }
    }
    if (id === 'dt-forced' || id === 'ds-forced') { const st = id === 'dt-forced' ? DT : DS; st.forced = e.target.value; st.touched = true; }
  });

  function shell(title, body, opts) {
    opts = opts || {};
    app.innerHTML = `${U.demoBar()}${U.topBar({ back: true, title: '<b>' + title + '</b>', sub: opts.sub || '', right: opts.right || '' })}
      <main class="admin-main ${opts.cls || ''}">${A.loading && !A.data ? '<p class="muted">読み込んでいます…</p>' : A.err && !A.data ? errBox() : body}</main>${opts.bar || ''}`;
    mountMapSlot();
  }

  /* ---------- 地図で見て選ぶ（一覧と切り替え） ----------
   * 画面は打つたび・さわるたびに描き直すので、地図は作り直さず、同じ地図を新しい画面の場所へ差し込む（縮尺と位置がそのまま）
   */
  const MV = {};                       // 画面ごと：'list' | 'map'
  const AM = { key: '', el: null, ctl: null, want: null };
  const TC = K.terrMap.C;
  function viewSeg(key, label) {
    return `<div class="seg two vseg"><button data-act="mvSet" data-k="${key}" data-v="list" aria-pressed="${MV[key] !== 'map'}">一覧で選ぶ</button><button data-act="mvSet" data-k="${key}" data-v="map" aria-pressed="${MV[key] === 'map'}">${I.map}<span>${label || '地図で見て選ぶ'}</span></button></div>`;
  }
  act.mvSet = el => { MV[el.dataset.k] = el.dataset.v; U.render(); };
  function mapSlot(key, opts) { AM.want = { key: key, opts: opts }; return '<div class="amap-slot"></div>'; }
  function dropMap() { if (AM.ctl) AM.ctl.destroy(); AM.ctl = null; AM.el = null; AM.key = ''; }
  function mountMapSlot() {
    const slot = document.querySelector('.amap-slot');
    const want = AM.want;
    AM.want = null;
    if (!slot || !want || !window.L) { if (!slot) dropMap(); return; }
    if (AM.ctl && AM.key === want.key) { slot.replaceWith(AM.el); AM.ctl.update(want.opts); AM.ctl.invalidate(); return; }
    dropMap();
    const el = document.createElement('div');
    el.className = 'amap';
    slot.replaceWith(el);
    AM.el = el; AM.key = want.key;
    AM.ctl = K.terrMap(el, want.opts);
  }
  U.leaveHooks.push(dropMap);
  /** 色の見本 */
  function legend(items) {
    return `<div class="tm-legend">${items.map(x => `<span><i style="background:${x[0].fill};border-color:${x[0].stroke}"></i>${esc(x[1])}</span>`).join('')}</div>`;
  }
  const AGE_LEGEND = [[TC.old, '長く配っていない（4か月以上・まだ）'], [TC.mid, '2〜4か月前に返った'], [TC.recent, '2か月のうちに返った'], [TC.out, '配布中']];
  const tLabel = id => { const t = K.geo.terr[id]; return t ? esc(t.no) + '<small>' + t.houses + '軒</small>' : ''; };
  function errBox() {
    return `<div class="notice">${esc(A.err.net ? '電波のある所で開いてください。管理の操作は、その場でサーバーに送ります。' : A.err.message)}</div><button class="btn" data-act="aReload">もう一度読み込む</button>`;
  }

  /* ==================== 管理のメニュー ==================== */
  views.admin = async function () {
    if (!A.data || view().fresh) { shell('管理', ''); await load(); view().fresh = false; }
    if (U.view().name !== 'admin') return;
    const d = A.data;
    if (!d) return shell('管理', '');
    const holds = d.dists.filter(x => x.kind === '手持ち' && !x.other);
    const mine = d.dists.filter(x => x.kind !== '手持ち' && !x.other);
    const over = mine.filter(x => x.kind !== '手持ち' && x.due && H.daysLeft(x.due) < 0).length;
    const waits = top() ? countWaits() : 0;
    const tile = (v, icon, title, sub, badge) => `<button class="tile" data-act="aGo" data-v="${v}">${icon}<span class="tt"><b>${title}</b><small>${sub}</small></span>${badge ? `<span class="badge">${badge}</span>` : ''}${I.chev}</button>`;
    let body = '';
    if (top()) {
      const apt = aptOnly();
      const bl = d.buildings || [];
      const pi = K.plan ? K.plan.homeInfo() : { sub: '', badge: '', notice: '' };
      body = `
        ${apt ? `<p class="notice info">今は<b>集合住宅だけ</b>で使っています（${esc(activeRoutes().map(r => r.name).join('・'))}）。戸建ての区域の画面は出していません（［設定］で戻せます）。</p>` : ''}
        ${nowPanel(d, { holds, mine, over, waits, pi })}
        <h2 class="sec">配る・回収する</h2>
        <div class="tiles">
          ${apt ? '' : tile('aAll', I.users, '全員に配る', '区域を用意して、全員にまとめて配る（月のはじめ）')}
          ${tile('aGather', I.bldg, '集まりで割り振る', esc((apt ? [] : ['不在宅訪問']).concat(activeRoutes().map(r => r.name)).join('・')) + '（集まりの日に、来た人へ）', (d.gatherings || []).length ? '開いている ' + d.gatherings.length : '')}
          ${apt ? '' : tile('aHold', I.users, 'グループに預ける', '残った区域を責任者へ', holds.length ? '手持ち ' + holds.length : '')}
          ${apt ? '' : tile('aHand', I.check, '手持ちを配る', '預けた区域をメンバーへ（責任者の代わりに）')}
          ${tile('aOne', I.check, '1枚ずつ配る', apt ? '人と建物（部屋）を選んで配る' : '人と区域を選んで1枚。台帳の分を前の日付で入れるのもここ')}
          ${tile('aOut', I.ret, '配布中と回収', mine.length + (apt ? '件' : '枚') + ' 配布中・回収日を変える・返却にする', over ? '回収日を過ぎた ' + over : '')}
        </div>
        <h2 class="sec">記録</h2>
        <div class="tiles">
          ${tile('aProxy', I.pen || I.check, '代理入力（紙の記録）', '紙で回った記録・返した日を、日付を指定して入れる')}
          ${tile('aCycle', I.cal, '回った月', (apt ? '建物' : '区域・建物') + 'ごとに何月に回ったか・配った日と返した日を直す')}
        </div>
        <h2 class="sec">区域と地図</h2>
        <div class="tiles">
          ${tile('aPlan', I.flag, '一巡の計画', esc(pi.sub), pi.badge)}
          ${apt ? '' : tile('aBounds', I.map, '区切りの手直し', '家やブロックを別の区域へ・分ける・合わせる・範囲を広げる・番号を変える', boundsCount() ? '直した ' + boundsCount() : '')}
          ${apt ? '' : tile('aMap', I.map, '地図の手直し', '地図にない家を足す・場所を直す・国土地理院の更新と比べる', newHouseReports() ? '知らせ ' + newHouseReports() : '')}
          ${apt ? '' : tile('aSort', I.map, '建物の仕分け', '大きな建物・集合住宅かも・現地からの報告', waits ? waits : '')}
          ${tile('aBldg', I.bldg, '集合住宅', bl.length + '棟・' + bl.reduce((n, b) => n + b.rooms, 0) + '部屋（部屋の一覧・回り方）')}
          ${tile('aRoutes', I.bldg, '回り方', esc(allRoutes().map(r => r.name).join('・')) + '（名前・渡し方を変える・足す）')}
        </div>
        <h2 class="sec">人</h2>
        <div class="tiles">
          ${tile('aPeople', I.users, '人とグループ', d.users.filter(u => u.active).length + '人・' + d.groups.length + 'グループ（役割・所属・名前）')}
          ${tile('aCards', I.keyb, '利用カード', '一人ずつのQRコードを印刷する')}
          ${tile('aNotice', I.bell || I.flag, 'お知らせ', esc(noticeSub()))}
        </div>
        <h2 class="sec">紙と設定</h2>
        <div class="tiles">
          ${tile('aPrint', I.print, 'まとめて印刷', (apt ? '集合住宅カード' : '区域カード・集合住宅カード') + '・S-13（Word・PDF）・訪問しない一覧・配布中の一覧・台帳')}
          ${tile('aSettings', I.gear || I.flag, '設定', settingsSub(d), settingsBadge(d))}
        </div>`;
    } else if (aptOnly()) {
      body = `
        <p class="muted">${esc(d.me.groupName || '自分のグループ')}の人の割り当てを見られます。</p>
        <div class="tiles">
          ${tile('aOut', I.ret, '配布中と回収', mine.length + '件 配布中', over ? '回収日を過ぎた ' + over : '')}
          ${tile('aProxy', I.pen || I.check, '代理入力（紙の記録）', '紙で回った記録を、日付を指定して入れる')}
          ${tile('aPeople', I.users, 'グループの人', d.users.length + '人')}
        </div>`;
    } else {
      body = `
        <p class="muted">${esc(d.me.groupName || '自分のグループ')}の区域を扱えます。</p>
        <div class="tiles">
          ${tile('aHand', I.check, '手持ちを配る', '預かった区域をメンバーへ', holds.length ? holds.length + '枚' : '')}
          ${tile('aOut', I.ret, '配布中と回収', mine.length + '枚 配布中・返却にする（返した日も選べる）', over ? '回収日を過ぎた ' + over : '')}
          ${tile('aProxy', I.pen || I.check, '代理入力（紙の記録）', '紙で回った記録を、日付を指定して入れる')}
          ${tile('aPeople', I.users, 'グループの人', d.users.length + '人')}
        </div>`;
    }
    shell('管理', body, { sub: top() ? '上位管理者' : esc(d.me.groupName || '') , right: `<button class="btn sm ghost" data-act="aReload">最新にする</button>` });
  };
  function view() { return U.view(); }

  /* ---------- 「今」のまとめ（0.12.0）：上位管理者が開いてすぐ、今の状態と次にすることが分かる ---------- */
  function boundsCount() { return K.geo ? K.geo.list.filter(t => K.boundsChanged(t)).length : 0; }
  function nowPanel(d, x) {
    const apt = aptOnly();
    const today = H.todayStr();
    const ym = today.slice(0, 7);
    const rows = [];
    const row = (v, icon, text, cls) => rows.push(`<button class="now-row ${cls || ''}" data-act="aGo" data-v="${v}">${icon}<span>${text}</span>${I.chev}</button>`);
    // 一巡の計画
    row('aPlan', I.flag, esc(x.pi.sub) + (x.pi.notice ? '<br><small>' + x.pi.notice + '</small>' : ''), x.pi.badge ? 'warn plan-notice' : '');
    // 配布中・回収
    row('aOut', I.ret, '配布中 <b>' + x.mine.length + '</b>' + (apt ? '件' : '枚') + (x.over ? '　<b class="warn-t">回収日を過ぎた ' + x.over + '</b>' : '　回収日を過ぎたものはありません'), x.over ? 'warn' : '');
    if ((d.gatherings || []).length) row('aOut', I.bldg, '開いている集まり <b>' + d.gatherings.length + '</b>（終わったら［集まりを終える］）', 'warn');
    if (!apt && x.holds.length) row('aHold', I.users, 'グループに預けた手持ち <b>' + x.holds.length + '</b>枚（責任者がメンバーに配ります）');
    const reps = newHouseReports();
    if (!apt && (reps || x.waits)) row(reps ? 'aMap' : 'aSort', I.map, (reps ? '地図にない家の知らせ <b>' + reps + '</b>' : '') + (reps && x.waits ? '・' : '') + (x.waits ? '建物の仕分け待ち <b>' + x.waits + '</b>' : ''));
    const n = d.notice;
    if (n && n.text) row('aNotice', I.bell || I.flag, 'お知らせを出しています：' + esc(n.text.replace(/\s+/g, ' ').slice(0, 30)) + (n.text.length > 30 ? '…' : ''));
    const b = d.backup;
    if (b && (b.error || (b.trigger === false && b.on))) row('aSettings', I.gear || I.flag, '<b class="warn-t">毎晩のバックアップができていません</b>（［設定］で確かめる）', 'warn');
    // 次にすること（毎月の流れ）
    const allThisMonth = d.dists.filter(y => y.kind === '通常' && !y.gatheringId && y.distributedAt >= ym + '-01').length;
    const lr = d.lastReturned || {};
    let next = '';
    const cy = K.plan ? K.plan.cycle(null, apt ? 'b' : 'h') : { set: false };
    if (!apt && !allThisMonth && Number(today.slice(8)) <= 25 && (cy.set ? !cy.before : true) && K.geo.list.some(t => t.houses > 0)) next = `<button class="now-next" data-act="aGo" data-v="aAll">${I.users}<span><b>今月はまだ全員に配っていません。</b>［全員に配る］で区域を用意して配ります。</span>${I.chev}</button>`;
    else if (x.over) next = `<button class="now-next" data-act="aGo" data-v="aOut">${I.ret}<span><b>回収日を過ぎた区域が ${x.over}。</b>本人に声をかけるか、［配布中と回収］で日付を延ばします（完全回収日が来れば自動で回収）。</span>${I.chev}</button>`;
    else if ((d.gatherings || []).length) next = `<button class="now-next" data-act="aGo" data-v="aOut">${I.bldg}<span><b>開いている集まりがあります。</b>終わったら［集まりを終える］でまとめて返却にします。</span>${I.chev}</button>`;
    else if (x.pi.badge) next = `<button class="now-next" data-act="aGo" data-v="aPlan">${I.flag}<span><b>一巡の計画より遅れている${apt ? '建物' : '区域'}があります。</b>［1枚ずつ配る］［集まりで割り振る］で補います。</span>${I.chev}</button>`;
    else if (!apt && reps) next = `<button class="now-next" data-act="aGo" data-v="aMap">${I.map}<span><b>地図にない家の知らせが届いています。</b>［地図の手直し］で確かめて足します。</span>${I.chev}</button>`;
    else next = `<p class="now-ok">${I.check}<span>今、急ぐことはありません。</span></p>`;
    return `<section class="now"><h2 class="sec">今</h2><div class="now-rows">${rows.join('')}</div>${next}</section>`;
  }
  /* ---------- 設定（0.12.0）：散らばっていた設定をひとつの画面に ---------- */
  const NUM_SETTINGS = [
    ['完全回収までの日数', 'forcedDays', '回収日からこの日数がたつと「完全回収日」。過ぎると自動で回収する（それまでは記録できる）', 0, 90, '日'],
    ['回収日の知らせ', 'noticeDays', '回収日の何日前から、持っている人の画面に知らせを出すか', 0, 60, '日前'],
    ['集まりの完全回収までの日数', 'gatherForcedDays', '集まりで割り振った区域は、その日が回収日。この日数で自動で回収する', 0, 30, '日'],
    ['返却を取り消せる日数', 'undoDays', '間違えて返したとき、本人が「元に戻す」を使える日数（上位管理者はいつでも）', 0, 90, '日'],
    ['1人が持てる枚数', 'maxCards', '1人がふだん持てる区域の上限（集まりの分は数えない）', 1, 50, '枚'],
    ['注意を出す枚数', 'warnCards', 'この枚数から、配る画面に注意を出す', 1, 50, '枚'],
    ['いつもの枚数（決めていない人）', 'usualDefault', '全員に配るとき、枚数を決めていない人に配る枚数', 0, 50, '枚'],
    ['取り消しできる時間', 'undoHours', '一般の人が自分の記録を取り消せる時間', 0, 720, '時間'],
    ['不在宅訪問の候補の日数', 'absentDays', '返却からこの日数のうちの区域を、不在宅訪問の候補に出す', 0, 365, '日'],
  ];
  const DUE_CHOICES = ['月末', '1か月', '2か月', '3か月', '4か月', '5か月', '6か月'];
  const SE = { draft: {} };
  function settingsSub(d) {
    const st = d.settings || {};
    return '回収日 ' + esc(st.due || '月末') + '・完全回収まで ' + (st.forcedDays || 14) + '日・' + esc(scope()) + '・' + (K.basemap.setting() === '保存した地図' ? '保存した地図' : '国土地理院の地図') + '・バックアップ';
  }
  function settingsBadge(d) { const b = d.backup; return b && (b.error || (b.trigger === false && b.on)) ? '確認' : ''; }
  views.aSettings = async function () {
    if (!A.data || view().fresh) { shell('設定', ''); await load(); view().fresh = false; SE.draft = {}; }
    if (U.view().name !== 'aSettings') return;
    if (!top()) return shell('設定', '<p class="notice">上位管理者だけが使えます。</p>');
    const d = A.data;
    const st = d.settings || {};
    const due = SE.draft['回収日'] !== undefined ? SE.draft['回収日'] : (st.due || '月末');
    const numRows = NUM_SETTINGS.map(x => {
      const cur = st[x[1]];
      const v = SE.draft[x[0]] !== undefined ? SE.draft[x[0]] : cur;
      const changed = SE.draft[x[0]] !== undefined && SE.draft[x[0]] !== cur;
      return `<div class="set-row ${changed ? 'changed' : ''}"><div class="set-l"><b>${esc(x[0])}</b><small class="muted">${esc(x[2])}</small></div>
        <span class="stepper"><button data-act="seStep" data-n="${esc(x[0])}" data-d="-1" aria-label="${esc(x[0])}を減らす" ${v <= x[3] ? 'disabled' : ''}>−</button><b class="num">${v}<small>${x[5]}</small></b><button data-act="seStep" data-n="${esc(x[0])}" data-d="1" aria-label="${esc(x[0])}を増やす" ${v >= x[4] ? 'disabled' : ''}>＋</button></span></div>`;
    }).join('');
    const dirty = Object.keys(SE.draft).some(k => k === '回収日' ? SE.draft[k] !== (st.due || '月末') : SE.draft[k] !== st[NUM_SETTINGS.find(x => x[0] === k)[1]]);
    shell('設定', `
      <p class="muted small">配るときの決まり・使う機能・地図の下地・毎晩のバックアップを、ここでまとめて変えます。変えると、次にアプリを開いた人から効きます。一巡の長さと月ごとの配りやすさは［一巡の計画］→［一巡の設定］にあります。</p>
      <h2 class="sec">配るときの決まり</h2>
      <div class="scope-box">
        <div class="set-row ${SE.draft['回収日'] !== undefined && SE.draft['回収日'] !== (st.due || '月末') ? 'changed' : ''}"><div class="set-l"><b>回収日</b><small class="muted">配るときに最初に出る回収日。「月末」は配った月の末日</small></div></div>
        <div class="seg wrap">${DUE_CHOICES.map(c => `<button data-act="seDue" data-v="${esc(c)}" aria-pressed="${due === c}">${esc(c)}</button>`).join('')}</div>
        ${numRows}
        <button class="btn primary wide" data-act="seSave" ${dirty ? '' : 'disabled'}>${dirty ? '変えたものを保存する' : '保存済みです'}</button>
        <p class="muted small">スプレッドシートの「設定」シートでも同じものを変えられます（アプリのURL・区域番号の頭文字はシートだけ）。</p>
      </div>
      ${scopeBox()}
      ${baseBox()}
      <h2 class="sec">一巡の計画</h2>
      <div class="scope-box"><p class="small">${esc((K.plan ? K.plan.homeInfo() : { sub: '' }).sub)}</p>
        <button class="btn" data-act="aGo" data-v="aPlan">［一巡の計画］→［一巡の設定］で変える</button></div>
      ${backupBox()}
      <h2 class="sec">このアプリ</h2>
      <div class="scope-box"><p class="small">アプリの版 <b>${esc(K.VERSION)}</b>・サーバーの版 <b>${esc(d.version || '')}</b>${d.appUrl ? '<br>アプリのURL：' + esc(d.appUrl) : ''}</p>
        <p class="muted small">使い方は「上位管理者の手引き」に、置き方と新しい版への上げ方は README にあります。</p></div>`);
  };
  act.seDue = el => { SE.draft['回収日'] = el.dataset.v; U.render(); };
  act.seStep = el => {
    const x = NUM_SETTINGS.find(y => y[0] === el.dataset.n);
    if (!x) return;
    const cur = SE.draft[x[0]] !== undefined ? SE.draft[x[0]] : (A.data.settings || {})[x[1]];
    SE.draft[x[0]] = Math.max(x[3], Math.min(x[4], Number(cur || 0) + Number(el.dataset.d)));
    U.render();
  };
  act.seSave = async el => {
    el.disabled = true;
    const st = A.data.settings || {};
    const todo = Object.keys(SE.draft).filter(k => k === '回収日' ? SE.draft[k] !== (st.due || '月末') : SE.draft[k] !== st[NUM_SETTINGS.find(x => x[0] === k)[1]]);
    try {
      for (const k of todo) await api('saveSetting', { name: k, value: SE.draft[k] });
      toast('設定を保存しました（' + todo.length + '件）');
      SE.draft = {};
      await load();
      K.refresh().catch(() => {});
    } catch (e) { /* api が知らせる */ }
    U.render();
  };

  /** 使う機能（すべて／集合住宅だけ）の切り替え */
  function scopeBox() {
    const now = scope();
    const other = now === 'すべて' ? '集合住宅だけ' : 'すべて';
    return `<h2 class="sec">使う機能</h2>
      <div class="scope-box"><p>今は<b>「${esc(now)}」</b>です。${now === 'すべて' ? '戸建ての区域と集合住宅の両方を使っています。' : '集合住宅の回り方（' + esc(activeRoutes().map(r => r.name).join('・')) + '）だけを使い、戸建ての区域は配りません。'}</p>
        <p class="muted small">「集合住宅だけ」にすると、管理の画面が集合住宅の分だけになり、戸建ての区域は配れなくなります。今までの記録や配った分は、そのまま残ります。いつでも戻せます。</p>
        <button class="btn" data-act="aScope" data-v="${esc(other)}">「${esc(other)}」に切り替える</button></div>`;
  }
  /** 地図の下地（国土地理院の地図／保存した地図）。国土地理院が地図の公開をやめても使い続けられるように */
  const BM = { check: null };
  function baseBox() {
    const B = K.basemap;
    const m = B.meta;
    const now = B.setting();
    const fmt = s => { const p = String(s || '').split('-'); return p.length === 3 ? p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日' : esc(s); };
    const chk = BM.check === null ? '' : BM.check === 'run' ? '確かめています…' : BM.check ? '<b class="ok-t">つながっています</b>' : '<b class="warn-t">つながりません</b>（国土地理院が止まっているか、電波がありません）';
    if (B.done && !m) {
      return `<h2 class="sec">地図の下地</h2>
        <div class="scope-box"><p>国土地理院の地図を使っています。</p>
          <p class="notice">保存した地図（basemap フォルダ）が置かれていません。国土地理院の地図が読めなくなると、地図の下地が出なくなります。説明書の「0.9.0」の手順で、basemap フォルダも置いてください。</p></div>`;
    }
    if (K.cfg.basemapOnly) {
      return `<h2 class="sec">地図の下地</h2>
        <div class="scope-box"><p>このページでは、<b>保存した地図</b>だけを使っています（国土地理院にはつなぎません）。本番では、ふだんは国土地理院の地図を使い、読めないときに自動でこの地図に切り替わります。</p>
          <p class="muted small">保存した地図：${m ? esc(m.source) + '（' + esc(m.sourceDate || '') + 'の更新分）から、' + fmt(m.made) + 'に作ったもの。国土地理院が地図の公開をやめても、この地図で使い続けられます。' : '読んでいます…'}</p>
          <div class="row-btns"><button class="btn" data-act="aBmPreview">${I.map}<span>保存した地図を見る</span></button></div></div>`;
    }
    return `<h2 class="sec">地図の下地</h2>
      <div class="scope-box">
        <p>今は<b>「${now === '保存した地図' ? '保存した地図' : '国土地理院の地図'}」</b>を使っています。${now === '保存した地図'
          ? '国土地理院の地図は読みません（写真も出ません）。全員の地図が、アプリと一緒に置いた地図になります。'
          : '国土地理院の地図が読めないときは、自動で保存した地図に切り替わります。電波がない所でも、保存した地図が出ます。'}</p>
        <p class="muted small">保存した地図：${m ? esc(m.source) + '（' + esc(m.sourceDate || '') + 'の更新分）から、' + fmt(m.made) + 'に作ったもの。区域のある所は細かく（建物まで）、まわりは広く出ます。国土地理院が地図の公開をやめても、この地図で使い続けられます。' : '読んでいます…'}</p>
        <p class="small">国土地理院の地図：${chk || '<button class="link" data-act="aBmCheck">つながるか確かめる</button>'}${B.downUntil > Date.now() ? '<br><span class="muted">この端末では、さっき読めなかったので、しばらく保存した地図を出しています。</span>' : ''}</p>
        <div class="row-btns">
          <button class="btn" data-act="aBmPreview">${I.map}<span>保存した地図を見る</span></button>
          <button class="btn" data-act="aBasemap" data-v="${now === '保存した地図' ? '国土地理院' : '保存した地図'}">${now === '保存した地図' ? '国土地理院の地図に戻す' : '保存した地図だけにする'}</button>
        </div>
      </div>`;
  }
  /* ---------- お知らせ（0.11.0） ---------- */
  function noticeSub() {
    const n = A.data && A.data.notice;
    if (n && n.text) return '出しています：' + n.text.replace(/\s+/g, ' ').slice(0, 24) + (n.text.length > 24 ? '…' : '') + (n.until ? '（' + H.mdShort(n.until) + 'まで）' : '');
    return '全員の画面のいちばん上に一言を出す';
  }
  const NT = { text: null, until: null };
  views.aNotice = async function () {
    if (!A.data) await load();
    if (view().fresh) { NT.text = null; NT.until = null; view().fresh = false; }
    const raw = A.data.noticeRaw || {};
    const live = A.data.notice;
    const text = NT.text !== null ? NT.text : raw.text || '';
    const until = NT.until !== null ? NT.until : raw.until || '';
    shell('お知らせ', `
      <p class="muted small">全員のスマホの「わたしの区域」のいちばん上に出す一言です（例：今日は紙で配ります・集まりの場所が変わりました）。電波のない所でも、最後に開いたときのお知らせが出ます。</p>
      ${live ? `<div class="notice-box"><p class="nb-head">${I.bell || I.flag}<b>今出しているお知らせ</b><small>${esc(H.md(live.at))}から${live.until ? '・' + esc(H.md(live.until)) + 'まで' : '・消すまで'}</small></p><p class="nb-text">${esc(live.text)}</p></div>`
        : raw.text ? `<p class="notice">「${esc(raw.text.slice(0, 40))}」は、期限（${esc(H.md(raw.until))}）を過ぎたので、今は出していません。</p>` : '<p class="notice info">今は、お知らせを出していません。</p>'}
      <label class="lbl" for="nt-text">お知らせの文（300字まで）</label>
      <textarea id="nt-text" class="sel nt-text" rows="4" maxlength="300" placeholder="例：アプリの調子が悪いので、今日は紙の区域カードで配ります。">${esc(text)}</textarea>
      <label class="lbl" for="nt-until">いつまで出すか（空なら、消すまで出します）</label>
      <input id="nt-until" type="date" class="sel" min="${esc(H.todayStr())}" value="${esc(until)}">
      <div class="row-btns"><button class="btn primary" data-act="ntSave">${live || raw.text ? '書き直して出す' : '出す'}</button>${raw.text ? '<button class="btn" data-act="ntClear">お知らせを消す</button>' : ''}</div>`);
  };
  function ntKeep() {
    const t = document.getElementById('nt-text'), u = document.getElementById('nt-until');
    if (t) NT.text = t.value;
    if (u) NT.until = u.value;
  }
  act.ntSave = async el => {
    ntKeep();
    if (!String(NT.text || '').trim()) { toast('お知らせの文を書いてください'); return; }
    el.disabled = true;
    try {
      await api('saveNotice', { text: NT.text, until: NT.until || '' });
      await load(); NT.text = null; NT.until = null;
      K.refresh().catch(() => {});
      toast('お知らせを出しました。全員の画面に出ます');
      U.render();
    } catch (e) { el.disabled = false; }
  };
  act.ntClear = async el => {
    if (!sure(el, 'もう一度押すと消します')) return;
    el.disabled = true;
    try {
      await api('saveNotice', { text: '' });
      await load(); NT.text = null; NT.until = null;
      K.refresh().catch(() => {});
      toast('お知らせを消しました');
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* ---------- 毎晩のバックアップ（0.11.0） ---------- */
  const kb = n => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
  function backupBox() {
    const b = A.data && A.data.backup;
    if (!b) return '';
    const at = b.at ? new Date(b.at) : null;
    const when = at ? (at.getMonth() + 1) + '/' + at.getDate() + ' ' + at.getHours() + ':' + String(at.getMinutes()).padStart(2, '0') : '';
    const ck = b.checked && b.skipped ? new Date(b.checked) : null;
    return `<h2 class="sec">毎晩のバックアップ</h2>
      <div class="scope-box">
        <p>${b.on ? '毎晩2時ごろ、全部のシートを小さな zip にまとめて、Google ドライブの「区域訪問管理のバックアップ」フォルダに残しています。' : '<b>毎晩のバックアップを止めています。</b>'}</p>
        ${b.error ? `<p class="notice">前回は作れませんでした（${esc(b.error)}）。スプレッドシートのメニュー［区域アプリ］→［初めの準備］を実行して、Google ドライブの許可を出してください。</p>` : ''}
        ${b.trigger === false && b.on ? '<p class="notice">毎晩の自動実行がまだ登録されていません。スプレッドシートのメニュー［区域アプリ］→［初めの準備］を一度実行してください（Google ドライブの許可も、そこで出します）。</p>' : ''}
        <p class="small">${at ? '最後に作ったもの：<b>' + esc(when) + '</b>（' + kb(b.size) + '）・残しているもの <b>' + b.files + '個</b>（合わせて ' + kb(b.total) + '）' : 'まだ作っていません。'}${ck ? '<br><span class="muted">' + (ck.getMonth() + 1) + '/' + ck.getDate() + '：' + esc(b.skipped) + 'ので、作りませんでした</span>' : ''}</p>
        <p class="muted small">変わっていない日は作りません。この7日は毎日、6週までは週に1つ、1年までは月に1つを残し、古いものは自動でごみ箱に移します（ドライブをほとんど使いません）。戻すときは、スプレッドシートのメニュー［区域アプリ］→［バックアップから戻す］で、新しいスプレッドシートに戻します。${K.state.demo ? '<br><b>お試し版では、本当のドライブには保存しません。</b>' : ''}</p>
        <div class="row-btns"><button class="btn" data-act="aBackupNow">今すぐバックアップする</button><button class="btn ghost" data-act="aBackupOn" data-v="${b.on ? 'しない' : 'する'}">${b.on ? '毎晩のバックアップを止める' : '毎晩のバックアップを始める'}</button></div>
      </div>`;
  }
  act.aBackupNow = async el => {
    el.disabled = true;
    const label = el.textContent;
    el.textContent = '作っています…';
    try {
      const r = await api('backupNow', {});
      toast('バックアップを作りました（' + kb(r.size) + '）。残しているもの ' + r.files + '個');
      await load();
    } catch (e) { /* api が知らせる */ }
    el.textContent = label; el.disabled = false;
    U.render();
  };
  act.aBackupOn = async el => {
    if (!sure(el, el.dataset.v === 'しない' ? 'もう一度押すと止めます' : 'もう一度押すと始めます')) return;
    el.disabled = true;
    try { await api('saveSetting', { name: '毎晩のバックアップ', value: el.dataset.v }); await load(); toast(el.dataset.v === 'しない' ? '毎晩のバックアップを止めました' : '毎晩のバックアップを始めました'); U.render(); } catch (e) { el.disabled = false; }
  };

  function newHouseReports() { return ((A.data && A.data.reports) || []).filter(r => !r.houseId && !r.roomId && r.lat !== null && r.lat !== undefined).length; }
  function countWaits() {
    const d = A.data;
    const st = d.houseStates || {};
    let n = (d.reports || []).filter(r => r.houseId).length;
    K.geo.list.forEach(t => (K.geo.byTerr[t.id] || []).forEach(h => { if (h.big && !st[h.id]) n++; }));
    return n;
  }

  act.admin = () => { U.go('admin', { fresh: true }); };
  act.aGoEdit = el => { U.closeSheet(); U.go('aMapEdit', { tid: el.dataset.t, focusHouse: el.dataset.h || '' }); };
  act.aGo = el => { U.closeSheet(); U.go(el.dataset.v, { fresh: true }); };
  act.aReload = async () => { await load(); U.render(); toast('最新にしました'); };
  act.aScope = async el => {
    if (!sure(el, 'もう一度押すと「' + el.dataset.v + '」にします')) return;
    el.disabled = true;
    try {
      await api('saveSetting', { name: '使う機能', value: el.dataset.v });
      await load();
      K.refresh().catch(() => {});
      toast('「' + el.dataset.v + '」にしました');
      U.render();
      window.scrollTo(0, 0);
    } catch (e) { el.disabled = false; }
  };

  K.on('basemap', () => { if (U.view().name === 'admin' && document.querySelector('[data-act="aBmPreview"], .scope-box')) U.render(); });
  act.aBasemap = async el => {
    const v = el.dataset.v;
    if (!sure(el, v === '保存した地図' ? 'もう一度押すと、全員が保存した地図だけになります' : 'もう一度押すと、国土地理院の地図に戻します')) return;
    el.disabled = true;
    try {
      await api('saveSetting', { name: '地図の下地', value: v });
      await load();
      K.refresh().catch(() => {});
      K.basemap.changed();
      toast(v === '保存した地図' ? '保存した地図だけにしました' : '国土地理院の地図に戻しました');
      U.render();
    } catch (e) { el.disabled = false; }
  };
  act.aBmCheck = async () => {
    BM.check = 'run'; U.render();
    BM.check = await K.basemap.checkGsi();
    U.render();
  };
  act.aBmPreview = () => {
    const m = K.basemap.meta;
    U.openSheet(U.sheetTitle('保存した地図'), `<p class="muted small">国土地理院につながらないときに出る地図です（${esc((m && m.attribution) || '')}）。</p><div class="bm-prev" id="bm-prev"></div>`);
    setTimeout(() => {
      const el = document.getElementById('bm-prev');
      if (!el || !window.L) return;
      const map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 20, minZoom: 12, zoomSnap: 0.5 });
      map.attributionControl.setPrefix(false);
      U.baseLayer(false, true).addTo(map);
      const ts = K.geo.list;
      const s = Math.min(...ts.map(t => t.bb[0])), w = Math.min(...ts.map(t => t.bb[1])), n = Math.max(...ts.map(t => t.bb[2])), e = Math.max(...ts.map(t => t.bb[3]));
      map.fitBounds([[s, w], [n, e]]);
      setTimeout(() => map.invalidateSize(), 80);
    }, 60);
  };

  /* ==================== 割り当て案（全員に配る・集まり 共通） ==================== */
  const W = { kind: 'all' };
  /** 区域・建物の真ん中（地図の上の場所） */
  function centerOf(id) {
    const t = K.geo.terr[id];
    if (t) return [(t.bb[0] + t.bb[2]) / 2, (t.bb[1] + t.bb[3]) / 2];
    const b = target(id).b;
    return b && b.lat !== null && b.lat !== undefined && b.lat !== '' ? [Number(b.lat), Number(b.lon)] : null;
  }
  /** 2つの場所のおよその距離（km） */
  function kmBetween(a, b) {
    if (!a || !b) return 999;
    const dy = (a[0] - b[0]) * 111, dx = (a[1] - b[1]) * 111 * Math.cos(a[0] * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }
  /* ---------- 家の近く（0.10.0：区域の番号・住所・地図の場所のどれでも） ----------
   *   「家の近く」の値：T001（区域）／ 住所:銭函三丁目（町・丁目まで。番地は持たない）／ 地図:43.152,141.107（約100mの細かさ）
   */
  const KNUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const kanjiNum = n => { n = Number(n); if (n < 10) return KNUM[n]; const t = Math.floor(n / 10), o = n % 10; return (t > 1 ? KNUM[t] : '') + '十' + (o ? KNUM[o] : ''); };
  const NUM_RE = /[一二三四五六七八九十]+/;
  let TOWNS = null;
  /** 町・丁目ごとの家の中心。base は「星置」「銭函」のように数字の前まで */
  function townIndex() {
    if (TOWNS && TOWNS.geo === K.geo) return TOWNS;
    const acc = {};
    Object.keys(K.geo.block).forEach(bid => {
      const b = K.geo.block[bid];
      if (!b.town) return;
      const a = acc[b.town] = acc[b.town] || { name: b.town, lat: 0, lon: 0, n: 0 };
      const hs = (K.geo.byBlock[bid] || []).filter(h => !h.prov);
      if (hs.length) hs.forEach(h => { a.lat += h.lat; a.lon += h.lon; a.n++; });
      else { a.lat += (b.bb[0] + b.bb[2]) / 2; a.lon += (b.bb[1] + b.bb[3]) / 2; a.n++; }
    });
    const list = Object.keys(acc).map(k => { const a = acc[k]; return { name: a.name, lat: a.lat / a.n, lon: a.lon / a.n, n: a.n, base: a.name.replace(new RegExp('(' + NUM_RE.source + '条)?' + NUM_RE.source + '丁目$'), '') }; });
    const bases = {};
    list.forEach(t => { (bases[t.base] = bases[t.base] || []).push(t); });
    TOWNS = { geo: K.geo, list: list.sort((a, b) => b.name.length - a.name.length), bases: bases };
    return TOWNS;
  }
  /** 住所の書き方をそろえる（全角→半角、市・区を外す、「1条3丁目」→「一条三丁目」） */
  function normAddr(text) {
    let x = String(text || '').normalize('NFKC').replace(/\s+/g, '');
    x = x.replace(/^北海道/, '').replace(/小樽市|札幌市|手稲区/g, '').replace(/[‐‑‒–—―−ー－]/g, '-');
    return x.replace(/(\d+)条/g, (m, d) => kanjiNum(d) + '条').replace(/(\d+)丁目/g, (m, d) => kanjiNum(d) + '丁目');
  }
  /**
   * 住所から町・丁目を探す。返り値 {key（保存する名前）, name（見せる名前）, lat, lon, whole（丁目までは分からず町全体）} か null
   *   「銭函3丁目4-5」「星置1条3丁目」「星置1-3-5」（札幌の条・丁目の略し方）「桂岡町12」などが読める。番地は使わない
   */
  function resolveAddr(text) {
    const T = townIndex();
    const x = normAddr(text);
    if (!x) return null;
    const exact = T.list.find(t => x.indexOf(t.name) >= 0);
    if (exact) return { key: exact.name, name: exact.name, lat: exact.lat, lon: exact.lon };
    const bases = Object.keys(T.bases).filter(b => b && x.indexOf(b) >= 0).sort((a, b) => b.length - a.length);
    for (const b of bases) {
      const rest = x.slice(x.indexOf(b) + b.length);
      const towns = T.bases[b];
      const has = nm => T.list.find(t => t.name === nm);
      let m = rest.match(/^(\d+)-(\d+)/);
      if (m && has(b + kanjiNum(m[1]) + '条' + kanjiNum(m[2]) + '丁目')) { const t = has(b + kanjiNum(m[1]) + '条' + kanjiNum(m[2]) + '丁目'); return { key: t.name, name: t.name, lat: t.lat, lon: t.lon }; }
      m = rest.match(/^(\d+)/);
      if (m && has(b + kanjiNum(m[1]) + '丁目')) { const t = has(b + kanjiNum(m[1]) + '丁目'); return { key: t.name, name: t.name, lat: t.lat, lon: t.lon }; }
      // 丁目までは分からない：その町の全体の真ん中
      let n = 0, lat = 0, lon = 0;
      towns.forEach(t => { lat += t.lat * t.n; lon += t.lon * t.n; n += t.n; });
      return { key: b, name: b + '（全体）', lat: lat / n, lon: lon / n, whole: true };
    }
    return null;
  }
  /** いちばん近い町・丁目の名前 */
  function townNear(pt) {
    let best = null, d = 1e9;
    townIndex().list.forEach(t => { const k = kmBetween(pt, [t.lat, t.lon]); if (k < d) { d = k; best = t; } });
    return best ? best.name : '';
  }
  /** 「家の近く」の値を読む。{type: terr|addr|map, point, label（〇〇のまわり）, short（短い名前）, text（入力欄に出す形）} か null */
  function nearInfo(v) {
    v = String(v || '').trim();
    if (!v || !K.geo) return null;
    if (K.geo.terr[v]) { const t = K.geo.terr[v]; return { type: 'terr', point: centerOf(v), label: t.no + 'のまわり', short: t.no, text: t.no }; }
    let m = v.match(/^住所[:：](.+)$/);
    if (m) { const r = resolveAddr(m[1]); return r ? { type: 'addr', point: [r.lat, r.lon], label: r.name + 'のあたり', short: r.name, text: r.key, key: r.key } : null; }
    m = v.match(/^地図[:：\s]*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) { const pt = [Number(m[1]), Number(m[2])]; const tw = townNear(pt); return { type: 'map', point: pt, label: '地図で決めた場所（' + tw + 'のあたり）', short: '地図・' + tw, text: '地図 ' + m[1] + ',' + m[2] }; }
    return null;
  }
  const mapNear = pt => '地図:' + Number(pt[0]).toFixed(3) + ',' + Number(pt[1]).toFixed(3);
  /** 入力された「家の近く」（区域の番号・住所・「地図 緯度,経度」）を、保存する値にする。{value} か {error} */
  function nearInput(text) {
    const v = String(text || '').trim();
    if (!v) return { value: '' };
    const t = terrByNo(v);
    if (t) return { value: t.id };
    let m = v.normalize('NFKC').match(/^地図[:\s]*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { value: mapNear([m[1], m[2]]) };
    m = v.match(/^住所[:：]?(.+)$/);
    const r = resolveAddr(m ? m[1] : v);
    if (r) return { value: '住所:' + r.key, note: r.name };
    return { error: '「' + v + '」は、区域の番号（例：Z07-3）か住所（例：銭函3丁目）として読めません' };
  }
  /** 「家の近くにまとめる」人の家の近くの場所（決まっていなければ null） */
  const nearOf = p => { if (p.mode !== '近く' || !p.near) return null; const x = nearInfo(p.near); return x ? x.point : null; };
  const nearShort = p => { const x = nearInfo(p.near); return x ? x.short : ''; };
  /**
   * 候補から、まず「家の近く」の人の分を、家の近くの区域に近い順に取っておく（区域を選ぶときの最初の選び方）。
   * 返り値：取っておいた区域の配列
   */
  function reserveNear(people, cands) {
    const taken = new Set();
    people.filter(p => p.count > 0 && nearOf(p)).forEach(p => {
      const c0 = nearOf(p);
      // 一巡の計画があれば、今月の組・遅れている組を少し優先する（近さが同じくらいなら、そちら）
      const score = id => kmBetween(centerOf(id), c0) + (tierOf(id) >= 9 ? 3 : tierOf(id) >= 2 ? 1.5 : 0);
      cands.filter(id => !taken.has(id)).sort((a, b) => score(a) - score(b)).slice(0, p.count).forEach(id => taken.add(id));
    });
    return Array.from(taken);
  }
  /** 一巡の計画での並びの段（plan.js。計画がなければ 0）。集合住宅は別枠の計画（0.11.0） */
  const tierOf = id => (K.plan && (K.geo.terr[id] || /^AP/.test(id)) ? K.plan.tier(id) : 0);
  /** 一覧に出す、月ごとの組の印 */
  function planTag(id) {
    if (!K.plan) return '';
    const fr = K.plan.frameOf(id);
    if (!K.plan.cycle(null, fr).set || !K.plan.hasGroups(fr)) return '';
    const g = K.plan.groupOf(id);
    const t = tierOf(id);
    if (t === 9) return '<span class="tag ok">この一巡で済</span> ';
    if (!g) return '';
    return `<span class="tag plg${t === 0 ? ' late' : ''}" style="--c:${K.plan.colorOf(g)}">${g}か月目${t === 0 ? '・遅れ' : ''}</span> `;
  }
  /**
   * 候補（長く配っていない順）から need 枚を選ぶ。同じくらい長く配っていない区域（同じ月に返した・まだ配っていない）が
   * たくさんあるときは、番号の順に頭から取らずに、全体から間をあけて取る（選ぶ時点で地域が散らばるように）
   */
  function spreadPick(ids, need, keyOf) {
    if (ids.length <= need) return ids.slice();
    const ym = id => String(keyOf(id) || '');
    const cut = ym(ids[need - 1]);
    const older = ids.filter(id => ym(id) < cut);
    const tie = ids.filter(id => ym(id) === cut).sort((a, b) => target(a).order - target(b).order);
    const k = need - older.length;
    const pick = [];
    for (let j = 0; j < k; j++) pick.push(tie[Math.min(tie.length - 1, Math.floor((j + 0.5) * tie.length / k))]);
    return older.concat(pick);
  }
  /**
   * 割り当て案（0.8.0から「散らばるように」）。
   *   ・「家の近くにまとめる」人（車がない・足が悪いなど）：家の近くの区域に近い順に、その人の枚数を先に取る
   *   ・ほかの人：選んだ区域を地図の並び（番号の順＝町ごと・西から東）に並べ、トランプを配るように1枚ずつ順に配る。
   *     1人の区域は並びの上で人数ぶん離れるので、銭函と星置のように地域が散らばり、となりどうしにもなりにくい
   */
  function makePlan(people, pool) {
    const plan = {};
    people.forEach(p => { plan[p.id] = []; });
    let left = pool.slice();
    people.filter(p => p.count > 0 && nearOf(p)).forEach(p => {
      const c0 = nearOf(p);
      left.sort((a, b) => kmBetween(centerOf(a), c0) - kmBetween(centerOf(b), c0));
      plan[p.id] = left.slice(0, p.count);
      left = left.slice(p.count);
    });
    const others = people.filter(p => p.count > 0 && !nearOf(p));
    const deck = left.sort((a, b) => target(a).order - target(b).order);
    let i = 0;
    while (deck.length && others.some(p => plan[p.id].length < p.count)) {
      const p = others[i++ % others.length];
      if (plan[p.id].length < p.count) plan[p.id].push(deck.shift());
    }
    // 1人の区域を、番号の順に並べ直す（見やすく）
    Object.keys(plan).forEach(k => plan[k].sort((a, b) => target(a).order - target(b).order));
    return plan;
  }
  const chunkOf = id => (W.chunks && W.chunks[id]) || null;
  const sizeOf = id => { const c = chunkOf(id); return c ? c.rooms.length : 1; };
  const sumOf = list => (list || []).reduce((n, id) => n + sizeOf(id), 0);
  function chipLabel(id) {
    const c = chunkOf(id);
    if (c) return `${esc(c.no)}<small class="rooms">${esc(c.nos.join('・'))}</small>`;
    const t = target(id);
    return `${esc(t.no)}<small>${esc(t.name)}</small>`;
  }
  function planView() {
    const people = W.people.filter(p => p.count > 0 || (W.plan[p.id] || []).length);
    const unit = W.chunks && Object.keys(W.chunks).length ? '部屋' : '枚';
    const total = people.reduce((n, p) => n + sumOf(W.plan[p.id]), 0);
    const short = people.filter(p => sumOf(W.plan[p.id]) < p.count);
    const selC = W.sel ? chunkOf(W.sel.id) : null;
    const selT = W.sel ? (selC ? { no: selC.no + ' ' + selC.nos.join('・') } : target(W.sel.id)) : null;
    const canMap = unit !== '部屋';
    const sw = p => (canMap && MV.plan === 'map' ? `<i class="sw" style="background:${K.terrMap.PEOPLE[W.people.indexOf(p) % K.terrMap.PEOPLE.length]}"></i>` : '');
    return `
      ${canMap ? viewSeg('plan', '地図で見て直す') : ''}
      ${canMap && MV.plan === 'map' ? planMap() + '<p class="muted small">色は人ごと。区域をさわって選び、下の人の名前をさわるとその人に移します。ほかの人の区域をさわると入れ替わります。</p>' : ''}
      ${short.length ? `<p class="notice">${unit === '部屋' ? '部屋' : '区域'}が足りず、${short.length}人は予定より少なくなっています。前にもどって${unit === '部屋' ? '建物を足すか、「1つの建物から」の部屋の数を増やす' : '区域を足す'}か、このまま配れます。</p>` : ''}
      <p class="muted small">${unit === '部屋' ? '1人に、いくつかの建物から少しずつ（1つの建物から' + W.perB + '部屋まで）分けました。1つの建物は1人だけです（同じ日に同じ建物に入るのは1人）。<b>建物をさわると、何号室にするかを一覧から選び直せます</b>（ほかの人に移す・外すも）。「＋ 建物」で建物を足せます。</p>' : '1人の区域が、地域が散らばるように（となりどうしにならないように）配りました。「家の近くにまとめる」人は、家の近くから選んでいます。さわって選び、別の人の名前をさわると移せます。どうしをさわると入れ替わります。</p>'}
      ${selT ? `<p class="notice info"><b>${esc(selT.no)}</b> を選んでいます。移す先の人か、入れ替える区域をさわってください。<button class="link" data-act="planUnsel">選ぶのをやめる</button></p>` : ''}
      <div class="plan">${people.map(p => `<div class="prow ${W.sel && W.sel.from !== p.id ? 'droppable' : ''}">
        <button class="pname" data-act="planTo" data-u="${esc(p.id)}"><b>${sw(p)}${esc(p.name)}</b><small>${sumOf(W.plan[p.id])}${unit}</small></button>
        <div class="chips">${(W.plan[p.id] || []).map(id => `<button class="tchip ${chunkOf(id) ? 'rchip' : ''} ${W.sel && W.sel.id === id ? 'sel' : ''}" data-act="${chunkOf(id) ? 'ckOpen' : 'planPick'}" data-u="${esc(p.id)}" data-id="${esc(id)}">${chipLabel(id)}</button>`).join('') || '<span class="muted small">なし</span>'}${unit === '部屋' ? `<button class="tchip addchip" data-act="ckAdd" data-u="${esc(p.id)}">＋ 建物</button>` : ''}</div>
      </div>`).join('')}</div>
      <p class="muted small">合計 ${total}${unit}</p>`;
  }
  /* ---------- 割り当て案（部屋ごと）：建物ごとに、何号室を割り振るかを一覧から選ぶ ---------- */
  const CK = { id: '', uid: '', rooms: [], seq: 0 };
  const rsB = bid => (W.rs && W.rs.buildings.find(b => b.id === bid)) || null;
  /** 割り当て案で、この建物を持っている人（1つの建物は1人だけ） */
  function planOwner(bid) {
    let who = '';
    Object.keys(W.plan || {}).forEach(uid => (W.plan[uid] || []).forEach(id => { const c = chunkOf(id); if (c && c.bid === bid) who = uid; }));
    return who;
  }
  function roomGrid(b, sel, actName, all) {
    const ents = {};
    b.rooms.forEach(x => { const e = ents[x.entrance || ''] = ents[x.entrance || ''] || {}; (e[x.floor] = e[x.floor] || []).push(x); });
    const entKeys = Object.keys(ents).sort((a, c) => (Number(a) || 0) - (Number(c) || 0));
    return entKeys.map(ek => `<section class="ent">${entKeys.length > 1 ? `<h3>入口${esc(ek)}</h3>` : ''}<div class="grid">${Object.keys(ents[ek]).map(Number).sort((a, c) => c - a).map(f => `<div class="floor"><span class="fl num">${f}階</span><div class="cells">${ents[ek][f].map(x => {
      const dis = !all && (!!x.out || x.refused);
      const mark = x.refused ? '拒' : x.out ? esc(String(x.out.name).slice(0, 2)) : x.done ? '済' : x.last && x.last.res === '不在' ? '不' : '';
      return `<button class="cell pk ${sel.has(x.id) ? 'on' : ''} ${x.out ? 'taken' : ''} ${x.refused ? 'ref' : ''} ${x.done ? 'recent' : ''}" data-act="${actName}" data-room="${esc(x.id)}" ${dis ? 'disabled' : ''}><b class="num">${esc(x.no)}</b><span class="mk">${mark}</span></button>`;
    }).join('')}</div></div>`).join('')}</div></section>`).join('');
  }
  function renderChunk(open) {
    const c = chunkOf(CK.id);
    const b = c && rsB(c.bid);
    if (!b) return;
    const p = W.people.find(x => x.id === CK.uid) || { name: '' };
    const sel = new Set(CK.rooms);
    const nos = b.rooms.filter(x => sel.has(x.id)).map(x => x.no);
    const refused = b.rooms.filter(x => x.refused).map(x => x.no);
    const body = `
      ${b.round ? `<p class="small bk-note"><b>${esc(roundText(b.round))}</b></p>` : ''}
      <p class="muted small"><b>${esc(p.name)}さん</b>に割り振る部屋を、さわって選びます（この回り方は1つの建物から${W.perB}部屋まで。それより多くしてもかまいません）。印：<b>拒</b>＝拒否（選べません）、済＝今の巡回でもう回った、不＝前回は不在、名前＝今だれかが持っている。</p>
      ${refused.length ? `<p class="small">拒否の部屋：${esc(refused.join('・'))}</p>` : ''}
      <div class="row"><button class="btn sm" data-act="ckNext">まだの部屋から${W.perB}部屋</button><button class="btn sm" data-act="ckClear">選ぶのをやめる</button></div>
      <div class="rooms rpick">${roomGrid(b, sel, 'ckRoom')}</div>
      <p class="small">選んだ部屋：<b class="num">${CK.rooms.length}</b>${nos.length ? '（' + esc(nos.join('・')) + '）' : ''}</p>
      <button class="btn primary big wide" data-act="ckDone">${CK.rooms.length ? 'この' + CK.rooms.length + '部屋にする' : 'この建物を外す'}</button>
      ${W.people.length > 1 ? `<div class="lbl">ほかの人に移す（選んだ部屋ごと）</div><div class="seg wrap">${W.people.filter(x => x.id !== CK.uid).map(x => `<button data-act="ckMove" data-u="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>` : ''}`;
    const title = U.sheetTitle(esc(b.no) + ' <small>' + esc(b.name) + '</small>');
    const sh = document.querySelector('.sheet');
    if (open || !sh) U.openSheet(title, body);
    else sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + title + body;
  }
  act.ckOpen = el => {
    const c = chunkOf(el.dataset.id);
    if (!c) return;
    Object.assign(CK, { id: c.id, uid: el.dataset.u, rooms: c.rooms.slice() });
    renderChunk(true);
  };
  act.ckRoom = el => { const id = el.dataset.room; CK.rooms = CK.rooms.indexOf(id) >= 0 ? CK.rooms.filter(x => x !== id) : CK.rooms.concat([id]); renderChunk(); };
  act.ckClear = () => { CK.rooms = []; renderChunk(); };
  act.ckNext = () => {
    const c = chunkOf(CK.id), b = c && rsB(c.bid);
    if (!b) return;
    const keep = new Set(CK.rooms);
    const fresh = b.rooms.filter(x => !x.out && !x.refused && !x.done && !keep.has(x.id)).sort((a, c2) => (String(a.entrance) < String(c2.entrance) ? -1 : String(a.entrance) > String(c2.entrance) ? 1 : 0) || a.order - c2.order);
    CK.rooms = fresh.slice(0, W.perB).map(x => x.id);
    renderChunk();
  };
  /** 選んだ部屋を割り当て案に書き戻す（部屋がなければ、その建物を外す） */
  function ckApply() {
    const c = chunkOf(CK.id), b = c && rsB(c.bid);
    if (!c) return;
    const want = new Set(CK.rooms);
    const rs = b ? b.rooms.filter(x => want.has(x.id)) : [];
    c.rooms = rs.map(x => x.id); c.nos = rs.map(x => x.no);
    if (!c.rooms.length) {
      Object.keys(W.plan).forEach(uid => { W.plan[uid] = W.plan[uid].filter(x => x !== c.id); });
      delete W.chunks[c.id];
    }
  }
  act.ckDone = () => { ckApply(); U.closeSheet(); U.render(); };
  act.ckMove = el => {
    const to = el.dataset.u;
    ckApply();
    const c = chunkOf(CK.id);
    if (c) {
      W.plan[CK.uid] = W.plan[CK.uid].filter(x => x !== c.id);
      const same = (W.plan[to] || []).map(chunkOf).find(x => x && x.bid === c.bid);
      if (same) { same.rooms = same.rooms.concat(c.rooms); same.nos = same.nos.concat(c.nos); delete W.chunks[c.id]; }
      else (W.plan[to] = W.plan[to] || []).push(c.id);
      toast(c.no + ' を ' + (W.people.find(x => x.id === to) || {}).name + 'さんに移しました');
    }
    U.closeSheet(); U.render();
  };
  /** 「＋ 建物」：その人に建物を足す（ほかの人の建物・今だれかが持っている建物はのぞく） */
  act.ckAdd = el => {
    const uid = el.dataset.u;
    const p = W.people.find(x => x.id === uid) || { name: '' };
    const list = roomCands().filter(c => !c.taken && (!planOwner(c.b.id) || planOwner(c.b.id) === uid));
    U.openSheet(U.sheetTitle(esc(p.name) + ' <small>さんに建物を足す</small>'), `
      <p class="muted small">建物を選ぶと、部屋を選ぶ画面になります。ほかの人に割り振った建物と、今だれかが部屋を持っている建物は出しません（同じ日に同じ建物に入るのは1人）。</p>
      <div class="tlist">${list.map(c => `<button class="trow" data-act="ckAddB" data-u="${esc(uid)}" data-id="${esc(c.b.id)}"><b class="num">${esc(c.b.no)}</b><span class="town">${esc(c.b.name)}</span><span class="h num">${c.rooms.length}部屋</span>
        <span class="st">${esc(roundText(c.round, c.cool))}${planOwner(c.b.id) === uid ? '・この人に割り振っています' : ''}</span></button>`).join('') || '<p class="empty">足せる建物がありません。</p>'}</div>`);
  };
  act.ckAddB = el => {
    const uid = el.dataset.u, bid = el.dataset.id;
    const have = (W.plan[uid] || []).map(chunkOf).find(x => x && x.bid === bid);
    let c = have;
    if (!c) {
      const b = rsB(bid);
      c = { id: 'cx' + (++CK.seq), bid: bid, no: b.no, name: b.name, rooms: [], nos: [] };
      W.chunks[c.id] = c;
      (W.plan[uid] = W.plan[uid] || []).push(c.id);
    }
    Object.assign(CK, { id: c.id, uid: uid, rooms: c.rooms.slice() });
    renderChunk(true);
  };
  act.planPick = el => {
    const id = el.dataset.id, from = el.dataset.u;
    if (W.sel && W.sel.id !== id) {
      // 入れ替え
      const a = W.plan[W.sel.from], b = W.plan[from];
      const ia = a.indexOf(W.sel.id), ib = b.indexOf(id);
      a[ia] = id; b[ib] = W.sel.id;
      W.sel = null;
    } else W.sel = W.sel && W.sel.id === id ? null : { id: id, from: from };
    U.render();
  };
  act.planTo = el => {
    if (!W.sel) return;
    const to = el.dataset.u;
    if (to !== W.sel.from) {
      W.plan[W.sel.from] = W.plan[W.sel.from].filter(x => x !== W.sel.id);
      (W.plan[to] = W.plan[to] || []).push(W.sel.id);
    }
    W.sel = null;
    U.render();
  };
  act.planUnsel = () => { W.sel = null; U.render(); };
  act.step = el => {
    const id = el.dataset.id, d = Number(el.dataset.d);
    if (id === '__per') { W.per = Math.max(1, Math.min(10, W.per + d)); W.pool = null; }
    else if (id === '__rooms') { W.perRooms = Math.max(1, Math.min(20, W.perRooms + d)); W.plan = null; }
    else if (id === '__perB') { W.perB = Math.max(1, Math.min(20, W.perB + d)); W.plan = null; }
    else { const p = W.people.find(x => x.id === id); if (p) { p.count = Math.max(0, Math.min(10, p.count + d)); W.pool = null; } }
    U.render();
  };
  function bottomBar(left, btn, cls) { return `<div class="confirm-bar ${cls || ''}"><div>${left}</div>${btn}</div>`; }
  function resultView(r, what) {
    const ok = r.results.filter(x => x.ok);
    const ng = r.results.filter(x => !x.ok);
    return `<div class="done-box"><p class="big-ok">${I.check}${ok.length}枚を${what}</p>
      ${ng.length ? `<div class="notice"><b>${ng.length}枚は配れませんでした</b><ul>${ng.map(x => `<li>${esc(x.message)}</li>`).join('')}</ul></div>` : ''}
      <div class="stack"><button class="btn" data-act="aGo" data-v="aOut">配布中の一覧を見る</button><button class="btn ghost" data-act="aGo" data-v="admin">管理のメニューへ</button></div></div>`;
  }

  /**
   * いくつも選ぶ地図（全員に配る・グループに預ける・集まり）。cands：選べる区域、sel：選んでいる区域、actName：さわったときの動き
   */
  function poolMap(key, cands, sel, out, lr, actName, opts) {
    opts = opts || {};
    const can = new Set(cands);
    const tap = id => act[actName]({ dataset: { id: id } });
    return `${legend([[TC.sel, '選んでいる']].concat(opts.legend || AGE_LEGEND))}
      ${mapSlot(key, {
        style: id => (sel.has(id) ? TC.sel : can.has(id) ? (opts.candStyle ? opts.candStyle(id) : K.terrMap.ageStyle(lr[id])) : out[id] ? TC.out : TC.other),
        label: id => (can.has(id) || sel.has(id) ? tLabel(id) : null),
        onTap: id => { if (can.has(id) || sel.has(id)) tap(id); else if (out[id]) toast(K.geo.terr[id].no + ' は配布中です（' + (out[id].name || '') + '）'); else toast('この区域は候補にありません'); },
        buildings: opts.buildings ? opts.buildings.map(b => ({ id: b.id, lat: b.lat, lon: b.lon, html: '<i>' + esc(b.no) + '</i>', cls: sel.has(b.id) ? 'sel' : can.has(b.id) ? 'free' : 'out' })) : null,
        onTapB: id => { if (can.has(id) || sel.has(id)) tap(id); },
        fit: cands.length ? cands : null,
      })}
      <p class="muted small">さわると選ぶ・外すを切り替えます。選んでいる：<b class="num">${sel.size}</b></p>`;
  }
  /** 割り当て案を地図で見る：人ごとに色を変える。区域をさわって選び、下の人の名前をさわると移せる */
  function planMap() {
    const owner = {};
    const color = {};
    W.people.forEach((p, i) => { color[p.id] = K.terrMap.PEOPLE[i % K.terrMap.PEOPLE.length]; });
    Object.keys(W.plan).forEach(uid => (W.plan[uid] || []).forEach(id => { owner[id] = uid; }));
    const ids = Object.keys(owner);
    const out = outMap();
    const short = uid => { const p = W.people.find(x => x.id === uid); return p ? esc(p.name.split(/\s/)[0]) : ''; };
    const bld = (A.data.buildings || []).filter(b => owner[b.id]);
    return mapSlot('plan', {
      style: id => {
        if (!owner[id]) return out[id] ? TC.out : TC.other;
        const c = color[owner[id]];
        const on = W.sel && W.sel.id === id;
        return { stroke: on ? '#111827' : c, fill: c, fillOpacity: on ? 0.85 : 0.5, weight: on ? 4 : 1.5 };
      },
      label: id => (owner[id] ? tLabel(id).replace('<small>', '<small>' + short(owner[id]) + '・') : null),
      onTap: id => { if (owner[id]) act.planPick({ dataset: { id: id, u: owner[id] } }); },
      buildings: bld.map(b => ({ id: b.id, lat: b.lat, lon: b.lon, html: `<i style="background:${color[owner[b.id]]}">${esc(b.no)}</i>`, cls: 'plan' + (W.sel && W.sel.id === b.id ? ' sel' : '') })),
      onTapB: id => act.planPick({ dataset: { id: id, u: owner[id] } }),
      fit: ids,
    });
  }

  /* ==================== 全員に配る（一律配布） ==================== */
  views.aAll = async function () {
    if (!A.data) await load();
    if (W.kind !== 'all' || !W.people || view().fresh) {
      const def = A.data.settings.usualDefault || 4;
      Object.assign(W, { kind: 'all', step: 1, area: 'all', pool: null, plan: null, sel: null, result: null, chunks: {},
        people: usersSorted(A.data.users.filter(u => u.active)).map(u => ({ id: u.id, name: u.name, groupId: u.groupId, current: u.cards, mode: u.mode, near: u.near, usual: u.usual === null || u.usual === undefined || u.usual === '' ? def : Number(u.usual), count: Math.max(0, (u.usual === null || u.usual === undefined || u.usual === '' ? def : Number(u.usual)) - u.cards) })) });
      datesReset();
      if (view().fresh) view().fresh = false;
    }
    const need = W.people.reduce((n, p) => n + p.count, 0);
    const steps = ['人と枚数', '区域', '割り当て案'];
    const head = `<ol class="steps">${steps.map((s, i) => `<li class="${W.step === i + 1 ? 'on' : W.step > i + 1 ? 'done' : ''}">${i + 1}. ${s}</li>`).join('')}</ol>`;
    if (W.result) return shell('全員に配る', resultView(W.result, '配りました'));
    if (W.step === 1) {
      let lastG = null;
      const rows = W.people.map(p => {
        const gh = p.groupId !== lastG ? `<h3 class="ghead">${esc(groupName(p.groupId))}</h3>` : '';
        lastG = p.groupId;
        return gh + `<div class="urow"><div class="uname"><b>${esc(p.name)}</b><small>今 ${p.current}枚・いつも ${p.usual}枚${nearOf(p) ? '・<b>家の近く</b>（' + esc(nearInfo(p.near).label) + '）' : ''}</small></div>${stepper(p.id, p.count, 0, 10)}</div>`;
      }).join('');
      return shell('全員に配る', `${head}
        <p class="muted small">一人ずつ、今回配る枚数を決めます。最初は「いつもの枚数」から今持っている枚数を引いた数です。来ない人は0にします。グループは関係しません。</p>
        ${K.plan ? K.plan.allGuide(need) : ''}
        <div class="row"><button class="btn sm" data-act="allUsual">全員「いつもの枚数」に</button><button class="btn sm" data-act="allZero">全員0に</button></div>
        <div class="ulist">${rows}</div>`, { bar: bottomBar(`合計 <b class="num">${need}</b>枚`, `<button class="btn primary" data-act="allNext" ${need ? '' : 'disabled'}>次へ：区域を選ぶ</button>`) });
    }
    if (W.step === 2) {
      const out = outMap();
      const lr = A.data.lastReturned || {};
      let cands = K.geo.list.filter(t => !out[t.id] && t.houses > 0);
      if (W.area !== 'all') cands = cands.filter(t => t.no[0] === W.area);
      cands.sort((a, b) => (tierOf(a.id) - tierOf(b.id)) || ((lr[a.id] || '') < (lr[b.id] || '') ? -1 : (lr[a.id] || '') > (lr[b.id] || '') ? 1 : a.i - b.i));
      if (!W.pool) {
        // 「家の近く」の人の分は、家の近くから先に取っておく。のこりは（一巡の計画の順に）長く配っていない順
        const near = reserveNear(W.people, cands.map(t => t.id));
        W.pool = near.concat(spreadPick(cands.map(t => t.id).filter(id => near.indexOf(id) < 0), Math.max(0, need - near.length), id => tierOf(id) + ':' + String(lr[id] || '').slice(0, 7)));
      }
      const sel = new Set(W.pool);
      const list = cands.slice(0, Math.max(need + 30, 60));
      const nearN = W.people.filter(p => p.count > 0 && nearOf(p)).length;
      return shell('全員に配る', `${head}
        <p class="muted small">${K.plan && K.plan.cycle().set ? '一巡の計画の順（遅れている組 → 今月の組 → 次の月の組）に、その中では' : ''}長く配っていない区域から順に、必要な ${need}枚を選びました。同じくらい長く配っていない区域が多いときは、地域が散らばるように間をあけて選んでいます${nearN ? '（「家の近くにまとめる」人' + nearN + '人の分は、その人の家の近くから）' : ''}。外したい区域や、足したい区域をさわってください。</p>
        <div class="seg three">${[['all', '両方'], ['Z', '小樽側（Z）'], ['H', '札幌側（H）']].map(a => `<button data-act="allArea" data-a="${a[0]}" aria-pressed="${W.area === a[0]}">${a[1]}</button>`).join('')}</div>
        ${viewSeg('all2')}
        ${MV.all2 === 'map' ? poolMap('all2-' + W.area, cands.map(t => t.id), sel, out, lr, 'allToggle') : `<div class="tlist">${list.map(t => `<button class="trow pick ${sel.has(t.id) ? 'sel' : ''}" data-act="allToggle" data-id="${t.id}">
          <span class="cbx">${sel.has(t.id) ? I.check : ''}</span><b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h num">${t.houses}軒</span>
          <span class="st">${planTag(t.id)}${lr[t.id] ? '前回の返却 ' + H.mdShort(lr[t.id]) : 'まだ配っていません'}</span></button>`).join('')}</div>`}`,
        { bar: bottomBar(`選んだ <b class="num">${W.pool.length}</b> / 必要 ${need}枚`, `<button class="btn" data-act="allBack">もどる</button><button class="btn primary" data-act="allPlan" ${W.pool.length ? '' : 'disabled'}>次へ：割り当て案</button>`) });
    }
    if (!W.plan) W.plan = makePlan(W.people.filter(p => p.count > 0), W.pool);
    const n = Object.keys(W.plan).reduce((s, k) => s + W.plan[k].length, 0);
    return shell('全員に配る', `${head}${datesBox('dt', DT)}${planView()}`, { bar: bottomBar(`${n}枚を配ります`, `<button class="btn" data-act="allBack">もどる</button><button class="btn primary" data-act="allGo" ${n ? '' : 'disabled'}>配る</button>`) });
  };
  act.allUsual = () => { W.people.forEach(p => { p.count = p.usual; }); W.pool = null; U.render(); };
  act.allZero = () => { W.people.forEach(p => { p.count = 0; }); W.pool = null; U.render(); };
  act.allNext = () => { W.step = 2; W.pool = null; U.render(); window.scrollTo(0, 0); };
  act.allArea = el => { W.area = el.dataset.a; W.pool = null; U.render(); };
  act.allToggle = el => { const id = el.dataset.id; W.pool = W.pool.indexOf(id) >= 0 ? W.pool.filter(x => x !== id) : W.pool.concat([id]); W.plan = null; U.render(); };
  act.allPlan = () => { W.step = 3; W.plan = null; W.sel = null; U.render(); window.scrollTo(0, 0); };
  act.allBack = () => { W.step = Math.max(1, W.step - 1); W.plan = null; W.sel = null; U.render(); };
  act.allGo = async el => {
    if (!sure(el, 'もう一度押すと配ります')) return;
    el.disabled = true;
    const items = [];
    Object.keys(W.plan).forEach(uid => W.plan[uid].forEach(id => items.push({ targetId: id, no: target(id).no, kind: '通常', userId: uid })));
    try {
      W.result = await api('distribute', { items: items, dates: { due: DT.due, forced: DT.forced } });
      await load();
      if (items.some(x => x.userId === (K.state.me && K.state.me.user && K.state.me.user.id))) K.refresh().catch(() => {});
    } catch (e) { el.disabled = false; return; }
    U.render(); window.scrollTo(0, 0);
  };

  /* ==================== 集まりで割り振る ==================== */
  /** 集まりの種類：不在宅訪問と、使っている回り方 */
  const GK = () => [['不在宅訪問', '不在宅訪問', '返却された区域の、会えなかった家と回れなかった家']].concat(activeRoutes().map(r =>
    [r.id, r.name, '回り方に「' + r.name + '」が入っている集合住宅・' + (r.mode === '部屋ごと' ? '1人に' + r.per + '部屋ずつ（1つの建物から' + perBOf(r) + '部屋まで）' : '建物まるごと1人に（一棟まとめて）')]));
  const modeOf = id => (wholeRoute(id) ? 'bldg' : 'room');
  function gatherPool() {
    const out = outMap();
    const lr = A.data.lastReturned || {};
    if (W.gkind === '不在宅訪問') {
      const st = K.houseStates();
      return (A.data.absentCands || []).filter(c => !out[c.territoryId]).map(c => {
        const done = new Set(c.done), ref = new Set(c.refused), abs = new Set(c.absent || []), blocks = new Set(c.doneBlocks);
        const n = (K.geo.byTerr[c.territoryId] || []).filter(h => K.houseKind(h, st).kind === 'house' && !done.has(h.id) && !ref.has(h.id) && !(blocks.has(h.b) && !abs.has(h.id))).length;
        return { id: c.territoryId, n: n, note: '回る家 ' + n + '軒・返却 ' + H.mdShort(c.returnedAt) };
      }).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    }
    // 一棟まとめて：巡回の途中の建物（部屋ごとに一部を回った建物）を先に、そのあと前の巡回が終わったのが古い順
    const cy = A.data.cycles || {};
    return (A.data.buildings || []).filter(b => routesOf(b).indexOf(W.gkind) >= 0 && !out[b.id]).map(b => {
      const r = cy[b.id];
      const lrB = r ? r.lastDone : (lr[b.id] || '');
      return { id: b.id, n: b.rooms, note: b.rooms + '部屋・' + (r ? roundText(r) : lrB ? '前回の返却 ' + H.mdShort(lrB) : 'まだ回っていません'), tag: planTag(b.id), lr: r && r.start ? '0' + r.start : lrB ? '2' + lrB : '1', t: Math.min(tierOf(b.id), r && r.start ? 1 : 9) };
    }).sort((a, b) => (a.t - b.t) || (a.lr < b.lr ? -1 : a.lr > b.lr ? 1 : target(a.id).order - target(b.id).order));
  }
  /** 建物の巡回を一言で（途中なら何回目・何部屋まで、終わっていれば終わった日） */
  function roundText(r, cool) {
    if (!r) return '';
    if (r.start) return '巡回' + r.n + '回目の途中 ' + r.covered + '/' + r.required + '部屋（' + H.mdShort(r.start) + '〜）';
    if (r.lastDone) return '前の巡回 ' + H.mdShort(r.lastDone) + 'に終わり' + (cool ? '（回り直すまで あと' + cool + '日）' : '');
    return 'まだ回っていません';
  }
  /**
   * 部屋ごとに割り振るときの候補（0.7.0から巡回で数える）。
   *   部屋：今の巡回でまだ回っていない・だれも持っていない・拒否でない部屋。
   *   建物：ほかの人が部屋を持っている建物は taken（同じ建物に入るのは1人だけ。forUser はその人なら足せる）。
   *   並び：巡回の途中の建物（始めた日が早い順）→ まだ回ったことがない建物 → 前の巡回が終わったのが古い順。
   *   前の巡回が終わってから「回り直すまでの日数」がたっていない建物は cool（最初は選ばない・後ろに並ぶ）
   */
  function roomCands(rs, forUser) {
    rs = rs || W.rs;
    const cyc = rs.cycleDays || 90;
    const today = H.ymd(H.todayStr());
    const group = c => (c.round.start ? 0 : !c.round.lastDone ? 1 : c.cool ? 3 : 2);
    const when = c => (c.round.start || c.round.lastDone || '');
    // 一巡の計画（集合住宅の別枠）があれば、遅れている組 → 今月の組 → 次の月の組 の順を先に。巡回の途中の建物は今月の組と同じに扱う
    const tr = c => Math.min(tierOf(c.b.id), c.round.start ? 1 : 9);
    return rs.buildings.filter(b => !b.whole).map(b => {
      const outs = b.rooms.filter(x => x.out);
      const holders = [];
      outs.forEach(x => { const k = x.out.userId || x.out.name; if (!holders.some(h => h.k === k)) holders.push({ k: k, name: x.out.name }); });
      const taken = holders.some(h => h.k !== forUser);
      const rooms = b.rooms.filter(x => !x.out && !x.refused && !x.done)
        .sort((a, c) => (String(a.entrance) < String(c.entrance) ? -1 : String(a.entrance) > String(c.entrance) ? 1 : 0) || a.order - c.order);
      const round = b.round || {};
      const since = round.lastDone ? Math.floor((today - H.ymd(round.lastDone)) / 864e5) : Infinity;
      const cool = !round.start && since < cyc ? cyc - since : 0;
      return { b: b, rooms: rooms, round: round, cool: cool, taken: taken, holders: holders.map(h => h.name), outN: outs.length, refusedN: b.rooms.filter(x => x.refused).length };
    }).filter(c => c.rooms.length)
      .sort((a, c) => (tr(a) - tr(c)) || (group(a) - group(c)) || (when(a) < when(c) ? -1 : when(a) > when(c) ? 1 : 0) || (noKey(a.b.no) < noKey(c.b.no) ? -1 : 1));
  }
  /**
   * 部屋を、1人にいくつかの建物から少しずつ割り振る。
   *   cands：長く回っていない建物から順（それぞれ、候補の部屋が入口・並び順に並ぶ）。people：[{id, count}]。perB：1つの建物から1人に何部屋まで
   *   1人ずつ順に、まだだれも取っていない建物のうち一番上の建物から、続きの部屋を perB 部屋まで取る（これを全員が足りるまでくり返す）。
   *   1つの建物は1人だけ（同じ日に同じ建物に入るのは1人）。同じ人が同じ建物から2回取ることもないので、1人の部屋はいくつかの建物に分かれる
   */
  function spreadRooms(people, cands, perB) {
    const left = cands.map(c => ({ b: c.b, rooms: c.rooms.slice() }));
    const plan = {}, chunks = {}, got = {}, used = {}, owner = {};
    let n = 0;
    people.forEach(p => { plan[p.id] = []; got[p.id] = 0; used[p.id] = {}; });
    let moved = true;
    while (moved) {
      moved = false;
      people.forEach(p => {
        const need = p.count - got[p.id];
        if (need <= 0) return;
        const c = left.find(x => x.rooms.length && !used[p.id][x.b.id] && !owner[x.b.id]);
        if (!c) return;
        owner[c.b.id] = p.id;
        const take = c.rooms.splice(0, Math.min(perB, need));
        const ch = { id: 'c' + (n++), bid: c.b.id, no: c.b.no, name: c.b.name, rooms: take.map(x => x.id), nos: take.map(x => x.no) };
        chunks[ch.id] = ch; plan[p.id].push(ch.id);
        used[p.id][c.b.id] = true; got[p.id] += take.length; moved = true;
      });
    }
    return { plan: plan, chunks: chunks };
  }
  function loadRooms(opts, then) {
    if (W.rsLoading) return;
    W.rsLoading = true; W.rsErr = null;
    api('roomStatus', opts).then(r => { W.rs = r; }).catch(e => { W.rsErr = e; }).finally(() => { W.rsLoading = false; if (then) then(); });
  }
  views.aGather = async function () {
    if (!A.data) await load();
    if (W.kind !== 'gather' || view().fresh) {
      const g0 = aptOnly() ? firstRoute('部屋ごと') : firstRoute('一棟まとめて');
      Object.assign(W, { kind: 'gather', step: 1, gkind: g0 || '不在宅訪問', gname: '', per: 1, perRooms: (K.route(g0) || {}).per || 5, perB: perBOf(g0),
        mode: modeOf(g0), present: {}, q: '', pool: null, plan: null, sel: null, result: null, people: [], rs: null, rsErr: null, bsel: null, chunks: {} });
      if (view().fresh) view().fresh = false;
    }
    const roomMode = W.mode === 'room' && isBKind(W.gkind);
    const steps = ['種類', '来た人', roomMode ? '部屋' : '区域', '割り当て案'];
    const head = `<ol class="steps">${steps.map((s, i) => `<li class="${W.step === i + 1 ? 'on' : W.step > i + 1 ? 'done' : ''}">${i + 1}. ${s}</li>`).join('')}</ol>`;
    const open = (A.data.gatherings || []);
    const kinds = GK().filter(g => !aptOnly() || isBKind(g[0]));
    if (W.result) return shell('集まりで割り振る', resultView(W.result, '割り振りました') + `<p class="muted small">集まりが終わったら「配布中と回収」から、まとめて返却にできます。</p>`);
    if (W.step === 1) {
      return shell('集まりで割り振る', `${head}
        ${open.length ? `<div class="notice info">開いている集まり：${open.map(g => esc(H.mdShort(g.date) + ' ' + g.name)).join('、')}<br><button class="link" data-act="aGo" data-v="aOut">配布中と回収で終える</button></div>` : ''}
        <p class="muted small">集まりの場で、来た人に一律に割り振ります。割り振った区域は今日が回収日です。${esc(H.md(addDaysStr(H.todayStr(), (A.data.settings && A.data.settings.gatherForcedDays) ?? 2)))}を過ぎると自動で回収します（「集まりを終える」で、その場でまとめて返却にもできます）。</p>
        <div class="stack">${kinds.map(g => `<button class="persona ${W.gkind === g[0] ? 'on' : ''}" data-act="gKind" data-k="${esc(g[0])}"><b>${esc(g[1])}</b><span class="muted">${esc(g[2])}</span></button>`).join('')}</div>
        ${isBKind(W.gkind) ? `<div class="lbl">割り振り方</div>
          <div class="seg two"><button data-act="gMode" data-m="bldg" aria-pressed="${W.mode === 'bldg'}">一棟まとめて</button><button data-act="gMode" data-m="room" aria-pressed="${W.mode === 'room'}">部屋ごと（1人に数部屋）</button></div>
          <p class="muted small">${W.mode === 'room' ? '巡回の途中の建物と長く回っていない建物の、今の巡回でまだ回っていない部屋を、1人に数部屋ずつ割り振ります。1人には、いくつかの建物から少しずつ（1つの建物から' + W.perB + '部屋まで）割り振ります。同じ日に同じ建物に入るのは1人だけです。' : '建物をまるごと（全部の部屋を）1人に渡します。1人に何棟渡すかは、次の画面で決めます。'}${'（「' + esc(rName(W.gkind)) + '」の最初の割り振り方は「' + (wholeRoute(W.gkind) ? '一棟まとめて' : '部屋ごと') + '」。「回り方」の画面で変えられます）'}</p>` : ''}`,
        { bar: bottomBar(`<b>${esc(rName(W.gkind))}</b>${isBKind(W.gkind) ? '・' + (W.mode === 'room' ? '部屋ごと' : '一棟まとめて') : ''}`, `<button class="btn primary" data-act="gNext">次へ：来た人</button>`) });
    }
    if (W.step === 2) {
      const us = usersSorted(A.data.users.filter(u => u.active));
      const q = W.q.trim();
      const list = q ? us.filter(u => (u.name + u.kana).indexOf(q) >= 0) : us;
      const n = Object.keys(W.present).filter(k => W.present[k]).length;
      let lastG = null;
      return shell('集まりで割り振る', `${head}
        <p class="muted small">来た人をさわって選びます。</p>
        <input id="g-q" class="sel" type="search" placeholder="名前で探す" value="${esc(W.q)}" autocomplete="off">
        <div class="row"><button class="btn sm" data-act="gAll">表示中の全員を選ぶ</button><button class="btn sm" data-act="gNone">選ぶのをやめる</button></div>
        <div class="ulist">${list.map(u => { const gh = u.groupId !== lastG ? `<h3 class="ghead">${esc(groupName(u.groupId))}</h3>` : ''; lastG = u.groupId;
          return gh + `<button class="urow pick ${W.present[u.id] ? 'sel' : ''}" data-act="gPick" data-id="${u.id}"><span class="cbx">${W.present[u.id] ? I.check : ''}</span><span class="uname"><b>${esc(u.name)}</b></span></button>`; }).join('')}</div>
        <div class="per">1人あたり ${roomMode ? stepper('__rooms', W.perRooms, 1, 20) + ' 部屋' : stepper('__per', W.per, 1, 10) + (isBKind(W.gkind) ? ' 棟' : ' 枚')}</div>
        ${roomMode ? `<div class="per">1つの建物から ${stepper('__perB', W.perB, 1, 20)} 部屋まで</div>
          <p class="muted small">1人に、いくつかの建物から少しずつ割り振ります（${W.perRooms}部屋なら、${Math.ceil(W.perRooms / W.perB)}棟以上から）。最初の数は「回り方」の画面で変えられます。</p>` : ''}`,
        { bar: bottomBar(`来た人 <b class="num">${n}</b>人 × ${roomMode ? W.perRooms + '部屋' : W.per + (isBKind(W.gkind) ? '棟' : '枚')}`, `<button class="btn" data-act="gBack">もどる</button><button class="btn primary" data-act="gNext" ${n ? '' : 'disabled'}>次へ：${roomMode ? '部屋' : '区域'}</button>`) });
    }
    const ids = Object.keys(W.present).filter(k => W.present[k]);
    if (W.step === 3 && roomMode) {
      if (!W.rs) {
        if (!W.rsLoading && !W.rsErr) loadRooms({ kind: W.gkind }, () => { if (view().name === 'aGather') U.render(); });
        return shell('集まりで割り振る', `${head}${W.rsErr ? `<div class="notice">${esc(W.rsErr.message || '部屋の様子を読めませんでした')}</div><button class="btn" data-act="gRooms">もう一度読む</button>` : '<p class="muted">部屋の様子を読んでいます…</p>'}`);
      }
      const all = roomCands();
      const cands = all.filter(c => !c.taken);
      const takenN = all.length - cands.length;
      if (!W.bsel) W.bsel = cands.filter(c => !c.cool).map(c => c.b.id);
      const sel = new Set(W.bsel);
      const need = ids.length * W.perRooms;
      // 1つの建物は1人だけ・1人に1つの建物から W.perB 部屋まで。実際に割り当て案を作って、割り振れる部屋の数を出す
      const trial = spreadRooms(ids.map(id => ({ id: id, count: W.perRooms })), cands.filter(c => sel.has(c.b.id)), W.perB);
      const cap = Object.keys(trial.chunks).reduce((n, k) => n + trial.chunks[k].rooms.length, 0);
      const needB = ids.length * Math.ceil(W.perRooms / W.perB);
      const coolN = cands.filter(c => c.cool && !sel.has(c.b.id)).length;
      return shell('集まりで割り振る', `${head}
        <p class="muted small">巡回の途中の建物を先に、そのあと長く回っていない建物の順に並べました。候補は、今の巡回でまだ回っていない・だれも持っていない・拒否の印がない部屋です。前の巡回が終わってから${W.rs.cycleDays}日たっていない建物は、最初は選んでいません。</p>
        <p class="notice ${sel.size < needB ? '' : 'info'}">同じ日に同じ建物に入るのは1人だけです。1つの建物からは1人に${W.perB}部屋までなので、${ids.length}人に${W.perRooms}部屋ずつなら、建物が${needB}棟いります（選んでいる：${sel.size}棟）。${sel.size < needB ? (coolN ? '足りない分は、下の「回り直すまで」の建物も選べます。' : '「1つの建物から」の部屋の数を増やすか、このまま少なめに割り振れます。') : ''}</p>
        ${takenN ? `<p class="muted small">今だれかが部屋を持っている建物（${takenN}棟）は、同じ日に入らないように候補から外しました。</p>` : ''}
        ${cands.length ? '' : `<p class="notice">候補の部屋がありません。「集合住宅」で、回り方に「${esc(rName(W.gkind))}」を入れた建物があるか確かめてください。</p>`}
        <div class="tlist">${cands.map(c => `<button class="trow pick ${sel.has(c.b.id) ? 'sel' : ''}" data-act="gBsel" data-id="${c.b.id}">
          <span class="cbx">${sel.has(c.b.id) ? I.check : ''}</span><b class="num">${esc(c.b.no)}</b><span class="town">${esc(c.b.name)}</span><span class="h num">${c.rooms.length}部屋</span>
          <span class="st">${esc(roundText(c.round, c.cool))}・全${c.b.rooms.length}部屋${c.refusedN ? '・拒否 ' + c.refusedN : ''}</span></button>`).join('')}</div>`,
        { bar: bottomBar(`<small>割り振れる部屋</small><b class="num">${cap}</b> / ${need}`, `<button class="btn" data-act="gBack">もどる</button><button class="btn primary" data-act="gNext" ${cap ? '' : 'disabled'}>次へ：割り当て案</button>`) });
    }
    if (W.step === 3) {
      const need = ids.length * W.per;
      const pool = gatherPool();
      if (!W.pool) {
        const ppl = usersSorted(A.data.users.filter(u => ids.indexOf(u.id) >= 0)).map(u => ({ count: W.per, mode: u.mode, near: u.near }));
        const near = reserveNear(ppl, pool.map(x => x.id));
        W.pool = near.concat(pool.map(x => x.id).filter(id => near.indexOf(id) < 0).slice(0, Math.max(0, need - near.length)));
      }
      const sel = new Set(W.pool);
      return shell('集まりで割り振る', `${head}
        <p class="muted small">${W.gkind === '不在宅訪問' ? '回る家が多い区域から順に、必要な ' + need + '枚' : '長く回っていない建物から順に、必要な ' + need + '棟'}を選びました。さわって外したり足したりできます。${isBKind(W.gkind) ? '建物はまるごと（全部の部屋を）渡します。' : ''}</p>
        ${pool.length ? '' : `<p class="notice">候補がありません。${W.gkind === '不在宅訪問' ? '前の月に返却された区域がないか、全部配っています。' : '「集合住宅」で、回り方に「' + esc(rName(W.gkind)) + '」を入れた建物がないか、全部配っています。'}</p>`}
        ${pool.length ? viewSeg('gpool') : ''}
        ${pool.length && MV.gpool === 'map' ? gatherMap(pool, sel) : `<div class="tlist">${pool.map(x => { const t = target(x.id); return `<button class="trow pick ${sel.has(x.id) ? 'sel' : ''}" data-act="gToggle" data-id="${x.id}">
          <span class="cbx">${sel.has(x.id) ? I.check : ''}</span><b class="num">${esc(t.no)}</b><span class="town">${esc(t.name)}</span><span class="h"></span><span class="st">${x.tag || ''}${esc(x.note)}</span></button>`; }).join('')}</div>`}`,
        { bar: bottomBar(`選んだ <b class="num">${W.pool.length}</b> / 必要 ${need}枚`, `<button class="btn" data-act="gBack">もどる</button><button class="btn primary" data-act="gNext" ${W.pool.length ? '' : 'disabled'}>次へ：割り当て案</button>`) });
    }
    if (!W.plan) {
      W.people = usersSorted(A.data.users.filter(u => ids.indexOf(u.id) >= 0)).map(u => ({ id: u.id, name: u.name, count: roomMode ? W.perRooms : W.per, mode: u.mode, near: u.near }));
      W.chunks = {};
      if (roomMode) {
        const sel = new Set(W.bsel || []);
        const r = spreadRooms(W.people, roomCands().filter(c => sel.has(c.b.id) && !c.taken), W.perB);
        W.plan = r.plan; W.chunks = r.chunks;
      } else W.plan = makePlan(W.people, W.pool);
    }
    const n = Object.keys(W.plan).reduce((s, k) => s + sumOf(W.plan[k]), 0);
    return shell('集まりで割り振る', `${head}
      <label class="lbl" for="g-name">集まりの名前</label><input id="g-name" class="sel" value="${esc(W.gname + rName(W.gkind))}" autocomplete="off">
      ${planView()}`, { bar: bottomBar(`${n}${roomMode ? '部屋' : '枚'}を割り振ります`, `<button class="btn" data-act="gBack">もどる</button><button class="btn primary" data-act="gGo" ${n ? '' : 'disabled'}>割り振る</button>`) });
  };
  /** 集まりの候補を地図で見る（不在宅訪問は区域、回り方は場所のある建物） */
  function gatherMap(pool, sel) {
    const ids = pool.map(x => x.id);
    const out = outMap();
    if (isBKind(W.gkind)) {
      const bs = (A.data.buildings || []).filter(b => ids.indexOf(b.id) >= 0);
      const noPlace = bs.filter(b => b.lat === null || b.lat === undefined).length;
      return poolMap('gpool-' + W.gkind, ids, sel, out, {}, 'gToggle', { buildings: bs, legend: [[TC.old, '候補の建物']] }) +
        (noPlace ? `<p class="muted small">地図の場所がない建物（${noPlace}棟）は「一覧で選ぶ」から選んでください。</p>` : '');
    }
    const n = {};
    pool.forEach(x => { n[x.id] = x.n; });
    return poolMap('gpool-absent', ids, sel, out, {}, 'gToggle', {
      legend: [[TC.old, '回る家が多い（10軒以上）'], [TC.mid, '5〜9軒'], [TC.recent, '4軒まで']],
      candStyle: id => (n[id] >= 10 ? TC.old : n[id] >= 5 ? TC.mid : TC.recent),
    });
  }
  act.gKind = el => { W.gkind = el.dataset.k; W.mode = modeOf(el.dataset.k); W.perRooms = (K.route(el.dataset.k) || {}).per || 5; W.perB = perBOf(el.dataset.k); W.pool = null; W.rs = null; W.bsel = null; W.plan = null; U.render(); };
  act.gMode = el => { W.mode = el.dataset.m; W.pool = null; W.rs = null; W.bsel = null; W.plan = null; U.render(); };
  act.gPick = el => { W.present[el.dataset.id] = !W.present[el.dataset.id]; W.pool = null; U.render(); };
  act.gAll = () => { const q = W.q.trim(); A.data.users.filter(u => u.active && (!q || (u.name + u.kana).indexOf(q) >= 0)).forEach(u => { W.present[u.id] = true; }); W.pool = null; U.render(); };
  act.gNone = () => { W.present = {}; W.pool = null; U.render(); };
  act.gToggle = el => { const id = el.dataset.id; W.pool = W.pool.indexOf(id) >= 0 ? W.pool.filter(x => x !== id) : W.pool.concat([id]); W.plan = null; U.render(); };
  act.gBsel = el => { const id = el.dataset.id; W.bsel = W.bsel.indexOf(id) >= 0 ? W.bsel.filter(x => x !== id) : W.bsel.concat([id]); W.plan = null; U.render(); };
  act.gRooms = () => { W.rs = null; W.rsErr = null; U.render(); };
  act.gNext = () => { W.step++; if (W.step === 3) { W.rs = null; W.rsErr = null; W.bsel = null; } if (W.step === 4) { W.plan = null; W.sel = null; } U.render(); window.scrollTo(0, 0); };
  act.gBack = () => { W.step = Math.max(1, W.step - 1); W.plan = null; W.sel = null; U.render(); };
  act.gGo = async el => {
    if (!sure(el, 'もう一度押すと割り振ります')) return;
    el.disabled = true;
    const name = (document.getElementById('g-name') || {}).value || rName(W.gkind);
    const items = [];
    Object.keys(W.plan).forEach(uid => {
      const byB = {};   // 移したりして、同じ人に同じ建物の部屋が2つに分かれていたら1つにまとめる
      W.plan[uid].forEach(id => {
        const c = chunkOf(id);
        if (!c) { items.push({ targetId: id, no: target(id).no, kind: W.gkind, userId: uid }); return; }
        if (byB[c.bid]) { byB[c.bid].rooms = byB[c.bid].rooms.concat(c.rooms); return; }
        items.push(byB[c.bid] = { targetId: c.bid, no: c.no, kind: W.gkind, userId: uid, rooms: c.rooms.slice() });
      });
    });
    try {
      W.result = await api('distribute', { items: items, gathering: { kind: W.gkind, name: name } });
      await load();
      K.refresh().catch(() => {});
    } catch (e) { el.disabled = false; return; }
    U.render(); window.scrollTo(0, 0);
  };
  /*
   * 検索の欄。打つたびに画面を描き直して絞り込む。
   * ただし日本語の変換中（ぜにばこ → 銭函）は描き直さない。変換中に描き直すと、変換中の文字と決めた文字が二重に入る
   */
  const S = { 'h-q': '', 'o-q': '', 's-q': '', 'b-q': '', 'p-q': '', 'r-q': '', 'm-q': '', 'c-q': '' };
  const isSearch = el => !!el && (el.id === 'g-q' || Object.prototype.hasOwnProperty.call(S, el.id));
  let composing = false;
  function searchInput(el) {
    const id = el.id;
    const cur = document.getElementById(id) || el;
    const v = cur.value;
    if (id === 'g-q') { if (W.q === v) return; W.q = v; } else { if (S[id] === v) return; S[id] = v; }
    const pos = cur.selectionStart;
    U.render();
    const n = document.getElementById(id);
    if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* なくてもよい */ } }
  }
  document.addEventListener('compositionstart', e => { if (isSearch(e.target)) composing = true; });
  document.addEventListener('compositionend', e => {
    if (!isSearch(e.target)) return;
    composing = false;
    const el = e.target;
    setTimeout(() => searchInput(el), 0);
  });
  document.addEventListener('input', e => {
    if (!isSearch(e.target) || e.isComposing || composing) return;
    searchInput(e.target);
  });

  /* ==================== グループに預ける ==================== */
  const HG = { group: '', pick: [] };
  views.aHold = async function () {
    if (!A.data) await load();
    const d = A.data;
    if (!HG.group) HG.group = (d.groups[0] || {}).id || '';
    const out = outMap();
    const lr = d.lastReturned || {};
    const holds = d.dists.filter(x => x.kind === '手持ち' && x.groupId === HG.group);
    const q = S['h-q'].trim().toLowerCase();
    let cands = K.geo.list.filter(t => !out[t.id] && t.houses > 0);
    if (q) cands = cands.filter(t => (t.no + ' ' + t.town).toLowerCase().indexOf(q) >= 0 || t.no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0);
    cands.sort((a, b) => (tierOf(a.id) - tierOf(b.id)) || ((lr[a.id] || '') < (lr[b.id] || '') ? -1 : (lr[a.id] || '') > (lr[b.id] || '') ? 1 : a.i - b.i));
    const sel = new Set(HG.pick);
    const gname = groupName(HG.group);
    shell('グループに預ける', `
      <p class="muted small">全員への配布で残った区域から、グループの責任者・副責任者に預けます。預けた区域は、責任者がメンバーに配ります。</p>
      <div class="seg wrap">${d.groups.map(g => { const n = d.dists.filter(x => x.kind === '手持ち' && x.groupId === g.id).length; return `<button data-act="hgGroup" data-g="${g.id}" aria-pressed="${HG.group === g.id}">${esc(g.name)}${n ? `<small>${n}</small>` : ''}</button>`; }).join('')}</div>
      ${holds.length ? `<h3 class="ghead">${esc(gname)}の手持ち（${holds.length}枚）</h3><div class="tlist">${holds.map(x => `<div class="trow static"><b class="num">${esc(x.no)}</b><span class="town">${esc(target(x.territoryId).name)}</span><span class="h"></span>
        <span class="st">${H.mdShort(x.distributedAt)} 預けた <button class="link" data-act="hgBack" data-id="${esc(x.distId)}">戻す</button></span></div>`).join('')}</div>` : ''}
      <h3 class="ghead">預ける区域を選ぶ</h3>
      ${viewSeg('hold')}
      ${MV.hold === 'map' ? poolMap('hold', K.geo.list.filter(t => !out[t.id] && t.houses > 0).map(t => t.id), sel, out, lr, 'hgPick') : `<input id="h-q" class="sel" type="search" placeholder="番号か町名で探す（例：Z06、桂岡）" value="${esc(S['h-q'])}" autocomplete="off">
      <div class="tlist">${cands.slice(0, 80).map(t => `<button class="trow pick ${sel.has(t.id) ? 'sel' : ''}" data-act="hgPick" data-id="${t.id}">
        <span class="cbx">${sel.has(t.id) ? I.check : ''}</span><b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h num">${t.houses}軒</span>
        <span class="st">${lr[t.id] ? '前回の返却 ' + H.mdShort(lr[t.id]) : 'まだ配っていません'}</span></button>`).join('')}</div>`}`,
      { bar: HG.pick.length ? bottomBar(`<b class="num">${HG.pick.length}</b>区域を <b>${esc(gname)}</b> に預けます`, `<button class="btn primary" data-act="hgGo">預ける</button>`) : '' });
  };
  act.hgGroup = el => { HG.group = el.dataset.g; U.render(); };
  act.hgPick = el => { const id = el.dataset.id; HG.pick = HG.pick.indexOf(id) >= 0 ? HG.pick.filter(x => x !== id) : HG.pick.concat([id]); U.render(); };
  act.hgGo = async el => {
    el.disabled = true;
    try {
      const r = await api('distribute', { items: HG.pick.map(id => ({ targetId: id, no: target(id).no, kind: '手持ち', groupId: HG.group })) });
      toast(r.results.filter(x => x.ok).length + '区域を預けました');
      HG.pick = [];
      await load();
    } catch (e) { /* api が知らせる */ }
    U.render();
  };
  act.hgBack = async el => {
    if (!sure(el, 'もう一度押すと戻す')) return;
    try { await api('returnCards', { distIds: [el.dataset.id] }); toast('手持ちから戻しました'); await load(); } catch (e) { /* api が知らせる */ }
    U.render();
  };

  /* ==================== 手持ちを配る（責任者・副責任者） ==================== */
  const HD = { group: '' };
  views.aHand = async function () {
    if (!A.data) await load();
    const d = A.data;
    if (!HD.group) HD.group = top() ? ((d.groups[0] || {}).id || '') : d.me.groupId;
    const holds = d.dists.filter(x => x.kind === '手持ち' && x.groupId === HD.group && !x.other);
    shell('手持ちを配る', `
      ${top() ? `<div class="seg wrap">${d.groups.map(g => { const n = d.dists.filter(x => x.kind === '手持ち' && x.groupId === g.id).length; return `<button data-act="hdGroup" data-g="${g.id}" aria-pressed="${HD.group === g.id}">${esc(g.name)}${n ? `<small>${n}</small>` : ''}</button>`; }).join('')}</div>` : ''}
      <p class="muted small">${esc(groupName(HD.group))}が預かっている区域です。区域の「配る」を押して、メンバーを選びます。回収日は${esc(H.md(defaultDue()))}、完全回収日はその${forcedDays()}日後になります${top() ? '（「配布中と回収」で変えられます）' : ''}。</p>
      ${holds.length ? viewSeg('hand', '地図で見て配る') : ''}
      ${holds.length && MV.hand === 'map' ? handMap(holds) : holds.length ? `<div class="tlist">${holds.map(x => { const t = target(x.territoryId); return `<div class="trow static"><b class="num">${esc(x.no)}</b><span class="town">${esc(t.name)}</span><span class="h num">${t.size}${t.unit}</span>
        <span class="st">${H.mdShort(x.distributedAt)} に預かった<button class="btn sm primary" data-act="hdOpen" data-id="${esc(x.distId)}">配る</button></span></div>`; }).join('')}</div>` : '<p class="empty">今、預かっている区域はありません。</p>'}`);
  };
  /** 手持ちを地図で見て配る：預かっている区域（緑）と、メンバーが今持っている区域（オレンジ・名前つき） */
  function handMap(holds) {
    const d = A.data;
    const hold = {};
    holds.forEach(x => { hold[x.territoryId] = x; });
    const member = {};
    d.dists.filter(x => !x.other && x.kind !== '手持ち' && x.groupId === HD.group && x.userId).forEach(x => { member[x.territoryId] = x; });
    const sur = n => esc(String(n || '').split(/\s/)[0]);
    return `${legend([[TC.old, '預かっている区域（さわると配る）'], [TC.held, 'メンバーが今持っている']])}
      ${mapSlot('hand-' + HD.group, {
        style: id => (hold[id] ? TC.old : member[id] ? TC.held : TC.other),
        label: id => (hold[id] ? tLabel(id) : member[id] ? esc(K.geo.terr[id] ? K.geo.terr[id].no : '') + '<small>' + sur(member[id].name) + '</small>' : null),
        always: id => !!hold[id],
        onTap: id => { if (hold[id]) act.hdOpen({ dataset: { id: hold[id].distId } }); else if (member[id]) toast(K.geo.terr[id].no + ' は' + member[id].name + 'さんが持っています'); },
        fit: Object.keys(hold),
      })}
      <p class="muted small">預かっている区域をさわると、配る人を選べます。メンバーが今持っている区域の近くを渡すと、回りやすくなります。</p>`;
  }
  act.hdGroup = el => { HD.group = el.dataset.g; U.render(); };
  act.hdOpen = el => {
    const d = A.data;
    const hold = d.dists.find(x => x.distId === el.dataset.id);
    if (!hold) return;
    const members = usersSorted(d.users.filter(u => u.active && u.groupId === hold.groupId));
    U.openSheet(U.sheetTitle(esc(hold.no) + ' <small>を配る</small>'), `<p class="muted">だれに配りますか。</p>
      <div class="ulist">${members.map(u => `<button class="urow pick" data-act="hdGive" data-hold="${esc(hold.distId)}" data-u="${u.id}"><span class="uname"><b>${esc(u.name)}</b><small>今 ${u.cards}枚</small></span>${I.chev}</button>`).join('')}</div>`);
  };
  act.hdGive = async el => {
    if (el.dataset.sure !== '1') {
      document.querySelectorAll('[data-act="hdGive"].sure').forEach(x => { x.classList.remove('sure'); x.dataset.sure = ''; });
      el.dataset.sure = '1'; el.classList.add('sure');
      const sm = el.querySelector('small'); if (sm) sm.textContent = 'もう一度押すと配ります';
      return;
    }
    el.disabled = true;
    try {
      const r = await api('distribute', { items: [{ fromDistId: el.dataset.hold, userId: el.dataset.u }] });
      const x = r.results[0];
      if (x.ok) toast(x.dist.no + ' を ' + x.dist.name + 'さんに配りました'); else toast(x.message);
      U.closeSheet();
      await load();
      if (el.dataset.u === (K.state.me && K.state.me.user && K.state.me.user.id)) K.refresh().catch(() => {});
    } catch (e) { el.disabled = false; return; }
    U.render();
  };

  /* ==================== 1枚ずつ配る ==================== */
  /*
   * 戸建ての区域は1枚ずつ（ON.pick）。集合住宅は、いくつもの建物から選べる（ON.bk）：
   *   ON.bk = { 建物ID: {whole: true}（一棟まとめて） | {rooms: [部屋ID], nos: [部屋番号]} }
   *   マンション訪問では、1人に、いくつかの建物から少しずつ（2部屋ずつなど）渡すことが多いため
   */
  const ON = { userId: '', kind: '通常', q: '', pick: '', bk: {}, rp: '', rooms: [], rs: null, pFrom: '', pTo: '', pRet: false, pOpen: false };
  const bkIds = () => Object.keys(ON.bk);
  const bkSize = id => (ON.bk[id].whole ? target(id).size : ON.bk[id].rooms.length);
  const bkRooms = () => bkIds().reduce((n, id) => n + bkSize(id), 0);
  function bkWhat(id) {
    const x = ON.bk[id];
    return x.whole ? '一棟まとめて・' + target(id).size + '部屋' : x.nos.join('・');
  }
  views.aOne = async function () {
    if (!A.data) await load();
    if (view().fresh || !DT.due) {
      datesReset();
      const pre = view().pick;   // 集合住宅の画面の「この建物を渡す」から
      if (pre) { ON.kind = pre.kind; ON.pick = ''; ON.bk = {}; ON.bk[pre.id] = { whole: true }; view().pick = null; }
      view().fresh = false;
      if ((aptOnly() && !isBKind(ON.kind)) || (isBKind(ON.kind) && !(K.route(ON.kind) || {}).active)) { ON.kind = firstRoute('部屋ごと'); ON.pick = ''; ON.bk = {}; }
    }
    const d = A.data;
    const out = outMap();
    const lr = d.lastReturned || {};
    const cy = d.cycles || {};
    const isB = isBKind(ON.kind);
    const q = S['o-q'].trim().toLowerCase();
    let list = isB ? (d.buildings || []).map(b => target(b.id)) : K.geo.list.filter(t => !t.off).map(t => target(t.id));
    if (q) list = list.filter(t => (t.no + ' ' + t.name).toLowerCase().indexOf(q) >= 0 || t.no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0);
    // 集合住宅：ほかの人が部屋を持っている建物は選べない（同じ建物に入るのは1人だけ）。配る人が持っている建物には部屋を足せる
    const blocked = id => { const o = out[id]; return !!o && !(isB && o.partial && o.uids.every(x => x === ON.userId)); };
    list.sort((a, b) => ((blocked(a.id) ? 1 : 0) - (blocked(b.id) ? 1 : 0)) || (tierOf(a.id) - tierOf(b.id)) || ((lr[a.id] || '') < (lr[b.id] || '') ? -1 : (lr[a.id] || '') > (lr[b.id] || '') ? 1 : a.order - b.order));
    const u = d.users.find(x => x.id === ON.userId);
    const t = !isB && ON.pick ? target(ON.pick) : null;
    const ids = isB ? bkIds() : [];
    const allWhole = ids.length && ids.every(id => ON.bk[id].whole);
    const roomRoute = isB && !wholeRoute(ON.kind);
    const r0 = K.route(ON.kind) || {};
    const opts = usersSorted(d.users.filter(x => x.active));
    const kinds = ['通常', '不在宅訪問'].concat(activeRoutes().map(r => r.id)).filter(k => !aptOnly() || isBKind(k));
    let lastG = null;
    const what = isB ? (ids.length === 1 ? `<b class="num">${esc(target(ids[0]).no)}</b>${ON.bk[ids[0]].whole ? '（一棟まとめて・' + target(ids[0]).size + '部屋）' : ' の ' + bkSize(ids[0]) + '部屋'}`
      : ids.length ? `<b class="num">${ids.length}</b>棟・<b class="num">${bkRooms()}</b>部屋` : '')
      : t ? `<b class="num">${esc(t.no)}</b>` : '';
    const ready = u && (isB ? ids.length : t);
    const picked = !!what;
    const basket = isB && ids.length ? `<div class="bk-box">
        <p class="bk-head"><b>選んだ集合住宅</b><span class="num">${ids.length}棟・${bkRooms()}部屋</span></p>
        <ul class="bk-list">${ids.map(id => { const x = target(id); return `<li><span class="bk-main"><b class="num">${esc(x.no)}</b> ${esc(x.name)}<small>${esc(bkWhat(id))}</small></span>
          <button class="btn sm" data-act="oBkRooms" data-id="${esc(id)}">${ON.bk[id].whole ? '部屋を選ぶ' : '部屋を直す'}</button><button class="btn sm ghost" data-act="oBkDel" data-id="${esc(id)}">外す</button></li>`; }).join('')}</ul>
      </div>` : '';
    shell('1枚ずつ配る', `
      <label class="lbl" for="o-user">1．配る人</label>
      <select id="o-user" class="sel"><option value="">選んでください</option>${opts.map(x => { const og = x.groupId !== lastG ? (lastG !== null ? '</optgroup>' : '') + `<optgroup label="${esc(groupName(x.groupId))}">` : ''; lastG = x.groupId; return og + `<option value="${x.id}" ${ON.userId === x.id ? 'selected' : ''}>${esc(x.name)}（${x.cards}枚）</option>`; }).join('')}</optgroup></select>
      <div class="lbl">2．種類</div>
      <div class="seg wrap">${kinds.map(k => `<button data-act="oKind" data-k="${esc(k)}" aria-pressed="${ON.kind === k}">${k === '通常' ? 'ふつうの配布' : esc(K.kindLabel(k))}</button>`).join('')}</div>
      ${pastBox()}
      ${ON.pRet ? '' : '<div class="lbl">3．回収日</div>' + datesBox('dt', DT)}
      <label class="lbl" for="o-q">4．${isB ? (wholeRoute(ON.kind) ? '集合住宅（さわると一棟まとめて選びます。何棟でも選べます。部屋だけ渡すときは「部屋を選ぶ」）' : '集合住宅（さわると部屋を選べます。いくつかの建物から少しずつ選べます）') : '区域'}</label>
      ${roomRoute ? `<div class="bk-auto"><button class="btn" data-act="oAuto">${I.check}<span>おまかせで${r0.per || 5}部屋を選ぶ</span></button><span class="muted small">巡回の途中の建物と、長く回っていない建物から、1つの建物から${perBOf(r0)}部屋まで選びます。ほかの人が部屋を持っている建物は選びません。あとから直せます。</span></div>` : ''}
      ${basket}
      ${viewSeg('one')}
      ${MV.one === 'map' ? oneMap(isB, out, lr, blocked) : `<input id="o-q" class="sel" type="search" placeholder="番号か名前で探す" value="${esc(S['o-q'])}" autocomplete="off">
      <div class="tlist">${list.slice(0, 60).map(x => { const o = out[x.id]; const bl = blocked(x.id); const on = isB ? !!ON.bk[x.id] : ON.pick === x.id; return `<button class="trow ${bl ? 'out' : ''} ${on ? 'sel' : ''}" data-act="oPick" data-id="${x.id}" ${bl ? 'disabled' : ''}>
        <b class="num">${esc(x.no)}</b><span class="town">${esc(x.name)}</span><span class="h num">${x.size}${x.unit}</span>
        <span class="st">${o ? (o.partial ? (bl ? esc(o.names.join('・')) + 'さんが部屋を持っています（同じ建物は1人だけ）' : 'この人が' + o.rooms + '部屋持っています') : '配布中・' + esc(o.name)) : planTag(x.id) + (isB && cy[x.id] ? esc(roundText(cy[x.id])) : lr[x.id] ? '前回の返却 ' + H.mdShort(lr[x.id]) : 'まだ配っていません')}${on && isB ? '・' + (ON.bk[x.id].whole ? '一棟まとめて' : ON.bk[x.id].rooms.length + '部屋を選んでいます') : ''}</span></button>`; }).join('')}</div>`}`,
      { bar: u && picked ? bottomBar(`${what} を <b>${esc(u.name)}</b>さんに${ON.kind === '通常' ? '' : '（' + esc(K.kindLabel(ON.kind)) + '）'}<small>今 ${u.cards}枚</small>`, `<button class="btn primary" data-act="oGo" ${ready ? '' : 'disabled'}>${isB && allWhole ? '一棟まとめて渡す' : '配る'}</button>`) : u || !picked ? '' : bottomBar(`${what}`, '<span class="muted small">「1．配る人」を選んでください</span>') });
    const sel = document.getElementById('o-user');
    if (sel) sel.addEventListener('change', () => { ON.userId = sel.value; U.render(); });
    if (ON.scrollMap) { ON.scrollMap = false; const v = document.querySelector('.vseg'); if (v) setTimeout(() => v.scrollIntoView({ block: 'start' }), 80); }
  };
  /** 台帳から入れる（0.11.0）：配った日を前の日にする・もう返ってきた配布として入れる */
  function pastBox() {
    const today = H.todayStr();
    const on = !!(ON.pFrom && ON.pFrom !== today) || ON.pRet;
    return `<details class="past-box" ${ON.pOpen || on ? 'open' : ''}><summary data-act="oPastToggle">${on ? '<b>台帳から入れる：' + esc(H.md(ON.pFrom || today)) + 'に配った' + (ON.pRet ? '・' + esc(H.md(ON.pTo || today)) + 'に返った' : '') + '</b>' : '台帳から入れる（配った日を前の日にする・もう返った分）'}</summary>
      <div class="dates"><label>配った日<input type="date" id="o-pfrom" value="${esc(ON.pFrom || today)}" max="${esc(today)}"></label>
        <label class="chk"><input type="checkbox" id="o-pret" ${ON.pRet ? 'checked' : ''}> もう返ってきた</label>
        ${ON.pRet ? `<label>返した日<input type="date" id="o-pto" value="${esc(ON.pTo || today)}" min="${esc(ON.pFrom || today)}" max="${esc(today)}"></label>` : ''}</div>
      <p class="muted small">紙の台帳に書いた配布を、あとから入れるときに使います。ほかの人が持っていた期間と重なる日は入れられません。もう返ってきた配布は、持っている枚数には数えません（回った月と S-13 に入ります）。</p></details>`;
  }
  act.oPastToggle = el => { const d = el.closest('details'); ON.pOpen = !(d && d.open); if (d) d.open = ON.pOpen; };
  document.addEventListener('change', e => {
    const id = e.target && e.target.id;
    if (id === 'o-pfrom') { ON.pFrom = e.target.value; if (ON.pTo && ON.pTo < ON.pFrom) ON.pTo = ON.pFrom; U.render(); }
    else if (id === 'o-pto') { ON.pTo = e.target.value; U.render(); }
    else if (id === 'o-pret') { ON.pRet = e.target.checked; ON.pOpen = true; if (ON.pRet && !ON.pTo) ON.pTo = H.todayStr(); U.render(); }
  });
  /** 1枚ずつ配る：地図で見て選ぶ。配る人が今持っている区域も出すので、近くの区域を選べる */
  function oneMap(isB, out, lr, blocked) {
    const d = A.data;
    const held = new Set(d.dists.filter(x => x.userId && x.userId === ON.userId && !x.other).map(x => x.territoryId));
    const who = ON.userId ? (d.users.find(x => x.id === ON.userId) || {}).name : '';
    if (isB) {
      const bs = (d.buildings || []).filter(b => routesOf(b).indexOf(ON.kind) >= 0 || held.has(b.id) || ON.bk[b.id]);
      const noPlace = bs.filter(b => b.lat === null || b.lat === undefined).length;
      return `${legend([[TC.sel, '選んだ建物'], [TC.held, (who ? who + 'さんが' : '') + '今持っている'], [TC.old, '配れる建物'], [TC.out, '配布中']])}
        ${mapSlot('one-b-' + ON.kind, {
          style: () => TC.other, label: null, onTap: null, labelZoom: 99,
          buildings: bs.map(b => ({ id: b.id, lat: b.lat, lon: b.lon, html: '<i>' + esc(b.no) + '</i>',
            cls: ON.bk[b.id] ? 'sel' : held.has(b.id) ? 'held' : blocked(b.id) ? 'out' : 'free' })),
          onTapB: id => { if (blocked(id)) { toast(target(id).no + ' は' + (out[id].partial ? out[id].names.join('・') + 'さんが部屋を持っています（同じ建物は1人だけ）' : '配布中です（' + (out[id].name || '') + '）')); return; } act.oPick({ dataset: { id: id } }); },
          fit: bs.map(b => b.id),
        })}
        <p class="muted small">建物の印をさわって選びます。いくつもの建物から選べます。${noPlace ? '地図の場所がない建物（' + noPlace + '棟）は「一覧で選ぶ」から選んでください。' : ''}</p>`;
    }
    return `${legend([[TC.sel, '選んだ区域'], [TC.held, (who ? who + 'さんが' : '配る人が') + '今持っている']].concat(AGE_LEGEND))}
      ${mapSlot('one-t-' + ON.userId, {
        style: id => (id === ON.pick ? TC.sel : held.has(id) ? TC.held : out[id] ? TC.out : K.geo.terr[id].houses > 0 ? K.terrMap.ageStyle(lr[id]) : TC.other),
        label: tLabel,
        onTap: id => { if (out[id] && !held.has(id)) { toast(K.geo.terr[id].no + ' は配布中です（' + (out[id].name || '') + '）'); return; } if (held.has(id)) { toast(K.geo.terr[id].no + ' は' + (who || 'この人') + 'さんが持っています'); return; } act.oPick({ dataset: { id: id } }); },
        fit: held.size ? Array.from(held) : null,
      })}
      <p class="muted small">区域をさわって選びます。${who ? who + 'さんが今持っている区域（オレンジ）の近くから選べます。' : '先に「1．配る人」を選ぶと、その人が今持っている区域がオレンジで出ます。'}</p>`;
  }
  act.oKind = el => { ON.kind = el.dataset.k; ON.pick = ''; ON.bk = {}; U.render(); };
  act.oPick = el => {
    const id = el.dataset.id;
    if (!ON.userId) toast('先に「配る人」を選んでください');
    if (!isBKind(ON.kind)) { ON.pick = ON.pick === id ? '' : id; U.render(); return; }
    // 一棟まとめての回り方は、さわるだけで建物まるごと（もう一度さわると外す）。部屋ごとの回り方・一部を配布中の建物は、部屋を選ぶ
    if (wholeRoute(ON.kind) && !outMap()[id]) {
      if (ON.bk[id]) delete ON.bk[id]; else ON.bk[id] = { whole: true };
      U.render();
      return;
    }
    openRoomPicker(id);
  };
  act.oBkRooms = el => openRoomPicker(el.dataset.id);
  act.oBkDel = el => { delete ON.bk[el.dataset.id]; U.render(); };
  /** 建物の部屋を選ぶ（今だれが持っているか・拒否・最後の記録つき） */
  function openRoomPicker(id) {
    const t = target(id);
    ON.rp = id;
    ON.rooms = ON.bk[id] && !ON.bk[id].whole ? ON.bk[id].rooms.slice() : [];
    U.openSheet(U.sheetTitle(esc(t.no) + ' <small>' + esc(t.name) + '</small>'), '<p class="muted">部屋の様子を読んでいます…</p>');
    api('roomStatus', { ids: [id], route: ON.kind }).then(r => { ON.rs = r; renderRoomPicker(); }).catch(() => U.closeSheet());
  }
  function renderRoomPicker() {
    const b = ON.rs && ON.rs.buildings[0];
    if (!b || b.id !== ON.rp) return;
    const recent = x => !!x.done;   // 今の巡回でもう回った部屋
    const sel = new Set(ON.rooms);
    const partial = b.rooms.some(x => x.out);
    const ents = {};
    b.rooms.forEach(x => { const e = ents[x.entrance || ''] = ents[x.entrance || ''] || {}; (e[x.floor] = e[x.floor] || []).push(x); });
    const entKeys = Object.keys(ents).sort((a, c) => (Number(a) || 0) - (Number(c) || 0));
    const free = b.rooms.filter(x => !x.out && !x.refused);
    const fresh = free.filter(x => !recent(x));
    const grid = entKeys.map(ek => `<section class="ent">${entKeys.length > 1 ? `<h3>入口${esc(ek)}</h3>` : ''}<div class="grid">${Object.keys(ents[ek]).map(Number).sort((a, c) => c - a).map(f => `<div class="floor"><span class="fl num">${f}階</span><div class="cells">${ents[ek][f].map(x => {
      const dis = !!x.out || x.refused;
      const mark = x.out ? esc(String(x.out.name).slice(0, 2)) : x.refused ? '拒' : recent(x) ? '済' : x.last && x.last.res === '不在' ? '不' : '';
      return `<button class="cell pk ${sel.has(x.id) ? 'on' : ''} ${x.out ? 'taken' : ''} ${x.refused ? 'ref' : ''} ${recent(x) ? 'recent' : ''}" data-act="oRoom" data-room="${esc(x.id)}" ${dis ? 'disabled' : ''}><b class="num">${esc(x.no)}</b><span class="mk">${mark}</span></button>`;
    }).join('')}</div></div>`).join('')}</div></section>`).join('');
    const sh = document.querySelector('.sheet');
    if (!sh) return;
    const k = ON.rs.roomsPerBuilding || perBOf(ON.kind);
    const others = bkIds().filter(id => id !== b.id);
    const otherN = others.reduce((n, id) => n + bkSize(id), 0);
    sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + U.sheetTitle(esc(b.no) + ' <small>' + esc(b.name) + '</small>') + `
      ${b.round ? `<p class="small bk-note"><b>${esc(roundText(b.round))}</b></p>` : ''}
      <p class="muted small">さわって部屋を選びます。いくつかの建物から少しずつ選べます（この回り方は、1つの建物から${k}部屋まで・1人に${ON.rs.roomsPer || 5}部屋が目安）。印：名前＝だれかが持っている、拒＝拒否、済＝今の巡回でもう回った、不＝前回は不在。</p>
      ${others.length ? `<p class="small bk-note">ほかに選んでいる建物：${others.map(id => esc(target(id).no) + '（' + bkSize(id) + '部屋）').join('、')}。合わせて${otherN}部屋</p>` : ''}
      <div class="row"><button class="btn sm" data-act="oRoomsNext" data-n="${k}">まだの部屋から${k}部屋</button><button class="btn sm" data-act="oRoomsClear">選ぶのをやめる</button></div>
      <div class="rooms rpick">${grid}</div>
      <p class="small">選んだ部屋：<b class="num">${ON.rooms.length}</b>${ON.rooms.length ? '（' + esc(b.rooms.filter(x => sel.has(x.id)).map(x => x.no).join('・')) + '）' : ''}</p>
      <div class="row2"><button class="btn big" data-act="oWhole" ${partial ? 'disabled' : ''}>${partial ? '一部を配布中のため一棟まとめては不可' : '一棟まとめて（全部の部屋）'}</button><button class="btn primary big" data-act="oRoomsDone" ${ON.rooms.length || ON.bk[b.id] ? '' : 'disabled'}>${ON.rooms.length ? 'この' + ON.rooms.length + '部屋にする' : ON.bk[b.id] ? 'この建物を外す' : '部屋を選んでください'}</button></div>
      <p class="muted small">空いている部屋 ${free.length}・そのうち今の巡回でまだ回っていない部屋 ${fresh.length}</p>`;
    ON.fresh = fresh.map(x => x.id);
  }
  act.oRoom = el => { const id = el.dataset.room; ON.rooms = ON.rooms.indexOf(id) >= 0 ? ON.rooms.filter(x => x !== id) : ON.rooms.concat([id]); renderRoomPicker(); };
  act.oRoomsNext = el => { ON.rooms = (ON.fresh || []).slice(0, Number(el.dataset.n) || 2); renderRoomPicker(); };
  act.oRoomsClear = () => { ON.rooms = []; renderRoomPicker(); };
  act.oWhole = () => { ON.bk[ON.rp] = { whole: true }; U.closeSheet(); U.render(); };
  act.oRoomsDone = () => {
    const b = ON.rs && ON.rs.buildings[0];
    if (ON.rooms.length && b && b.id === ON.rp) {
      const want = new Set(ON.rooms);
      const rs = b.rooms.filter(x => want.has(x.id));   // 部屋の並び順にそろえる
      ON.bk[ON.rp] = { rooms: rs.map(x => x.id), nos: rs.map(x => x.no) };
    } else delete ON.bk[ON.rp];
    U.closeSheet(); U.render();
  };
  /** おまかせ：長く回っていない建物から、1つの建物から決めた部屋数までずつ、1人分（回り方の「1人の部屋数」）を選ぶ */
  act.oAuto = async el => {
    if (!ON.userId) { toast('先に「1．配る人」を選んでください'); return; }
    el.disabled = true;
    try {
      const rs = await api('roomStatus', { kind: ON.kind });
      const need = (rs.roomsPer || (K.route(ON.kind) || {}).per || 5) - bkRooms();
      if (need <= 0) { toast('もう' + bkRooms() + '部屋を選んでいます'); el.disabled = false; return; }
      const cands = roomCands(rs, ON.userId).filter(c => !c.taken && !c.cool && !ON.bk[c.b.id]);
      const r = spreadRooms([{ id: 'x', count: need }], cands, rs.roomsPerBuilding || perBOf(ON.kind));
      r.plan.x.forEach(cid => { const c = r.chunks[cid]; ON.bk[c.bid] = { rooms: c.rooms, nos: c.nos }; });
      if (!r.plan.x.length) toast('候補の部屋がありません（今の巡回でまだ回っていない・だれも持っていない・拒否でない部屋）');
    } catch (e) { el.disabled = false; return; }
    U.render();
  };
  act.oGo = async el => {
    el.disabled = true;
    const isB = isBKind(ON.kind);
    const base = id => ({ targetId: id, no: target(id).no, kind: ON.kind, userId: ON.userId });
    const items = isB ? bkIds().map(id => Object.assign(base(id), ON.bk[id].whole ? {} : { rooms: ON.bk[id].rooms })) : [base(ON.pick)];
    const today = H.todayStr();
    const past = (ON.pFrom && ON.pFrom !== today) || ON.pRet ? { from: ON.pFrom || today, returned: ON.pRet ? (ON.pTo || today) : '' } : null;
    try {
      const r = await api('distribute', Object.assign({ items: items }, past && past.returned ? {} : { dates: { due: DT.due, forced: DT.forced } }, past ? { past: past } : {}));
      const ok = r.results.filter(x => x.ok), ng = r.results.filter(x => !x.ok);
      if (!ok.length) { toast(ng.map(x => x.message).join('、')); el.disabled = false; return; }
      const desc = x => x.dist.no + (x.dist.roomNos && x.dist.roomNos.length ? ' の ' + x.dist.roomNos.join('・') : '');
      toast(ok.map(desc).join('、') + ' を ' + ok[0].dist.name + 'さんに' + (past ? H.md(past.from) + 'に配ったことにしました' + (past.returned ? '（' + H.md(past.returned) + 'に返却）' : '') : '配りました') + (ng.length ? '。配れなかったもの：' + ng.map(x => x.message).join('、') : ''));
      if (ON.userId === (K.state.me && K.state.me.user && K.state.me.user.id)) K.refresh().catch(() => {});
      r.results.forEach((x, i) => { if (x.ok && isB) delete ON.bk[items[i].targetId]; });
      ON.pick = '';
      await load();
    } catch (e) { el.disabled = false; return; }
    U.render();
  };

  /* ==================== 回った月（巡回の記録） ==================== */
  /*
   * 区域と集合住宅ごとに、何月に回ったか（返した月）。サイクルの管理と、S-13（割り当てた日付・完了した日付）の元になる。
   *   戸建ての区域：ふつうの配布を返した月に印。集合住宅：月ごとに回った部屋の数と、巡回（全部の部屋を一通り）の始めた日・終わった日
   */
  const CV = { tab: 'b', data: null, err: null, loading: false, sort: 'no' };
  const ymdJ = s => { const p = String(s || '').split('-'); return p.length === 3 ? p[0] + '/' + Number(p[1]) + '/' + Number(p[2]) : ''; };
  function cycleCell(r) {
    if (!r) return '';
    if (r.start) return '途中 ' + r.covered + '/' + r.required + '（' + H.mdShort(r.start) + '〜）';
    if (r.lastDone) return ymdJ(r.lastDone) + ' 完了';
    return 'まだ';
  }
  views.aCycle = async function () {
    if (!A.data) await load();
    if (view().fresh) { CV.data = null; CV.err = null; view().fresh = false; }
    if (aptOnly()) CV.tab = 'b';
    if (!CV.data) {
      if (!CV.loading && !CV.err) {
        CV.loading = true;
        api('coverage', { months: 12 }).then(r => { CV.data = r; }).catch(e => { CV.err = e; }).finally(() => { CV.loading = false; if (view().name === 'aCycle') U.render(); });
      }
      return shell('回った月', CV.err ? `<div class="notice">${esc(CV.err.message || '読めませんでした')}</div><button class="btn" data-act="cvReload">もう一度読む</button>` : '<p class="muted">読んでいます…</p>');
    }
    const d = CV.data;
    const months = d.months;
    const last = n => months.slice(-n);
    const q = S['c-q'].trim().toLowerCase();
    const hit = (no, name) => !q || (no + ' ' + name).toLowerCase().indexOf(q) >= 0 || no.replace('-', '').toLowerCase().indexOf(q.replace('-', '')) >= 0;
    const ymHead = months.map((ym, i) => { const p = ym.split('-'); return `<th>${i === 0 || p[1] === '01' ? '<small>' + p[0] + '</small>' : ''}${Number(p[1])}月</th>`; }).join('');
    let table = '', lead = '', sum = '';
    if (CV.tab === 'b') {
      const key = b => (b.round && b.round.start ? '0' + b.round.start : b.round && b.round.lastDone ? '2' + b.round.lastDone : '1');
      const list = d.buildings.filter(b => hit(b.no, b.name)).sort((a, b) => (CV.sort === 'old' ? (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) : 0) || (noKey(a.no) < noKey(b.no) ? -1 : 1));
      const rooms3 = d.buildings.reduce((n, b) => n + last(3).reduce((m, ym) => m + (b.months[ym] ? b.months[ym].rooms : 0), 0), 0);
      const all = d.buildings.reduce((n, b) => n + b.rooms, 0);
      const done3 = d.buildings.filter(b => b.rounds.some(r => last(3).indexOf(r.end.slice(0, 7)) >= 0)).length;
      sum = `<div class="cy-sum"><span><b class="num">${rooms3}</b><small>この3か月で回った部屋（全${all}部屋）</small></span><span><b class="num">${done3}</b><small>この3か月で巡回が終わった建物（全${d.buildings.length}棟）</small></span></div>`;
      lead = '数は、その月に回った部屋の数です（配った部屋を返した月）。「完」はその月に巡回（全部の部屋を一通り）が終わった印です。拒否の部屋は数えません。';
      table = `<table class="cy"><thead><tr><th class="no">建物</th>${ymHead}<th class="st">今の巡回</th></tr></thead><tbody>${list.map(b => {
        const ends = new Set(b.rounds.map(r => r.end.slice(0, 7)));
        return `<tr data-act="cvOpen" data-id="${esc(b.id)}"><th class="no"><b class="num">${esc(b.no)}</b><small>${esc(b.name)}</small></th>${months.map(ym => { const n = b.months[ym] ? b.months[ym].rooms : 0; const e = ends.has(ym); return `<td class="${n ? 'on' : ''}${e ? ' end' : ''}">${n ? '<b class="num">' + n + '</b>' : ''}${e ? '<i>完</i>' : ''}</td>`; }).join('')}<td class="st">${esc(cycleCell(b.round))}</td></tr>`;
      }).join('')}</tbody></table>`;
    } else {
      const by = {};
      d.terrs.forEach(t => { by[t.id] = t; });
      const key = t => { const x = by[t.id]; return x && x.out ? '3' : x && x.last ? '2' + x.last : '1'; };
      const list = K.geo.list.filter(t => t.houses > 0 && hit(t.no, t.town)).sort((a, b) => (CV.sort === 'old' ? (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) : 0) || a.i - b.i);
      const tot = K.geo.list.filter(t => t.houses > 0).length;
      const done4 = d.terrs.filter(t => last(4).some(ym => t.months[ym])).length;
      const outN = d.terrs.filter(t => t.out).length;
      sum = `<div class="cy-sum"><span><b class="num">${done4}</b><small>この4か月で回った区域（全${tot}区域）</small></span><span><b class="num">${outN}</b><small>今配っている区域</small></span></div>`;
      lead = '●は、その月に返した（回った）区域です。2回以上なら数を出します。不在宅訪問とグループの手持ちは数えません。';
      table = `<table class="cy"><thead><tr><th class="no">区域</th>${ymHead}<th class="st">今</th></tr></thead><tbody>${list.map(t => {
        const x = by[t.id] || { months: {} };
        return `<tr data-act="cvOpen" data-id="${esc(t.id)}"><th class="no"><b class="num">${esc(t.no)}</b><small>${esc(t.town)}</small></th>${months.map(ym => { const n = x.months[ym] || 0; return `<td class="${n ? 'on' : ''}">${n ? (n > 1 ? '<b class="num">' + n + '</b>' : '●') : ''}</td>`; }).join('')}<td class="st">${x.out ? '配布中' : x.last ? esc(ymdJ(x.last)) : 'まだ'}</td></tr>`;
      }).join('')}</tbody></table>`;
    }
    shell('回った月', `
      <p class="muted small">区域と建物ごとに、何月に回ったかを出します。返した日を「回った日」と数えます（S-13の「完了した日付」と同じ）。行をさわると、配った日・返した日の記録が出ます。</p>
      ${aptOnly() ? '' : `<div class="seg two"><button data-act="cvTab" data-v="b" aria-pressed="${CV.tab === 'b'}">集合住宅</button><button data-act="cvTab" data-v="t" aria-pressed="${CV.tab === 't'}">戸建ての区域</button></div>`}
      ${sum}
      <div class="row"><input id="c-q" class="sel" type="search" placeholder="番号か名前で探す" value="${esc(S['c-q'])}" autocomplete="off"></div>
      <div class="seg two"><button data-act="cvSort" data-v="no" aria-pressed="${CV.sort === 'no'}">番号の順</button><button data-act="cvSort" data-v="old" aria-pressed="${CV.sort === 'old'}">${CV.tab === 'b' ? '途中・長く回っていない順' : '長く回っていない順'}</button></div>
      <p class="muted small">${lead}</p>
      <div class="cy-wrap">${table}</div>`);
    // 表は新しい月が右。開いたときは右の端（今月）を出す
    const w = document.querySelector('.cy-wrap');
    if (w) w.scrollLeft = w.scrollWidth;
  };
  act.cvTab = el => { CV.tab = el.dataset.v; U.render(); };
  act.cvSort = el => { CV.sort = el.dataset.v; U.render(); };
  act.cvReload = () => { CV.err = null; CV.data = null; U.render(); };
  act.cvOpen = el => {
    const d = CV.data;
    const id = el.dataset.id;
    const b = d.buildings.find(x => x.id === id);
    if (b) {
      const r = b.round || {};
      const ms = Object.keys(b.months).sort().reverse();
      U.openSheet(U.sheetTitle(esc(b.no) + ' <small>' + esc(b.name) + '</small>'), `
        <p class="bk-note small"><b>${esc(roundText(r))}</b>${r.out ? '・今 ' + r.out + '部屋を配布中' : ''}</p>
        <h3 class="sub">巡回ごと</h3>
        <div class="cy-wrap"><table class="cy-hist"><thead><tr><th>巡回</th><th>始めた日</th><th>終わった日</th><th>部屋</th><th>回った人</th></tr></thead><tbody>
          ${r.start ? `<tr class="cur"><td>${r.n}回目（途中）</td><td>${esc(ymdJ(r.start))}</td><td>—</td><td class="num">${r.covered}/${r.required}</td><td></td></tr>` : ''}
          ${b.rounds.map(x => `<tr><td>${x.n}回目</td><td>${esc(ymdJ(x.start))}</td><td>${esc(ymdJ(x.end))}</td><td class="num">${x.rooms}</td><td>${esc(x.people.join('・'))}</td></tr>`).join('') || (r.start ? '' : '<tr><td colspan="5" class="muted">まだ回っていません</td></tr>')}
        </tbody></table></div>
        <p class="muted small">始めた日＝その巡回で最初に配った日、終わった日＝全部の部屋（拒否をのぞく）を回し終えた返却の日。S-13の「割り当てた日付」「完了した日付」になります。</p>
        ${ms.length ? `<h3 class="sub">月ごと（この12か月）</h3><ul class="cy-months">${ms.map(ym => `<li><b>${Number(ym.slice(5))}月</b>${ym.slice(0, 4) !== d.months[d.months.length - 1].slice(0, 4) ? '<small>' + ym.slice(0, 4) + '</small>' : ''}　${b.months[ym].rooms}部屋<span class="muted small">　${esc(b.months[ym].people.join('・'))}</span></li>`).join('')}</ul>` : ''}`);
      return;
    }
    const t = K.geo.terr[id];
    if (!t) return;
    const x = d.terrs.find(y => y.id === id) || { hist: [] };
    U.openSheet(U.sheetTitle(esc(t.no) + ' <small>' + esc(t.town) + '</small>'), `
      <div class="cy-wrap"><table class="cy-hist"><thead><tr><th>伝道者</th><th>割り当てた日付</th><th>完了した日付</th></tr></thead><tbody>
        ${x.out ? `<tr class="cur"><td>${esc(x.out.name)}</td><td>${esc(ymdJ(x.out.from))}</td><td>（配布中）</td></tr>` : ''}
        ${x.hist.map(h => `<tr><td>${esc(h.name)}</td><td>${esc(ymdJ(h.from))}</td><td>${esc(ymdJ(h.to))}${h.how && h.how !== '返却' ? '<small>（' + esc(h.how) + '）</small>' : ''}${h.distId ? ` <button class="link" data-act="cvFix" data-id="${esc(h.distId)}" data-t="${esc(id)}" data-f="${esc(h.from)}" data-to="${esc(h.to)}" data-n="${esc(h.name)}">日付を直す</button>` : ''}</td></tr>`).join('') || (x.out ? '' : '<tr><td colspan="3" class="muted">まだ配っていません</td></tr>')}
      </tbody></table></div>
      <p class="muted small">S-13と同じ形です（新しい順・最近の12回まで）。台帳と日付がちがうときは「日付を直す」で直せます（S-13 にもそのまま出ます）。</p>`);
  };
  /** 配った日・返した日を直す（0.11.0） */
  act.cvFix = el => {
    const t = K.geo.terr[el.dataset.t];
    U.openSheet(U.sheetTitle(esc(t ? t.no : '') + ' <small>の日付を直す</small>'), `
      <p class="muted">${esc(el.dataset.n)}さん</p>
      <div class="dates"><label>配った日（割り当てた日付）<input type="date" id="fx-from" value="${esc(el.dataset.f)}" max="${esc(H.todayStr())}"></label>
        <label>返した日（完了した日付）<input type="date" id="fx-to" value="${esc(el.dataset.to)}" max="${esc(H.todayStr())}"></label></div>
      <p class="muted small">ほかの人が持っていた期間と重なる日にはできません。直したことは「変更の記録」に残ります。</p>
      <div class="row2"><button class="btn big" data-act="closeSheet">やめる</button><button class="btn primary big" data-act="cvFixGo" data-id="${esc(el.dataset.id)}">直す</button></div>`);
  };
  act.cvFixGo = async el => {
    const f = (document.getElementById('fx-from') || {}).value, t = (document.getElementById('fx-to') || {}).value;
    el.disabled = true;
    try {
      await api('fixDist', { distId: el.dataset.id, from: f, to: t });
      toast('日付を直しました');
      U.closeSheet();
      CV.data = null; await load();
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* ==================== 配布中と回収 ==================== */
  const OT = { filter: 'all' };
  views.aOut = async function () {
    if (!A.data) await load();
    const d = A.data;
    const mine = d.dists.filter(x => !x.other);
    const holds = mine.filter(x => x.kind === '手持ち');
    let cards = mine.filter(x => x.kind !== '手持ち');
    const nd = (d.settings && d.settings.noticeDays) || 7;
    const isSoon = x => x.due && H.daysLeft(x.due) >= 0 && H.daysLeft(x.due) <= nd;
    const isOver = x => x.due && H.daysLeft(x.due) < 0;
    const allCards = cards;
    if (OT.filter === 'soon') cards = cards.filter(isSoon);
    if (OT.filter === 'over') cards = cards.filter(isOver);
    const q = S['r-q'].trim();
    if (q) cards = cards.filter(x => (x.name + x.no).indexOf(q) >= 0);
    const by = {};
    cards.forEach(x => { (by[x.userId] = by[x.userId] || { name: x.name, list: [] }).list.push(x); });
    const gs = d.gatherings || [];
    const others = d.dists.filter(x => x.other).length;
    const row = x => {
      const t = target(x.territoryId);
      return `<div class="rrow"><div class="rmain"><b class="num">${esc(x.no)}</b><span class="small">${esc(t.name)}${x.roomNos && x.roomNos.length ? '　<b>' + esc(x.roomNos.join('・')) + '</b>（' + x.roomNos.length + '部屋）' : ''}</span>${x.kind !== '通常' && x.kind !== '手持ち' ? `<span class="tag ${x.kind === '不在宅訪問' ? 'warn' : 'apt'}">${esc(K.kindLabel(x.kind))}</span>` : ''}
        <span class="muted small">${esc(H.mdShort(x.distributedAt))} 配布</span>${dueLine(x)}</div>
        <div class="ractions"><button class="btn sm" data-act="oReturn" data-id="${esc(x.distId)}">${x.kind === '手持ち' ? '戻す' : '返却にする'}</button>
        ${x.kind !== '手持ち' ? `<button class="link" data-act="oReturnDay" data-id="${esc(x.distId)}">返した日を選ぶ</button>` : ''}
        ${top() && x.kind !== '手持ち' ? `<button class="link" data-act="oDates" data-id="${esc(x.distId)}">日付を変える</button>` : ''}
        <button class="link" data-act="oCancel" data-id="${esc(x.distId)}">配布の間違い</button></div></div>`;
    };
    const backs = top() ? (d.returnedRecent || []) : [];
    if (OT.filter === 'back' && top()) {
      const q2 = S['r-q'].trim();
      const list = backs.filter(x => !q2 || (x.name + x.no).indexOf(q2) >= 0);
      const how = x => x.endedBy === '自動回収' ? '自動回収' : x.endedBy === '戻した' ? '手持ちから戻した' : x.by && x.by === x.userId ? '本人が返した' : x.byName ? esc(x.byName) + 'さんが回収' : '返却';
      const place = x => { const t = target(x.territoryId); return t.isBuilding ? '・' + esc(t.name) : ''; };
      return shell('配布中と回収', `${filterSeg(allCards, isSoon, isOver, backs)}
        <p class="muted small">30日のうちに返ってきた区域です。間違えて返した・回収したときは「元に戻す」を押すと、同じ人が持っている状態に戻ります（記録もそのまま）。完全回収日を過ぎていたら、今日から数え直します。ほかの人に配り直した区域は戻せません。</p>
        <input id="r-q" class="sel" type="search" placeholder="名前か番号で探す" value="${esc(S['r-q'])}" autocomplete="off">
        ${list.length ? `<div class="tlist">${list.map(x => { return `<div class="trow static ret-row"><b class="num">${esc(x.no)}</b><span class="town">${esc(x.name)}${x.kind !== '通常' ? '・' + esc(K.kindLabel(x.kind)) : ''}</span><span class="h"></span>
          <span class="st">${esc(H.mdShort(x.returnedAt))} ${how(x)}${place(x)}${x.roomNos && x.roomNos.length ? '（' + esc(x.roomNos.join('・')) + '）' : ''}
          ${x.takenBy ? `<span class="muted">今は${esc(x.takenBy)}さんが持っています</span>` : `<button class="btn sm" data-act="oReopen" data-id="${esc(x.distId)}">元に戻す</button>`}</span></div>`; }).join('')}</div>` : '<p class="empty">30日のうちに返ってきた区域はありません。</p>'}`);
    }
    shell('配布中と回収', `
      ${gs.length ? `<h2 class="sec">開いている集まり</h2>${gs.map(g => { const n = mine.filter(x => x.gatheringId === g.id).length; return `<div class="who gath"><div><b>${esc(H.mdShort(g.date))} ${esc(g.name)}</b><span class="muted">　${n}枚 配布中</span></div><button class="btn sm primary" data-act="oClose" data-id="${esc(g.id)}">集まりを終える（まとめて返却）</button></div>`; }).join('')}` : ''}
      <h2 class="sec">人ごと</h2>
      ${filterSeg(allCards, isSoon, isOver, backs)}
      <p class="muted small">回収日を過ぎた区域も、完全回収日までは記録できます。完全回収日を過ぎると自動で回収されます（返していない人へのペナルティではありません）。</p>
      <input id="r-q" class="sel" type="search" placeholder="名前か番号で探す" value="${esc(S['r-q'])}" autocomplete="off">
      ${top() && cards.length ? `<button class="btn" data-act="oDatesAll">表示中の${cards.length}枚の日付をまとめて変える</button>` : ''}
      ${Object.keys(by).length ? Object.keys(by).sort((a, b) => (by[a].name < by[b].name ? -1 : 1)).map(id => `<section class="who"><h3>${esc(by[id].name)}<span class="muted">　${by[id].list.length}枚</span></h3>${by[id].list.map(row).join('')}</section>`).join('') : '<p class="empty">当てはまる配布はありません。</p>'}
      ${holds.length ? `<h2 class="sec">グループの手持ち</h2>${Object.entries(holds.reduce((m, x) => { (m[x.groupId] = m[x.groupId] || []).push(x); return m; }, {})).map(([g, list]) => `<section class="who"><h3>${esc(groupName(g))}<span class="muted">　${list.length}枚</span></h3>${list.map(row).join('')}</section>`).join('')}` : ''}
      ${others ? `<p class="muted small">ほかのグループが配っている区域：${others}枚</p>` : ''}`);
  };
  function filterSeg(allCards, isSoon, isOver, backs) {
    return `<div class="seg wrap"><button data-act="otFilter" data-f="all" aria-pressed="${OT.filter === 'all'}">すべて<small>${allCards.length}</small></button><button data-act="otFilter" data-f="soon" aria-pressed="${OT.filter === 'soon'}">回収日が近い<small>${allCards.filter(isSoon).length}</small></button><button data-act="otFilter" data-f="over" aria-pressed="${OT.filter === 'over'}">回収日を過ぎた<small>${allCards.filter(isOver).length}</small></button>${top() ? `<button data-act="otFilter" data-f="back" aria-pressed="${OT.filter === 'back'}">返ってきた（元に戻す）<small>${backs.length}</small></button>` : ''}</div>`;
  }
  act.otFilter = el => { OT.filter = el.dataset.f; U.render(); };
  act.oReopen = async el => {
    if (!sure(el, 'もう一度押すと戻します')) return;
    el.disabled = true;
    try {
      const r = await api('reopenDists', { distIds: [el.dataset.id] });
      const x = r.results[0];
      toast(x.dist ? x.dist.no + ' を ' + x.dist.name + 'さんに戻しました' + (x.forced ? '（完全回収日 ' + H.mdShort(x.forced) + '）' : '') : '戻しました');
      await load();
      K.refresh().catch(() => {});
    } catch (e) { el.disabled = false; return; }
    U.render();
  };
  const DS = { ids: [], due: '', forced: '', touched: false };
  function openDates(ids) {
    const list = A.data.dists.filter(x => ids.indexOf(x.distId) >= 0);
    if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    Object.assign(DS, { ids: ids, due: one ? one.due : defaultDue(), forced: one ? one.forced : addDaysStr(defaultDue(), forcedDays()), touched: false });
    U.openSheet(U.sheetTitle(one ? esc(one.no) + ' <small>の日付</small>' : list.length + '枚 <small>の日付</small>'), `
      ${one ? `<p class="muted">${esc(one.name)}さん・${esc(H.mdShort(one.distributedAt))} 配布</p>` : `<p class="muted">${esc(list.slice(0, 8).map(x => x.no).join('、'))}${list.length > 8 ? ' ほか' : ''}</p>`}
      ${datesBox('ds', DS, '回収日だけ変えると、完全回収日は回収日の' + forcedDays() + '日後になります。完全回収日を過ぎると、自動で回収します。')}
      <button class="btn primary big wide" data-act="dsSave">保存する</button>`);
  }
  act.oDates = el => openDates([el.dataset.id]);
  act.oDatesAll = () => {
    const nd = (A.data.settings && A.data.settings.noticeDays) || 7;
    const q = S['r-q'].trim();
    let cards = A.data.dists.filter(x => !x.other && x.kind !== '手持ち');
    if (OT.filter === 'soon') cards = cards.filter(x => x.due && H.daysLeft(x.due) >= 0 && H.daysLeft(x.due) <= nd);
    if (OT.filter === 'over') cards = cards.filter(x => x.due && H.daysLeft(x.due) < 0);
    if (q) cards = cards.filter(x => (x.name + x.no).indexOf(q) >= 0);
    openDates(cards.map(x => x.distId));
  };
  act.dsSave = async el => {
    if (!DS.due) { toast('回収日を選んでください'); return; }
    el.disabled = true;
    try {
      const r = await api('setDates', { distIds: DS.ids, due: DS.due, forced: DS.forced });
      const ng = r.results.filter(x => !x.ok);
      toast((r.results.length - ng.length) + '枚の日付を変えました' + (ng.length ? '（' + ng.length + '枚は変えられませんでした：' + ng[0].message + '）' : ''));
      U.closeSheet();
      await load();
      K.refresh().catch(() => {});
      U.render();
    } catch (e) { el.disabled = false; }
  };
  act.oReturn = async el => {
    if (!sure(el, 'もう一度押す')) return;
    try { await api('returnCards', { distIds: [el.dataset.id] }); toast('返却にしました'); await load(); K.refresh().catch(() => {}); } catch (e) { /* api が知らせる */ }
    U.render();
  };
  /** 返した日を選んで返却にする（紙で回って、あとから返ってきたとき。0.11.0） */
  act.oReturnDay = el => {
    const x = A.data.dists.find(y => y.distId === el.dataset.id);
    if (!x) return;
    U.openSheet(U.sheetTitle(esc(x.no) + ' <small>を返却にする</small>'), `
      <p class="muted">${esc(x.name)}さん・${esc(H.md(x.distributedAt))} 配布</p>
      <label class="lbl" for="rd-day">返した日</label>
      <input id="rd-day" type="date" class="sel" value="${esc(H.todayStr())}" min="${esc(x.distributedAt)}" max="${esc(H.todayStr())}">
      <p class="muted small">紙の区域カードが、あとから返ってきたときなどに使います。返した日は、回った月と S-13 の「完了した日付」になります。紙に書かれた家ごとの記録は［代理入力］で入れられます。</p>
      <div class="row2"><button class="btn big" data-act="closeSheet">やめる</button><button class="btn primary big" data-act="oReturnDayGo" data-id="${esc(x.distId)}">この日で返却にする</button></div>`);
  };
  act.oReturnDayGo = async el => {
    const day = (document.getElementById('rd-day') || {}).value || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { toast('返した日を選んでください'); return; }
    el.disabled = true;
    try {
      await api('returnCards', { distIds: [el.dataset.id], at: day });
      toast(H.md(day) + 'に返したことにしました');
      U.closeSheet();
      await load(); K.refresh().catch(() => {});
      U.render();
    } catch (e) { el.disabled = false; }
  };
  act.oCancel = async el => {
    if (!sure(el, 'もう一度押すと取り消し')) return;
    try { const r = await api('cancelDist', { distId: el.dataset.id }); toast(r.results && r.results[0].reopened ? '取り消して、手持ちに戻しました' : '配布を取り消しました'); await load(); K.refresh().catch(() => {}); } catch (e) { /* api が知らせる */ }
    U.render();
  };
  act.oClose = async el => {
    if (!sure(el, 'もう一度押すと、まとめて返却')) return;
    try { const r = await api('closeGathering', { gatheringId: el.dataset.id }); toast('集まりを終え、' + r.returned + '枚を返却にしました'); await load(); K.refresh().catch(() => {}); } catch (e) { /* api が知らせる */ }
    U.render();
  };

  /* ==================== 建物の仕分け ==================== */
  const SO = { tab: 'report' };
  function sortItems() {
    const d = A.data;
    const st = d.houseStates || {};
    const items = { report: [], big: [], maybe: [], done: [] };
    (d.reports || []).forEach(r => {
      const h = K.geo.house[r.houseId];
      if (r.houseId && h) items.report.push({ h: h, r: r, note: '報告：' + r.note + '（' + r.by + '・' + H.mdShort(r.at) + '）' });
    });
    K.geo.list.forEach(t => (K.geo.byTerr[t.id] || []).forEach(h => {
      const s = st[h.id];
      if (s) { items.done.push({ h: h, note: s.state + (s.buildingId ? '（' + target(s.buildingId).no + ' ' + target(s.buildingId).name + '）' : '') + '・' + H.mdShort(s.at) }); return; }
      if (h.big) items.big.push({ h: h, note: '大きな建物（400㎡以上）' });
      else if (h.maybe) items.maybe.push({ h: h, note: '集合住宅かも（大きめの家）' });
    }));
    return items;
  }
  views.aSort = async function () {
    if (!A.data) await load();
    const it = sortItems();
    const tabs = [['report', '現地からの報告'], ['big', '大きな建物'], ['maybe', '集合住宅かも'], ['done', '仕分け済み']];
    const q = S['s-q'].trim().toLowerCase();
    let list = it[SO.tab];
    if (q) list = list.filter(x => { const t = K.geo.terr[x.h.t]; return (t.no + ' ' + t.town).toLowerCase().indexOf(q) >= 0; });
    shell('建物の仕分け', `
      <p class="muted small">地図の建物を、家・集合住宅・空き家・家ではない、に分けます。大きな建物は、ここで決めるまで区域の中で記録できません。アパートとマンションは、すべて「集合住宅」として別に管理します。</p>
      <div class="seg wrap">${tabs.map(t => `<button data-act="soTab" data-t="${t[0]}" aria-pressed="${SO.tab === t[0]}">${t[1]}<small>${it[t[0]].length}</small></button>`).join('')}</div>
      <input id="s-q" class="sel" type="search" placeholder="区域の番号か町名で絞る（例：Z05、星置）" value="${esc(S['s-q'])}" autocomplete="off">
      <div class="tlist">${list.slice(0, 80).map(x => { const t = K.geo.terr[x.h.t]; return `<button class="trow" data-act="soOpen" data-h="${x.h.id}" ${x.r ? `data-rep="${esc(x.r.id)}"` : ''}>
        <b class="num">${esc(t.no)}</b><span class="town">${esc(t.town)}</span><span class="h">${I.chev}</span><span class="st">${esc(x.note)}</span></button>`; }).join('') || '<p class="empty">ありません。</p>'}</div>
      ${list.length > 80 ? `<p class="muted small">ほか ${list.length - 80}件。区域の番号で絞ってください。</p>` : ''}`);
  };
  act.soTab = el => { SO.tab = el.dataset.t; U.render(); };
  act.soOpen = el => openHouseSort(el.dataset.h, el.dataset.rep || '');

  let sortMap = null;
  function openHouseSort(hid, repId) {
    const h = K.geo.house[hid];
    if (!h) return;
    const t = K.geo.terr[h.t];
    const st = (A.data && A.data.houseStates || {})[hid];
    const rep = repId ? (A.data.reports || []).find(r => r.id === repId) : null;
    const sh = U.openSheet(U.sheetTitle(esc(t.no) + ' <small>' + esc(t.town) + '</small>'),
      `<div class="minimap" id="sortmap"></div>
      <p class="small">${h.big ? '大きな建物（400㎡以上）' : h.maybe ? '大きめの建物（集合住宅かも）' : '家'}${st ? '・今は「' + esc(st.state) + '」' : ''}</p>
      ${rep ? `<p class="notice info">報告：${esc(rep.note)}（${esc(rep.by)}）</p>` : ''}
      ${sortButtons(hid, repId)}`, () => { if (sortMap) { sortMap.remove(); sortMap = null; } });
    setTimeout(() => { sortMap = U.miniMap(sh.querySelector('#sortmap'), h.lat, h.lon, { territoryId: t.id }); }, 30);
  }
  function sortButtons(hid, repId) {
    const r = repId ? ` data-rep="${esc(repId)}"` : '';
    return `<div class="sortbtns">
      <button class="btn" data-act="hsSet" data-h="${hid}" data-state="家"${r}>家として回る</button>
      <button class="btn primary" data-act="hsApt" data-h="${hid}"${r}>${I.bldg}集合住宅として別に管理</button>
      <button class="btn" data-act="hsSet" data-h="${hid}" data-state="空き家"${r}>空き家</button>
      <button class="btn" data-act="hsSet" data-h="${hid}" data-state="家ではない"${r}>家ではない（店・倉庫など）</button>
      <button class="btn" data-act="hsSet" data-h="${hid}" data-state="なくなった"${r}>なくなった（取り壊し・更地）</button>
      ${repId ? `<button class="link" data-act="repSkip" data-rep="${esc(repId)}">報告を見送る（何も変えない）</button>` : ''}
    </div>`;
  }
  /** 区域の地図から開いた家のシートに足す、上位管理者用の欄 */
  K.adminTools = {
    houseSection: function (h) {
      return `<details class="report admin-sec"><summary>建物の扱いを変える（上位管理者）</summary>${sortButtons(h.id, '')}
        <button class="link" data-act="aGoEdit" data-t="${esc(h.t)}" data-h="${esc(h.id)}">地図の手直しで開く（場所を直す・家を足す）</button></details>`;
    },
  };
  async function afterHouseState(hid, state, buildingId) {
    if (K.state.me) {
      K.state.me.houseStates = Object.assign({}, K.state.me.houseStates || {}, { [hid]: { state: state, buildingId: buildingId || '', at: H.todayStr() } });
    }
    if (A.data) A.data.houseStates = Object.assign({}, A.data.houseStates || {}, { [hid]: { state: state, buildingId: buildingId || '', at: H.todayStr() } });
    U.refreshMarkers();
    U.renderPanel();
    K.emit('houseEdit');
  }
  act.hsSet = async el => {
    const hid = el.dataset.h, state = el.dataset.state;
    el.disabled = true;
    try {
      await api('setHouseState', { houseId: hid, state: state, reportId: el.dataset.rep || '' });
      await afterHouseState(hid, state, '');
      toast('「' + state + '」にしました');
      U.closeSheet();
      await load();
      K.refresh().catch(() => {});
      if (U.view().name === 'aSort') U.render();
    } catch (e) { el.disabled = false; }
  };
  act.repSkip = async el => {
    try { await api('resolveReport', { reportId: el.dataset.rep, result: '見送り' }); toast('報告を見送りました'); U.closeSheet(); await load(); U.render(); } catch (e) { /* api が知らせる */ }
  };
  act.hsApt = el => {
    const h = K.geo.house[el.dataset.h];
    const t = K.geo.terr[h.t];
    openBuildingForm({ houseId: h.id, lat: h.lat, lon: h.lon, city: t.no[0], reportId: el.dataset.rep || '', town: t.town });
  };

  /* ==================== 集合住宅の登録・変更 ==================== */
  const BF = {};
  function openBuildingForm(o) {
    Object.assign(BF, { id: '', name: '', type: 'アパート', autolock: 'なし', routes: [firstRoute('一棟まとめて')].filter(Boolean), floors: 2, per: 4, style: '101', houseId: '', lat: '', lon: '', city: 'Z', reportId: '', address: '' }, o || {});
    if (o && o.building) {
      const b = o.building;
      Object.assign(BF, { id: b.id, name: b.name, type: b.type, autolock: b.autolock || '分からない', routes: routesOf(b).slice(), houseId: b.houseId, lat: b.lat, lon: b.lon, city: b.city, address: b.address });
    }
    renderBuildingForm();
  }
  function seg(name, list, val) {
    return `<div class="seg wrap">${list.map(v => `<button data-act="bfSet" data-f="${name}" data-v="${esc(v)}" aria-pressed="${val === v}">${esc(v)}</button>`).join('')}</div>`;
  }
  function renderBuildingForm() {
    const isNew = !BF.id;
    const rooms = genRooms();
    U.openSheet(U.sheetTitle(isNew ? '集合住宅として登録' : esc(BF.name)), `
      <label class="lbl" for="bf-name">名前</label>
      <input id="bf-name" class="sel" value="${esc(BF.name)}" placeholder="例：桂岡ハイツ（分からなければ「桂岡町のアパート1」など）" autocomplete="off">
      <div class="lbl">種類</div>${seg('type', ['アパート', 'マンション', 'その他'], BF.type)}
      ${isNew && !BF.houseId ? `<div class="lbl">場所</div><div class="seg two">${[['Z', '小樽側（Z）'], ['H', '札幌側（H）']].map(c => `<button data-act="bfSet" data-f="city" data-v="${c[0]}" aria-pressed="${BF.city === c[0]}">${c[1]}</button>`).join('')}</div>
        <label class="lbl" for="bf-addr">住所（なくてもよい）</label><input id="bf-addr" class="sel" value="${esc(BF.address || '')}" placeholder="例：小樽市銭函2丁目" autocomplete="off">` : ''}
      <div class="lbl">オートロック</div>${seg('autolock', ['なし', 'あり', '分からない'], BF.autolock)}
      <div class="lbl">回り方（いくつでも選べます）</div>
      <div class="seg wrap">${allRoutes().filter(r => r.active || BF.routes.indexOf(r.id) >= 0).map(r => `<button data-act="bfRoute" data-v="${esc(r.id)}" aria-pressed="${BF.routes.indexOf(r.id) >= 0}">${BF.routes.indexOf(r.id) >= 0 ? I.check : ''}${esc(r.name)}${r.active ? '' : '（使っていない）'}</button>`).join('')}</div>
      <p class="muted small">${BF.routes.length >= 2 ? esc(BF.routes.map(rName).join('と')) + 'の、どの集まりでも割り振れます。' : BF.routes.length ? esc(rName(BF.routes[0])) + 'の集まりで割り振ります（' + (wholeRoute(BF.routes[0]) ? '一棟まとめて' : '部屋ごと') + '）。' : 'どれも選ばないと「決めていない」になり、集まりの候補に出ません。'}</p>
      ${isNew ? `<div class="lbl">部屋</div>
        <div class="gen"><span>${stepperF('floors', BF.floors, 1, 30)}階建て</span><span>1つの階に ${stepperF('per', BF.per, 1, 30)}部屋</span></div>
        <div class="seg two"><button data-act="bfSet" data-f="style" data-v="101" aria-pressed="${BF.style === '101'}">101・102…</button><button data-act="bfSet" data-f="style" data-v="1" aria-pressed="${BF.style === '1'}">1・2・3…</button></div>
        <p class="muted small">${rooms.length}部屋：${esc(rooms.slice(0, 6).map(r => r.no).join('、'))}${rooms.length > 6 ? '…' : ''}。あとから「集合住宅」で1部屋ずつ直せます。</p>` : ''}
      <button class="btn primary big wide" data-act="bfSave">${isNew ? '登録する' : '保存する'}</button>
      ${!isNew ? `<div class="bld-actions"><button class="btn wide" data-act="bfStatus">部屋の様子（拒否・今の巡回で回った部屋・持っている人）</button><button class="btn wide" data-act="bfRooms">部屋の一覧を見る・直す</button>
        <button class="btn wide" data-act="bfGive">${I.check}<span>この建物を渡す（一棟まとめて・部屋を選んで）</span></button></div>` : ''}
      ${isNew ? '<p class="muted small">登録すると、この建物は戸建ての区域から外れ、集合住宅の区域（番号の頭が ' + (BF.type === 'マンション' ? 'M' : 'A') + '）になります。</p>' : ''}`);
  }
  function stepperF(f, v, min, max) {
    return `<span class="stepper"><button data-act="bfStep" data-f="${f}" data-d="-1" ${v <= min ? 'disabled' : ''}>−</button><b class="num">${v}</b><button data-act="bfStep" data-f="${f}" data-d="1" ${v >= max ? 'disabled' : ''}>＋</button></span>`;
  }
  function genRooms() {
    const out = [];
    let k = 0;
    for (let f = 1; f <= BF.floors; f++) for (let i = 1; i <= BF.per; i++) { k++; out.push({ entrance: '', floor: f, no: BF.style === '101' ? String(f * 100 + i) : String(k) }); }
    return out;
  }
  function keepName() { const n = document.getElementById('bf-name'); if (n) BF.name = n.value; const a = document.getElementById('bf-addr'); if (a) BF.address = a.value; }
  act.bfSet = el => { keepName(); BF[el.dataset.f] = el.dataset.v; renderBuildingForm(); };
  act.bfRoute = el => { keepName(); const k = el.dataset.v; BF.routes = BF.routes.indexOf(k) >= 0 ? BF.routes.filter(x => x !== k) : allRoutes().map(r => r.id).filter(x => x === k || BF.routes.indexOf(x) >= 0); renderBuildingForm(); };
  /** 集合住宅の画面から、この建物を1枚ずつ配る画面へ（建物の回り方を選んだ状態で） */
  act.bfGive = () => {
    const kind = BF.routes.find(id => (K.route(id) || {}).active) || firstRoute('一棟まとめて');
    if (!kind) { toast('先に「回り方」の画面で、回り方を作ってください'); return; }
    U.closeSheet();
    U.go('aOne', { fresh: true, pick: { kind: kind, id: BF.id } });
  };
  act.bfStep = el => { keepName(); const f = el.dataset.f; BF[f] = Math.max(1, Math.min(30, BF[f] + Number(el.dataset.d))); renderBuildingForm(); };
  act.bfSave = async el => {
    keepName();
    if (!BF.name.trim()) { toast('名前を入れてください'); return; }
    el.disabled = true;
    const building = { id: BF.id, name: BF.name.trim(), type: BF.type, autolock: BF.autolock, routes: BF.routes, city: BF.city, houseId: BF.houseId, lat: BF.lat, lon: BF.lon, address: BF.address || BF.town || '' };
    try {
      const r = await api('saveBuilding', { building: building, rooms: BF.id ? undefined : genRooms(), reportId: BF.reportId });
      toast((BF.id ? '保存しました：' : '登録しました：') + r.building.no + ' ' + r.building.name);
      if (BF.houseId) await afterHouseState(BF.houseId, '集合住宅', r.id);
      U.closeSheet();
      await load();
      K.refresh().catch(() => {});
      if (['aSort', 'aBldg'].indexOf(U.view().name) >= 0) U.render();
    } catch (e) { el.disabled = false; }
  };
  act.bfRooms = async () => {
    try {
      const r = await api('building', { id: BF.id });
      openRoomsEditor(r.building, r.rooms.filter(x => x.active !== false));
    } catch (e) { /* api が知らせる */ }
  };
  /* ---------- 部屋の様子：拒否の部屋・今の巡回で回った部屋・持っている人。拒否にする／解除する ---------- */
  const BS = { b: null, rid: '' };
  async function loadBStatus(id) {
    const r = await api('roomStatus', { ids: [id] });
    BS.b = r.buildings[0];
  }
  function renderBStatus(open) {
    const b = BS.b;
    if (!b) return;
    const x = b.rooms.find(y => y.id === BS.rid);
    const refused = b.rooms.filter(y => y.refused);
    const out = b.rooms.filter(y => y.out);
    const body = `
      ${b.round ? `<p class="small bk-note"><b>${esc(roundText(b.round))}</b></p>` : ''}
      <p class="muted small">印：<b>拒</b>＝拒否（割り振りの候補に出さず、部屋を選ぶ画面でも選べません）、済＝今の巡回でもう回った、不＝前回は不在、名前＝今持っている人。部屋をさわると、拒否にする・解除するができます。</p>
      <p class="small">拒否の部屋：<b class="num">${refused.length}</b>${refused.length ? '（' + esc(refused.map(y => y.no).join('・')) + '）' : ''}　配布中：${out.length}部屋</p>
      <div class="rooms rpick">${roomGrid(b, new Set(BS.rid ? [BS.rid] : []), 'bsRoom', true)}</div>
      ${x ? `<div class="bs-pick"><p><b class="num">${esc(x.no)}</b>　${x.refused ? '<span class="tag warn">拒否</span>' : ''}${x.out ? esc(x.out.name) + 'さんが持っています。' : ''}${x.done ? '今の巡回で ' + esc(H.mdShort(x.done)) + 'に回りました。' : ''}${x.last ? '最後の記録：' + esc(x.last.res) + '（' + esc(H.mdShort(x.last.at)) + '）' : '記録はまだありません。'}</p>
        ${x.refused ? `<button class="btn primary wide" data-act="bsRefuse" data-v="">拒否を解除する（また割り振れるようにする）</button>` : `<button class="btn wide" data-act="bsRefuse" data-v="1">拒否にする（割り振らない）</button>`}</div>` : ''}`;
    const title = U.sheetTitle(esc(b.no) + ' <small>部屋の様子</small>');
    const sh = document.querySelector('.sheet');
    if (open || !sh) U.openSheet(title, body);
    else sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + title + body;
  }
  act.bfStatus = async () => {
    U.openSheet(U.sheetTitle('部屋の様子'), '<p class="muted">部屋の様子を読んでいます…</p>');
    try { BS.rid = ''; await loadBStatus(BF.id); renderBStatus(true); } catch (e) { U.closeSheet(); }
  };
  act.bsRoom = el => { BS.rid = BS.rid === el.dataset.room ? '' : el.dataset.room; renderBStatus(); };
  act.bsRefuse = async el => {
    const refused = !!el.dataset.v;
    el.disabled = true;
    try {
      await api('setRoomRefusal', { buildingId: BS.b.id, roomId: BS.rid, refused: refused });
      const no = (BS.b.rooms.find(y => y.id === BS.rid) || {}).no;
      toast(no + ' を' + (refused ? '拒否にしました' : '拒否から外しました'));
      await loadBStatus(BS.b.id);
      renderBStatus();
      K.refresh().catch(() => {});
    } catch (e) { el.disabled = false; }
  };
  function openRoomsEditor(b, rooms) {
    const text = rooms.map(r => (r.entrance ? r.entrance + ':' : '') + r.no).join('\n');
    U.openSheet(U.sheetTitle(esc(b.no) + ' <small>部屋の一覧</small>'), `
      <p class="muted small">1行に1部屋。入口が分かれているときは「2:1403」のように、入口の番号とコロンを前に付けます。消した部屋の記録は残ります。</p>
      <textarea id="rooms-text" class="sel rooms-text" rows="12">${esc(text)}</textarea>
      <p class="muted small">今 ${rooms.length}部屋</p>
      <button class="btn primary big wide" data-act="roomsSave" data-id="${esc(b.id)}">部屋の一覧を保存する</button>`);
    BF.editing = b;
  }
  act.roomsSave = async el => {
    const b = BF.editing;
    const lines = document.getElementById('rooms-text').value.split(/\n/).map(s => s.trim()).filter(Boolean);
    const rooms = lines.map(s => { const m = s.match(/^([^:：]+)[:：](.+)$/); return m ? { entrance: m[1].trim(), no: m[2].trim() } : { entrance: '', no: s }; });
    el.disabled = true;
    try {
      const r = await api('saveBuilding', { building: { id: b.id, name: b.name, type: b.type, autolock: b.autolock, routes: routesOf(b) }, rooms: rooms });
      toast('部屋の一覧を保存しました（' + r.rooms.total + '部屋' + (r.rooms.added ? '・足した ' + r.rooms.added : '') + (r.rooms.removed ? '・消した ' + r.rooms.removed : '') + '）');
      U.closeSheet();
      await load();
      if (U.view().name === 'aBldg') U.render();
    } catch (e) { el.disabled = false; }
  };

  const BL = { route: 'all' };
  views.aBldg = async function () {
    if (!A.data) await load();
    const d = A.data;
    const out = outMap();
    const lr = d.lastReturned || {};
    const q = S['b-q'].trim();
    let list = (d.buildings || []).slice();
    const hasRoute = (b, r) => (r === '決めていない' ? routesOf(b).length === 0 : routesOf(b).indexOf(r) >= 0);
    if (BL.route !== 'all') list = list.filter(b => hasRoute(b, BL.route));
    if (q) list = list.filter(b => (b.no + b.name).indexOf(q) >= 0);
    list.sort((a, b) => (noKey(a.no) < noKey(b.no) ? -1 : 1));
    const routes = [['all', 'すべて']].concat(allRoutes().map(r => [r.id, r.name])).concat([['決めていない', '決めていない']]);
    shell('集合住宅', `
      <p class="muted small">アパートとマンションは、戸建ての区域とは別に、部屋ごとに記録します。建物ごとに「回り方」（${esc(activeRoutes().map(r => r.name).join('・'))}）を選ぶと、その集まりで割り振れます（いくつでも選べます）。回り方の名前や渡し方は「回り方」の画面で変えられます。</p>
      <div class="seg wrap">${routes.map(r => `<button data-act="blRoute" data-r="${esc(r[0])}" aria-pressed="${BL.route === r[0]}">${esc(r[1])}<small>${r[0] === 'all' ? d.buildings.length : d.buildings.filter(b => hasRoute(b, r[0])).length}</small></button>`).join('')}</div>
      <input id="b-q" class="sel" type="search" placeholder="番号か名前で探す" value="${esc(S['b-q'])}" autocomplete="off">
      <div class="tlist">${list.map(b => `<button class="trow" data-act="blOpen" data-id="${b.id}"><b class="num">${esc(b.no)}</b><span class="town">${esc(b.name)}</span><span class="h num">${b.rooms}部屋</span>
        <span class="st">${routeTags(b)} ${esc(b.type)}・オートロック${esc(b.autolock || '?')}${out[b.id] ? '・' + (out[b.id].partial ? esc(out[b.id].names.join('・')) + 'さんが部屋を配布中' : '配布中（' + esc(out[b.id].name) + '）') : ''}${(A.data.cycles || {})[b.id] ? '・' + esc(roundText(A.data.cycles[b.id])) : !out[b.id] && lr[b.id] ? '・前回の返却 ' + H.mdShort(lr[b.id]) : ''}</span></button>`).join('') || '<p class="empty">ありません。</p>'}</div>
      <button class="btn" data-act="blNew">＋ 集合住宅を足す（地図の場所なし）</button>
      <p class="muted small">${aptOnly() ? 'たくさんあるときは、スプレッドシートの「取り込み」シートに貼って、メニュー「マンションマスタを取り込む」で入れられます。' : '地図の場所を付けたいときは「建物の仕分け」で、地図の建物から登録します。たくさんあるときは「マンションマスタを取り込む」も使えます。'}</p>`);
  };
  act.blRoute = el => { BL.route = el.dataset.r; U.render(); };
  act.blNew = () => openBuildingForm({ routes: [aptOnly() ? firstRoute('部屋ごと') : firstRoute('一棟まとめて')].filter(Boolean) });
  act.blOpen = el => { const b = (A.data.buildings || []).find(x => x.id === el.dataset.id); if (b) openBuildingForm({ building: b }); };

  /* ==================== 回り方（名前・渡し方を変える・足す） ==================== */
  views.aRoutes = async function () {
    if (!A.data) await load();
    const d = A.data;
    const count = id => (d.buildings || []).filter(b => routesOf(b).indexOf(id) >= 0).length;
    const outN = id => (d.dists || []).filter(x => x.kind === id && !x.other).length;
    shell('回り方', `
      <p class="muted small">集合住宅を回るときの回り方です。名前はいつでも変えられます（例：「夕方のアパート」→「日中のアパート」）。名前を変えても、建物・配っている区域・これまでの記録との結びつきはそのままです。</p>
      <div class="rt-list">${allRoutes().map(r => `<div class="rt-row ${r.active ? '' : 'off'}">
        <div class="rt-main"><b>${esc(r.name)}</b><span class="small">${r.mode === '部屋ごと' ? '部屋ごと（1人に' + r.per + '部屋・1つの建物から' + perBOf(r) + '部屋まで）' : '一棟まとめて'}・回り直すまで${r.cycle}日${r.active ? '' : '・<b>使っていない</b>'}</span>
          <span class="muted small">建物 ${count(r.id)}棟・配布中 ${outN(r.id)}件　<span class="rt-id">${esc(r.id)}</span></span></div>
        <button class="btn sm" data-act="rtOpen" data-id="${esc(r.id)}">変える</button></div>`).join('')}</div>
      <button class="btn" data-act="rtNew">＋ 回り方を足す（例：日中のマンション・祝日のアパート）</button>
      <p class="muted small">渡し方：「一棟まとめて」は建物まるごと1人に渡します（夕方のアパートなど）。「部屋ごと」は1人に数部屋ずつ割り振ります（マンション訪問など）。集まりで割り振るときも、1枚ずつ配るときも、その場で変えられます。</p>`);
  };
  const RF = {};
  function openRoute(r) {
    Object.assign(RF, r ? { id: r.id, name: r.name, mode: r.mode, per: r.per, perB: perBOf(r), cycle: r.cycle, active: r.active } : { id: '', name: '', mode: '一棟まとめて', per: 5, perB: 2, cycle: 90, active: true });
    renderRoute();
  }
  function renderRoute() {
    U.openSheet(U.sheetTitle(RF.id ? esc(RF.name) + ' <small>を変える</small>' : '回り方を足す'), `
      <label class="lbl" for="rf-name">名前</label>
      <input id="rf-name" class="sel" value="${esc(RF.name)}" placeholder="例：日中のアパート" autocomplete="off" maxlength="20">
      <div class="lbl">渡し方</div>
      <div class="seg two"><button data-act="rfSet" data-f="mode" data-v="一棟まとめて" aria-pressed="${RF.mode === '一棟まとめて'}">一棟まとめて</button><button data-act="rfSet" data-f="mode" data-v="部屋ごと" aria-pressed="${RF.mode === '部屋ごと'}">部屋ごと</button></div>
      ${RF.mode === '部屋ごと' ? `<div class="lbl">1人に割り振る部屋の数</div><div class="gen">${rfStep('per', RF.per, 1, 20)}<span>部屋</span></div>
        <div class="lbl">1つの建物から（1人に）</div><div class="gen">${rfStep('perB', RF.perB, 1, 20)}<span>部屋まで</span></div>
        <p class="muted small">1人に、いくつかの建物から少しずつ割り振ります。「1人に割り振る部屋の数」と同じにすると、なるべく1つの建物にまとめます。</p>` : ''}
      <div class="lbl">回り直すまでの日数</div>
      <div class="gen">${rfStep('cycle', RF.cycle, 0, 365, 10)}<span>日</span></div>
      <p class="muted small">建物の巡回（全部の部屋を一通り回ること）が終わってから、次の巡回を始めるまでの日数です。この日数がたつまで、その建物は集まりで最初には選びません。</p>
      ${RF.id ? `<div class="lbl">使うか</div><div class="seg two"><button data-act="rfSet" data-f="active" data-v="1" aria-pressed="${RF.active}">使う</button><button data-act="rfSet" data-f="active" data-v="" aria-pressed="${!RF.active}">使わない</button></div>
        <p class="muted small">「使わない」にすると、集まりや配る画面に出なくなります。今配っている分と記録は、そのまま残ります。</p>` : ''}
      <button class="btn primary big wide" data-act="rfSave">${RF.id ? '保存する' : '足す'}</button>`);
  }
  function rfStep(f, v, min, max, step) {
    return `<span class="stepper"><button data-act="rfStep" data-f="${f}" data-d="${-(step || 1)}" data-min="${min}" data-max="${max}" ${v <= min ? 'disabled' : ''}>−</button><b class="num">${v}</b><button data-act="rfStep" data-f="${f}" data-d="${step || 1}" data-min="${min}" data-max="${max}" ${v >= max ? 'disabled' : ''}>＋</button></span>`;
  }
  function keepRoute() { const n = document.getElementById('rf-name'); if (n) RF.name = n.value; }
  act.rtNew = () => openRoute(null);
  act.rtOpen = el => openRoute(allRoutes().find(r => r.id === el.dataset.id));
  act.rfSet = el => { keepRoute(); RF[el.dataset.f] = el.dataset.f === 'active' ? !!el.dataset.v : el.dataset.v; renderRoute(); };
  act.rfStep = el => { keepRoute(); const f = el.dataset.f; RF[f] = Math.max(Number(el.dataset.min), Math.min(Number(el.dataset.max), Number(RF[f]) + Number(el.dataset.d))); renderRoute(); };
  act.rfSave = async el => {
    keepRoute();
    if (!RF.name.trim()) { toast('名前を入れてください'); return; }
    el.disabled = true;
    try {
      const r = await api('saveRoute', { route: { id: RF.id, name: RF.name.trim(), mode: RF.mode, per: RF.per, perB: RF.perB, cycle: RF.cycle, active: RF.active } });
      toast(RF.id ? '保存しました' : '「' + r.route.name + '」を足しました');
      U.closeSheet();
      await load();
      K.refresh().catch(() => {});
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* ==================== 人とグループ ==================== */
  const PG = { tab: 'people', mode: '' };
  views.aPeople = async function () {
    if (!A.data) await load();
    if (top() && PG.mode === 'grid') return peopleGrid();
    if (top() && PG.mode === 'add') return peopleAdd();
    if (top() && PG.mode === 'ggrid') return groupsGrid();
    const d = A.data;
    const q = S['p-q'].trim();
    const us = usersSorted(d.users.filter(u => !q || (u.name + u.kana).indexOf(q) >= 0));
    const roleTag = r => r === '一般' ? '' : `<span class="tag ${r === '上位管理者' ? 'top' : ''}">${esc(r)}</span>`;
    let body = '';
    if (PG.tab === 'people') {
      let lastG = null;
      body = `<input id="p-q" class="sel" type="search" placeholder="名前で探す" value="${esc(S['p-q'])}" autocomplete="off">
        ${top() ? `<div class="row wrap"><button class="btn" data-act="pNew">＋ 人を足す</button><button class="btn" data-act="pgMode" data-m="grid">表でまとめて直す</button><button class="btn" data-act="pgMode" data-m="add">貼り付けてまとめて足す</button></div>` : ''}
        <div class="ulist">${us.map(u => { const gh = u.groupId !== lastG ? `<h3 class="ghead">${esc(groupName(u.groupId))}</h3>` : ''; lastG = u.groupId;
          return gh + `<button class="urow ${u.active ? '' : 'off'}" data-act="pOpen" data-id="${u.id}" ${top() ? '' : 'disabled'}><span class="uname"><b>${esc(u.name)}</b><small>${u.cards}枚持っている${u.active ? '' : '・止めている'}</small></span>${roleTag(u.role)}${top() ? I.chev : ''}</button>`; }).join('')}</div>`;
    } else {
      body = `${top() ? '<div class="row wrap"><button class="btn" data-act="gNew">＋ グループを足す</button><button class="btn" data-act="pgMode" data-m="ggrid">表でまとめて直す・足す</button></div>' : ''}
        <div class="ulist">${d.groups.map((g, i) => { const ms = d.users.filter(u => u.groupId === g.id && u.active); const leads = ms.filter(u => u.role === '責任者' || u.role === '副責任者');
          return `<div class="urow grow"><span class="uname"><b>${esc(g.name)}</b><small>${ms.length}人${leads.length ? '・' + leads.map(u => esc(u.name) + '（' + esc(u.role) + '）').join('、') : '・責任者がいません'}</small></span>
            ${top() ? `<span class="ord"><button class="icon-btn" data-act="gUp" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button><button class="icon-btn" data-act="gDown" data-id="${g.id}" ${i === d.groups.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button></span><button class="btn sm" data-act="gOpen" data-id="${g.id}">変える</button>` : ''}</div>`; }).join('')}</div>
        <p class="muted small">責任者と副責任者は、人の「役割」で決まります。グループを変えるときは、人の画面で所属を選び直します。</p>`;
    }
    shell(top() ? '人とグループ' : 'グループの人', `
      ${top() ? `<div class="seg two"><button data-act="pgTab" data-t="people" aria-pressed="${PG.tab === 'people'}">人（${d.users.filter(u => u.active).length}）</button><button data-act="pgTab" data-t="groups" aria-pressed="${PG.tab === 'groups'}">グループ（${d.groups.length}）</button></div>` : ''}
      ${body}`);
  };
  act.pgTab = el => { PG.tab = el.dataset.t; PG.mode = ''; U.render(); };
  act.pgMode = el => { PG.mode = el.dataset.m; if (PG.mode === 'grid') peReset(); if (PG.mode === 'ggrid') geReset(); if (PG.mode === 'add') { PE.parsed = null; } U.render(); window.scrollTo(0, 0); };

  /* ---------- 人とグループ：まとめて直す・足す（0.8.0） ---------- */
  const ROLE_LIST = ['一般', '副責任者', '責任者', '上位管理者'];
  const PE = { draft: {}, sel: {}, gf: 'all', bad: {}, text: '', parsed: null };
  const terrNo = id => (K.geo.terr[id] ? K.geo.terr[id].no : '');
  const terrByNo = no => { const v = String(no || '').trim().toUpperCase(); return v ? (K.geo.list.find(t => t.no === v) || null) : null; };
  const terrList = () => `<datalist id="terr-nos">${K.geo.list.map(t => `<option value="${esc(t.no)}">${esc(t.town)}</option>`).join('')}</datalist>`;
  /** 家の近くの入力の候補：区域の番号と、町・丁目の名前 */
  const nearList = () => `<datalist id="near-opts">${K.geo.list.map(t => `<option value="${esc(t.no)}">${esc(t.town)}</option>`).join('')}${townIndex().list.slice().sort((a, b) => (a.name < b.name ? -1 : 1)).map(t => `<option value="${esc(t.name)}">住所</option>`).join('')}</datalist>`;
  const nearText = v => { const x = nearInfo(v); return x ? x.text : String(v || ''); };
  const PFIELDS = ['name', 'kana', 'groupId', 'role', 'usual', 'mode', 'nearNo', 'active'];
  function personVals(u) {
    return { name: u.name, kana: u.kana || '', groupId: u.groupId || '', role: u.role, usual: u.usual === null || u.usual === undefined ? '' : String(u.usual), mode: u.mode === '近く' ? '近く' : '散らばる', nearNo: nearText(u.near), active: !!u.active };
  }
  function peReset() { PE.draft = {}; PE.sel = {}; PE.bad = {}; }
  const peVal = u => Object.assign(personVals(u), PE.draft[u.id] || {});
  function peChangedIds() {
    return Object.keys(PE.draft).filter(id => { const u = A.data.users.find(x => x.id === id); if (!u) return false; const o = personVals(u), v = peVal(u); return PFIELDS.some(f => String(o[f]) !== String(v[f])); });
  }
  function peBar() {
    const n = peChangedIds().length;
    return bottomBar(`<span class="pe-count">${n ? '<b class="num">' + n + '</b>人を変えています' : '変えたところはまだありません'}</span>`, `<button class="btn" data-act="peUndoAll" ${n ? '' : 'disabled'}>やめる</button><button class="btn primary" data-act="peSave" ${n ? '' : 'disabled'}>保存する</button>`);
  }
  function peopleGrid() {
    const d = A.data;
    const q = S['p-q'].trim();
    let us = usersSorted(d.users);
    if (PE.gf !== 'all') us = us.filter(u => (u.groupId || '') === (PE.gf === 'none' ? '' : PE.gf));
    if (q) us = us.filter(u => (u.name + u.kana).indexOf(q) >= 0);
    const nSel = Object.keys(PE.sel).filter(k => PE.sel[k]).length;
    const gopt = (v, none) => `${none ? '<option value="__">（変えない）</option>' : ''}${d.groups.map(g => `<option value="${g.id}" ${v === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="" ${v === '' && !none ? 'selected' : ''}>グループなし</option>`;
    const sel = (f, id, list, v) => `<select data-pe="${f}" data-id="${id}">${list.map(o => `<option value="${esc(o[0])}" ${String(v) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    const rows = us.map(u => {
      const o = personVals(u), v = peVal(u);
      const ch = f => (String(o[f]) !== String(v[f]) ? 'chg' : '');
      return `<tr class="${PE.bad[u.id] ? 'bad' : ''} ${v.active ? '' : 'off'}">
        <td class="pck"><input type="checkbox" data-pe-sel="${u.id}" ${PE.sel[u.id] ? 'checked' : ''} aria-label="${esc(u.name)}を選ぶ"></td>
        <td class="no ${ch('name')}"><input data-pe="name" data-id="${u.id}" value="${esc(v.name)}" aria-label="名前">${PE.bad[u.id] ? `<small class="err">${esc(PE.bad[u.id])}</small>` : ''}</td>
        <td class="${ch('kana')}"><input data-pe="kana" data-id="${u.id}" value="${esc(v.kana)}" aria-label="ふりがな"></td>
        <td class="${ch('groupId')}"><select data-pe="groupId" data-id="${u.id}">${gopt(v.groupId)}</select></td>
        <td class="${ch('role')}">${sel('role', u.id, ROLE_LIST.map(r => [r, r]), v.role)}</td>
        <td class="${ch('usual')}"><input data-pe="usual" data-id="${u.id}" value="${esc(v.usual)}" inputmode="numeric" class="num w4" aria-label="いつもの枚数"></td>
        <td class="${ch('mode')}">${sel('mode', u.id, [['散らばる', '散らばる'], ['近く', '家の近く']], v.mode)}</td>
        <td class="${ch('nearNo')}"><input data-pe="nearNo" data-id="${u.id}" value="${esc(v.nearNo)}" list="near-opts" placeholder="${v.mode === '近く' ? '例：Z07-3・銭函3丁目' : ''}" class="w9" aria-label="家の近く（区域の番号か住所）"></td>
        <td class="${ch('active')}"><input type="checkbox" data-pe="active" data-id="${u.id}" ${v.active ? 'checked' : ''} aria-label="使っている"></td>
        <td class="muted">${u.cards}枚</td></tr>`;
    }).join('');
    shell('人とグループ', `
      <div class="seg two"><button data-act="pgTab" data-t="people" aria-pressed="true">人（${d.users.filter(u => u.active).length}）</button><button data-act="pgTab" data-t="groups" aria-pressed="false">グループ（${d.groups.length}）</button></div>
      <div class="row wrap"><button class="btn sm" data-act="pgMode" data-m="">一覧にもどる</button><button class="btn sm" data-act="pgMode" data-m="add">貼り付けてまとめて足す</button></div>
      <p class="muted small">表の中で直して、最後に［保存する］を押します（まとめて1回で保存します）。変えたところは色が付きます。左の□で人を選ぶと、選んだ人をまとめて変えられます。</p>
      <div class="row wrap"><select id="pe-gf" class="sel sm"><option value="all" ${PE.gf === 'all' ? 'selected' : ''}>すべてのグループ</option>${d.groups.map(g => `<option value="${g.id}" ${PE.gf === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="none" ${PE.gf === 'none' ? 'selected' : ''}>グループなし</option></select>
        <input id="p-q" class="sel sm" type="search" placeholder="名前で探す" value="${esc(S['p-q'])}" autocomplete="off"></div>
      <div class="pe-bulk">
        <p><b>選んだ <span class="num pe-nsel">${nSel}</span>人を、まとめて：</b></p>
        <div class="pe-bulk-f">
          <label>グループ<select id="pb-group">${gopt('__', true)}</select></label>
          <label>役割<select id="pb-role"><option value="">（変えない）</option>${ROLE_LIST.map(r => `<option>${r}</option>`).join('')}</select></label>
          <label>いつもの枚数<input id="pb-usual" inputmode="numeric" placeholder="（変えない）" class="w6"></label>
          <label>配り方<select id="pb-mode"><option value="">（変えない）</option><option value="散らばる">散らばる</option><option value="近く">家の近く</option></select></label>
          <label>使う<select id="pb-active"><option value="">（変えない）</option><option value="1">使っている</option><option value="0">止めている</option></select></label>
        </div>
        <div class="row wrap"><button class="btn sm primary" data-act="peBulk">選んだ人に当てはめる</button><button class="btn sm" data-act="peSelAll">表に出ている人を全部選ぶ</button><button class="btn sm" data-act="peSelNone">選ぶのをやめる</button></div>
        <p class="muted small">当てはめても、まだ保存はしません。表で確かめてから［保存する］を押してください。</p>
      </div>
      <div class="cy-wrap pe-wrap"><table class="pe"><thead><tr><th class="pck"></th><th class="no">名前（S-13の書き方）</th><th>ふりがな</th><th>グループ</th><th>役割</th><th>枚数</th><th>配り方</th><th>家の近く</th><th>使う</th><th>持っている</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">配り方：「散らばる」は、全員に配る・不在宅訪問の割り当て案で、地域がばらけるように配ります。「家の近く」は、家の近くからまとめて配ります（車がない・足が悪いなど）。家の近くは、区域の番号（例：Z07-3）か住所（例：銭函3丁目、星置1条3丁目）で入れます。住所は町・丁目までで探し、番地は保存しません。地図の場所で決めるときは、人の画面から選びます。</p>
      ${nearList()}`, { bar: peBar() });
    const gf = document.getElementById('pe-gf');
    if (gf) gf.addEventListener('change', () => { PE.gf = gf.value; U.render(); });
  }
  function peUpdateBar() {
    const n = peChangedIds().length;
    const c = document.querySelector('.pe-count');
    if (c) c.innerHTML = n ? '<b class="num">' + n + '</b>人を変えています' : '変えたところはまだありません';
    document.querySelectorAll('[data-act="peSave"], [data-act="peUndoAll"]').forEach(b => { b.disabled = !n; });
  }
  function peInput(el) {
    const id = el.dataset.id, f = el.dataset.pe;
    const u = A.data.users.find(x => x.id === id);
    if (!u) return;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    (PE.draft[id] = PE.draft[id] || {})[f] = v;
    const td = el.closest('td');
    if (td) td.classList.toggle('chg', String(personVals(u)[f]) !== String(v));
    if (f === 'active') { const tr = el.closest('tr'); if (tr) tr.classList.toggle('off', !v); }
    peUpdateBar();
  }
  document.addEventListener('input', e => { const el = e.target; if (el && el.dataset && el.dataset.pe) peInput(el); if (el && el.dataset && el.dataset.ge) geInput(el); });
  document.addEventListener('change', e => {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.pe) peInput(el);
    if (el.dataset.ge) geInput(el);
    if (el.dataset.peSel) { PE.sel[el.dataset.peSel] = el.checked; const n = document.querySelector('.pe-nsel'); if (n) n.textContent = Object.keys(PE.sel).filter(k => PE.sel[k]).length; }
  });
  act.peSelAll = () => {
    document.querySelectorAll('[data-pe-sel]').forEach(x => { PE.sel[x.dataset.peSel] = true; });
    U.render();
  };
  act.peSelNone = () => { PE.sel = {}; U.render(); };
  act.peBulk = () => {
    const ids = Object.keys(PE.sel).filter(k => PE.sel[k]);
    if (!ids.length) { toast('先に、表の左の□で人を選んでください'); return; }
    const g = document.getElementById('pb-group').value, r = document.getElementById('pb-role').value, us = document.getElementById('pb-usual').value.trim();
    const m = document.getElementById('pb-mode').value, a = document.getElementById('pb-active').value;
    if (g === '__' && !r && !us && !m && !a) { toast('変える項目を選んでください'); return; }
    ids.forEach(id => {
      const dd = PE.draft[id] = PE.draft[id] || {};
      if (g !== '__') dd.groupId = g;
      if (r) dd.role = r;
      if (us) dd.usual = String(Math.max(0, Math.min(20, Number(us) || 0)));
      if (m) dd.mode = m;
      if (a) dd.active = a === '1';
    });
    toast(ids.length + '人に当てはめました。確かめて［保存する］を押してください');
    U.render();
  };
  act.peUndoAll = el => { if (!sure(el, 'もう一度押すと、変えたところを全部やめます')) return; PE.draft = {}; PE.bad = {}; U.render(); };
  act.peSave = async el => {
    const ids = peChangedIds();
    if (!ids.length) return;
    const bad = {};
    const people = ids.map(id => {
      const u = A.data.users.find(x => x.id === id);
      const v = peVal(u);
      const nv = String(v.nearNo) === String(personVals(u).nearNo) ? { value: u.near || '' } : nearInput(v.nearNo);
      if (nv.error) bad[id] = nv.error;
      if (v.mode === '近く' && !nv.error && !nv.value) bad[id] = '「家の近く」には、区域の番号か住所を入れてください';
      if (!String(v.name).trim()) bad[id] = '名前を入れてください';
      return { id: id, name: String(v.name).trim(), kana: v.kana, groupId: v.groupId, role: v.role, usual: v.usual, active: !!v.active, mode: v.mode, near: nv.value || '' };
    });
    if (Object.keys(bad).length) { PE.bad = bad; toast(Object.keys(bad).length + '人に直すところがあります（赤い行）'); U.render(); return; }
    el.disabled = true;
    try {
      const r = await api('savePeople', { people: people });
      if (!r.saved) {
        PE.bad = {};
        (r.bad || []).forEach(b => { PE.bad[people[b.i].id] = b.message; });
        toast(r.message + '（赤い行）');
        U.render();
        return;
      }
      toast(r.changed + '人を保存しました');
      peReset();
      await load();
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* 貼り付けてまとめて足す：1行に1人。名前、ふりがな、グループ、役割、いつもの枚数、配り方、家の近く（タブかカンマで区切る） */
  function parsePeople(text) {
    const d = A.data;
    const gBy = {};
    d.groups.forEach(g => { gBy[g.name] = g.id; gBy[g.id] = g.id; });
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !/^名前[\t,、]/.test(s)).map(line => {
      const c = line.split(/\t|,|，/).map(x => x.trim());
      const why = [];
      const gname = c[2] || '';
      const gid = gname ? gBy[gname] : '';
      if (gname && !gid) why.push('グループ「' + gname + '」がありません');
      const role = c[3] || '一般';
      if (ROLE_LIST.indexOf(role) < 0) why.push('役割「' + role + '」はありません');
      const usual = c[4] || '';
      if (usual && !/^\d+$/.test(usual)) why.push('枚数は数で');
      const mode = /近/.test(c[5] || '') ? '近く' : '散らばる';
      const nv = nearInput(c[6] || '');
      if (nv.error) why.push(nv.error);
      if (mode === '近く' && !nv.error && !nv.value) why.push('「家の近く」には区域の番号か住所がいります');
      if (!c[0]) why.push('名前がありません');
      if (d.users.some(u => u.name === c[0])) why.push('同じ名前の人がもういます');
      return { name: c[0] || '', kana: c[1] || '', groupId: gid || '', gname: gname, role: role, usual: usual, mode: mode, near: nv.value || '', nearNo: nv.value ? (nearInfo(nv.value) || {}).short || '' : '', why: why };
    });
  }
  function peopleAdd() {
    const d = A.data;
    const list = PE.parsed;
    const okN = list ? list.filter(x => !x.why.length).length : 0;
    shell('人とグループ', `
      <div class="seg two"><button data-act="pgTab" data-t="people" aria-pressed="true">人（${d.users.filter(u => u.active).length}）</button><button data-act="pgTab" data-t="groups" aria-pressed="false">グループ（${d.groups.length}）</button></div>
      <div class="row wrap"><button class="btn sm" data-act="pgMode" data-m="">一覧にもどる</button><button class="btn sm" data-act="pgMode" data-m="grid">表でまとめて直す</button></div>
      <h2 class="sec">貼り付けてまとめて足す</h2>
      <p class="muted small">1行に1人。左から <b>名前、ふりがな、グループ、役割、いつもの枚数、配り方、家の近く</b>。タブかカンマで区切ります（スプレッドシートからそのまま貼れます）。名前のほかは空でもかまいません（役割は「一般」になります）。家の近くは、区域の番号（Z07-3）か住所（銭函3丁目・星置1条3丁目。番地は使いません）です。</p>
      <p class="muted small">例：<span class="num">山田 太郎,やまだ たろう,${esc((d.groups[0] || {}).name || '第1グループ')},一般,4</span>　／　<span class="num">佐々木 光,ささき ひかる,${esc((d.groups[1] || d.groups[0] || {}).name || '第2グループ')},一般,2,家の近く,Z07-3</span>　／　<span class="num">高橋 恵,たかはし めぐみ,${esc((d.groups[0] || {}).name || '第1グループ')},一般,3,家の近く,星置1条3丁目</span></p>
      <textarea id="pe-text" class="sel rooms-text" rows="8" placeholder="ここに貼り付けます">${esc(PE.text)}</textarea>
      <button class="btn" data-act="peParse">確かめる</button>
      ${list ? `<div class="cy-wrap pe-wrap"><table class="pe"><thead><tr><th class="no">名前</th><th>ふりがな</th><th>グループ</th><th>役割</th><th>枚数</th><th>配り方</th><th>家の近く</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr class="${x.why.length ? 'bad' : ''}"><td class="no">${esc(x.name)}</td><td>${esc(x.kana)}</td><td>${esc(x.gname || 'なし')}</td><td>${esc(x.role)}</td><td class="num">${esc(x.usual)}</td><td>${x.mode === '近く' ? '家の近く' : '散らばる'}</td><td>${esc(x.nearNo)}</td><td>${x.why.length ? '<small class="err">' + esc(x.why.join('、')) + '</small>' : '<span class="tag ok">足せます</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${terrList()}`, { bar: list ? bottomBar(`<b class="num">${okN}</b>人を足せます${list.length - okN ? '<small>' + (list.length - okN) + '行は直すところがあります（足しません）</small>' : ''}`, `<button class="btn primary" data-act="peAdd" ${okN ? '' : 'disabled'}>${okN}人を足す</button>`) : '' });
  }
  act.peParse = () => { PE.text = document.getElementById('pe-text').value; PE.parsed = parsePeople(PE.text); U.render(); };
  act.peAdd = async el => {
    const list = (PE.parsed || []).filter(x => !x.why.length);
    if (!list.length) return;
    el.disabled = true;
    try {
      const r = await api('savePeople', { people: list.map(x => ({ name: x.name, kana: x.kana, groupId: x.groupId, role: x.role, usual: x.usual, active: true, mode: x.mode, near: x.near })) });
      if (!r.saved) { toast(r.message); el.disabled = false; return; }
      toast(r.added + '人を足しました。［利用カード］の画面から印刷してください');
      PE.text = ''; PE.parsed = null; PG.mode = '';
      await load();
      U.render();
    } catch (e) { el.disabled = false; }
  };

  /* グループを表でまとめて直す・足す */
  const GE = { draft: {}, adds: [] };
  function geReset() { GE.draft = {}; GE.adds = []; }
  const gVals = g => ({ name: g.name, area: g.area || '', order: String(g.order === undefined ? '' : g.order), active: true });
  function geInput(el) {
    const id = el.dataset.id, f = el.dataset.ge;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (id.indexOf('new') === 0) { const x = GE.adds[Number(id.slice(3))]; if (x) x[f] = v; }
    else (GE.draft[id] = GE.draft[id] || {})[f] = v;
    const g = A.data.groups.find(x => x.id === id);
    const td = el.closest('td');
    if (td && g) td.classList.toggle('chg', String(gVals(g)[f]) !== String(v));
    geUpdateBar();
  }
  function geChanged() {
    return A.data.groups.filter(g => { const dd = GE.draft[g.id]; if (!dd) return false; const o = gVals(g); return Object.keys(dd).some(f => String(o[f]) !== String(dd[f])); });
  }
  function geCount() { return geChanged().length + GE.adds.filter(x => String(x.name || '').trim()).length; }
  function geUpdateBar() {
    const n = geCount();
    const c = document.querySelector('.ge-count');
    if (c) c.innerHTML = n ? '<b class="num">' + n + '</b>件を変えています' : '変えたところはまだありません';
    document.querySelectorAll('[data-act="geSave"]').forEach(b => { b.disabled = !n; });
  }
  function groupsGrid() {
    const d = A.data;
    const rows = d.groups.map((g, i) => {
      const o = gVals(g), v = Object.assign({}, o, GE.draft[g.id] || {});
      const ch = f => (String(o[f]) !== String(v[f]) ? 'chg' : '');
      const n = d.users.filter(u => u.groupId === g.id && u.active).length;
      return `<tr class="${v.active ? '' : 'off'}"><td class="no ${ch('name')}"><input data-ge="name" data-id="${g.id}" value="${esc(v.name)}" aria-label="グループの名前"></td>
        <td class="${ch('area')}"><input data-ge="area" data-id="${g.id}" value="${esc(v.area)}" aria-label="主に回るエリア"></td>
        <td class="${ch('order')}"><input data-ge="order" data-id="${g.id}" value="${esc(v.order || String(i + 1))}" inputmode="numeric" class="num w4" aria-label="並び順"></td>
        <td class="num">${n}人</td>
        <td class="${ch('active')}"><input type="checkbox" data-ge="active" data-id="${g.id}" ${v.active ? 'checked' : ''} ${n ? 'disabled title="メンバーがいるグループはなくせません"' : ''} aria-label="使う"></td></tr>`;
    }).join('') + GE.adds.map((x, i) => `<tr class="newrow"><td class="no"><input data-ge="name" data-id="new${i}" value="${esc(x.name || '')}" placeholder="新しいグループの名前"></td><td><input data-ge="area" data-id="new${i}" value="${esc(x.area || '')}" placeholder="例：星置"></td><td><input data-ge="order" data-id="new${i}" value="${esc(x.order || '')}" inputmode="numeric" class="num w4"></td><td class="muted">新しい</td><td></td></tr>`).join('');
    const n = geCount();
    shell('人とグループ', `
      <div class="seg two"><button data-act="pgTab" data-t="people" aria-pressed="false">人（${d.users.filter(u => u.active).length}）</button><button data-act="pgTab" data-t="groups" aria-pressed="true">グループ（${d.groups.length}）</button></div>
      <div class="row wrap"><button class="btn sm" data-act="pgMode" data-m="">一覧にもどる</button><button class="btn sm" data-act="geAddRow">＋ 行を足す</button></div>
      <p class="muted small">名前・主に回るエリア・並び順を表の中で直して、最後に［保存する］を押します。新しいグループは［＋ 行を足す］で何行でも足せます。メンバーがいるグループは、なくせません（先に「人」の表で、ほかのグループへ移してください）。</p>
      <div class="cy-wrap pe-wrap"><table class="pe"><thead><tr><th class="no">名前</th><th>主に回るエリア</th><th>並び順</th><th>人数</th><th>使う</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      { bar: bottomBar(`<span class="ge-count">${n ? '<b class="num">' + n + '</b>件を変えています' : '変えたところはまだありません'}</span>`, `<button class="btn primary" data-act="geSave" ${n ? '' : 'disabled'}>保存する</button>`) });
  }
  act.geAddRow = () => { GE.adds.push({ name: '', area: '', order: '' }); U.render(); };
  act.geSave = async el => {
    const list = geChanged().map(g => { const v = Object.assign(gVals(g), GE.draft[g.id]); return { id: g.id, name: String(v.name).trim(), area: v.area, order: v.order, active: !!v.active }; })
      .concat(GE.adds.filter(x => String(x.name || '').trim()).map(x => ({ name: String(x.name).trim(), area: x.area || '', order: x.order || '' })));
    if (!list.length) return;
    el.disabled = true;
    try {
      const r = await api('saveGroups', { groups: list });
      if (!r.saved) { toast((r.bad || []).map(b => (b.name || '') + '：' + b.message).join('／') || r.message); el.disabled = false; return; }
      toast('グループを保存しました' + (r.added ? '（足した ' + r.added + '）' : ''));
      geReset();
      await load();
      U.render();
    } catch (e) { el.disabled = false; }
  };
  const PF = {};
  function openPerson(u) {
    Object.assign(PF, u ? { id: u.id, name: u.name, kana: u.kana, groupId: u.groupId, role: u.role, usual: u.usual === null || u.usual === undefined ? '' : u.usual, active: u.active, key: u.key, mode: u.mode === '近く' ? '近く' : '散らばる' } :
      { id: '', name: '', kana: '', groupId: (A.data.groups[0] || {}).id || '', role: '一般', usual: '', active: true, key: '', mode: '散らばる' });
    const ni = u ? nearInfo(u.near) : null;
    Object.assign(PF, { nearType: ni ? ni.type : 'terr', nearNo: ni && ni.type === 'terr' ? ni.text : '', nearAddr: ni && ni.type === 'addr' ? ni.text : '', nearPt: ni && ni.type === 'map' ? ni.point : null });
    renderPerson();
  }
  function renderPerson() {
    const d = A.data;
    U.openSheet(U.sheetTitle(PF.id ? esc(PF.name) : '人を足す'), `
      <label class="lbl" for="pf-name">名前（S-13に載る書き方）</label><input id="pf-name" class="sel" value="${esc(PF.name)}" autocomplete="off">
      <label class="lbl" for="pf-kana">ふりがな</label><input id="pf-kana" class="sel" value="${esc(PF.kana)}" autocomplete="off">
      <label class="lbl" for="pf-group">グループ</label><select id="pf-group" class="sel">${d.groups.map(g => `<option value="${g.id}" ${PF.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="" ${!PF.groupId ? 'selected' : ''}>グループなし</option></select>
      <div class="lbl">役割</div><div class="seg wrap">${['一般', '副責任者', '責任者', '上位管理者'].map(r => `<button data-act="pfSet" data-f="role" data-v="${r}" aria-pressed="${PF.role === r}">${r}</button>`).join('')}</div>
      <p class="muted small">責任者・副責任者は、自分のグループの手持ちを配り、回収できます。上位管理者は、すべての管理ができます。</p>
      <div class="lbl">いつもの枚数（全員に配るときの目安）</div>
      <div class="gen"><span class="stepper"><button data-act="pfUsual" data-d="-1">−</button><b class="num">${PF.usual === '' ? '—' : PF.usual}</b><button data-act="pfUsual" data-d="1">＋</button></span><button class="link" data-act="pfUsual" data-d="0">決めない</button></div>
      <div class="lbl">配り方（全員に配る・不在宅訪問の割り当て案）</div>
      <div class="seg two"><button data-act="pfSet" data-f="mode" data-v="散らばる" aria-pressed="${PF.mode !== '近く'}">散らばるように（ふつう）</button><button data-act="pfSet" data-f="mode" data-v="近く" aria-pressed="${PF.mode === '近く'}">家の近くにまとめる</button></div>
      ${PF.mode === '近く' ? nearForm() : '<p class="muted small">ふつうは「散らばるように」。1人に何枚か配るとき、地域がばらけるように選びます。</p>'}
      <div class="lbl">使っているか</div><div class="seg two"><button data-act="pfSet" data-f="active" data-v="1" aria-pressed="${PF.active}">使っている</button><button data-act="pfSet" data-f="active" data-v="" aria-pressed="${!PF.active}">止めている</button></div>
      <button class="btn primary big wide" data-act="pfSave">${PF.id ? '保存する' : '足す'}</button>
      ${PF.id && PF.active ? `<button class="btn wide" data-act="pfGive">${I.map}<span>この人に配る（地図で見て選ぶ）</span></button>` : ''}
      ${PF.id ? `<button class="btn wide" data-act="pfReissue">利用カードを作り直す（なくしたとき）</button>` : ''}`);
  }
  /** 家の近くの決め方：区域の番号・住所・地図の場所 */
  function nearForm() {
    const T = PF.nearType || 'terr';
    const seg = `<div class="seg three">${[['terr', '区域の番号'], ['addr', '住所'], ['map', '地図で決める']].map(x => `<button data-act="pfNearType" data-v="${x[0]}" aria-pressed="${T === x[0]}">${x[1]}</button>`).join('')}</div>`;
    let body = '';
    if (T === 'terr') {
      body = `<label class="lbl" for="pf-near">家の近くの区域（番号）</label><input id="pf-near" class="sel" list="terr-nos" value="${esc(PF.nearNo || '')}" placeholder="例：Z07-3" autocomplete="off">${terrList()}`;
    } else if (T === 'addr') {
      const r = PF.nearAddr ? resolveAddr(PF.nearAddr) : null;
      body = `<label class="lbl" for="pf-addr">住所（町・丁目まででかまいません）</label><input id="pf-addr" class="sel" value="${esc(PF.nearAddr || '')}" placeholder="例：銭函3丁目、星置1条3丁目" autocomplete="off">
        <p class="small near-hit">${addrHit(r, PF.nearAddr)}</p>
        <p class="muted small">町・丁目を探して、その真ん中を「家の近く」にします。番地や建物の名前は保存しません（保存するのは「銭函三丁目」のような町・丁目の名前だけ）。</p>`;
    } else {
      const pt = PF.nearPt;
      body = `<p class="small">${pt ? '<b>決めた場所：</b>' + esc(townNear(pt)) + 'のあたり（' + pt[0].toFixed(3) + ', ' + pt[1].toFixed(3) + '）' : 'まだ決めていません。'}</p>
        <button class="btn wide" data-act="pfNearMap">${I.map}<span>${pt ? '地図で決め直す' : '地図を開いて決める'}</span></button>
        <p class="muted small">地図をさわった所を「家の近く」にします。約100mの細かさで保存します（家そのものの場所でなくてかまいません）。</p>`;
    }
    return `<div class="lbl">家の近く</div>${seg}${body}<p class="muted small">車がない・年配・足が悪いなど、近くを回る人に。割り当て案で、ここに近い区域からまとめて選びます。</p>`;
  }
  function addrHit(r, text) {
    if (!String(text || '').trim()) return '';
    if (!r) return '<span class="warn-t">見つかりません。町の名前（例：銭函・桂岡町・星置）から入れてください</span>';
    return '→ <b>' + esc(r.name) + '</b>のあたり' + (r.whole ? '（丁目まで入れると、もっと近くになります）' : '');
  }
  document.addEventListener('input', e => {
    if (!e.target || e.target.id !== 'pf-addr') return;
    PF.nearAddr = e.target.value;
    const hit = document.querySelector('.near-hit');
    if (hit) hit.innerHTML = addrHit(resolveAddr(PF.nearAddr), PF.nearAddr);
  });
  act.pfNearType = el => { keepPerson(); PF.nearType = el.dataset.v; renderPerson(); };
  /** 地図で家の近くを決める（さわった所に印。［ここにする］で人の画面にもどる） */
  act.pfNearMap = () => {
    keepPerson();
    let pick = PF.nearPt ? PF.nearPt.slice() : null;
    U.openSheet(U.sheetTitle('家の近くを地図で決める'), `<p class="muted small">家のあたりをさわってください。区域の番号は、近づけると出ます。</p>
      <div class="near-map" id="near-map"></div>
      <p class="small near-pick">${pick ? esc(townNear(pick)) + 'のあたり' : 'まださわっていません'}</p>
      <div class="row-btns"><button class="btn" data-act="pfNearBack">もどる</button><button class="btn primary" data-act="pfNearOk">ここにする</button></div>`);
    setTimeout(() => {
      const el = document.getElementById('near-map');
      if (!el || !window.L) return;
      const center = pick || (nearInfo(A.data.users.find(u => u.id === PF.id) ? A.data.users.find(u => u.id === PF.id).near : '') || {}).point;
      let pin = null;
      let ctl = null;
      const place = ll => {
        pick = [ll.lat, ll.lng];
        PF.nearPick = pick;
        if (pin) pin.setLatLng(ll); else pin = L.marker(ll, { icon: L.divIcon({ className: 'tm-pin', html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 26] }), keyboard: false, interactive: false }).addTo(ctl.map);
        const p = document.querySelector('.near-pick');
        if (p) p.textContent = townNear(pick) + 'のあたり';
      };
      ctl = K.terrMap(el, {
        style: () => ({ stroke: '#64748b', fill: '#cbd5e1', fillOpacity: 0.12, weight: 1 }),
        label: id => esc(K.geo.terr[id].no),
        labelZoom: 15.5,
        onTapPoint: place,
        view: center ? { center: center, zoom: 16 } : null,
      });
      PF.nearPick = pick;
      if (pick) place(L.latLng(pick[0], pick[1]));
      PF.nearCtl = ctl;
    }, 60);
  };
  const nearMapDone = () => { if (PF.nearCtl) { PF.nearCtl.destroy(); PF.nearCtl = null; } };
  act.pfNearBack = () => { nearMapDone(); renderPerson(); };
  act.pfNearOk = () => {
    if (!PF.nearPick) { toast('地図をさわって、場所を決めてください'); return; }
    PF.nearPt = PF.nearPick; PF.nearType = 'map';
    nearMapDone(); renderPerson();
  };
  function keepPerson() {
    const n = document.getElementById('pf-name'), k = document.getElementById('pf-kana'), g = document.getElementById('pf-group'), ne = document.getElementById('pf-near'), ad = document.getElementById('pf-addr');
    if (n) PF.name = n.value; if (k) PF.kana = k.value; if (g) PF.groupId = g.value; if (ne) PF.nearNo = ne.value; if (ad) PF.nearAddr = ad.value;
  }
  /** 人の画面の「家の近く」を保存する値に。{value} か {error} */
  function pfNearValue() {
    if (PF.mode !== '近く') return { value: '' };
    const T = PF.nearType || 'terr';
    if (T === 'terr') { const t = terrByNo(PF.nearNo); return t ? { value: t.id } : { error: PF.nearNo ? '区域「' + PF.nearNo + '」が見つかりません' : '家の近くの区域の番号を入れてください' }; }
    if (T === 'addr') { const r = resolveAddr(PF.nearAddr); return r ? { value: '住所:' + r.key } : { error: PF.nearAddr ? '住所「' + PF.nearAddr + '」の町が見つかりません' : '家の近くの住所を入れてください' }; }
    return PF.nearPt ? { value: mapNear(PF.nearPt) } : { error: '地図で家の近くを決めてください' };
  }
  act.pNew = () => openPerson(null);
  /** 人の画面から、その人に1枚ずつ配る画面へ（地図で見て選ぶ） */
  act.pfGive = () => {
    U.closeSheet();
    ON.userId = PF.id; ON.pick = ''; ON.bk = {};
    if (isBKind(ON.kind) && !aptOnly()) ON.kind = '通常';
    MV.one = 'map';
    ON.scrollMap = true;
    U.go('aOne', { fresh: true });
  };
  act.pOpen = el => openPerson(A.data.users.find(u => u.id === el.dataset.id));
  act.pfSet = el => { keepPerson(); PF[el.dataset.f] = el.dataset.f === 'active' ? !!el.dataset.v : el.dataset.v; renderPerson(); };
  act.pfUsual = el => { keepPerson(); const d = Number(el.dataset.d); PF.usual = d === 0 ? '' : Math.max(0, Math.min(10, (PF.usual === '' ? 4 : Number(PF.usual)) + d)); renderPerson(); };
  act.pfSave = async el => {
    keepPerson();
    const nv = pfNearValue();
    if (nv.error) { toast(nv.error); return; }
    el.disabled = true;
    try {
      const r = await api('savePerson', { person: { id: PF.id, name: PF.name, kana: PF.kana, groupId: PF.groupId, role: PF.role, usual: PF.usual, active: PF.active, mode: PF.mode, near: nv.value } });
      toast(PF.id ? '保存しました' : PF.name + 'さんを足しました。利用カードを印刷してください');
      U.closeSheet();
      await load();
      U.render();
      if (r.key) showKey(PF.name, r.key);
    } catch (e) { el.disabled = false; }
  };
  act.pfReissue = async el => {
    if (!sure(el, 'もう一度押すと作り直します（前のカードは使えなくなります）')) return;
    try {
      const r = await api('reissueKey', { userId: PF.id });
      await load();
      U.render();
      showKey(PF.name, r.key);
    } catch (e) { /* api が知らせる */ }
  };
  function showKey(name, key) {
    U.openSheet(U.sheetTitle(esc(name) + ' <small>さんの利用カード</small>'), `<p class="lead">新しい番号です。「利用カード」の画面から印刷して渡してください。</p><p class="keybig num">${esc(K.fmtKey(key))}</p>
      <button class="btn wide" data-act="aGo" data-v="aCards">利用カードの画面へ</button>`);
  }
  const GF = {};
  act.gNew = () => { Object.assign(GF, { id: '', name: '', area: '' }); renderGroup(); };
  act.gOpen = el => { const g = A.data.groups.find(x => x.id === el.dataset.id); Object.assign(GF, { id: g.id, name: g.name, area: g.area || '' }); renderGroup(); };
  function renderGroup() {
    U.openSheet(U.sheetTitle(GF.id ? esc(GF.name) : 'グループを足す'), `
      <label class="lbl" for="gf-name">グループの名前</label><input id="gf-name" class="sel" value="${esc(GF.name)}" autocomplete="off">
      <label class="lbl" for="gf-area">主に回るエリア（メモ）</label><input id="gf-area" class="sel" value="${esc(GF.area)}" placeholder="例：銭函・桂岡" autocomplete="off">
      <button class="btn primary big wide" data-act="gfSave">${GF.id ? '保存する' : '足す'}</button>
      ${GF.id ? '<button class="btn danger wide" data-act="gfRemove">このグループをなくす（メンバーがいないときだけ）</button>' : ''}`);
  }
  act.gfSave = async el => {
    el.disabled = true;
    try {
      await api('saveGroup', { group: { id: GF.id, name: document.getElementById('gf-name').value, area: document.getElementById('gf-area').value } });
      toast('保存しました'); U.closeSheet(); await load(); U.render();
    } catch (e) { el.disabled = false; }
  };
  act.gfRemove = async el => {
    if (!sure(el, 'もう一度押すと、なくします')) return;
    try { await api('saveGroup', { group: { id: GF.id, name: GF.name, active: false } }); toast('グループをなくしました'); U.closeSheet(); await load(); U.render(); } catch (e) { /* api が知らせる */ }
  };
  async function moveGroup(id, dir) {
    const gs = A.data.groups.slice();
    const i = gs.findIndex(g => g.id === id);
    const j = i + dir;
    if (j < 0 || j >= gs.length) return;
    [gs[i], gs[j]] = [gs[j], gs[i]];
    try {
      await api('saveGroup', { group: { id: gs[i].id, name: gs[i].name, order: i + 1 } });
      await api('saveGroup', { group: { id: gs[j].id, name: gs[j].name, order: j + 1 } });
      await load(); U.render();
    } catch (e) { /* api が知らせる */ }
  }
  act.gUp = el => moveGroup(el.dataset.id, -1);
  act.gDown = el => moveGroup(el.dataset.id, 1);

  /* ==================== 利用カード ==================== */
  const CD = { group: 'all' };
  views.aCards = async function () {
    if (!A.data) await load();
    const d = A.data;
    const base = d.appUrl || K.cfg.appUrl || (location.origin + location.pathname);
    const canPrint = K.cfg.canPrint && !H.inFrame;
    const qr = text => { if (!window.qrcode) return ''; const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); };
    const list = usersSorted(d.users.filter(u => u.active && (CD.group === 'all' || u.groupId === CD.group)));
    shell('利用カード', `
      <p class="muted small">一人1枚。QRコードには、その人だけの番号が入っています。なくしたときは「人とグループ」で作り直すと、古いカードは使えなくなります。</p>
      ${K.state.demo ? '<p class="notice info">お試し版のQRコードは見本です。読み取っても開けません。</p>' : ''}
      <div class="seg wrap"><button data-act="cdGroup" data-g="all" aria-pressed="${CD.group === 'all'}">全員</button>${d.groups.map(g => `<button data-act="cdGroup" data-g="${g.id}" aria-pressed="${CD.group === g.id}">${esc(g.name)}</button>`).join('')}</div>
      ${canPrint ? '<button class="btn primary" data-act="print">利用カードを印刷する</button>' : ''}
      <div class="ucards print-area">${list.map(u => `
        <article class="ucard">
          <div class="uqr">${u.key ? qr(base + '#k=' + u.key) : ''}</div>
          <div class="uinfo"><p class="uapp">区域訪問管理　利用カード</p><p class="uname">${esc(u.name)}<small>さん</small></p>
            <p class="ukey num">${esc(K.fmtKey(u.key))}</p>
            <ol class="usteps"><li>スマホのカメラでQRコードを読み取る</li><li>開いた画面を「ホーム画面に追加」</li></ol></div>
        </article>`).join('')}</div>`);
  };
  act.cdGroup = el => { CD.group = el.dataset.g; U.render(); };
  act.print = () => { try { window.print(); } catch (e) { toast('この画面では印刷できません'); } };

  /* 地図の手直し（mapedit.js）で使う道具 */
  K.adminKit = { A, load, shell, api, sure, toast, target, sortButtons, afterHouseState, S, top, mapCtl: () => AM.ctl,
    mapSlot, viewSeg, legend, outMap, bottomBar, usersSorted, groupName, noKey, aptOnly, tLabel, MV, nearInfo, townIndex, kmBetween, centerOf, routesOf, rName, roundText };
})();

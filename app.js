/*
 * 区域訪問管理 — 画面（一般の人の画面と共通の部品）
 *   はじめに（利用カード）→ わたしの区域 → 区域の地図で家を記録 ／ 集合住宅は部屋の一覧で記録
 *   設定と確認 ／ お試し版。管理の画面は admin.js
 */
(function () {
  'use strict';
  const K = window.K;
  const app = document.getElementById('app');

  /* ---------- 小さな道具 ---------- */
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const ymd = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const md = s => { if (!s) return ''; const d = ymd(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; };
  const mdShort = s => { if (!s) return ''; const d = ymd(s); return (d.getMonth() + 1) + '/' + d.getDate(); };
  const hm = iso => { const d = new Date(iso); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const whenText = iso => {
    const d = new Date(iso); const t = new Date();
    return d.toDateString() === t.toDateString() ? '今日 ' + hm(iso) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(iso);
  };
  const daysLeft = due => { if (!due) return 99; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((ymd(due) - t) / 864e5); };
  const dueText = due => { if (!due) return ''; const dl = daysLeft(due); return dl < 0 ? '回収日を過ぎました' : dl === 0 ? '今日が回収日' : '回収日 ' + md(due); };
  /** カードに出す回収日の一言と、色の段階 */
  function dueChip(c) {
    const x = K.dueInfo(c);
    if (x.phase === 'none') return { text: '', cls: '' };
    if (x.gather) return { text: x.dd === 0 ? '今日まで' : x.dd < 0 ? '回収日を過ぎました' : '回収日 ' + mdShort(c.due), cls: x.dd <= 0 ? 'soon' : '' };
    if (x.phase === 'grace') return { text: '回収日を過ぎました', cls: 'soon' };
    if (x.phase === 'soon') return { text: x.dd === 0 ? '今日が回収日' : '回収日 ' + mdShort(c.due) + '（あと' + x.dd + '日）', cls: 'soon' };
    return { text: '回収日 ' + mdShort(c.due), cls: '' };
  }
  /** 区域の画面に出す、回収日の知らせ（近いときと過ぎたときだけ。地図を広く使えるよう短く） */
  function dueNote(c) {
    const x = K.dueInfo(c);
    if (x.gather || (x.phase !== 'soon' && x.phase !== 'grace')) return '';
    const text = x.phase === 'grace' ? '回収日を過ぎました。' + (c.forced ? md(c.forced) + 'まで記録できます' : '')
      : (x.dd === 0 ? '今日が回収日です' : md(c.due) + 'が回収日です') + (c.forced ? '（' + mdShort(c.forced) + 'のあと自動で回収）' : '');
    return '<p class="due-note ' + x.phase + '">' + I.wait + '<span>' + esc(text) + '</span></p>';
  }
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const vibrate = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* なくてもよい */ } };
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      const s = document.createElement('script');
      s.src = src; s.dataset.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' を読めませんでした'));
      document.head.appendChild(s);
    });
  }
  /*
   * ファイルを保存する（S-13 の Word・PDF など。0.11.0）。
   *   ふつうのページ：ブラウザーのダウンロード。claude.ai に置いたお試し版の中では、そのページの「保存」の仕組み
   *   （見る人に確かめてから保存する）が使えるときだけ保存できる
   */
  let DLNS = null;
  if (inFrame && window.claude && typeof window.claude.use === 'function') {
    try { window.claude.use('downloads').then(ns => { DLNS = ns || null; if (DLNS && K.ui && K.ui.view().name === 'aPrint') K.ui.render(); }).catch(() => { DLNS = null; }); } catch (e) { DLNS = null; }
  }
  const canSave = () => !inFrame || !!K.cfg.canSave || !!DLNS;
  /** 返り値：'saved'（保存した・ダウンロードに渡した）か 'declined'（見る人がやめた） */
  async function saveFile(blob, name) {
    if (inFrame && DLNS) {
      try { await DLNS.save({ filename: name, data: blob }); return 'saved'; } catch (e) {
        if (e && e.code === 'declined') return 'declined';
        throw new Error(e && e.code === 'rate_limited' ? '保存の確かめが開いています。少し待ってから押してください' : '保存できませんでした（' + ((e && (e.message || e.code)) || e) + '）');
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    return 'saved';
  }
  K.h = { esc, ymd, todayStr, md, mdShort, hm, whenText, daysLeft, dueText, isStandalone, inFrame, isIOS, vibrate, loadScript, canSave, saveFile };
  K.h.dueChip = c => dueChip(c);

  const GLYPH = { '未': '', '会えた': '会', '不在': '不', '拒否': '拒', '済': '済' };
  const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>（国土地理院）';
  const OWN_ATTR = '保存した地図：国土地理院ベクトルタイル提供実験を加工して作成';
  /** 全国最新写真には GRUS画像（衛星画像）が入る所があり、そのときは出典を足すよう求められている */
  const PHOTO_ATTR = GSI_ATTR + '・一部 GRUS画像（© Axelspace）';

  const I = {
    back: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    fit: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    locate: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    gmap: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>',
    ret: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 14 4 9l5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4.5 12.5 10 18 19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M8 14.5l2.2 2.2 4.6-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    wait: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    nosignal: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 19h2M9 19v-4M14 19v-8M19 19V7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="9" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 20c.6-3.6 3.2-5.6 6.2-5.6s5.6 2 6.2 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.3M18.2 14.6c1.7.8 2.8 2.6 3.1 5.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 7h3l1.6-2.4h6.8L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12.6" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    keyb: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    layers: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m3 13 9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    bldg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="2"/></svg>',
    print: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 8V3.5h10V8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><rect x="3" y="8" width="18" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="7" y="13.5" width="10" height="7" rx="1" fill="var(--surface, #fff)" stroke="currentColor" stroke-width="2.2"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8 4 20Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/><path d="M13.5 7.2l3.3 3.3" stroke="currentColor" stroke-width="2.1"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5l1.5-2Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
    doc: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v4h4M12 10v7M9 14l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 21V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4.5h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const LOGO = '<svg class="logo" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M7 8h8v7H7zM17 8h8v7h-8zM7 17h8v7H7z" fill="var(--accent-fg)" opacity=".92"/><circle cx="21" cy="20.5" r="4.2" fill="var(--ok)" stroke="var(--accent-fg)" stroke-width="1.6"/></svg>';

  /* ---------- 画面の切り替え ---------- */
  const views = {};
  const act = {};
  let view = { name: 'boot' };
  function go(name, params, replace) {
    leaveView();
    const t = document.querySelector('.toast'); if (t) t.remove();
    view = Object.assign({ name: name }, params || {});
    try { history[replace ? 'replaceState' : 'pushState']({ v: view }, ''); } catch (e) { /* 使えない環境 */ }
    render();
    window.scrollTo(0, 0);
  }
  function back() {
    let st = null;
    try { st = history.state; } catch (e) { st = null; }
    if (st && st.v && st.v.name !== 'home' && st.v.name !== 'start') { try { history.back(); return; } catch (e) { /* 下へ */ } }
    go(K.state.key ? 'home' : 'start', null, true);
  }
  window.addEventListener('popstate', e => {
    leaveView();
    closeSheet();
    const v = e.state && e.state.v;
    view = v && v.name !== 'boot' ? Object.assign({}, v) : { name: K.state.key ? 'home' : 'start' };
    if (!K.state.key && ['start', 'key', 'scan', 'demo'].indexOf(view.name) < 0) view = { name: 'start' };
    render();
  });
  const leaveHooks = [];
  function leaveView() { leaveHooks.forEach(f => { try { f(); } catch (e) { /* 次へ */ } }); destroyMap(); stopCamera(); }

  function render() {
    app.classList.remove('fill');
    const fn = views[view.name];
    if (fn) fn(view);
    else app.innerHTML = '<div class="boot">読み込んでいます…</div>';
  }

  /* ---------- 送信の状態 ---------- */
  let authError = null;
  function syncInfo() {
    const s = K.state;
    const n = s.outbox.length;
    if (K.sync.busy && n) return { cls: 'info', icon: I.up, text: '送っています（' + n + '件）', short: '送信中', quiet: false };
    if (n && !K.net.online) return { cls: 'warn', icon: I.nosignal, text: '電波を待っています（' + n + '件）。記録はこのスマホに残っています。電波が戻ると自動で送ります。', short: '送信待ち ' + n, quiet: false };
    if (n) return { cls: 'warn', icon: I.wait, text: '送信待ち ' + n + '件。まもなく自動で送ります。', short: '送信待ち ' + n, quiet: false };
    if (!K.net.online) return { cls: 'mute', icon: I.nosignal, text: '電波がありません。記録はできます。', short: '電波なし', quiet: false };
    if (s.failed.length) return { cls: 'bad', icon: I.x, text: '送れなかった記録が' + s.failed.length + '件あります。「設定」の画面で見られます。', short: '要確認', quiet: false };
    return { cls: 'ok', icon: I.check, text: '記録はすべて送りました' + (s.lastSync ? '（' + whenText(s.lastSync) + '）' : ''), short: '送信済み', quiet: true };
  }
  function updateStatus() {
    const i = syncInfo();
    document.querySelectorAll('[data-status]').forEach(el => {
      const quietMode = el.hasAttribute('data-quiet');
      el.className = 'status s-' + i.cls + (quietMode && i.quiet ? ' quiet' : '');
      el.innerHTML = i.icon + '<span>' + esc(i.text) + '</span>';
    });
    document.querySelectorAll('[data-status-mini]').forEach(el => {
      el.className = 'mini-status s-' + i.cls;
      el.innerHTML = i.icon + '<span>' + esc(i.short) + '</span>';
    });
    document.querySelectorAll('[data-act="toggleNet"]').forEach(el => {
      el.textContent = K.demo.offline ? '電波を戻す' : '電波を切ってみる';
      el.setAttribute('aria-pressed', K.demo.offline ? 'true' : 'false');
    });
  }

  function demoBar() {
    if (!K.state.demo) return '';
    return '<div class="demo-bar"><span class="demo-tag">お試し版</span><span class="demo-note">記録はこの端末の中だけ</span>' +
      '<button class="demo-net" data-act="toggleNet" aria-pressed="' + (K.demo.offline ? 'true' : 'false') + '">' + (K.demo.offline ? '電波を戻す' : '電波を切ってみる') + '</button></div>';
  }
  function topBar(opts) {
    return `<header class="top">
      ${opts.back ? `<button class="back-btn" data-act="${opts.backAct || 'back'}" aria-label="もどる">${I.back}<span>もどる</span></button>` : ''}
      <div class="title">${opts.title || ''}${opts.sub ? `<span class="sub">${opts.sub}</span>` : ''}</div>
      ${opts.right || ''}
    </header>`;
  }

  /* ---------- はじめに（利用カード） ---------- */
  views.start = function () {
    if (K.cfg.demoOnly) return views.demo();
    const sa = isStandalone();
    app.innerHTML = `
      <main class="start">
        <div class="start-mark">${LOGO.replace('width="30" height="30"', 'width="64" height="64"')}</div>
        <h1>区域訪問管理</h1>
        <p class="lead">利用カードのQRコードを、スマホのカメラで読み取ってください。</p>
        ${sa ? '<p class="notice info">ホーム画面から開いたときは、最初の1回だけ、もう一度カードを読み取ります。</p>' : ''}
        ${authError ? '<p class="notice">' + esc(authError.message) + '</p>' : ''}
        <div class="stack">
          <button class="btn primary big" data-act="scan">${I.camera}カメラでQRを読み取る</button>
          <button class="btn big" data-act="typeKey">${I.keyb}カードの番号を入れる</button>
        </div>
        ${K.cfg.demo ? '<div class="demo-entry"><p class="muted">カードがなくても、見本のデータで操作を試せます。</p><button class="btn ghost" data-act="demo">お試し版で使ってみる</button></div>' : ''}
        <p class="credit">地図：${GSI_ATTR}（写真は全国最新写真。一部 GRUS画像 © Axelspace）<br>保存した地図・区域：国土地理院ベクトルタイル提供実験を加工して作成<br>部品：Leaflet（BSD）・QR Code Generator（MIT）・jsQR（Apache-2.0）。全文は <a href="vendor/LICENSES.txt" target="_blank" rel="noopener">LICENSES.txt</a></p>
      </main>`;
  };

  views.key = function () {
    const demo = !!view.demo;
    app.innerHTML = `
      ${demo ? demoBar() : ''}
      ${topBar({ back: true, title: '<b>カードの番号を入れる</b>' })}
      <main class="start keyin">
        <p class="lead">利用カードに書いてある12文字の番号を入れてください。</p>
        <form id="keyform" novalidate>
          <label class="sr" for="key-in">カードの番号</label>
          <input id="key-in" class="key-in num" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="17" placeholder="ABCD-EFGH-JKLM">
          <p class="err" id="key-err" hidden></p>
          <button class="btn primary big" type="submit" id="key-go">これで始める</button>
        </form>
        <p class="muted small">0（ゼロ）とO（オー）、1（イチ）とI（アイ）は使っていません。小文字で入れても大丈夫です。</p>
        ${demo ? demoKeyList() : ''}
      </main>`;
    const inp = document.getElementById('key-in');
    inp.addEventListener('input', () => {
      const f = K.fmtKey(K.normKey(inp.value).slice(0, 12));
      if (inp.value !== f) inp.value = f;
    });
    document.getElementById('keyform').addEventListener('submit', e => { e.preventDefault(); tryKey(inp.value, demo ? 'お試し版（番号）' : '番号の入力', demo); });
  };

  function demoKeyList() {
    if (!K.demo.backend) return '';
    return '<div class="demo-keys"><h2>お試し版の番号</h2><ul>' + K.demo.users().map(u =>
      `<li><span>${esc(u.name)}<small>（${esc(u.role)}）</small></span><b class="num">${esc(K.fmtKey(u.key))}</b></li>`).join('') + '</ul></div>';
  }

  async function tryKey(raw, from, demo) {
    const key = K.normKey(raw);
    const err = document.getElementById('key-err');
    const btn = document.getElementById('key-go');
    const show = m => { if (err) { err.textContent = m; err.hidden = false; } };
    if (key.length !== 12) return show('番号は12文字です（今 ' + key.length + '文字）');
    const prev = { key: K.state.key, demo: K.state.demo };
    K.state.key = key; K.state.demo = !!demo;
    if (btn) { btn.disabled = true; btn.textContent = '確かめています…'; }
    try {
      await K.refresh();
      await K.setKey(key, !!demo, from);
      authError = null;
      go('home', null, true);
      K.tiles.saveAll();
    } catch (e) {
      if (e.net) {
        await K.setKey(key, !!demo, from);
        go('home', null, true);
        toast('番号を保存しました。電波のある所で開くと、区域が出ます。');
      } else {
        K.state.key = prev.key; K.state.demo = prev.demo;
        show(e.message || 'この番号は使えません');
        if (btn) { btn.disabled = false; btn.textContent = 'これで始める'; }
      }
    }
  }

  /* ---------- QRコードの読み取り ---------- */
  let cam = null;
  function stopCamera() {
    if (!cam) return;
    cam.stop = true;
    try { cam.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* もう止まっている */ }
    cam = null;
  }
  views.scan = async function () {
    app.innerHTML = `
      ${topBar({ back: true, title: '<b>QRコードを読み取る</b>' })}
      <main class="start scan">
        <p class="lead">利用カードのQRコードを、枠の中に入れてください。</p>
        <div class="cam"><video playsinline muted autoplay></video><div class="frame" aria-hidden="true"></div></div>
        <p class="err" id="scan-err" hidden></p>
        <button class="btn big" data-act="typeKey">${I.keyb}番号を入れる</button>
      </main>`;
    const err = document.getElementById('scan-err');
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('この画面ではカメラを使えません。「番号を入れる」を使ってください。');
    try {
      await loadScript('vendor/jsQR.js');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (view.name !== 'scan') { stream.getTracks().forEach(t => t.stop()); return; }
      const video = app.querySelector('video');
      cam = { stream: stream, stop: false };
      video.srcObject = stream;
      await video.play().catch(() => {});
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const mine = cam;
      const tick = () => {
        if (mine.stop) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
          cv.width = w; cv.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            const k = keyFromText(code.data);
            if (k) { vibrate(40); stopCamera(); views.key(); document.getElementById('key-in').value = K.fmtKey(k); tryKey(k, 'QRコード（アプリの中で読み取り）', false); return; }
          }
        }
        setTimeout(() => requestAnimationFrame(tick), 180);
      };
      tick();
    } catch (e) {
      fail(e && e.name === 'NotAllowedError' ? 'カメラの利用が許可されていません。設定で許可するか、「番号を入れる」を使ってください。' : 'カメラを使えませんでした。「番号を入れる」を使ってください。');
    }
  };
  function keyFromText(text) {
    const m = String(text).match(/[#?&]k=([A-Za-z0-9-]{8,20})/);
    if (m) return K.normKey(m[1]);
    const k = K.normKey(text);
    return k.length === 12 ? k : '';
  }

  /* ---------- お試し版の入口 ---------- */
  views.demo = async function () {
    app.innerHTML = '<div class="boot">お試し版を準備しています…</div>';
    try { await K.demo.init(); } catch (e) { app.innerHTML = '<main class="start"><p class="notice">お試し版を準備できませんでした：' + esc(e.message) + '</p><button class="btn" data-act="back">もどる</button></main>'; return; }
    const us = K.demo.users();
    const pick = [
      ['U002', '区域を持っている人', '地図で家を記録し、アパートを部屋ごとに記録します。電波を切って記録し、戻したときに自動で送られるかも試せます。昨日返した区域を「元に戻す」も試せます。いちばん上に、上位管理者からのお知らせが出ます。'],
      ['U004', '第1グループの責任者', '自分の区域の記録に加えて、グループの手持ちの区域をメンバーに配る・回収する、紙で回った記録の代理入力（日付を指定）を試せます。'],
      ['U001', '上位管理者', '全員への一律配布、地図で見て配る、集まりでの割り振り（マンション訪問は1人にいくつかの建物から少しずつ・夕方のアパートは一棟まとめて）、回り方の名前の変更、返ってきた区域を元に戻す、地図の手直し、「集合住宅だけ」の切り替え、地図の下地（国土地理院がなくても使える保存した地図）、S-13（Word・書き込める PDF）、代理入力・台帳から入れる、冬の前倒し・集合住宅の月ごとの組、お知らせ、毎晩のバックアップを試せます。'],
    ];
    app.innerHTML = `
      <header class="top">${K.cfg.demoOnly ? '<div class="brand">' + LOGO + '<h1>区域訪問管理 お試し版</h1></div>' : '<button class="back-btn" data-act="back" aria-label="もどる">' + I.back + '<span>もどる</span></button><div class="title"><b>お試し版</b></div>'}</header>
      <main class="start demo-pick">
        <p class="lead">だれとして使うかを選んでください。</p>
        <p class="muted small">見本のデータ（小樽市桂岡町の区域と、マンション訪問管理の15のマンション）で動きます。記録はこの端末の中だけに残り、だれにも送られません。</p>
        <div class="stack">
          ${pick.map(p => { const u = us.find(x => x.id === p[0]); return u ? `<button class="persona" data-act="demoAs" data-id="${u.id}"><b>${esc(u.name)}さん</b><span class="tag">${esc(p[1])}</span><span class="muted">${esc(p[2])}</span></button>` : ''; }).join('')}
        </div>
        <button class="btn ghost" data-act="demoType">カードの番号を入れて試す</button>
        ${K.cfg.demoOnly ? '<p class="notice info">このページは見本です。電波なしで開く・地図をスマホに保存する・カメラでQRを読む、の3つは、GitHub Pages に置いた本番の形で確かめます。</p>' : ''}
      </main>`;
  };

  /* ---------- わたしの区域 ---------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (view.name === 'home') views.home(); });

  views.home = function () {
    const mine = K.state.me;
    const user = mine && mine.user;
    const cards = K.cards();
    const recs = K.records();
    const today = todayStr();
    const todays = cards.filter(c => c.due === today && c.kind !== '通常');
    const rest = cards.filter(c => todays.indexOf(c) < 0);
    const section = (title, list) => list.length ? `${title ? `<h2 class="sec">${title}</h2>` : ''}<section class="cards">${list.map(c => cardTile(c, recs)).join('')}</section>` : '';
    const near = rest.filter(c => { const x = K.dueInfo(c); return !x.gather && (x.phase === 'soon' || x.phase === 'grace'); });
    const collected = K.collectedCards();
    const returned = K.returnedCards();
    const undoDays = (mine && mine.settings && mine.settings.undoDays) || 7;
    // 返したばかり（今日・昨日）なら、いちばん上に出す（間違えて返したときにすぐ気づけるように）
    const freshReturn = returned.some(c => daysLeft(c.returnedAt) >= -1);
    const returnedBox = returned.length ? `<div class="returned"><p><b>返した区域</b></p><ul>${returned.map(c => `<li><span><b class="num">${esc(c.no)}</b>　${esc(md(c.returnedAt))}に返しました</span>${c.canUndo ? `<button class="btn sm" data-act="undoReturn" data-id="${esc(c.distId)}">${I.undo || ''}元に戻す</button>` : `<span class="muted small">${c.takenBy ? esc(c.takenBy) + 'さんが持っているため戻せません' : '戻せません'}</span>`}</li>`).join('')}</ul>
          <p class="muted small">間違えて返したときは「元に戻す」を押してください。記録もそのまま戻ります（返してから${undoDays}日のうち）。</p></div>` : '';
    app.innerHTML = `
      ${demoBar()}
      <header class="top home-top">
        <div class="brand">${LOGO}<div class="brand-text"><h1>わたしの区域</h1>${user ? `<p class="who-name">${esc(user.name)}さん</p>` : ''}</div></div>
        ${user && user.admin ? `<button class="btn sm admin-btn" data-act="admin">${I.users}<span>管理</span></button>` : ''}
        <button class="icon-btn labeled" data-act="diag" aria-label="設定と確認">${I.gear}<span>設定</span></button>
      </header>
      <main class="home">
        <div class="status" data-status data-quiet></div>
        ${authError ? `<div class="notice">${esc(authError.message)}<div class="row"><button class="btn sm" data-act="restart">番号を入れ直す</button></div></div>` : ''}
        ${noticeBox(mine)}
        ${installHint()}
        ${!mine ? `<div class="empty"><p>${K.net.online ? '区域を読み込んでいます…' : '電波のある所で開くと、持っている区域が出ます。'}</p></div>` : ''}
        ${mine && !cards.length ? '<div class="empty"><p>今、持っている区域はありません。</p><p class="muted">区域を受け取ると、ここに出ます。</p></div>' : ''}
        ${freshReturn ? returnedBox : ''}
        ${near.length ? dueBox(near) : ''}
        ${cards.length && K.geo ? `<button class="btn wide over-btn" data-act="overview">${I.map}<span>持っている区域を、全体の地図で見る</span></button>` : ''}
        ${section(todays.length && rest.length ? '今日の割り振り' : '', todays)}
        ${section(todays.length && rest.length ? '持っている区域' : '', rest)}
        ${returned.length && !freshReturn ? returnedBox : ''}
        ${collected.length ? `<div class="collected"><p><b>自動で回収された区域</b></p><ul>${collected.map(c => `<li><b class="num">${esc(c.no)}</b>　${esc(md(c.forced || c.returnedAt))}を過ぎたので回収しました</li>`).join('')}</ul><p class="muted small">記録はそのまま残っています。返す操作はしなくて大丈夫です。続けて回りたいときは、上位管理者に伝えると戻してもらえます。</p></div>` : ''}
        <p class="credit">地図：${GSI_ATTR}（写真は全国最新写真。一部 GRUS画像 © Axelspace）<br>保存した地図・区域：国土地理院ベクトルタイル提供実験を加工して作成<br>部品：Leaflet（BSD）・QR Code Generator（MIT）・jsQR（Apache-2.0）。全文は <a href="vendor/LICENSES.txt" target="_blank" rel="noopener">LICENSES.txt</a></p>
      </main>`;
    updateStatus();
  };

  /** 上位管理者からのお知らせ（0.11.0）。閉じると、同じお知らせはたたんで出す */
  let noticeOpen = null;
  function noticeBox(mine) {
    const n = mine && mine.notice;
    if (!n || !n.text) return '';
    if (n.until && n.until < todayStr()) return '';
    const sig = n.at + '|' + n.text;
    let hidden = false;
    try { hidden = localStorage.getItem('kuiki.noticeHidden') === sig; } catch (e) { hidden = false; }
    if (noticeOpen === sig) hidden = false;
    if (hidden) return `<button class="notice-mini" data-act="noticeShow" data-sig="${esc(sig)}">${I.bell}<span>お知らせ（${esc(mdShort(n.at))}）</span></button>`;
    return `<div class="notice-box" role="status"><p class="nb-head">${I.bell}<b>お知らせ</b><small>${esc(md(n.at))}${n.until ? '・' + esc(md(n.until)) + 'まで' : ''}</small>
      <button class="icon-btn nb-x" data-act="noticeHide" data-sig="${esc(sig)}" aria-label="お知らせをたたむ">${I.x}</button></p><p class="nb-text">${esc(n.text)}</p></div>`;
  }
  act.noticeHide = el => { try { localStorage.setItem('kuiki.noticeHidden', el.dataset.sig); } catch (e) { /* 保存できない */ } noticeOpen = null; render(); };
  act.noticeShow = el => { noticeOpen = el.dataset.sig; try { localStorage.removeItem('kuiki.noticeHidden'); } catch (e) { /* なくてもよい */ } render(); };

  /** 回収日が近い・過ぎた区域の知らせ（責めない言い方で、返さなくても大丈夫と伝える） */
  function dueBox(list) {
    const grace = list.some(c => K.dueInfo(c).phase === 'grace');
    return `<div class="due-box">
      <p class="due-title">${I.wait}<b>回収日のお知らせ</b></p>
      <ul>${list.map(c => { const x = K.dueInfo(c); return `<li><b class="num">${esc(c.no)}</b>　${x.phase === 'grace' ? '回収日を過ぎました。' + esc(md(c.forced)) + 'まで記録できます' : (x.dd === 0 ? '今日が回収日です' : esc(md(c.due)) + 'が回収日です（あと' + x.dd + '日）')}</li>`; }).join('')}</ul>
      <p class="small">全部回ったら、区域の画面の「この区域を返す」を押してください。<b>押さなくても</b>、記録できる日が過ぎると自動で回収されます。${grace ? '記録がまだの家があれば、それまでにつけてください。' : ''}</p>
    </div>`;
  }

  function installHint() {
    if (isStandalone() || K.state.demo || inFrame) return '';
    return `<div class="install"><b>ホーム画面に追加すると、電波がなくても開けます。</b>
      ${installEvt ? `<button class="btn sm primary" data-act="install">アプリとして入れる</button>` : `<button class="btn sm" data-act="howInstall">やり方を見る</button>`}</div>`;
  }

  function cardTile(c, recs) {
    const st = c.isBuilding ? K.buildingState(c, recs) : K.cardState(c, recs);
    const dc = dueChip(c);
    const unit = c.isBuilding ? '部屋' : '軒';
    const name = c.isBuilding ? esc(c.building.name) : esc(K.geo.terr[c.territoryId].town);
    const part = c.isBuilding && c.rooms && c.rooms.length;
    const sub = c.isBuilding ? (part ? `${st.total}部屋：${esc(st.rooms.slice(0, 6).map(r => r.no).join('・'))}${st.rooms.length > 6 ? '…' : ''}` : `${esc(c.building.type)}・${st.total}${unit}`) : `${st.absent ? '回る家' : '家'} ${st.total}${unit}`;
    const saved = K.state.savedMaps[c.territoryId];
    const prog = K.tiles.progress && K.tiles.progress.territoryId === c.territoryId;
    let mapTxt = '';
    if (K.tiles.available() && K.tiles.bbOf(c)) mapTxt = prog ? '地図を保存中…' : saved && saved.ok ? '' : '地図はまだ保存していません';
    const kl = K.kindLabel(c.kind);
    const tag = kl ? `<span class="tag ${c.kind === '不在宅訪問' ? 'warn' : 'apt'}">${esc(kl)}</span>` : '';
    return `<button class="ccard ${c.isBuilding ? 'bld' : ''} ${c.kind === '不在宅訪問' ? 'absent' : ''}" data-act="open" data-id="${esc(c.distId)}">
      <span class="ccard-head"><b class="ccard-no num">${esc(c.no)}</b>${tag}
        <span class="ccard-due ${dc.cls}">${esc(dc.text)}</span></span>
      <span class="ccard-town">${name}<span class="muted">　${sub}</span></span>
      <span class="ccard-prog"><span class="bar" aria-hidden="true">${segBar(st)}</span><span class="ccard-n">記録 <b class="num">${st.done}</b>/${st.total}</span></span>
      ${mapTxt ? `<span class="ccard-meta">${mapTxt}</span>` : ''}
    </button>`;
  }
  function segBar(st) {
    if (!st.total) return '';
    return ['会えた', '不在', '拒否', '済'].map(k => st.counts[k] ? `<i class="sb-${k}" style="width:${(st.counts[k] / st.total * 100).toFixed(1)}%"></i>` : '').join('');
  }
  function progLine(st, unit) {
    const parts = ['会えた', '不在', '拒否', '済'].filter(k => st.counts[k]).map(k => `<span class="pl s-${k}"><i>${GLYPH[k]}</i>${st.counts[k]}</span>`);
    return `<div class="prog-row"><div class="prog"><b class="num">${st.done}</b><span>/ ${st.total}${unit} 記録</span></div><div class="plist">${parts.join('')}</div></div>
      <div class="bar wide" aria-hidden="true">${segBar(st)}</div>`;
  }

  /* ---------- Googleマップ（区域のあたりを出すだけ。道案内はしない） ---------- */
  function gmapsUrl(lat, lon, zoom) {
    return 'https://www.google.com/maps/@?api=1&map_action=map&center=' + Number(lat).toFixed(6) + ',' + Number(lon).toFixed(6) + '&zoom=' + (zoom || 18);
  }
  function terrCenter(t) { return [(t.bb[0] + t.bb[2]) / 2, (t.bb[1] + t.bb[3]) / 2]; }
  function terrZoom(t) {
    const m = Math.max((t.bb[2] - t.bb[0]) * 111000, (t.bb[3] - t.bb[1]) * 81000);
    return m > 700 ? 16 : m > 350 ? 17 : 18;
  }

  /* ---------- 地図の部品 ---------- */
  let M = null;
  let photo = false;
  let watchId = null;
  const EMPTY_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  function tileOpts() {
    const o = { maxNativeZoom: 18, maxZoom: 20, crossOrigin: 'anonymous', attribution: '' };
    if (K.cfg.tileBounds) o.bounds = L.latLngBounds(K.cfg.tileBounds);
    return o;
  }
  /** 地図の下地。国土地理院の地図を読み、読めないタイルは保存した地図（K.basemap）で埋める。
   *  国土地理院が続けて読めないとき・設定で「保存した地図」のとき・電波がないときは、保存した地図だけにする */
  let BaseLayer = null;
  function baseLayer(usePhoto, onlyOwn) {
    const B = K.basemap;
    B.init();
    if (!BaseLayer) {
      BaseLayer = L.TileLayer.extend({
        initialize(photoOn, opts, own) {
          L.TileLayer.prototype.initialize.call(this, K.cfg.tileUrl || '', opts);
          this._photo = !!photoOn;
          this._onlyOwn = !!own;
          this._src = !own && B.useGsi() ? 'gsi' : 'own';
          this._ownShown = false;
          this._applySource();
        },
        _applySource() {
          const own = this._src === 'own';
          this.options.attribution = own ? OWN_ATTR : (this._photo && K.cfg.photoUrl ? PHOTO_ATTR : GSI_ATTR);
          this.options.minNativeZoom = own ? ((B.meta && B.meta.minZoom) || 12) : 0;
          this._url = own ? '' : (this._photo && K.cfg.photoUrl ? K.cfg.photoUrl : K.cfg.tileUrl);
        },
        _setAttr(oldA) {
          const ac = this._map && this._map.attributionControl;
          if (!ac) return;
          if (oldA) ac.removeAttribution(oldA);
          ac.addAttribution(this.options.attribution);
        },
        onAdd(map) { B.layers.add(this); return L.TileLayer.prototype.onAdd.call(this, map); },
        onRemove(map) {
          B.layers.delete(this);
          if (this._ownShown && map.attributionControl) { map.attributionControl.removeAttribution(OWN_ATTR); this._ownShown = false; }
          return L.TileLayer.prototype.onRemove.call(this, map);
        },
        /** 国土地理院 ↔ 保存した地図 を、今の状態に合わせる */
        refreshSource(force) {
          const src = !this._onlyOwn && B.useGsi() ? 'gsi' : 'own';
          if (src === this._src && !force) return;
          const oldA = this.options.attribution;
          if (this._ownShown && this._map && this._map.attributionControl) { this._map.attributionControl.removeAttribution(OWN_ATTR); this._ownShown = false; }
          this._src = src;
          this._applySource();
          this._setAttr(oldA);
          if (this._map) { this._resetView(); this.redraw(); }
        },
        setPhoto(on) {
          this._photo = !!on;
          if (this._src === 'gsi') { const oldA = this.options.attribution; this._applySource(); this._setAttr(oldA); this.redraw(); }
        },
        _own(img, c, done) {
          if (this._src === 'gsi' && !this._ownShown && this._map && this._map.attributionControl) { this._ownShown = true; this._map.attributionControl.addAttribution(OWN_ATTR); }
          B.tileUrl(c.z, c.x, c.y).then(u => {
            img.onload = () => { if (u) URL.revokeObjectURL(u); done(null, img); };
            img.onerror = () => { if (u) URL.revokeObjectURL(u); img.onerror = null; img.src = EMPTY_TILE; };
            img.src = u || EMPTY_TILE;
          });
        },
        createTile(c, done) {
          const img = document.createElement('img');
          img.alt = '';
          img.setAttribute('role', 'presentation');
          if (this._src === 'own') { this._own(img, c, done); return img; }
          img.crossOrigin = 'anonymous';
          img.onload = () => { B.gsiLoad(); done(null, img); };
          img.onerror = () => { img.onload = img.onerror = null; B.gsiError(); this._own(img, c, done); };
          img.src = this.getTileUrl(c);
          return img;
        },
      });
    }
    const layer = new BaseLayer(usePhoto, tileOpts(), onlyOwn);
    return layer;
  }
  /** 小さな地図（建物の場所を見せる） */
  function miniMap(el, lat, lon, opts) {
    opts = opts || {};
    if (!window.L || !el) return null;
    const map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 20, minZoom: 12, zoomSnap: 0.5 });
    map.attributionControl.setPrefix(false);
    baseLayer(false).addTo(map);
    if (opts.territoryId && K.geo.terr[opts.territoryId]) {
      K.geo.terr[opts.territoryId].blocks.forEach(bid => L.polygon(K.geo.block[bid].poly, { className: 'blk', interactive: false }).addTo(map));
    }
    L.marker([lat, lon], { icon: L.divIcon({ className: 'hm pin', html: '<i></i>', iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(map);
    map.setView([lat, lon], opts.zoom || 18.5);
    setTimeout(() => map.invalidateSize(), 80);
    return map;
  }

  /* ---------- 全体の地図（持っている区域が全体のどこか） ---------- */
  let OV = null;
  K.ovCtl = () => OV;
  function destroyOverview() { if (OV) { OV.destroy(); OV = null; } }
  leaveHooks.push(destroyOverview);
  views.overview = function () {
    destroyOverview();
    app.classList.add('fill');
    const cards = K.cards();
    const mine = {};
    cards.forEach(c => { mine[c.territoryId] = c; });
    const focus = view.focus || '';
    const terrIds = cards.filter(c => !c.isBuilding && K.geo.terr[c.territoryId]).map(c => c.territoryId);
    const blds = cards.filter(c => c.isBuilding && c.building && c.building.lat !== null && c.building.lat !== undefined);
    app.innerHTML = `
      ${demoBar()}
      <div class="cardview">
        ${topBar({ back: true, title: '<b>全体の地図</b>', sub: '持っている区域 ' + cards.length + '枚' })}
        <div class="mapwrap"><div id="ovmap" aria-label="全体の地図"></div>
          <div class="map-ctrl"><button data-act="ovAll" aria-label="持っている区域を全部見る">${I.fit}</button><button data-act="ovWhole" aria-label="範囲の全体を見る" class="txt">全体</button><button data-act="ovLocate" aria-label="今いる場所を出す">${I.locate}</button></div>
        </div>
        <section class="panel ov-panel">
          <p class="small"><i class="ov-sw"></i>青い所が、持っている区域です。さわると開けます。${blds.length ? '「集」は持っている集合住宅です。' : ''}</p>
          <div class="ov-chips">${cards.map(c => `<button class="tchip ${c.territoryId === focus ? 'sel' : ''}" data-act="ovGo" data-t="${esc(c.territoryId)}">${esc(c.no)}<small>${esc(c.isBuilding ? c.building.name : (K.geo.terr[c.territoryId] || {}).town || '')}</small></button>`).join('')}</div>
        </section>
      </div>`;
    if (!window.L) { document.getElementById('ovmap').innerHTML = '<p class="notice">地図の部品を読めませんでした</p>'; return; }
    const C = K.terrMap.C;
    OV = K.terrMap(document.getElementById('ovmap'), {
      style: id => (id === focus ? Object.assign({}, C.mine, { weight: 4, fillOpacity: 0.7 }) : mine[id] ? C.mine : C.other),
      label: id => (mine[id] ? esc(mine[id].no) : null),
      always: id => !!mine[id],
      onTap: id => { if (mine[id]) openOv(mine[id]); },
      buildings: blds.map(c => ({ id: c.territoryId, lat: c.building.lat, lon: c.building.lon, html: '<i>' + esc(c.no) + '</i>', cls: 'mine' + (c.territoryId === focus ? ' sel' : '') })),
      onTapB: id => { if (mine[id]) openOv(mine[id]); },
      fit: focus ? [focus] : terrIds.concat(blds.map(c => c.territoryId)),
      fitMaxZoom: 15,
      labelZoom: 99,
    });
  };
  function openOv(c) {
    const t = K.geo.terr[c.territoryId];
    openSheet(sheetTitle(esc(c.no) + ' <small>' + esc(c.isBuilding ? c.building.name : t ? t.town : '') + '</small>'),
      `<p class="muted">${esc(dueChip(c).text || '')}</p><button class="btn primary big wide" data-act="ovOpen" data-id="${esc(c.distId)}">この区域を開く</button>`);
  }
  Object.assign(act, {
    overview: el => go('overview', { focus: (el && el.dataset && el.dataset.t) || '' }),
    ovOpen: el => { closeSheet(); go('card', { id: el.dataset.id }); },
    ovAll: () => { if (!OV) return; const cs = K.cards(); OV.fit(cs.map(c => c.territoryId)); },
    ovWhole: () => { if (OV) OV.fit([]); },
    ovLocate: () => { if (OV) OV.locate(() => toast('今いる場所を出せませんでした')); },
    ovGo: el => {
      if (!OV) return;
      const id = el.dataset.t;
      if (el.classList.contains('sel')) { const c = K.cards().find(x => x.territoryId === id); if (c) openOv(c); return; }
      document.querySelectorAll('.ov-chips .tchip').forEach(x => x.classList.toggle('sel', x === el));
      OV.fit([id]);
    },
  });

  /* ---------- 区域の画面（戸建て） ---------- */
  views.card = function () {
    const card = K.cards().find(c => c.distId === view.id);
    if (!card) { go('home', null, true); return; }
    if (card.isBuilding) return renderBuilding(card);
    app.classList.add('fill');
    const t = K.geo.terr[card.territoryId];
    const tag = K.kindLabel(card.kind) ? `<span class="tag warn">${esc(K.kindLabel(card.kind))}</span>` : '';
    app.innerHTML = `
      ${demoBar()}
      <div class="cardview">
        ${topBar({ back: true, title: `<b class="num">${esc(card.no)}</b>`, sub: esc(t.town) + ' ' + tag, right: '<span class="mini-status" data-status-mini></span>' })}
        <div class="mapwrap">
          <div id="map" aria-label="${esc(card.no)}の地図"></div>
          <div class="map-ctrl">
            <button data-act="zin" aria-label="大きくする">${I.plus}</button>
            <button data-act="zout" aria-label="小さくする">${I.minus}</button>
            <button data-act="fit" aria-label="区域の全体を見る">${I.fit}</button>
            <button data-act="locate" aria-label="今いる場所を出す" class="${watchId !== null ? 'on' : ''}">${I.locate}</button>
          </div>
          ${K.basemap.photoOk() || photo ? `<button class="layer-btn" data-act="layer">${I.layers}<span>${photo ? '地図' : '写真'}</span></button>` : ''}
          <p class="map-hint">${card.kind === '不在宅訪問' ? '大きな丸が、今回回る家です' : '家の丸をさわって記録します'}</p>
          <div class="map-pick" data-pick hidden><span>家がある場所をさわってください</span><button class="btn sm" data-act="pickCancel">やめる</button></div>
        </div>
        <section class="panel" data-panel></section>
      </div>`;
    mountMap(card);
    renderPanel();
    updateStatus();
  };

  function renderPanel() {
    if (!M) return;
    const card = M.card;
    const t = K.geo.terr[card.territoryId];
    const st = K.cardState(card);
    const el = document.querySelector('[data-panel]');
    if (!el) return;
    const c = terrCenter(t);
    el.innerHTML = `
      ${dueNote(card)}
      ${progLine(st, '軒')}
      <div class="panel-actions">
        <a class="btn" href="${esc(gmapsUrl(c[0], c[1], terrZoom(t)))}" target="_blank" rel="noopener">${I.gmap}<span>Googleマップで見る</span></a>
        <button class="btn" data-act="blocks">${I.check}<span>全部回った</span></button>
      </div>
      <div class="panel-links"><button class="link" data-act="mapReport">${I.plus}<span>地図にない家を知らせる</span></button><button class="link" data-act="overview" data-t="${esc(card.territoryId)}">${I.map}<span>全体のどこ？</span></button><button class="link ret-link" data-act="returnAsk">${I.ret}この区域を返す</button></div>`;
    const hint = document.querySelector('.map-hint');
    if (hint) hint.hidden = st.done > 0 && !st.absent;
  }

  function mountMap(card) {
    destroyMap();
    if (!window.L) { document.getElementById('map').innerHTML = '<p class="notice">地図の部品を読めませんでした</p>'; return; }
    const t = K.geo.terr[card.territoryId];
    const map = L.map('map', { zoomControl: false, maxZoom: 20, minZoom: 12, zoomSnap: 0.5, wheelPxPerZoomLevel: 90, bounceAtZoomLimits: false });
    map.attributionControl.setPrefix(false);
    const base = baseLayer(photo).addTo(map);
    map.attributionControl.addAttribution(esc(K.geo.attribution));
    const blocks = t.blocks.map(bid => K.geo.block[bid]);
    blocks.forEach(b => L.polygon(b.poly, { className: 'blk', interactive: false }).addTo(map));
    if (blocks.length > 1) {
      blocks.forEach(b => L.marker(polyCenter(b.poly), {
        icon: L.divIcon({ className: 'blk-label', html: '<span>ブロック' + b.n + '</span>', iconSize: [76, 24] }), interactive: false, keyboard: false,
      }).addTo(map));
    }
    M = { map: map, card: card, t: t, base: base, markers: {}, sel: null, me: null, acc: null, pick: null, tmp: null };
    map.fitBounds(L.latLngBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 });
    map.on('zoomend', zoomClass);
    map.on('click', onMapClick);
    zoomClass();
    refreshMarkers();
    setTimeout(() => { if (M && M.map === map) map.invalidateSize(); }, 60);
  }
  function destroyMap() {
    if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) { /* もう止まっている */ } watchId = null; }
    if (M) { try { M.map.remove(); } catch (e) { /* もう消えている */ } M = null; }
  }
  function zoomClass() {
    if (!M) return;
    const z = M.map.getZoom();
    const el = M.map.getContainer();
    el.classList.toggle('z-lo', z < 17);
    el.classList.toggle('z-17', z >= 17 && z < 18);
    el.classList.toggle('z-18', z >= 18 && z < 19);
  }
  function markerLook(x) {
    if (x.kind === 'wait') return { cls: 'hm big k-wait', html: '<i>?</i>' };
    if (x.kind === 'apt') return { cls: 'hm big k-apt', html: '<i>集</i>' };
    if (x.kind === 'empty') return { cls: 'hm k-empty', html: '<i>空</i>' };
    const cls = 'hm s-' + x.s + (x.h.big ? ' big' : '') + (x.h.prov ? ' prov' : '') + (x.target ? '' : ' nt') + (x.rec && x.rec.pending ? ' pend' : '');
    return { cls: cls, html: '<i>' + GLYPH[x.s] + '</i>' };
  }
  function refreshMarkers() {
    if (!M) return;
    // 足した家・動かした家・仮の家に合わせて、印をそろえる
    const hs = K.geo.byTerr[M.t.id] || [];
    const ids = new Set(hs.map(h => h.id));
    Object.keys(M.markers).forEach(id => { if (!ids.has(id)) { M.markers[id].remove(); delete M.markers[id]; } });
    hs.forEach(h => {
      const mk = M.markers[h.id];
      if (!mk) M.markers[h.id] = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: 'hm', iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(M.map);
      else { const ll = mk.getLatLng(); if (ll.lat !== h.lat || ll.lng !== h.lon) mk.setLatLng([h.lat, h.lon]); }
    });
    const st = K.cardState(M.card);
    Object.keys(M.markers).forEach(id => {
      const x = st.map[id];
      const mk = M.markers[id];
      if (!x) { if (!mk._hidden) { mk.setOpacity(0); mk._hidden = true; } return; }
      if (mk._hidden) { mk.setOpacity(1); mk._hidden = false; }
      const look = markerLook(x);
      const cls = look.cls + (M.sel === id ? ' sel' : '');
      if (mk._sig !== cls + look.html) {
        mk.setIcon(L.divIcon({ className: cls, html: look.html, iconSize: [30, 30] }));
        mk._sig = cls + look.html;
      }
    });
  }
  function onMapClick(e) {
    if (!M) return;
    if (M.pick) return onPick(e);
    const st = K.cardState(M.card);
    const p = M.map.latLngToContainerPoint(e.latlng);
    const z = M.map.getZoom();
    const thr = z >= 19 ? 26 : z >= 18 ? 22 : 18;
    const near = [];
    st.houses.forEach(h => {
      const q = M.map.latLngToContainerPoint([h.lat, h.lon]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= thr) near.push({ h: h, d: d });
    });
    near.sort((a, b) => a.d - b.d);
    if (near.length === 1 || (near.length > 1 && z >= 19)) return openHouse(near[0].h);
    if (near.length > 1) {
      M.map.setView(e.latlng, 19);
      if (!M.zoomTold) { M.zoomTold = true; toast('家が近くに並んでいるので、大きくしました。もう一度、家の丸をさわってください'); }
      return;
    }
    const bid = M.t.blocks.find(id => inPoly([e.latlng.lat, e.latlng.lng], K.geo.block[id].poly));
    if (bid) return openBlock(bid);
  }
  /* 地図にない家を知らせる：場所をさわってもらう */
  function setPick(on) {
    if (!M) return;
    M.pick = on ? { type: 'report' } : null;
    const el = document.querySelector('[data-pick]');
    if (el) el.hidden = !on;
    const hint = document.querySelector('.map-hint');
    if (hint && on) hint.hidden = true;
  }
  function onPick(e) {
    const ll = [e.latlng.lat, e.latlng.lng];
    const bid = K.blockAt(ll[0], ll[1], M.t.id);
    if (!bid || K.geo.block[bid].t !== M.t.id) { toast('区域の外です。区域の線の中の、家がある場所をさわってください'); return; }
    if (M.tmp) M.tmp.remove();
    M.tmp = L.marker(ll, { icon: L.divIcon({ className: 'hm pin', html: '<i></i>', iconSize: [30, 30] }), interactive: false, keyboard: false }).addTo(M.map);
    openSheet(sheetTitle('地図にない家'), `<p class="lead">この場所に、地図にない家があることを知らせます。</p>
      <p class="muted small">上位管理者が確かめると、みんなの地図に家が足されます。それまでも「仮の家」として、この家に記録をつけられます。</p>
      <div class="row2"><button class="btn big" data-act="closeSheet">やめる</button><button class="btn primary big" data-act="mapReportDo" data-lat="${ll[0]}" data-lon="${ll[1]}">知らせる</button></div>`,
    () => { if (M && M.tmp) { M.tmp.remove(); M.tmp = null; } });
  }
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPoly(pt, multi) { return multi.some(poly => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h))); }
  function polyCenter(multi) {
    let best = multi[0][0], ba = 0;
    multi.forEach(p => {
      const r = p[0]; let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][1] * r[i][0] - r[i][1] * r[j][0]);
      if (Math.abs(a) > ba) { ba = Math.abs(a); best = r; }
    });
    let la = 0, lo = 0;
    best.forEach(q => { la += q[0]; lo += q[1]; });
    return [la / best.length, lo / best.length];
  }

  function user() { return K.state.me && K.state.me.user; }
  function myId() { const u = user(); return u ? u.id : ''; }
  function isAdmin() { const u = user(); return !!(u && u.admin); }
  function isTop() { const u = user(); return !!(u && u.top); }
  function canUndo(rec) {
    if (!rec) return false;
    if (rec.pending) return true;
    if (isAdmin()) return true;
    const hours = (K.state.me && K.state.me.settings && K.state.me.settings.undoHours) || 24;
    return rec.by === myId() && Date.now() - Date.parse(rec.at) < hours * 3600e3;
  }
  function stateChip(x) {
    if (x.s === '未') return '<span class="chip s-未">まだ記録なし</span>';
    let when = '';
    if (x.rec) when = '・' + whenText(x.rec.at);
    else if (x.refused) when = '（以前の記録）';
    const whole = x.rec && !x.rec.houseId && !x.rec.roomId;
    return '<span class="chip s-' + x.s + '">' + esc(x.s) + esc(when) + (whole ? '（まとめて）' : '') + '</span>';
  }
  function recButtons(attr, x) {
    return '<div class="seg big3">' + ['会えた', '不在', '拒否'].map(r =>
      `<button class="r-${r}" data-act="rec" ${attr} data-r="${r}" aria-pressed="${x.s === r && x.rec && (x.rec.houseId || x.rec.roomId) ? 'true' : 'false'}"><i>${GLYPH[r]}</i><span>${r}</span></button>`).join('') + '</div>';
  }
  function sheetTitle(title, chip) {
    return `<div class="sheet-title"><div class="room-big num">${title}</div>${chip || ''}<button class="icon-btn close" data-act="closeSheet" aria-label="閉じる">${I.x}</button></div>`;
  }

  function openHouse(h) {
    if (!M) return;
    const st = K.cardState(M.card);
    const x = st.map[h.id];
    if (!x) return;
    M.sel = h.id;
    refreshMarkers();
    const nHouses = K.geo.byTerr[M.t.id].filter(q => !q.big).length;
    let title = h.prov ? '仮の家' : h.n ? '家 ' + h.n + '<small>/' + nHouses + '</small>' : '大きな建物';
    let body = '';
    if (h.prov) body += `<p class="notice info">「地図にない家」として知らせた家です${h.by ? '（' + esc(h.by) + 'さん）' : ''}。上位管理者が確かめると、地図に足されます。</p>`;
    const reportBtns = list => `<details class="report"><summary>この建物のことを知らせる</summary><div class="report-opts">${list.map(n =>
      `<button class="btn sm" data-act="report" data-h="${h.id}" data-note="${esc(n[1])}">${esc(n[0])}</button>`).join('')}</div><p class="muted small">上位管理者が確かめてから、区域に反映します。</p></details>`;
    const stdReports = [['空き家らしい', '空き家らしい'], ['家ではない', '家ではない（店・倉庫・車庫など）'], ['アパート・マンション', '集合住宅（アパート・マンション）'], ['なくなった', 'なくなった（取り壊し・更地）']];
    if (x.kind === 'wait') {
      body += '<p class="notice info">まだ仕分けが済んでいない大きな建物です。家かどうか分からないので、ここでは記録しません。</p>';
      body += reportBtns([['人が住む家だった', '人が住む家だった'], ['アパート・マンション', '集合住宅（アパート・マンション）'], ['店・工場など', '家ではない（店・工場など）']]);
    } else if (x.kind === 'apt') {
      const b = K.buildings()[x.buildingId];
      title = '集合住宅';
      body += `<p class="notice info">この建物は、集合住宅として別に回ります${b ? `（<b>${esc(b.no)}</b> ${esc(b.name)}）` : ''}。ここでは記録しません。</p>`;
    } else if (x.kind === 'empty') {
      body += '<p class="notice info">空き家の印があります。訪問しなくてかまいません。</p>';
      body += reportBtns([['人が住んでいた', '人が住んでいた（空き家ではない）']]);
    } else {
      const ownRefusal = x.refused && x.rec && x.rec.result === '拒否' && canUndo(x.rec);
      if (st.absent) body += '<p class="prevline">前回：<span class="chip s-' + x.prev + '">' + (x.prev === '未' ? '記録なし' : esc(x.prev)) + '</span>' + (x.target ? '' : '　<span class="muted">今回は回らない家です</span>') + '</p>';
      if (h.big) body += '<p class="muted small">大きな建物ですが、家として回ることになっています。</p>';
      if (x.refused && !ownRefusal) {
        body += '<div class="notice">この家には「拒否」の印があります。訪問しないでください。</div>';
        if (isAdmin()) body += `<button class="btn wide" data-act="release" data-h="${h.id}">拒否の印を外す（管理者）</button>`;
      } else if (!ownRefusal) {
        body += recButtons(`data-h="${h.id}"`, x);
      }
      if (x.rec && x.rec.houseId && canUndo(x.rec)) body += `<button class="btn ghost wide" data-act="undo" data-id="${esc(x.rec.id)}">「${esc(x.rec.result)}」の記録を取り消す</button>`;
      if (!h.prov) body += reportBtns(stdReports);
    }
    if (isTop() && K.adminTools && !h.prov) body += K.adminTools.houseSection(h, x, M.card);
    openSheet(sheetTitle(title, x.kind === 'house' ? stateChip(x) : ''), body, () => { if (M) { M.sel = null; refreshMarkers(); } });
  }

  function openBlock(bid) {
    if (!M) return;
    const b = K.geo.block[bid];
    const st = K.cardState(M.card);
    const hs = K.geo.byBlock[bid].filter(h => st.map[h.id] && st.map[h.id].target);
    const blank = hs.filter(h => st.map[h.id].s === '未');
    const brec = K.records().filter(r => r.distId === M.card.distId && r.blockId === bid && !r.houseId && r.result === '済')
      .sort((a, c) => (a.at < c.at ? 1 : -1))[0];
    let body = `<p class="lead">家 ${hs.length}軒 ・ まだ印のない家 <b class="num">${blank.length}</b>軒</p>`;
    if (blank.length) {
      body += `<button class="btn primary big wide" data-act="blockDone" data-b="${bid}">このブロックは全部回った</button>
        <p class="muted small">印のない${blank.length}軒を「済」にします。不在だった家は、あとで家の丸をさわって直せます。</p>`;
    } else {
      body += '<p class="notice info">このブロックの家には、全部に印が付いています。</p>';
    }
    if (brec && canUndo(brec)) body += `<button class="btn ghost wide" data-act="undo" data-id="${esc(brec.id)}">「全部回った」を取り消す</button>`;
    let hl = null;
    try { hl = L.polygon(b.poly, { className: 'blk-hl', interactive: false }).addTo(M.map); } catch (e) { hl = null; }
    openSheet(sheetTitle('ブロック' + b.n), body, () => { if (hl) hl.remove(); });
  }

  function locate() {
    const btn = document.querySelector('[data-act="locate"]');
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId); watchId = null;
      if (M && M.me) { M.me.remove(); M.acc.remove(); M.me = M.acc = null; }
      if (btn) btn.classList.remove('on');
      return;
    }
    if (!navigator.geolocation) return toast('この端末では今いる場所を出せません');
    if (btn) btn.classList.add('on');
    let first = true;
    watchId = navigator.geolocation.watchPosition(p => {
      if (!M) return;
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!M.me) {
        M.acc = L.circle(ll, { radius: p.coords.accuracy, className: 'me-acc', interactive: false }).addTo(M.map);
        M.me = L.circleMarker(ll, { radius: 9, className: 'me-dot', interactive: false }).addTo(M.map);
      } else { M.me.setLatLng(ll); M.acc.setLatLng(ll).setRadius(p.coords.accuracy); }
      if (first) { first = false; M.map.setView(ll, Math.max(M.map.getZoom(), 17.5)); }
    }, err => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      const b = document.querySelector('[data-act="locate"]'); if (b) b.classList.remove('on');
      toast(err.code === 1 ? '位置情報の利用が許可されていません。スマホの設定で許可してください' : '今いる場所が分かりませんでした');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  /* ---------- 集合住宅の画面（部屋の一覧） ---------- */
  function renderBuilding(card) {
    const b = card.building;
    const st = K.buildingState(card);
    const tag = K.kindLabel(card.kind) ? `<span class="tag apt">${esc(K.kindLabel(card.kind))}</span>` : '';
    const hasLoc = b.lat !== null && b.lat !== undefined;
    app.innerHTML = `
      ${demoBar()}
      ${topBar({ back: true, title: `<b class="num">${esc(card.no)}</b>`, sub: esc(b.name), right: '<span class="mini-status" data-status-mini></span>' })}
      <main class="bview">
        <h2 class="bname">${esc(b.name)}</h2>
        <div class="binfo">
          <p>${tag} ${esc(b.type)}・${st.total}部屋・オートロック${esc(b.autolock || '分からない')}</p>
          ${card.rooms && card.rooms.length ? `<p class="small"><b>割り当てられた${st.total}部屋</b>だけを出しています（建物は全${((K.state.me && K.state.me.rooms && K.state.me.rooms[b.id]) || []).filter(r => r.active !== false).length}部屋）。</p>` : ''}
          ${dueNote(card) || `<p class="muted small">${esc(dueChip(card).text)}</p>`}
        </div>
        ${hasLoc ? `<div class="row2 tight">
          <button class="btn" data-act="bmap">${I.map}<span>場所を見る</span></button>
          <a class="btn" href="${esc(gmapsUrl(b.lat, b.lon, 18))}" target="_blank" rel="noopener">${I.gmap}<span>Googleマップ</span></a></div>` : ''}
        <div class="bprog" data-bprog></div>
        <p class="hint">部屋の番号をさわって記録します。</p>
        <div class="rooms" data-rooms></div>
        <div class="stack">
          <button class="btn" data-act="roomsAll">${I.check}<span>全部回った（印のない部屋を「済」に）</span></button>
          ${hasLoc && K.geo ? `<button class="link" data-act="overview" data-t="${esc(b.id)}">${I.map}<span>全体のどこ？（持っている区域の地図）</span></button>` : ''}
          <button class="link ret-link" data-act="returnAsk">${I.ret}この区域を返す</button>
        </div>
      </main>`;
    view.cardRef = card;
    refreshRooms();
    updateStatus();
  }
  function refreshRooms() {
    const card = K.cards().find(c => c.distId === view.id);
    if (!card || !card.isBuilding) return;
    view.cardRef = card;
    const st = K.buildingState(card);
    const pg = document.querySelector('[data-bprog]');
    if (pg) pg.innerHTML = progLine(st, '部屋');
    const box = document.querySelector('[data-rooms]');
    if (!box) return;
    if (!st.rooms.length) { box.innerHTML = '<p class="notice info">部屋の一覧がまだ登録されていません。上位管理者に伝えてください。</p>'; return; }
    const many = st.entrances.length > 1;
    box.innerHTML = st.entrances.map(e => `<section class="ent">${many ? `<h3>入口${esc(e.entrance || '')}</h3>` : ''}
      <div class="grid">${e.floorList.map(f => `<div class="floor"><span class="fl num">${f.floor}階</span><div class="cells">${f.rooms.map(r => {
        const x = st.map[r.id];
        return `<button class="cell s-${x.s}${x.rec && x.rec.pending ? ' pend' : ''}" data-act="room" data-room="${esc(r.id)}"><b class="num">${esc(r.no)}</b><span class="mk">${GLYPH[x.s] || ''}</span></button>`;
      }).join('')}</div></div>`).join('')}</div></section>`).join('');
  }
  function openRoom(roomId) {
    const card = view.cardRef;
    if (!card) return;
    const st = K.buildingState(card);
    const x = st.map[roomId];
    if (!x) return;
    const r = x.room;
    const ownRefusal = x.refused && x.rec && x.rec.result === '拒否' && canUndo(x.rec);
    let body = '';
    if (x.refused && !ownRefusal) {
      body += '<div class="notice">この部屋には「拒否」の印があります。訪問しないでください。</div>';
      if (isAdmin()) body += `<button class="btn wide" data-act="release" data-room="${esc(r.id)}">拒否の印を外す（管理者）</button>`;
    } else if (!ownRefusal) body += recButtons(`data-room="${esc(r.id)}"`, x);
    if (x.rec && x.rec.roomId && canUndo(x.rec)) body += `<button class="btn ghost wide" data-act="undo" data-id="${esc(x.rec.id)}">「${esc(x.rec.result)}」の記録を取り消す</button>`;
    body += `<details class="report"><summary>この部屋のことを知らせる</summary><div class="report-opts">
      <button class="btn sm" data-act="report" data-room="${esc(r.id)}" data-note="空き部屋らしい">空き部屋らしい</button>
      <button class="btn sm" data-act="report" data-room="${esc(r.id)}" data-note="部屋の番号がちがう">番号がちがう</button></div></details>`;
    const ent = st.entrances.length > 1 && r.entrance ? '<small>入口' + esc(r.entrance) + '</small> ' : '';
    openSheet(sheetTitle(ent + esc(r.no) + '<small>号室</small>', stateChip(x)), body);
  }

  /* ---------- ボトムシートとお知らせ ---------- */
  let sheetEl = null;
  function openSheet(titleHtml, bodyHtml, onClose) {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>' + titleHtml + (bodyHtml || '') + '</div>';
    wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);
    sheetEl = wrap;
    sheetEl._onClose = onClose;
    return wrap.querySelector('.sheet');
  }
  function closeSheet() {
    if (!sheetEl) return;
    const f = sheetEl._onClose;
    sheetEl.remove();
    sheetEl = null;
    if (f) f();
  }
  let toastT = null;
  function toast(msg, actLabel, actFn, ms) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actLabel ? '<button type="button">' + esc(actLabel) + '</button>' : '');
    if (actLabel) el.querySelector('button').addEventListener('click', () => { el.remove(); actFn(); });
    document.body.appendChild(el);
    clearTimeout(toastT);
    toastT = setTimeout(() => el.remove(), ms || (actLabel ? 8000 : 3200));
  }

  /** 間違えて返した区域を元に戻す。まだ送っていなければ手元で取り消し、送ったあとなら「戻す」を送る */
  async function undoReturn(distId, territoryId) {
    const o = K.returnOps()[distId];
    if (o && o.type === 'reopen') { if (view.name === 'home') views.home(); return; }
    let done = false;
    if (o && K.state.outbox.some(x => x.id === o.id)) done = await K.unqueue(o.id);
    if (!done) await K.enqueue({ type: 'reopen', distId: distId, territoryId: territoryId });
    const c = K.cards().find(x => x.distId === distId);
    toast((c ? c.no + ' を' : '') + '元に戻しました' + (done || K.net.online ? '' : '。電波が戻ると、サーバーにも伝わります'));
    if (view.name === 'home') views.home();
  }

  /* ---------- 記録する・取り消す ---------- */
  function currentCard() {
    if (M) return M.card;
    return view.cardRef || null;
  }
  async function record(target, result) {
    const card = currentCard();
    if (!card) return;
    const op = await K.enqueue(Object.assign({ type: 'visit', distId: card.distId, territoryId: card.territoryId, result: result }, target));
    vibrate(15);
    closeSheet();
    toast('「' + result + '」と記録しました', '取り消す', () => undo(op.id));
  }
  async function undo(id) {
    const removed = await K.unqueue(id);
    if (!removed) await K.enqueue({ type: 'void', target: id });
    closeSheet();
    toast('取り消しました');
  }

  /* ---------- 設定と確認 ---------- */
  views.diag = async function () {
    app.innerHTML = `
      ${demoBar()}
      ${topBar({ back: true, title: '<b>設定と確認</b>' })}
      <main class="diag">
        <div class="status" data-status></div>
        <dl class="checks" id="checks"><div class="muted">調べています…</div></dl>
        <div class="stack" id="diag-actions"></div>
      </main>`;
    updateStatus();
    const s = K.state;
    const mine = s.me;
    let sw = 'bad';
    try { sw = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'ok' : 'warn') : 'bad'; } catch (e) { sw = 'bad'; }
    let persisted = null, est = null;
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { persisted = null; }
    try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { est = null; }
    const tiles = await K.tiles.usage();
    await K.basemap.init();
    const where = await K.kv.where();
    const fk = K.fmtKey(s.key);
    const rows = [
      ['利用カードの番号', s.key ? '保存しています（' + fk.slice(0, 4) + '-…-' + fk.slice(-4) + '）' : 'ありません', s.key ? 'ok' : 'bad', s.keyFrom ? '読み取り方：' + s.keyFrom : ''],
      ['利用者', mine && mine.user ? mine.user.name + '（' + mine.user.role + (mine.user.groupName ? '・' + mine.user.groupName : '') + '）' : 'まだ確かめていません', mine ? 'ok' : 'warn', ''],
      ['開き方', isStandalone() ? 'ホーム画面から開いています' : 'ブラウザで開いています', isStandalone() ? 'ok' : 'warn', isStandalone() ? '' : 'ホーム画面に追加すると、電波がなくても開けます'],
      ['電波なしで開く準備', sw === 'ok' ? 'できています' : sw === 'warn' ? '次に開いたときから使えます' : 'この画面では使えません', sw, ''],
      ['データを消されにくくする', persisted === true ? '有効' : persisted === false ? 'まだ' : '確かめられません', persisted ? 'ok' : 'warn', ''],
      ['地図の下地', K.basemap.why(), K.basemap.done && !K.basemap.meta ? 'warn' : 'ok', K.basemap.meta ? '保存した地図：' + K.basemap.meta.made + ' 作成' : ''],
      ['端末に入れた地図', K.tiles.available() ? Object.keys(s.savedMaps).length + '区域分（' + (tiles === null ? '?' : tiles) + 'ファイル）' : 'この画面では保存しません', K.tiles.available() ? (Object.keys(s.savedMaps).length ? 'ok' : 'warn') : 'mute', '電波がない所では、これを出します'],
      ['記録の保存先', where, 'ok', ''],
      ['使っている容量', est && est.usage !== undefined ? (est.usage / 1e6).toFixed(1) + ' MB' : '—', 'mute', ''],
      ['送信待ち', s.outbox.length + '件', s.outbox.length ? 'warn' : 'ok', ''],
      ['送れなかった記録', s.failed.length + '件', s.failed.length ? 'bad' : 'ok', s.failed.slice(-5).map(f => (f.message || f.error) + '（' + whenText(new Date(f.failedAt).toISOString()) + '）').join(' ／ ')],
      ['最後に送れた時刻', s.lastSync ? whenText(s.lastSync) : 'まだ送っていません', 'mute', ''],
      ['区域データ', K.geo.version, 'mute', ''],
      ['アプリの版', K.VERSION + (s.demo ? '（お試し版）' : ''), 'mute', ''],
      ['端末', deviceName(), 'mute', ''],
    ];
    const box = document.getElementById('checks');
    if (!box) return;
    box.innerHTML = rows.map(r => `<div class="ck s-${r[2]}"><dt>${esc(r[0])}</dt><dd>${esc(r[1])}${r[3] ? '<small>' + esc(r[3]) + '</small>' : ''}</dd></div>`).join('');
    const acts = [];
    if (s.outbox.length) acts.push(`<button class="btn primary" data-act="syncNow">${I.up}今すぐ送る</button>`);
    acts.push(`<button class="btn" data-act="reload">自分の区域を読み直す</button>`);
    if (K.tiles.available()) acts.push(`<button class="btn" data-act="resave">地図をもう一度保存する</button>`);
    if (persisted === false) acts.push(`<button class="btn" data-act="persist">データを消されにくくする</button>`);
    if (!isStandalone() && !s.demo) acts.push(`<button class="btn" data-act="howInstall">ホーム画面に追加するやり方</button>`);
    if (s.demo) {
      acts.push(`<button class="btn" data-act="demoSwitch">お試し版で別の人になる</button>`);
      acts.push(`<button class="btn" data-act="demoReset">お試し版を最初からやり直す</button>`);
    } else {
      acts.push(`<button class="btn danger" data-act="forget">この端末から番号を消す</button>`);
    }
    document.getElementById('diag-actions').innerHTML = acts.join('');
  };
  function deviceName() {
    const ua = navigator.userAgent;
    const ios = ua.match(/OS (\d+)_(\d+)/);
    const and = ua.match(/Android (\d+(\.\d+)?)/);
    const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'ブラウザ';
    if (isIOS && ios) return 'iPhone / iPad（iOS ' + ios[1] + '.' + ios[2] + '）・' + br;
    if (and) return 'Android ' + and[1] + '・' + br;
    return br + '（' + (navigator.platform || '') + '）';
  }
  function howInstallSheet() {
    const ios = `<h3>iPhone（Safari）</h3><ol><li>画面の下にある <b>共有</b>（四角から矢印が出ている形）を押す</li><li><b>ホーム画面に追加</b> を押す</li><li>右上の <b>追加</b> を押す</li></ol>`;
    const and = `<h3>Android（Chrome）</h3><ol><li>右上の <b>︙</b> を押す</li><li><b>ホーム画面に追加</b> または <b>アプリをインストール</b> を押す</li><li><b>インストール</b>（または <b>追加</b>）を押す</li></ol>`;
    openSheet(sheetTitle('ホーム画面に追加'), `<div class="howto">${isIOS ? ios + and : and + ios}<p class="muted small">追加したあとは、ホーム画面のアイコンから開きます。iPhoneでは、最初の1回だけ、もう一度カードを読み取ります。</p></div>`);
  }

  /* ---------- 押したときの動き ---------- */
  Object.assign(act, {
    back: () => back(),
    scan: () => go('scan'),
    typeKey: () => go('key', { demo: view.name === 'demo' || (view.name === 'key' && view.demo) }),
    demo: () => go('demo'),
    demoType: () => go('key', { demo: true }),
    demoAs: async el => {
      const u = K.demo.users().find(x => x.id === el.dataset.id);
      if (!u) return;
      el.disabled = true;
      K.state.outbox = []; K.state.sent = []; K.state.failed = [];
      await K.kv.set('outbox', []); await K.kv.set('sent', []); await K.kv.set('failed', []);
      K.adminData = null;
      await K.setKey(u.key, true, 'お試し版');
      authError = null;
      go('home', null, true);
      K.refresh().then(() => K.tiles.saveAll()).catch(() => {});
    },
    demoSwitch: async () => { K.adminData = null; await K.forget(); go('demo', null, true); },
    toggleNet: () => { K.demo.setOffline(!K.demo.offline); updateStatus(); toast(K.demo.offline ? '電波がない状態にしました。記録はこのスマホにたまります。' : '電波を戻しました。たまった記録を送ります。'); },
    restart: async () => { await K.forget(); authError = null; go('start', null, true); },
    open: el => go('card', { id: el.dataset.id }),
    diag: () => go('diag'),
    zin: () => M && M.map.zoomIn(1),
    zout: () => M && M.map.zoomOut(1),
    fit: () => M && M.map.fitBounds(L.latLngBounds([[M.t.bb[0], M.t.bb[1]], [M.t.bb[2], M.t.bb[3]]]), { padding: [30, 30], maxZoom: 18.5 }),
    locate: () => locate(),
    layer: el => {
      if (!photo && !K.basemap.photoOk()) { toast('今は写真を出せません（国土地理院の地図を読めません）'); el.hidden = true; return; }
      photo = !photo;
      if (M) M.base.setPhoto(photo);
      el.querySelector('span').textContent = photo ? '地図' : '写真';
    },
    rec: el => record(el.dataset.room ? { roomId: el.dataset.room } : { houseId: el.dataset.h }, el.dataset.r),
    room: el => openRoom(el.dataset.room),
    undo: el => undo(el.dataset.id),
    release: async el => {
      const card = currentCard();
      if (!card) return;
      const op = await K.enqueue(Object.assign({ type: 'visit', distId: card.distId, territoryId: card.territoryId, result: '拒否解除' },
        el.dataset.room ? { roomId: el.dataset.room } : { houseId: el.dataset.h }));
      closeSheet();
      toast('拒否の印を外しました', '取り消す', () => undo(op.id));
    },
    report: async el => {
      const card = currentCard();
      if (!card) return;
      await K.enqueue({ type: 'report', territoryId: card.territoryId, houseId: el.dataset.h || '', roomId: el.dataset.room || '', note: el.dataset.note });
      closeSheet();
      toast('「' + el.dataset.note.replace(/（.*）/, '') + '」と知らせました。ありがとうございます');
    },
    blockDone: async el => {
      if (!M) return;
      const op = await K.enqueue({ type: 'visit', distId: M.card.distId, territoryId: M.card.territoryId, blockId: el.dataset.b, result: '済' });
      vibrate(15);
      closeSheet();
      toast('ブロックの残りを「済」にしました', '取り消す', () => undo(op.id));
    },
    roomsAll: () => {
      const card = view.cardRef;
      if (!card) return;
      const st = K.buildingState(card);
      const ents = st.entrances.map(e => ({ e: e, blank: e.floorList.reduce((n, f) => n + f.rooms.filter(r => st.map[r.id].s === '未').length, 0) }));
      const rows = ents.map(x => `<div class="brow"><div><b>${st.entrances.length > 1 ? '入口' + esc(x.e.entrance) : 'この建物'}</b><span class="muted">　印のない部屋 ${x.blank}</span></div>
        ${x.blank ? `<button class="btn sm primary" data-act="entDone" data-k="${esc(x.e.key)}">全部回った</button>` : '<span class="muted small">済んでいます</span>'}</div>`).join('');
      openSheet(sheetTitle('全部回った'), `<p class="muted">回り終えた${st.entrances.length > 1 ? '入口' : '建物'}を選ぶと、まだ印のない部屋をまとめて「済」にします。</p><div class="blist">${rows}</div>`);
    },
    entDone: async el => {
      const card = view.cardRef;
      if (!card) return;
      const op = await K.enqueue({ type: 'visit', distId: card.distId, territoryId: card.territoryId, blockId: el.dataset.k, result: '済' });
      vibrate(15);
      closeSheet();
      toast('印のない部屋を「済」にしました', '取り消す', () => undo(op.id));
    },
    bmap: () => {
      const card = view.cardRef;
      if (!card) return;
      const b = card.building;
      let mm = null;
      const sh = openSheet(sheetTitle(esc(b.name)), '<div class="minimap" id="bmini"></div>', () => { if (mm) mm.remove(); });
      setTimeout(() => { mm = miniMap(sh.querySelector('#bmini'), b.lat, b.lon); }, 30);
    },
    closeSheet: () => closeSheet(),
    mapReport: () => { if (!M) return; closeSheet(); setPick(true); toast('家がある場所を、地図の上でさわってください'); },
    pickCancel: () => setPick(false),
    mapReportDo: async el => {
      if (!M) return;
      const card = M.card;
      const op = await K.enqueue({ type: 'report', territoryId: card.territoryId, houseId: '', lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), note: '地図にない家' });
      setPick(false);
      closeSheet();
      refreshMarkers();
      const h = K.geo.house['n-' + op.id];
      if (h) openHouse(h);
      toast('知らせました。この家にも記録できます');
    },
    blocks: () => {
      if (!M) return;
      if (M.t.blocks.length === 1) return openBlock(M.t.blocks[0]);
      const st = K.cardState(M.card);
      const rows = M.t.blocks.map(bid => {
        const b = K.geo.block[bid];
        const hs = K.geo.byBlock[bid].filter(h => st.map[h.id] && st.map[h.id].target);
        const blank = hs.filter(h => st.map[h.id].s === '未').length;
        return `<div class="brow"><div><b>ブロック${b.n}</b><span class="muted">　家 ${hs.length}軒・印のない家 ${blank}軒</span></div>
          <button class="btn sm ${blank ? 'primary' : ''}" data-act="pickBlock" data-b="${bid}">${blank ? '全部回った' : '見る'}</button></div>`;
      }).join('');
      openSheet(sheetTitle('全部回ったブロック'), `<p class="muted">全部回ったブロックを選ぶと、まだ印のない家をまとめて「済」にできます。</p><div class="blist">${rows}</div>`);
    },
    pickBlock: el => openBlock(el.dataset.b),
    returnAsk: () => {
      const c = currentCard();
      if (!c) return;
      const st = c.isBuilding ? K.buildingState(c) : K.cardState(c);
      openSheet(sheetTitle(esc(c.no)), `<p class="lead">この区域を返却しますか。</p>
        <p class="muted">返したあとは、このスマホの「わたしの区域」から消えます。記録（${st.done}${c.isBuilding ? '部屋' : '軒'}）は残ります。</p>
        <div class="row2"><button class="btn big" data-act="closeSheet">やめる</button><button class="btn primary big" data-act="returnDo">返す</button></div>`);
    },
    returnDo: async () => {
      const c = currentCard();
      if (!c) return;
      await K.enqueue({ type: 'return', distId: c.distId, territoryId: c.territoryId });
      closeSheet();
      go('home', null, true);
      toast(c.no + ' を返却しました', '元に戻す', () => undoReturn(c.distId, c.territoryId), 10000);
    },
    undoReturn: el => {
      const c = K.returnedCards().find(x => x.distId === el.dataset.id);
      if (c) undoReturn(c.distId, c.territoryId);
    },
    install: async () => { if (!installEvt) return howInstallSheet(); installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* なくてもよい */ } installEvt = null; views.home(); },
    howInstall: () => howInstallSheet(),
    syncNow: () => { K.sync.failCount = 0; K.sync.kick(0); toast('送っています'); },
    reload: async () => { try { await K.refresh(); toast('読み直しました'); render(); } catch (e) { toast(e.net ? '電波のある所で、もう一度押してください' : e.message); } },
    resave: async () => { K.state.savedMaps = {}; await K.kv.set('savedMaps', {}); toast('地図を保存しています'); await K.tiles.saveAll(); toast('地図を保存しました'); if (view.name === 'diag') views.diag(); },
    persist: async () => { try { const ok = await navigator.storage.persist(); toast(ok ? '有効にしました' : 'この端末では有効にできませんでした（ホーム画面に追加すると有効になることがあります）'); } catch (e) { toast('この端末では使えません'); } views.diag(); },
    forget: async el => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'もう一度押すと消します（送信待ち ' + K.state.outbox.length + '件も消えます）'; return; }
      await K.forget(); go('start', null, true);
    },
    demoReset: async () => { await K.demo.reset(); K.adminData = null; await K.forget(); await K.kv.set('savedMaps', {}); go('demo', null, true); },
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = act[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'A') return; // リンクはそのまま開く
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetEl) closeSheet(); });

  /* ---------- データが変わったとき ---------- */
  K.on('data', () => {
    if (view.name === 'home') views.home();
    else if (view.name === 'card') {
      if (M) { if (!K.cards().some(c => c.distId === M.card.distId)) return; refreshMarkers(); renderPanel(); }
      else refreshRooms();
    }
    updateStatus();
  });
  K.on('sync', updateStatus);
  K.on('net', () => { updateStatus(); if (view.name === 'home') views.home(); });
  K.on('tiles', () => { if (view.name === 'home') views.home(); });
  // 国土地理院が読めなくなった・戻ったとき：写真のボタンを出す／隠す（写真を見ている最中は、地図に戻せるよう残す）
  K.on('basemap', () => { document.querySelectorAll('.layer-btn').forEach(b => { const s = b.querySelector('span'); if (s && s.textContent === '写真') b.hidden = !K.basemap.photoOk(); }); });
  K.on('auth', e => { authError = e; if (view.name === 'home') views.home(); });

  /* ---------- 起動 ---------- */
  function readUrlKey() {
    const m = (location.hash + '&' + location.search).match(/[#?&]k=([A-Za-z0-9-]{8,20})/);
    return m ? K.normKey(m[1]) : '';
  }
  function registerSW() {
    if (!K.cfg.serviceWorker || !('serviceWorker' in navigator)) return;
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* 使えない環境 */ }
  }
  K.boot = async function () {
    app.innerHTML = '<div class="boot">読み込んでいます…</div>';
    await K.load();
    const urlKey = readUrlKey();
    if (urlKey && urlKey !== K.state.key) await K.setKey(urlKey, false, 'QRコード');
    try { await K.loadGeo(); } catch (e) {
      app.innerHTML = '<main class="start"><p class="notice">区域のデータを読めませんでした。電波のある所で開き直してください。</p></main>';
      return;
    }
    if (K.state.demo) { try { await K.demo.init(); } catch (e) { await K.forget(); } }
    registerSW();
    K.basemap.init();
    view = { name: K.state.key ? 'home' : 'start' };
    try { history.replaceState({ v: view }, ''); } catch (e) { /* 使えない環境 */ }
    render();
    if (K.state.key) {
      K.refresh().then(() => K.tiles.saveAll()).catch(e => { if (e.code === 'BAD_KEY' || e.code === 'STOPPED') K.emit('auth', e); else render(); });
      K.sync.kick(800);
    }
    window.addEventListener('online', () => { updateStatus(); K.basemap.changed(); K.sync.kick(500); if (K.state.key) K.refresh().then(() => K.tiles.saveAll()).catch(() => {}); });
    window.addEventListener('offline', () => { updateStatus(); K.basemap.changed(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !K.state.key) return;
      K.sync.kick(300);
      const f = K.state.me && K.state.me.fetchedAt;
      if (!f || Date.now() - Date.parse(f) > 120000) K.refresh().catch(() => {});
    });
    setInterval(() => { if (K.state.outbox.length && !K.sync.busy) K.sync.run(); }, 60000);
  };

  K.ui = { go, back, render, toast, openSheet, closeSheet, sheetTitle, topBar, demoBar, updateStatus, miniMap, baseLayer, gmapsUrl, I, LOGO, GSI_ATTR, OWN_ATTR, views, act, leaveHooks, view: () => view, refreshMarkers: () => refreshMarkers(), renderPanel: () => renderPanel() };
})();

/**
 * 区域訪問管理 試作版 — サーバー側（Google Apps Script）
 *
 * 使い方
 *   1. 共有アカウントで新しいスプレッドシートを作り、［拡張機能］→［Apps Script］を開く
 *   2. このファイルの中身を コード.gs に貼り付けて保存する
 *   3. 関数「setup」を選んで［実行］（初回は権限の確認が出る）
 *   4. ［デプロイ］→［新しいデプロイ］→ 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *   5. 出てきたURL（…/exec）をアプリの js/config.js の gasUrl に入れる
 *
 * 決まり
 *   - 記録は追記だけ。取り消しは「取り消し」の行を足し、元の行の「無効」に印を付ける
 *   - 記録IDはスマホが付ける。同じIDは2回書かない（電波が戻って送り直しても重ならない）
 *   - 権限は画面だけでなく、ここでも確かめる
 *   - シートの列の順番は変えない（右側に列を足すのはよい）
 *   - 完全回収日を過ぎた区域は自動で回収する（毎日の自動実行と、画面を開いたときの両方で確かめる）
 *   - 地図の家は、元のデータ（data/territories.json）に「家の手直し」シートを重ねて使う
 *   - 集合住宅は、建物ごとにも、部屋を選んでも配れる（部屋が重ならなければ、同じ建物を何人にでも）
 *   - 設定「使う機能」を「集合住宅だけ」にすると、戸建ての区域は配れない（集合住宅の回り方だけで始めるとき）
 *   - 集合住宅の回り方（マンション訪問・夕方のアパートなど）は「回り方」シートで決める。名前はいつでも変えられる
 *     （建物や配布には回り方ID（R1・R2…）で残すので、名前を変えても結びつきは切れない）
 *   - 間違えて返した区域は、返した本人（決まった日数のうち）と上位管理者（いつでも）が「元に戻す」で戻せる
 *   - 代理入力（0.11.0）：紙で回った記録・台帳の配布と返却を、日付を指定してあとから入れる（入れた人は「入れた人」の列に残る）
 *   - 毎晩のバックアップ（0.11.0）：全部のシートを小さな zip にまとめ、Google ドライブに日・週・月ごとに残す（古いものは自動で消す）
 */

const APP_VERSION = '0.12.0';
const TZ = 'Asia/Tokyo';

const SHEETS = {
  '設定': ['項目', '値', '説明'],
  '利用者': ['利用者ID', '名前', 'ふりがな', 'グループID', '役割', '鍵', '有効', '作成日', 'メモ', 'いつもの枚数', '配り方', '家の近く'],
  'グループ': ['グループID', '名前', '並び順', '主に回るエリア', 'メモ', '有効'],
  '配布': ['配布ID', '区域ID', '区域番号', '種別', '利用者ID', '名前', '配布日', '回収日', '返却日', '配布した人', '無効', 'メモ',
    'グループID', '元の配布ID', '集まりID', '終わり方', '完全回収日', '部屋', '返した人'],
  '集まり': ['集まりID', '日付', '種類', '名前', '作った人', '終えた日', '無効'],
  '訪問記録': ['記録ID', '配布ID', '区域ID', '家ID', 'ブロックID', '結果', '訪問日時', '利用者ID', '名前', '受信日時', '無効', '取り消し元', '部屋ID', '入れた人'],
  '報告': ['報告ID', '家ID', '区域ID', '内容', '利用者ID', '名前', '日時', '対応', '部屋ID', '緯度', '経度'],
  '家の状態': ['日時', '家ID', '状態', '建物ID', '変えた人', 'メモ', '無効', '取り消した日時', '取り消した人'],
  '建物': ['建物ID', '表示番号', '名前', '種類', 'オートロック', '回り方', '市', '家ID', '緯度', '経度', '住所', '有効', 'メモ', '作成日'],
  '部屋': ['部屋ID', '建物ID', '入口', '階', '部屋番号', '並び順', '有効', 'メモ'],
  '変更の記録': ['日時', '操作した人', '対象', '内容'],
  '家の手直し': ['手直しID', '日時', '種類', '家ID', '区域ID', 'ブロックID', '緯度', '経度', 'メモ', '変えた人', '無効', '報告ID', '取り消した日時', '取り消した人'],
  '区切りの手直し': ['手直しID', '日時', '種類', '対象ID', '移す先', '番号', '町', '形', 'メモ', '変えた人', '無効', '取り消した日時', '取り消した人', '組'],
  '回り方': ['回り方ID', '名前', '渡し方', '1人の部屋数', '回り直すまでの日数', '並び順', '使う', 'メモ', '前の名前', '1つの建物から'],
  '月の組': ['区域ID', '区域番号', '組', '変えた日', '変えた人'],
};

/** 前の版の見出しを、新しい名前に直す（列の場所は同じ） */
const RENAMED_HEADERS = { '配布': { '返却期限': '回収日', '強制回収日': '完全回収日' } };
const RENAMED_SETTINGS = { '返却期限': '回収日', '強制回収までの日数': '完全回収までの日数', '集まりの強制回収までの日数': '集まりの完全回収までの日数' };

const DEFAULT_SETTINGS = [
  ['回収日', '月末', '配るときに最初に出る回収日。「月末」（配布した月の月末）または「1か月」〜「6か月」'],
  ['完全回収までの日数', 14, '回収日からこの日数がたった日を「完全回収日」にする。完全回収日を過ぎると、返していない区域を自動で回収する（それまでは記録をつけられる）'],
  ['回収日の知らせ', 7, '回収日の何日前から、持っている人の画面に知らせを出すか'],
  ['集まりの完全回収までの日数', 2, '集まりで割り振った区域は、その日が回収日。この日数がたつと自動で回収する'],
  ['使う機能', 'すべて', '「すべて」または「集合住宅だけ」。集合住宅だけにすると、集合住宅の回り方（マンション訪問など）だけを使い、戸建ての区域は配らない'],
  ['返却を取り消せる日数', 7, '間違えて返したとき、返した本人が「元に戻す」を使える日数（上位管理者はいつでも戻せる）'],
  ['1人が持てる枚数', 10, '1人がふだん持てる区域の上限（集まりで割り振る分は数えない）'],
  ['注意を出す枚数', 7, 'この枚数から配る画面に注意を出す'],
  ['取り消しできる時間', 24, '一般の人が自分の記録を取り消せる時間（時間）'],
  ['アプリのURL', '', '利用カードのQRコードに入るアドレス（GitHub Pages のURL）'],
  ['いつもの枚数（決めていない人）', 4, '全員にまとめて配るとき、枚数を決めていない人に配る枚数'],
  ['不在宅訪問の候補の日数', 62, '返却からこの日数以内の区域を、不在宅訪問の候補に出す'],
  ['マンションの頭文字', 'M', 'マンションの区域番号の頭（例：MZ3）'],
  ['アパートの頭文字', 'A', 'アパートの区域番号の頭（例：AH5）'],
  ['地図の下地', '国土地理院', '「国土地理院」（国土地理院の地図。読めないときは保存した地図）または「保存した地図」（アプリと一緒に置いた地図だけを使う）'],
  ['一巡の月数', 4, '戸建ての区域を一巡する月数（2〜6）。月ごとの組と進み具合に使う'],
  ['一巡の始まり', '', '一巡を始めた月（例：2026-11）。空なら一巡の進み具合は出さない。一巡が終わると、同じ長さで次の一巡が自動で始まる'],
  ['月ごとの配りやすさ', '', '戸建て：1月〜12月の配りやすさ（%、12個をカンマで）。冬を少なめにすると、ほかの月の組が大きくなる（冬の前倒し）。空ならどの月も同じ'],
  ['集合住宅の一巡の月数', '', '集合住宅を一巡する月数（2〜12）。空なら戸建てと同じ。集合住宅の月ごとの組と進み具合は、戸建てとは別に数える'],
  ['集合住宅の月ごとの配りやすさ', '', '集合住宅：1月〜12月の配りやすさ（%、12個をカンマで）。空ならどの月も同じ'],
  ['お知らせ', '', '全員の画面のいちばん上に出す一言。アプリの［管理］→［お知らせ］で書く'],
  ['お知らせの期限', '', 'この日を過ぎると、お知らせを出さない（空なら消すまで出す）'],
  ['お知らせを出した日', '', 'お知らせを書いた日（アプリが入れる）'],
  ['毎晩のバックアップ', 'する', '「する」なら毎晩2時ごろ、全部のシートを小さな zip にまとめて Google ドライブの「区域訪問管理のバックアップ」フォルダに残す（変わっていない日は作らない。古いものは自動で消す）'],
];

const RESULTS = ['会えた', '不在', '拒否', '済', '拒否解除'];
const ROLES = ['一般', '副責任者', '責任者', '上位管理者'];
const ADMIN_ROLES = ['副責任者', '責任者', '上位管理者'];
const KIND_NORMAL = '通常';
const KIND_ABSENT = '不在宅訪問';
const KIND_HOLD = '手持ち';
/** 配布の種別。集合住宅の回り方（R1・R2…）も種別になる */
const FIXED_KINDS = ['通常', '不在宅訪問', '手持ち'];
const SCOPES = ['すべて', '集合住宅だけ'];
const EDITABLE_SETTINGS = ['使う機能', '完全回収までの日数', '回収日の知らせ', '返却を取り消せる日数', '地図の下地', '一巡の月数', '一巡の始まり',
  '月ごとの配りやすさ', '集合住宅の一巡の月数', '集合住宅の月ごとの配りやすさ', '毎晩のバックアップ',
  '回収日', '集まりの完全回収までの日数', '1人が持てる枚数', '注意を出す枚数', '取り消しできる時間', 'いつもの枚数（決めていない人）', '不在宅訪問の候補の日数'];
/** 数の設定の範囲（アプリの［設定］から変えるとき） */
const NUMBER_RANGES = { '完全回収までの日数': [0, 90], '回収日の知らせ': [0, 60], '返却を取り消せる日数': [0, 90], '集まりの完全回収までの日数': [0, 30],
  '1人が持てる枚数': [1, 50], '注意を出す枚数': [1, 50], '取り消しできる時間': [0, 720], 'いつもの枚数（決めていない人）': [0, 50], '不在宅訪問の候補の日数': [0, 365] };
const DUE_CHOICES = ['月末', '1か月', '2か月', '3か月', '4か月', '5か月', '6か月'];
/** 一巡の月数の範囲（戸建て）と、集合住宅の一巡の月数の範囲 */
const PLAN_MONTHS = [2, 6];
const APT_MONTHS = [2, 12];
/** 文字として残す設定（「2026-11」や「100,100,…」が日付や数に変わらないように） */
const TEXT_SETTINGS = ['一巡の始まり', '月ごとの配りやすさ', '集合住宅の月ごとの配りやすさ', 'お知らせ', 'お知らせの期限'];
const BACKUP_FOLDER = '区域訪問管理のバックアップ';
const BACKUP_PREFIX = '区域訪問管理_';
const BASEMAPS = ['国土地理院', '保存した地図'];
/** 前の版の設定（0.5.0から回り方ごと）。setup で「回り方」シートに移す */
const MOVED_SETTINGS = ['1人に割り振る部屋の数', 'マンションの部屋を回り直すまでの日数'];
/** 回り方の渡し方：部屋ごと（1人に数部屋）・一棟まとめて（建物まるごと1人に） */
const HAND_MODES = ['部屋ごと', '一棟まとめて'];
const DEFAULT_ROUTES = [
  ['R1', 'マンション訪問', '部屋ごと', 5, 90, 1, true, '', '', 2],
  ['R2', '夕方のアパート', '一棟まとめて', 5, 90, 2, true, '', '', 2],
];
/** 0.4.0 までは回り方を名前で残していた。名前を変えたあとも読めるように */
const LEGACY_ROUTES = { 'マンション訪問': 'R1', '夕方のアパート': 'R2' };
const NO_ROUTE = '決めていない';
/** 部屋ごとに割り振るとき、1人に1つの建物から何部屋まで（回り方ごとに変えられる） */
const DEFAULT_PER_BUILDING = 2;
const BUILDING_TYPES = ['マンション', 'アパート', 'その他'];
const HOUSE_STATES = ['家', '家ではない', '空き家', '集合住宅', '確認待ち', 'なくなった'];
const EDIT_TYPES = ['足す', '動かす', '見送り'];
/** 区切りの手直し（0.12.0）の種類。家を移す：家を別の区域へ／ブロックを移す／ブロックを足す（線を描く）／区域を作る／区域を外す（使わない）／番号を変える */
const BOUNDARY_TYPES = ['家を移す', 'ブロックを移す', 'ブロックを足す', '区域を作る', '区域を外す', '番号を変える'];
const NEW_HOUSE_NOTE = '地図にない家';
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ============================== 入口 ============================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return json_(handle_(p));
  return json_({ ok: true, app: '区域訪問管理', version: APP_VERSION });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON', message: '送られた内容が読めませんでした' });
  }
  return json_(handle_(req));
}

function handle_(req) {
  try {
    if (req.action === 'ping') return { ok: true, version: APP_VERSION, time: new Date().toISOString() };
    ROUTE_CACHE_ = null;
    const user = auth_(req.key);
    switch (req.action) {
      case 'me': return apiMe_(user);
      case 'push': return apiPush_(user, req.ops);
      case 'admin': return apiAdmin_(user);
      case 'building': return apiBuilding_(user, req);
      case 'distribute': return apiDistribute_(user, req);
      case 'returnCards': return apiReturnCards_(user, req);
      case 'returnCard': return apiReturnCards_(user, { distIds: [req.distId] });
      case 'cancelDist': return apiCancelDist_(user, req);
      case 'closeGathering': return apiCloseGathering_(user, req);
      case 'savePerson': return apiSavePerson_(user, req.person || {});
      case 'reissueKey': return apiReissueKey_(user, req);
      case 'saveGroup': return apiSaveGroup_(user, req.group || {});
      case 'setHouseState': return apiSetHouseState_(user, req);
      case 'saveBuilding': return apiSaveBuilding_(user, req);
      case 'resolveReport': return apiResolveReport_(user, req);
      case 'setDates': return apiSetDates_(user, req);
      case 'editHouse': return apiEditHouse_(user, req.edit || {});
      case 'editBoundary': return apiEditBoundary_(user, req);
      case 'toggleBoundary': return apiToggleBoundary_(user, req);
      case 'undoHouseEdit': return apiUndoHouseEdit_(user, req);
      case 'roomStatus': return apiRoomStatus_(user, req);
      case 'saveSetting': return apiSaveSetting_(user, req);
      case 'saveRoute': return apiSaveRoute_(user, req.route || {});
      case 'reopenDists': return apiReopenDists_(user, req);
      case 'coverage': return apiCoverage_(user, req);
      case 'setRoomRefusal': return apiSetRoomRefusal_(user, req);
      case 'savePeople': return apiSavePeople_(user, req);
      case 'saveGroups': return apiSaveGroups_(user, req);
      case 'mapHistory': return apiMapHistory_(user, req);
      case 'toggleMapChanges': return apiToggleMapChanges_(user, req);
      case 'logCompare': return apiLogCompare_(user, req);
      case 'savePlan': return apiSavePlan_(user, req);
      case 'printData': return apiPrintData_(user, req);
      case 'proxyList': return apiProxyList_(user, req);
      case 'distRecords': return apiDistRecords_(user, req);
      case 'proxyVisits': return apiProxyVisits_(user, req);
      case 'fixDist': return apiFixDist_(user, req);
      case 's13': return apiS13_(user, req);
      case 'saveNotice': return apiSaveNotice_(user, req);
      case 'backupNow': return apiBackupNow_(user, req);
      default: throw err_('BAD_ACTION', '知らない操作です');
    }
  } catch (e) {
    if (e && e.code) return { ok: false, error: e.code, message: e.message };
    return { ok: false, error: 'SERVER', message: String((e && e.message) || e) };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/* ============================== 本人確認と権限 ============================== */

function normKey_(k) {
  return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function auth_(key) {
  const k = normKey_(key);
  if (k.length < 8) throw err_('BAD_KEY', '利用カードの番号が正しくありません');
  const users = readUsers_();
  for (const id in users) {
    const u = users[id];
    if (normKey_(u.key) === k) {
      if (!u.active) throw err_('STOPPED', 'この利用カードは使えなくなっています。責任者に伝えてください');
      return u;
    }
  }
  throw err_('BAD_KEY', '利用カードの番号が見つかりません');
}

function readUsers_() {
  const U = readTable_('利用者');
  const c = U.col;
  const out = {};
  U.rows.forEach((r, i) => {
    const id = String(r[c['利用者ID']] || '').trim();
    if (!id) return;
    const role = String(r[c['役割']] || '').trim();
    out[id] = {
      id: id, row: i + 2,
      name: String(r[c['名前']] || '').trim(),
      kana: String(r[c['ふりがな']] || '').trim(),
      groupId: String(r[c['グループID']] || '').trim(),
      role: ROLES.indexOf(role) >= 0 ? role : '一般',
      key: String(r[c['鍵']] || ''),
      active: !falsy_(r[c['有効']]),
      usual: r[c['いつもの枚数']] === '' || r[c['いつもの枚数']] === null ? null : Number(r[c['いつもの枚数']]),
      memo: String(r[c['メモ']] || ''),
      // 配り方（0.8.0）：散らばる（ふつう）／近く（家の近くの区域にまとめる。車がない・足が悪いなど）。家の近く＝区域ID
      mode: String(r[c['配り方']] || '') === '近く' ? '近く' : '散らばる',
      near: String(r[c['家の近く']] || ''),
    };
  });
  return out;
}

function isAdmin_(u) { return !!u && ADMIN_ROLES.indexOf(u.role) >= 0; }
function isTop_(u) { return !!u && u.role === '上位管理者'; }
function needTop_(u) { if (!isTop_(u)) throw err_('TOP_ONLY', '上位管理者だけができます'); }

/** 管理者 admin が、利用者 target の区域を扱えるか（上位管理者は全員、責任者・副責任者は自分のグループ） */
function canManage_(admin, target) {
  if (!admin || !target) return false;
  if (isTop_(admin)) return true;
  return isAdmin_(admin) && !!admin.groupId && admin.groupId === target.groupId;
}

/** 配布の行を扱えるか（本人の分、グループの手持ちはそのグループの責任者） */
function canHandleDist_(user, users, r, dc) {
  if (isTop_(user)) return true;
  const owner = String(r[dc['利用者ID']] || '');
  if (owner) return owner === user.id || canManage_(user, users[owner]);
  return isAdmin_(user) && !!user.groupId && String(r[dc['グループID']]) === user.groupId;
}

function publicUser_(u, groups) {
  const g = groups && groups[u.groupId];
  return { id: u.id, name: u.name, role: u.role, groupId: u.groupId, groupName: g ? g.name : '', admin: isAdmin_(u), top: isTop_(u) };
}

/* ============================== 一般向け ============================== */

/** 自分が持っている区域（戸建て・集合住宅）と、その記録を返す */
function apiMe_(user) {
  const st = settings_();
  const groups = readGroups_();
  const D = readTable_('配布');
  const dc = D.col;
  const now = new Date();
  autoCollect_(D, now, false);
  const mine = [];
  const byTerr = {};
  const collected = [];
  const returnedRows = [];
  const recent = fmtDate_(new Date(now.getTime() - 14 * 864e5));
  const undoDays = numSetting_(st, '返却を取り消せる日数', 7);
  const undoSince = now.getTime() - undoDays * 864e5;
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    const tid = String(r[dc['区域ID']]);
    (byTerr[tid] = byTerr[tid] || []).push(r);
    if (String(r[dc['利用者ID']]) !== user.id || String(r[dc['種別']]) === KIND_HOLD) return;
    if (!r[dc['返却日']]) mine.push(r);
    else if (String(r[dc['終わり方']]) === '自動回収' && fmtDate_(r[dc['完全回収日']]) >= recent) collected.push(distObj_(r, dc));
    else if (String(r[dc['終わり方']]) === '返却' && [user.id, ''].indexOf(String(r[dc['返した人']] || '')) >= 0 &&
      toDate_(r[dc['返却日']]).getTime() >= undoSince) returnedRows.push(r);
  });
  // 自分で返した区域（決まった日数のうち）：「元に戻す」で戻せる。だれかに配り直していたら戻せない
  const returned = returnedRows.map(r => {
    const o = distObj_(r, dc);
    const clash = takenBy_(D, r);
    o.canUndo = !clash;
    o.takenBy = clash ? String(clash[dc['名前']]) : '';
    return o;
  }).sort((a, b) => (a.returnedAt < b.returnedAt ? 1 : -1));

  const cards = mine.map(r => {
    const card = distObj_(r, dc);
    if (card.kind === KIND_ABSENT) {
      // 不在宅訪問：同じ区域の、その前に返却された通常の配布の記録を使う
      const myDate = toDate_(r[dc['配布日']]).getTime();
      const prev = (byTerr[card.territoryId] || [])
        .filter(x => String(x[dc['種別']]) === KIND_NORMAL && x[dc['返却日']] &&
          String(x[dc['配布ID']]) !== card.distId && toDate_(x[dc['配布日']]).getTime() <= myDate)
        .sort((a, b) => toDate_(b[dc['配布日']]) - toDate_(a[dc['配布日']]))[0];
      card.prevDistId = prev ? String(prev[dc['配布ID']]) : '';
      card.prevReturnedAt = prev ? fmtDate_(prev[dc['返却日']]) : '';
    }
    return card;
  }).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.no < b.no ? -1 : 1));

  const wantDist = {};
  const wantTerr = {};
  cards.forEach(cd => {
    wantDist[cd.distId] = true;
    if (cd.prevDistId) wantDist[cd.prevDistId] = true;
    wantTerr[cd.territoryId] = true;
  });
  // 返した区域の記録も送る（電波がなくても、戻したときに記録がそろって見える）
  returned.forEach(cd => { wantDist[cd.distId] = true; wantTerr[cd.territoryId] = true; });

  const V = readTable_('訪問記録');
  const vc = V.col;
  const records = [];
  const refusal = {};
  V.rows.forEach(r => {
    if (!r[vc['記録ID']] || truthy_(r[vc['無効']])) return;
    const res = String(r[vc['結果']]);
    if (res === '取り消し') return;
    const tid = String(r[vc['区域ID']]);
    const target = String(r[vc['部屋ID']] || r[vc['家ID']] || '');
    // 拒否は家（部屋）ごとに数える。区域の線を直して家がほかの区域に移っても、拒否は家について回る
    const isRoom = !!r[vc['部屋ID']];
    if ((wantTerr[tid] || !isRoom) && target && (res === '拒否' || res === '拒否解除')) {
      const at = toDate_(r[vc['訪問日時']]).getTime();
      if (!refusal[target] || refusal[target].at <= at) refusal[target] = { res: res, at: at, tid: tid, room: isRoom };
    }
    if (wantDist[String(r[vc['配布ID']])]) records.push(recObj_(r, vc));
  });

  const refusedByTerr = {};
  const refusedHouses = [];
  Object.keys(refusal).forEach(h => {
    const x = refusal[h];
    if (x.res !== '拒否') return;
    if (x.room) (refusedByTerr[x.tid] = refusedByTerr[x.tid] || []).push(h);
    else refusedHouses.push(h);
  });
  // 部屋の拒否は建物ごと。家の拒否は全部まとめて送り、画面が今の区切りで区域ごとに分ける
  cards.concat(returned).forEach(cd => { cd.refused = refusedByTerr[cd.territoryId] || []; });

  const B = readBuildings_();
  const rooms = {};
  const needRooms = cards.concat(returned).filter(cd => B[cd.territoryId]).map(cd => cd.territoryId);
  if (needRooms.length) {
    const all = readRooms_();
    needRooms.forEach(bid => { rooms[bid] = all[bid] || []; });
  }

  // 地図にない家の知らせ（まだ確かめていないもの）は、その区域を持っている人に「仮の家」として出す
  const provisional = [];
  const Rp = readTable_('報告');
  const rpc = Rp.col;
  Rp.rows.forEach(r => {
    if (!r[rpc['報告ID']] || String(r[rpc['対応']] || '未確認') !== '未確認') return;
    if (String(r[rpc['内容']]).indexOf(NEW_HOUSE_NOTE) !== 0 || r[rpc['緯度']] === '' || r[rpc['緯度']] === null) return;
    const tid = String(r[rpc['区域ID']] || '');
    if (!wantTerr[tid]) return;
    provisional.push({ houseId: 'n-' + String(r[rpc['報告ID']]), reportId: String(r[rpc['報告ID']]), territoryId: tid,
      lat: Number(r[rpc['緯度']]), lon: Number(r[rpc['経度']]), by: String(r[rpc['名前']] || '') });
  });

  return {
    ok: true,
    version: APP_VERSION,
    serverTime: now.toISOString(),
    user: publicUser_(user, groups),
    cards: cards,
    collected: collected,
    returned: returned,
    records: records,
    buildings: Object.keys(B).map(id => B[id]),
    rooms: rooms,
    houseStates: readHouseStates_(),
    houseEdits: readHouseEdits_(false),
    boundaryEdits: readBoundaryEdits_(false),
    refusedHouses: refusedHouses,
    provisional: provisional,
    settings: {
      undoHours: Number(st['取り消しできる時間']) || 24,
      maxCards: Number(st['1人が持てる枚数']) || 10,
      warnCards: Number(st['注意を出す枚数']) || 7,
      noticeDays: numSetting_(st, '回収日の知らせ', 7),
      scope: scopeOf_(st),
      undoDays: undoDays,
      basemap: basemapOf_(st),
    },
    routes: readRoutes_().list.map(publicRoute_),
    notice: noticeOf_(st, now),
  };
}

/**
 * スマホにたまった操作をまとめて受け取る。
 * ops: [{id, type:'visit'|'void'|'report'|'return'|'reopen', distId, houseId, roomId, blockId, result, target, note, at}]
 *   reopen：間違えて返した区域を元に戻す（返した本人は決まった日数のうち、上位管理者はいつでも）
 * 同じIDの記録はもう一度書かない。1件ずつ結果を返す（retry:true のものだけ、スマホは送り直す）
 */
function apiPush_(user, ops) {
  if (!Array.isArray(ops) || !ops.length) return { ok: true, results: [] };
  if (ops.length > 500) throw err_('TOO_MANY', '一度に送れるのは500件までです');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const st = settings_();
    const undoMs = (Number(st['取り消しできる時間']) || 24) * 3600 * 1000;
    const users = readUsers_();
    const now = new Date();

    const D = readTable_('配布');
    const dc = D.col;
    const dists = {};
    D.rows.forEach((r, i) => { if (r[dc['配布ID']]) dists[String(r[dc['配布ID']])] = { r: r, row: i + 2 }; });

    const V = readTable_('訪問記録');
    const vc = V.col;
    const vIndex = {};
    V.rows.forEach((r, i) => { if (r[vc['記録ID']]) vIndex[String(r[vc['記録ID']])] = { r: r, row: i + 2 }; });

    const R = readTable_('報告');
    const rIds = {};
    R.rows.forEach(r => { if (r[0]) rIds[String(r[0])] = true; });

    const newV = [];
    const newR = [];
    const voidRows = [];
    const touched = [];

    const checkDist = (distId) => {
      const d = dists[String(distId)];
      if (!d || truthy_(d.r[dc['無効']])) throw err_('NO_DIST', 'この区域の配布が見つかりません');
      if (!canHandleDist_(user, users, d.r, dc)) throw err_('NOT_YOURS', '自分の区域ではありません');
      return d;
    };

    const results = ops.map(op => {
      const id = String((op && op.id) || '');
      try {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw err_('BAD_ID', '記録の番号が正しくありません');
        const at = deviceTime_(op.at, now);

        if (op.type === 'visit') {
          if (vIndex[id]) return { id: id, ok: true, dup: true };
          const d = checkDist(op.distId);
          const result = String(op.result);
          if (RESULTS.indexOf(result) < 0) throw err_('BAD_RESULT', '結果が正しくありません');
          if (result === '拒否解除' && !isAdmin_(user)) throw err_('ADMIN_ONLY', '拒否の解除は管理者だけができます');
          if (!op.houseId && !op.blockId && !op.roomId) throw err_('NO_TARGET', '家・部屋・ブロックのどれかを選んでください');
          const row = [id, String(op.distId), String(d.r[dc['区域ID']]), String(op.houseId || ''), String(op.blockId || ''),
            result, at, user.id, user.name, now, false, '', String(op.roomId || '')];
          newV.push(row);
          vIndex[id] = { r: row, row: 0 };
          return { id: id, ok: true };
        }

        if (op.type === 'void') {
          if (vIndex[id]) return { id: id, ok: true, dup: true };
          const t = vIndex[String(op.target)];
          if (!t) throw err_('NO_TARGET', '取り消す記録が見つかりません');
          const tr = t.r;
          if (String(tr[vc['結果']]) === '取り消し') throw err_('BAD_TARGET', '取り消しの記録は取り消せません');
          const own = String(tr[vc['利用者ID']]) === user.id;
          const recent = now.getTime() - toDate_(tr[vc['訪問日時']]).getTime() <= undoMs;
          if (!(own && recent)) {
            const d = dists[String(tr[vc['配布ID']])];
            if (!isAdmin_(user) || !d || !canHandleDist_(user, users, d.r, dc)) throw err_('CANNOT_UNDO', '取り消せる時間を過ぎています。責任者に伝えてください');
          }
          if (!truthy_(tr[vc['無効']])) {
            tr[vc['無効']] = true;
            if (t.row) voidRows.push(t.row);
          }
          const row = [id, tr[vc['配布ID']], tr[vc['区域ID']], tr[vc['家ID']], tr[vc['ブロックID']], '取り消し',
            at, user.id, user.name, now, false, String(op.target), tr[vc['部屋ID']]];
          newV.push(row);
          vIndex[id] = { r: row, row: 0 };
          return { id: id, ok: true };
        }

        if (op.type === 'report') {
          if (rIds[id]) return { id: id, ok: true, dup: true };
          const note = String(op.note || '').trim().slice(0, 200);
          if (!note) throw err_('EMPTY', '内容が空です');
          const lat = Number(op.lat), lon = Number(op.lon);
          const hasLL = isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && op.lat !== undefined && op.lat !== '' && op.lat !== null;
          newR.push([id, String(op.houseId || ''), String(op.territoryId || ''), note, user.id, user.name, at, '未確認', String(op.roomId || ''),
            hasLL ? lat : '', hasLL ? lon : '']);
          rIds[id] = true;
          return { id: id, ok: true };
        }

        if (op.type === 'return') {
          const d = checkDist(op.distId);
          if (!d.r[dc['返却日']]) {
            d.r[dc['返却日']] = at;
            d.r[dc['終わり方']] = '返却';
            d.r[dc['返した人']] = user.id;
            if (touched.indexOf(d) < 0) touched.push(d);
          }
          return { id: id, ok: true };
        }

        if (op.type === 'reopen') {
          const d = dists[String(op.distId)];
          if (!d) throw err_('NO_DIST', 'この区域の配布が見つかりません');
          const res = reopenRow_(user, D, d, now, st);
          if (res.reopened && touched.indexOf(d) < 0) touched.push(d);
          return Object.assign({ id: id, ok: true }, res);
        }

        throw err_('BAD_TYPE', '知らない種類の記録です');
      } catch (e) {
        return { id: id, ok: false, error: e.code || 'SERVER', message: e.message, retry: !e.code };
      }
    });

    appendRows_(V, newV);
    voidRows.forEach(row => V.sh.getRange(row, vc['無効'] + 1).setValue(true));
    appendRows_(R, newR);
    touched.forEach(d => writeDist_(D, d, ['返却日', '終わり方', '返した人', '完全回収日', 'メモ']));

    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== 管理者向け：読む ============================== */

function apiAdmin_(user) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが使えます');
  const st = settings_();
  const top = isTop_(user);
  const groups = readGroups_();
  const users = readUsers_();
  const D = readTable_('配布');
  const dc = D.col;
  const now = new Date();
  autoCollect_(D, now, false);

  const active = [];
  const lastReturned = {};
  const lastNormal = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    const tid = String(r[dc['区域ID']]);
    const kind = String(r[dc['種別']] || KIND_NORMAL);
    if (r[dc['返却日']]) {
      if (kind === KIND_HOLD || kind === KIND_ABSENT) return;
      const d = fmtDate_(r[dc['返却日']]);
      if (!lastReturned[tid] || lastReturned[tid] < d) lastReturned[tid] = d;
      if (kind === KIND_NORMAL) {
        const t = toDate_(r[dc['返却日']]).getTime();
        if (!lastNormal[tid] || lastNormal[tid].t < t) lastNormal[tid] = { t: t, distId: String(r[dc['配布ID']]), returnedAt: d };
      }
    } else {
      active.push(distObj_(r, dc));
    }
  });

  const visible = d => top || (d.userId ? (d.userId === user.id || canManage_(user, users[d.userId])) : d.groupId === user.groupId);
  const dists = active.map(d => visible(d) ? d : {
    distId: '', territoryId: d.territoryId, no: d.no, kind: d.kind, userId: '', name: 'ほかのグループ', groupId: '',
    distributedAt: d.distributedAt, due: d.due, forced: d.forced, other: true,
  });

  const counts = {};
  active.forEach(d => { if (d.userId && d.kind === KIND_NORMAL) counts[d.userId] = (counts[d.userId] || 0) + 1; });
  const list = Object.keys(users).map(id => users[id])
    .filter(u => top || u.groupId === user.groupId)
    .map(u => ({
      id: u.id, name: u.name, kana: u.kana, groupId: u.groupId, role: u.role, active: u.active,
      cards: counts[u.id] || 0, usual: u.usual, key: top ? u.key : '', memo: top ? u.memo : '',
      mode: u.mode, near: top ? u.near : '',
    }));

  // 部屋ごとに配った分は、部屋番号を付けて返す
  if (dists.some(d => d.rooms && d.rooms.length)) {
    const no = {};
    const RR = readRooms_(true);
    Object.keys(RR).forEach(bid => RR[bid].forEach(x => { no[x.id] = x.no; }));
    dists.forEach(d => { if (d.rooms && d.rooms.length) d.roomNos = d.rooms.map(x => no[x] || x); });
  }

  const out = {
    ok: true,
    version: APP_VERSION,
    me: publicUser_(user, groups),
    top: top,
    users: list,
    groups: Object.keys(groups).map(id => groups[id]).sort((a, b) => a.order - b.order),
    dists: dists,
    lastReturned: lastReturned,
    buildings: (() => { const BB = readBuildings_(); return Object.keys(BB).map(id => BB[id]); })(),
    appUrl: String(st['アプリのURL'] || ''),
    settings: {
      maxCards: Number(st['1人が持てる枚数']) || 10,
      warnCards: Number(st['注意を出す枚数']) || 7,
      usualDefault: Number(st['いつもの枚数（決めていない人）']) || 4,
      due: String(st['回収日'] || st['返却期限'] || '月末'),
      forcedDays: numSetting_(st, '完全回収までの日数', 14),
      gatherForcedDays: numSetting_(st, '集まりの完全回収までの日数', 2),
      noticeDays: numSetting_(st, '回収日の知らせ', 7),
      today: fmtDate_(now),
      scope: scopeOf_(st),
      undoDays: numSetting_(st, '返却を取り消せる日数', 7),
      undoHours: Number(st['取り消しできる時間']) || 24,
      absentDays: Number(st['不在宅訪問の候補の日数']) || 62,
      basemap: basemapOf_(st),
    },
    routes: readRoutes_().list.map(publicRoute_),
    plan: Object.assign(planOf_(st), { groups: readPlanGroups_() }),
    notice: noticeOf_(st, now),
  };

  if (top) {
    // 不在宅訪問の候補：返却から決まった日数以内で、今は配っていない区域。前回の記録から「回らない家」を返す
    const days = Number(st['不在宅訪問の候補の日数']) || 62;
    const out_ = {};
    active.forEach(d => { out_[d.territoryId] = true; });
    const cands = {};
    Object.keys(lastNormal).forEach(tid => {
      const x = lastNormal[tid];
      if (out_[tid] || now.getTime() - x.t > days * 864e5) return;
      cands[x.distId] = { territoryId: tid, distId: x.distId, returnedAt: x.returnedAt, done: [], doneBlocks: [], refused: [], absent: [] };
    });
    const V = readTable_('訪問記録');
    const vc = V.col;
    const latest = {};
    V.rows.forEach(r => {
      if (!r[vc['記録ID']] || truthy_(r[vc['無効']])) return;
      const res = String(r[vc['結果']]);
      if (res === '取り消し') return;
      const c = cands[String(r[vc['配布ID']])];
      if (!c) return;
      const at = toDate_(r[vc['訪問日時']]).getTime();
      if (r[vc['家ID']]) {
        const k = c.distId + '|' + r[vc['家ID']];
        if (!latest[k] || latest[k].at <= at) latest[k] = { at: at, res: res, c: c, h: String(r[vc['家ID']]) };
      } else if (r[vc['ブロックID']] && res === '済') c.doneBlocks.push(String(r[vc['ブロックID']]));
    });
    Object.keys(latest).forEach(k => {
      const x = latest[k];
      if (x.res === '会えた' || x.res === '済') x.c.done.push(x.h);
      else if (x.res === '拒否') x.c.refused.push(x.h);
      else if (x.res === '不在') x.c.absent.push(x.h);
    });
    out.absentCands = Object.keys(cands).map(k => cands[k]);
    out.houseStates = readHouseStates_();
    out.gatherings = readTable_('集まり').rows
      .filter(r => r[0] && !r[5] && !truthy_(r[6]))
      .map(r => ({ id: String(r[0]), date: fmtDate_(r[1]), kind: normKind_(r[2]), name: String(r[3] || ''), by: String(r[4] || '') }));
    // 返ってきた区域（30日のうち）：間違えて返した・回収したときに「元に戻す」
    const since = now.getTime() - 30 * 864e5;
    const nameOf = id => (id === '自動' ? '自動' : users[id] ? users[id].name : '');
    out.returnedRecent = D.rows.filter(r => r[dc['配布ID']] && !truthy_(r[dc['無効']]) && r[dc['返却日']] &&
      String(r[dc['終わり方']]) !== '配った' && toDate_(r[dc['返却日']]).getTime() >= since)
      .map(r => {
        const o = distObj_(r, dc);
        const clash = takenBy_(D, r);
        o.by = String(r[dc['返した人']] || '');
        o.byName = nameOf(o.by);
        o.takenBy = clash ? String(clash[dc['名前']]) : '';
        return o;
      })
      .sort((a, b) => (a.returnedAt < b.returnedAt ? 1 : a.returnedAt > b.returnedAt ? -1 : 0)).slice(0, 300);
    const R = readTable_('報告');
    const rc = R.col;
    out.reports = R.rows.filter(r => r[0] && String(r[rc['対応']] || '未確認') === '未確認').map(r => ({
      id: String(r[rc['報告ID']]), houseId: String(r[rc['家ID']] || ''), roomId: String(r[rc['部屋ID']] || ''),
      territoryId: String(r[rc['区域ID']] || ''), note: String(r[rc['内容']]), by: String(r[rc['名前']] || ''), at: fmtDate_(r[rc['日時']]),
      lat: r[rc['緯度']] === '' || r[rc['緯度']] === null ? null : Number(r[rc['緯度']]),
      lon: r[rc['経度']] === '' || r[rc['経度']] === null ? null : Number(r[rc['経度']]),
    }));
    out.houseEdits = readHouseEdits_(true);
    out.boundaryEdits = readBoundaryEdits_(true);
    // 集合住宅の巡回（今の巡回の進み具合と、前の巡回が終わった日）
    const BB = readBuildings_();
    const RR0 = readRooms_();
    const REF0 = roomRefusals_();
    const cyc = buildingCycles_(D, BB, RR0, REF0);
    out.cycles = {};
    Object.keys(cyc).forEach(id => { out.cycles[id] = cycleSummary_(cyc[id]); });
    // 集合住宅の一巡（0.11.0）：この一巡のあいだに回った部屋の数と、全部回った日
    const pl = out.plan;
    const aFrom = cycleFrom_(pl.start, pl.aptMonths, now);
    out.plan.apt = aFrom ? aptProgress_(D, BB, RR0, REF0, aFrom) : {};
    out.plan.aptFrom = aFrom;
    // お知らせ（期限を過ぎたものも、書き直せるように）・毎晩のバックアップの様子
    out.noticeRaw = { text: String(st['お知らせ'] || ''), until: fmtDate_(st['お知らせの期限']), at: fmtDate_(st['お知らせを出した日']) };
    out.backup = backupInfo_(st);
  }
  return out;
}

/** 建物1つと部屋の一覧 */
function apiBuilding_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが使えます');
  const b = readBuildings_(true)[String(req.id || '')];
  if (!b) throw err_('NO_BUILDING', '建物が見つかりません');
  return { ok: true, building: b, rooms: readRooms_(true)[b.id] || [] };
}

/* ============================== 管理者向け：配る・回収 ============================== */

/**
 * まとめて配る。items: [{targetId, no, kind, userId | groupId, fromDistId}]
 *   - 上位管理者：だれにでも、どの種別でも配れる（グループの手持ちに預けるのも）
 *   - 責任者・副責任者：自分のグループの手持ちから、自分のグループの人にだけ配れる（fromDistId）
 *   - gathering: {kind, name} を付けると「集まり」を作り、その日の割り振りとしてまとめる
 *   - dates: {due, forced}（'yyyy-MM-dd'）で回収日・完全回収日を決められる（上位管理者だけ。なければ設定の既定）
 *   - past: {from, returned}（'yyyy-MM-dd'。0.11.0・上位管理者だけ）：台帳から入れるとき。配った日を前の日にする。
 *       returned もあれば、返ってきた配布として入れる（持てる枚数には数えない）。ほかの人が持っていた期間と重なる日は断る
 */
function apiDistribute_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが配れます');
  const items = Array.isArray(req.items) ? req.items : [req];
  if (!items.length) return { ok: true, results: [] };
  if (items.length > 600) throw err_('TOO_MANY', '一度に配れるのは600枚までです');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const st = settings_();
    const users = readUsers_();
    const groups = readGroups_();
    const D = readTable_('配布');
    const dc = D.col;
    const now = new Date();
    const max = Number(st['1人が持てる枚数']) || 10;
    autoCollect_(D, now, true);
    const given = isTop_(user) && req.dates ? checkDates_(req.dates, now) : null;
    let past = null;
    if (req.past) {
      needTop_(user);
      if (req.gathering) throw err_('BAD_PAST', '集まりは、前の日付では作れません');
      past = checkPast_(req.past, now);
    }

    // 今配っているもの：区域・建物ごとに「まるごと」か「部屋ごと」
    const outBy = {};
    const outOf = tid => outBy[tid] || (outBy[tid] = { whole: null, rooms: {} });
    const markOut = r => {
      const rs = roomsOf_(r, dc);
      if (rs.length) rs.forEach(x => { outOf(String(r[dc['区域ID']])).rooms[x] = r; });
      else outOf(String(r[dc['区域ID']])).whole = r;
    };
    const normalCount = {};
    const rowsById = {};
    D.rows.forEach((r, i) => {
      if (!r[dc['配布ID']]) return;
      rowsById[String(r[dc['配布ID']])] = { r: r, row: i + 2 };
      if (truthy_(r[dc['無効']]) || r[dc['返却日']]) return;
      markOut(r);
      if (String(r[dc['種別']]) === KIND_NORMAL) normalCount[String(r[dc['利用者ID']])] = (normalCount[String(r[dc['利用者ID']])] || 0) + 1;
    });
    const scope = scopeOf_(st);
    let B = null, R = null;
    const bldgs = () => B || (B = readBuildings_());
    const roomsAll = () => R || (R = readRooms_());
    const who = r => r[dc['名前']] + (r[dc['利用者ID']] ? 'さん' : '');

    const RT = readRoutes_();
    let gatheringId = '';
    if (req.gathering) {
      needTop_(user);
      const kind = String(req.gathering.kind || '') === KIND_ABSENT ? KIND_ABSENT : RT.resolve(req.gathering.kind);
      if (!kind || (kind !== KIND_ABSENT && !RT.byId[kind].active)) throw err_('BAD_KIND', '集まりの種類が正しくありません');
      gatheringId = String(req.gathering.id || '') || ('G' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-' + shortId_());
      const Gs = readTable_('集まり');
      if (!Gs.rows.some(r => String(r[0]) === gatheringId)) {
        appendRows_(Gs, [[gatheringId, now, kind, String(req.gathering.name || RT.name(kind)), user.name, '', false]]);
      }
    }

    const newRows = [];
    const holdUpdates = [];
    const results = items.map((it, i) => {
      try {
        const tid = String(it.targetId || it.territoryId || '').trim();
        const no = String(it.no || '').trim();
        if (!tid && !it.fromDistId) throw err_('BAD_TERRITORY', '区域を選んでください');
        let kind = FIXED_KINDS.indexOf(String(it.kind)) >= 0 ? String(it.kind) : (RT.resolve(it.kind) || KIND_NORMAL);
        if (isRouteKind_(kind) && !RT.byId[kind].active) throw err_('BAD_KIND', '「' + RT.name(kind) + '」は今は使っていない回り方です');
        let target = null;
        let group = null;
        let hold = null;
        const wantRooms = Array.isArray(it.rooms) ? Array.from(new Set(it.rooms.map(String).filter(Boolean))) : [];
        let roomNos = [];
        if (wantRooms.length > 60) throw err_('TOO_MANY', '一度に選べる部屋は60までです');

        if (it.fromDistId) {
          if (past) throw err_('BAD_PAST', '手持ちから配るときは、前の日付にできません');
          hold = rowsById[String(it.fromDistId)];
          if (!hold || truthy_(hold.r[dc['無効']]) || hold.r[dc['返却日']] || String(hold.r[dc['種別']]) !== KIND_HOLD) throw err_('NO_HOLD', 'この手持ちはもうありません');
          const gid = String(hold.r[dc['グループID']]);
          if (!isTop_(user) && gid !== user.groupId) throw err_('NOT_YOUR_GROUP', '自分のグループの手持ちだけ配れます');
          target = users[String(it.userId || '')];
          if (!target || !target.active) throw err_('NO_USER', '配る相手が見つかりません');
          if (!isTop_(user) && target.groupId !== gid) throw err_('NOT_YOUR_GROUP', 'グループの人にだけ配れます');
          kind = KIND_NORMAL;
        } else {
          needTop_(user);
          const isB = !!bldgs()[tid];
          if (scope === '集合住宅だけ' && !isB) throw err_('SCOPE', '今は「集合住宅だけ」で使う設定です。戸建ての区域は配れません');
          const o = outBy[tid];
          if (wantRooms.length) {
            if (!isB) throw err_('NOT_BUILDING', '部屋を選べるのは集合住宅だけです');
            if (kind === KIND_HOLD) throw err_('BAD_KIND', '部屋ごとには預けられません');
            const valid = {};
            (roomsAll()[tid] || []).forEach(x => { valid[x.id] = x; });
            wantRooms.forEach(x => { if (!valid[x]) throw err_('NO_ROOM', '部屋が見つかりません（' + x + '）'); });
            if (o && o.whole && !(past && past.returned)) throw err_('ALREADY_OUT', (no || tid) + ' は今、建物ごと' + who(o.whole) + 'が持っています');
            const clash = past && past.returned ? [] : wantRooms.filter(x => o && o.rooms[x]);
            if (clash.length) throw err_('ROOM_OUT', (no || tid) + ' の ' + clash.map(x => valid[x].no).join('・') + ' は今、' + who(o.rooms[clash[0]]) + 'が持っています');
            roomNos = wantRooms.map(x => valid[x].no);
          } else if (o && (o.whole || Object.keys(o.rooms).length) && !(past && past.returned)) {
            throw err_('ALREADY_OUT', (no || tid) + ' は今、' + (o.whole ? who(o.whole) + 'が持っています' : '一部の部屋を' + Array.from(new Set(Object.keys(o.rooms).map(x => who(o.rooms[x])))).join('・') + 'が持っています'));
          }
          if (kind === KIND_HOLD) {
            group = groups[String(it.groupId || '')];
            if (!group) throw err_('NO_GROUP', '預けるグループが見つかりません');
          } else {
            target = users[String(it.userId || '')];
            if (!target || !target.active) throw err_('NO_USER', '配る相手が見つかりません');
          }
          // 同じ建物に入るのは1人だけ（0.7.0）：ほかの人が部屋を持っている建物の部屋は、配らない。
          //   実際に行く日はアプリには分からないので「同時に持てるのは1人」にする（集まりの分はその日のうちに返る）
          if (isB && wantRooms.length && o && target && !(past && past.returned)) {
            const other = Object.keys(o.rooms).map(x => o.rooms[x]).find(r => String(r[dc['利用者ID']] || '') !== target.id);
            if (other) throw err_('BUILDING_TAKEN', (no || tid) + ' は今、' + who(other) + 'が部屋を持っています（同じ建物の部屋を同時に持てるのは1人だけ）');
          }
        }
        if (past && kind === KIND_HOLD) throw err_('BAD_PAST', 'グループに預けるときは、前の日付にできません');
        if (past) {
          // 台帳から：ほかの配布と期間が重ならないか（部屋ごとなら、同じ部屋だけ）
          const cl = overlapRow_(D, tid, wantRooms, past.from, past.returned, '');
          if (cl) throw err_('OVERLAP', (no || tid) + ' は、その日に' + who(cl) + 'が持っていました（' + fmtDate_(cl[dc['配布日']]) + '〜' + (cl[dc['返却日']] ? fmtDate_(cl[dc['返却日']]) : '配布中') + '）');
          if (overlapRow_({ col: dc, rows: newRows }, tid, wantRooms, past.from, past.returned, '')) throw err_('OVERLAP', (no || tid) + ' を同じ期間に2回入れています');
        }
        if (kind === KIND_NORMAL && target && !(past && past.returned)) {
          const n = normalCount[target.id] || 0;
          if (n >= max) throw err_('TOO_MANY_CARDS', target.name + 'さんはもう' + max + '枚持っています');
          normalCount[target.id] = n + 1;
        }
        const gatherDay = gatheringId && (kind === KIND_ABSENT || isRouteKind_(kind));
        const closed = !!(past && past.returned);
        const dates = closed ? { due: '', forced: '' } : planDates_(st, now, kind, gatherDay, given);
        const id = 'D' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-' + shortId_();
        const row = [id, hold ? String(hold.r[dc['区域ID']]) : tid, hold ? String(hold.r[dc['区域番号']]) : no, kind,
          target ? target.id : '', target ? target.name : group.name, past ? past.fromAt : now, dates.due, closed ? past.returnedAt : '', user.name, false,
          past ? '台帳から入れた（' + Utilities.formatDate(now, TZ, 'MM/dd') + ' ' + user.name + '）' : '',
          group ? group.id : (target ? target.groupId : ''), hold ? String(hold.r[dc['配布ID']]) : '', gatherDay ? gatheringId : '', closed ? '返却' : '', dates.forced,
          wantRooms.join(','), closed ? user.id : ''];
        newRows.push(row);
        if (!closed) markOut(row);
        if (hold) {
          hold.r[dc['返却日']] = now;
          holdUpdates.push(hold);
        }
        return { i: i, ok: true, dist: Object.assign(distObj_(row, dc), { roomNos: roomNos }) };
      } catch (e) {
        return { i: i, ok: false, error: e.code || 'SERVER', message: e.message };
      }
    });

    appendRows_(D, newRows);
    holdUpdates.forEach(h => {
      D.sh.getRange(h.row, dc['返却日'] + 1).setValue(now);
      D.sh.getRange(h.row, dc['終わり方'] + 1).setValue('配った');
      D.sh.getRange(h.row, dc['返した人'] + 1).setValue(user.id);
    });
    const okN = results.filter(x => x.ok).length;
    if (okN) log_(user, '配布', okN + '枚' + (gatheringId ? '（集まり ' + gatheringId + '）' : '') + (past ? '（台帳から：' + past.from + '〜' + (past.returned || '配布中') + '）' : ''));
    return { ok: true, results: results, gatheringId: gatheringId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 回収（返却にする）。何枚でもまとめて。
 *   at（'yyyy-MM-dd'。0.11.0）：返した日を前の日にする（紙で回って、あとから返ってきたとき）。配った日より前・今日よりあとにはできない
 */
function apiReturnCards_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけができます');
  const ids = (req.distIds || []).map(String);
  const at = req.at ? checkDay_(req.at, new Date(), '返した日') : null;
  return withDists_(user, ids, (d, dc, sh, now) => {
    if (d.r[dc['返却日']]) return { already: true };
    let when = now;
    if (at && at !== fmtDate_(now)) {
      if (at < fmtDate_(d.r[dc['配布日']])) return { ok: false, error: 'BAD_DATE', message: d.r[dc['区域番号']] + '：返した日が、配った日（' + fmtDate_(d.r[dc['配布日']]) + '）より前です' };
      when = dayAt_(at);
    }
    d.r[dc['返却日']] = when;
    sh.getRange(d.row, dc['返却日'] + 1).setValue(when);
    sh.getRange(d.row, dc['終わり方'] + 1).setValue(String(d.r[dc['種別']]) === KIND_HOLD ? '戻した' : '返却');
    sh.getRange(d.row, dc['返した人'] + 1).setValue(user.id);
    return {};
  });
}

/** 配布の間違いを取り消す（行は消さず「無効」に印を付ける。手持ちから配った分なら、手持ちに戻す） */
function apiCancelDist_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけができます');
  return withDists_(user, [String(req.distId)], (d, dc, sh, now, byId) => {
    sh.getRange(d.row, dc['無効'] + 1).setValue(true);
    const from = byId[String(d.r[dc['元の配布ID']] || '')];
    if (from) {
      sh.getRange(from.row, dc['返却日'] + 1).setValue('');
      sh.getRange(from.row, dc['終わり方'] + 1).setValue('');
      sh.getRange(from.row, dc['返した人'] + 1).setValue('');
    }
    return { reopened: !!from };
  });
}

/* ---------- 返却を取り消す（元に戻す） ---------- */

/** 同じ区域・建物を今だれかが持っていれば、その行（部屋ごとに配った分は、部屋が重なるときだけ） */
function takenBy_(D, r) {
  const dc = D.col;
  const tid = String(r[dc['区域ID']]);
  const mine = roomsOf_(r, dc);
  return D.rows.find(x => x !== r && x[dc['配布ID']] && String(x[dc['配布ID']]) !== String(r[dc['配布ID']]) &&
    !truthy_(x[dc['無効']]) && !x[dc['返却日']] && String(x[dc['区域ID']]) === tid &&
    (() => { const o = roomsOf_(x, dc); return !mine.length || !o.length || mine.some(v => o.indexOf(v) >= 0); })()) || null;
}

/**
 * 返した（回収した）区域を、もう一度持っている状態に戻す。d = {r, row}。表の中身（d.r）だけを変え、書くのは呼んだ側
 *   返した本人：自分で「返却」したものを、決まった日数（設定「返却を取り消せる日数」）のうち
 *   上位管理者：だれのものでも、自動回収・回収したものも、いつでも
 *   どちらも、その区域（部屋）をもうほかの人に配っていたら戻せない
 */
function reopenRow_(user, D, d, now, st) {
  const dc = D.col;
  const r = d.r;
  if (truthy_(r[dc['無効']])) throw err_('NO_DIST', 'この配布は取り消されています');
  if (!r[dc['返却日']]) return { already: true };
  const how = String(r[dc['終わり方']] || '');
  if (how === '配った') throw err_('HANDED', 'この手持ちは、もうメンバーに配っています');
  if (!isTop_(user)) {
    if (String(r[dc['利用者ID']]) !== user.id) throw err_('NOT_YOURS', '自分の区域ではありません');
    const by = String(r[dc['返した人']] || '');
    if (how !== '返却' || (by && by !== user.id)) throw err_('NOT_BY_YOU', '自分で返したものではないため、戻せません。上位管理者に伝えてください');
    const days = numSetting_(st, '返却を取り消せる日数', 7);
    if (now.getTime() - toDate_(r[dc['返却日']]).getTime() > days * 864e5) throw err_('TOO_LATE', '返してから' + days + '日を過ぎたため、自分では戻せません。上位管理者に伝えてください');
  }
  const clash = takenBy_(D, r);
  if (clash) throw err_('TAKEN', String(r[dc['区域番号']]) + ' は今、' + clash[dc['名前']] + (clash[dc['利用者ID']] ? 'さん' : '') + 'が持っているため、戻せません');
  r[dc['返却日']] = '';
  r[dc['終わり方']] = '';
  r[dc['返した人']] = '';
  let forced = '';
  if (String(r[dc['種別']]) !== KIND_HOLD && (r[dc['完全回収日']] === '' || r[dc['完全回収日']] === null || fmtDate_(r[dc['完全回収日']]) < fmtDate_(now))) {
    // 完全回収日を過ぎていたら（自動回収を戻したとき）、今日から数え直す
    const g = !!r[dc['集まりID']];
    r[dc['完全回収日']] = addDays_(endOfDay_(now), numSetting_(st, g ? '集まりの完全回収までの日数' : '完全回収までの日数', g ? 2 : 14));
    forced = fmtDate_(r[dc['完全回収日']]);
  }
  const note = '返却を取り消し（' + Utilities.formatDate(now, TZ, 'MM/dd') + ' ' + user.name + '）';
  r[dc['メモ']] = r[dc['メモ']] ? String(r[dc['メモ']]) + ' / ' + note : note;
  log_(user, '配布 ' + r[dc['配布ID']], '返却を取り消した：' + r[dc['区域番号']] + '（' + r[dc['名前']] + '）' + (how && how !== '返却' ? '・' + how + 'だったもの' : ''));
  return { reopened: true, forced: forced, dist: distObj_(r, dc) };
}

function writeDist_(D, d, cols) {
  cols.forEach(c => D.sh.getRange(d.row, D.col[c] + 1).setValue(d.r[D.col[c]]));
}

/** 上位管理者：返した・回収した区域をまとめて元に戻す。distIds: [...] */
function apiReopenDists_(user, req) {
  needTop_(user);
  const ids = (req.distIds || []).map(String);
  if (!ids.length) throw err_('NO_DIST', '区域を選んでください');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const st = settings_();
    const D = readTable_('配布');
    const dc = D.col;
    const byId = {};
    D.rows.forEach((r, i) => { if (r[dc['配布ID']]) byId[String(r[dc['配布ID']])] = { r: r, row: i + 2 }; });
    const now = new Date();
    const results = ids.map(id => {
      const d = byId[id];
      try {
        if (!d) throw err_('NO_DIST', 'この配布が見つかりません');
        const res = reopenRow_(user, D, d, now, st);
        if (res.reopened) writeDist_(D, d, ['返却日', '終わり方', '返した人', '完全回収日', 'メモ']);
        return Object.assign({ distId: id, ok: true }, res);
      } catch (e) {
        return { distId: id, ok: false, error: e.code || 'SERVER', message: e.message };
      }
    });
    if (ids.length === 1 && !results[0].ok) throw err_(results[0].error, results[0].message);
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

/** 集まりを終える：その集まりで割り振った区域を、まとめて返却にする */
function apiCloseGathering_(user, req) {
  needTop_(user);
  const gid = String(req.gatheringId || '');
  const D = readTable_('配布');
  const dc = D.col;
  const ids = D.rows.filter(r => String(r[dc['集まりID']]) === gid && !r[dc['返却日']] && !truthy_(r[dc['無効']])).map(r => String(r[dc['配布ID']]));
  const res = ids.length ? apiReturnCards_(user, { distIds: ids }) : { ok: true, results: [] };
  const Gs = readTable_('集まり');
  Gs.rows.forEach((r, i) => { if (String(r[0]) === gid) Gs.sh.getRange(i + 2, 6).setValue(new Date()); });
  return Object.assign(res, { closed: gid, returned: ids.length });
}

/**
 * 回収日・完全回収日を変える（上位管理者）。distIds: [...], due / forced: 'yyyy-MM-dd'
 * 片方だけでもよい。回収日だけ変えたときは、完全回収日を「回収日＋設定の日数」にそろえる（keepForced で今のまま）
 */
function apiSetDates_(user, req) {
  needTop_(user);
  const st = settings_();
  const now = new Date();
  const given = checkDates_({ due: req.due, forced: req.forced }, now);
  const ids = (req.distIds || []).map(String);
  if (!ids.length) throw err_('NO_DIST', '区域を選んでください');
  const res = withDists_(user, ids, (d, dc, sh) => {
    if (d.r[dc['返却日']]) return { ok: false, error: 'RETURNED', message: 'もう返却されています' };
    if (String(d.r[dc['種別']]) === KIND_HOLD) return { ok: false, error: 'HOLD', message: 'グループの手持ちには回収日を付けません' };
    const gather = !!d.r[dc['集まりID']];
    const due = given.due || toDate_(d.r[dc['回収日']]);
    let forced = given.forced;
    if (!forced) forced = req.keepForced && isDate_(d.r[dc['完全回収日']]) ? d.r[dc['完全回収日']] :
      addDays_(due, numSetting_(st, gather ? '集まりの完全回収までの日数' : '完全回収までの日数', gather ? 2 : 14));
    if (fmtDate_(forced) < fmtDate_(due)) return { ok: false, error: 'BAD_DATE', message: '完全回収日は、回収日と同じ日か、あとの日にしてください' };
    sh.getRange(d.row, dc['回収日'] + 1).setValue(due);
    sh.getRange(d.row, dc['完全回収日'] + 1).setValue(forced);
    return { due: fmtDate_(due), forced: fmtDate_(forced) };
  });
  const okN = res.results.filter(x => x.ok).length;
  if (okN) log_(user, '回収日', okN + '枚：' + (given.due ? '回収日 ' + fmtDate_(given.due) : '') + (given.forced ? '　完全回収日 ' + fmtDate_(given.forced) : ''));
  return res;
}

/** 'yyyy-MM-dd' を確かめる（今日よりあとは不可）。返り値は同じ文字 */
function checkDay_(v, now, label) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(parseYmd_(s).getTime()) || fmtDate_(parseYmd_(s)) !== s) throw err_('BAD_DATE', (label || '日付') + 'の書き方が正しくありません');
  if (s > fmtDate_(now)) throw err_('BAD_DATE', (label || '日付') + 'が今日よりあとです');
  if (s < '2000-01-01') throw err_('BAD_DATE', (label || '日付') + 'が古すぎます');
  return s;
}
/** その日の昼（日付だけ決めたときの時刻。どの時差でも同じ日付になるように） */
function dayAt_(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); }
/** 台帳から入れるときの日付：{from, returned}。returned は空でもよい（まだ配布中） */
function checkPast_(x, now) {
  const from = checkDay_(x.from, now, '配った日');
  const returned = x.returned ? checkDay_(x.returned, now, '返した日') : '';
  if (returned && returned < from) throw err_('BAD_DATE', '返した日が、配った日より前です');
  const today = fmtDate_(now);
  return { from: from, returned: returned, fromAt: from === today ? now : dayAt_(from), returnedAt: returned ? (returned === today ? now : dayAt_(returned)) : '' };
}
/**
 * 同じ区域・建物で、期間 [from, to]（to が空なら今も）と重なる配布の行（なければ null）。
 *   手持ち・取り消した行・except（配布ID）はのぞく。部屋ごとに配った分は、部屋が重なるときだけ。
 *   返した日と次に配った日が同じ日なのはよい（その日のうちに次の人へ）
 */
function overlapRow_(D, tid, rooms, from, to, except) {
  const dc = D.col;
  const end = to || '9999-12-31';
  return D.rows.find(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']]) || String(r[dc['区域ID']]) !== tid || String(r[dc['配布ID']]) === String(except || '')) return false;
    if (String(r[dc['種別']]) === KIND_HOLD) return false;
    const a = fmtDate_(r[dc['配布日']]);
    const b = r[dc['返却日']] ? fmtDate_(r[dc['返却日']]) : '9999-12-31';
    if (!((from < b && a < end) || a === from)) return false;
    const o = roomsOf_(r, dc);
    return !rooms.length || !o.length || rooms.some(v => o.indexOf(v) >= 0);
  }) || null;
}

function checkDates_(x, now) {
  const out = { due: null, forced: null };
  ['due', 'forced'].forEach(k => {
    const v = x && x[k];
    if (v === undefined || v === null || v === '') return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err_('BAD_DATE', '日付の書き方が正しくありません');
    out[k] = parseYmd_(String(v));
  });
  if (out.due && out.forced && fmtDate_(out.forced) < fmtDate_(out.due)) throw err_('BAD_DATE', '完全回収日は、回収日と同じ日か、あとの日にしてください');
  if (out.forced && fmtDate_(out.forced) < fmtDate_(now)) throw err_('BAD_DATE', '完全回収日が今日より前です。すぐ回収するときは「返却にする」を使ってください');
  return out;
}

/** 配るときの回収日・完全回収日。手持ちには付けない。集まりはその日が回収日 */
function planDates_(st, now, kind, gatherDay, given) {
  if (kind === KIND_HOLD) return { due: '', forced: '' };
  let due, days;
  if (gatherDay) { due = endOfDay_(now); days = numSetting_(st, '集まりの完全回収までの日数', 2); }
  else { due = dueDate_(now, st['回収日'] || st['返却期限']); days = numSetting_(st, '完全回収までの日数', 14); }
  let forced = addDays_(due, days);
  if (given && !gatherDay) {
    if (given.due) { due = given.due; forced = addDays_(due, days); }
    if (given.forced) forced = given.forced;
  }
  if (fmtDate_(forced) < fmtDate_(due)) forced = due;
  return { due: due, forced: forced };
}

/**
 * 完全回収日を過ぎた区域を、自動で回収する。
 *   返却日は、その配布の最後の記録の日（記録がなければ回収日）。終わり方は「自動回収」。
 *   D は読んだ「配布」の表。書いた分は D.rows にも反映する。haveLock なら、もう鍵を持っている
 */
function autoCollect_(D, now, haveLock) {
  const dc = D.col;
  const today = fmtDate_(now);
  const overdue = r => r[dc['配布ID']] && !truthy_(r[dc['無効']]) && !r[dc['返却日']] && String(r[dc['種別']]) !== KIND_HOLD &&
    r[dc['完全回収日']] !== '' && r[dc['完全回収日']] !== null && fmtDate_(r[dc['完全回収日']]) < today;
  if (!D.rows.some(overdue)) return 0;
  let lock = null;
  if (!haveLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return 0;
  }
  try {
    const T = haveLock ? D : readTable_('配布');
    const tc = T.col;
    const due = [];
    T.rows.forEach((r, i) => { if (overdue(r)) due.push({ r: r, row: i + 2 }); });
    if (!due.length) return 0;
    const want = {};
    due.forEach(x => { want[String(x.r[tc['配布ID']])] = null; });
    const V = readTable_('訪問記録');
    const vc = V.col;
    V.rows.forEach(r => {
      const id = String(r[vc['配布ID']]);
      if (!(id in want) || truthy_(r[vc['無効']]) || String(r[vc['結果']]) === '取り消し') return;
      const at = toDate_(r[vc['訪問日時']]);
      if (!want[id] || want[id] < at) want[id] = at;
    });
    const done = {};
    due.forEach(x => {
      const id = String(x.r[tc['配布ID']]);
      const forced = toDate_(x.r[tc['完全回収日']]);
      let at = want[id] || (isDate_(x.r[tc['回収日']]) ? x.r[tc['回収日']] : forced);
      if (at > forced) at = forced;
      x.r[tc['返却日']] = at;
      x.r[tc['終わり方']] = '自動回収';
      x.r[tc['返した人']] = '自動';
      T.sh.getRange(x.row, tc['返却日'] + 1).setValue(at);
      T.sh.getRange(x.row, tc['終わり方'] + 1).setValue('自動回収');
      T.sh.getRange(x.row, tc['返した人'] + 1).setValue('自動');
      done[id] = at;
    });
    if (T !== D) D.rows.forEach(r => { const id = String(r[dc['配布ID']]); if (done[id]) { r[dc['返却日']] = done[id]; r[dc['終わり方']] = '自動回収'; r[dc['返した人']] = '自動'; } });
    log_({ name: '自動' }, '完全回収', due.length + '枚：' + due.map(x => x.r[tc['区域番号']] + '（' + x.r[tc['名前']] + '）').join('、'));
    return due.length;
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** 毎日の自動実行（setup で登録する）。だれも画面を開かなくても、完全回収日を過ぎた区域を回収する */
function dailyCollect() {
  return autoCollect_(readTable_('配布'), new Date(), false);
}

function withDists_(user, ids, fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const users = readUsers_();
    const D = readTable_('配布');
    const dc = D.col;
    const byId = {};
    D.rows.forEach((r, i) => { if (r[dc['配布ID']]) byId[String(r[dc['配布ID']])] = { r: r, row: i + 2 }; });
    const now = new Date();
    const results = ids.map(id => {
      const d = byId[id];
      if (!d) return { distId: id, ok: false, error: 'NO_DIST', message: 'この配布が見つかりません' };
      if (truthy_(d.r[dc['無効']])) return { distId: id, ok: false, error: 'NO_DIST', message: 'この配布はもう取り消されています' };
      if (!canHandleDist_(user, users, d.r, dc)) return { distId: id, ok: false, error: 'NOT_YOUR_GROUP', message: '自分のグループの配布だけ扱えます' };
      return Object.assign({ distId: id, ok: true }, fn(d, dc, D.sh, now, byId) || {});
    });
    if (ids.length === 1 && !results[0].ok) throw err_(results[0].error, results[0].message);
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== 人とグループ ============================== */

function apiSavePerson_(user, p) {
  needTop_(user);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const U = readTable_('利用者');
    const c = U.col;
    const users = readUsers_();
    const groups = readGroups_();
    const name = String(p.name || '').trim();
    if (!name) throw err_('NO_NAME', '名前を入れてください');
    const role = ROLES.indexOf(String(p.role)) >= 0 ? String(p.role) : '一般';
    const groupId = String(p.groupId || '');
    if (groupId && !groups[groupId]) throw err_('NO_GROUP', 'グループが見つかりません');
    const active = p.active !== false;
    const usual = p.usual === '' || p.usual === null || p.usual === undefined ? '' : Math.max(0, Math.min(20, Number(p.usual) || 0));

    if (p.id) {
      const u = users[String(p.id)];
      if (!u) throw err_('NO_USER', 'この人が見つかりません');
      // 上位管理者が1人もいなくならないようにする
      if (u.role === '上位管理者' && (role !== '上位管理者' || !active)) {
        const others = Object.keys(users).filter(id => id !== u.id && users[id].role === '上位管理者' && users[id].active);
        if (!others.length) throw err_('LAST_TOP', '上位管理者が1人もいなくなるため、変えられません');
      }
      const changes = [];
      const set = (col, v, label) => {
        const old = U.rows[u.row - 2][c[col]];
        if (String(old) === String(v)) return;
        U.sh.getRange(u.row, c[col] + 1).setValue(v);
        changes.push(label + '：' + (old === '' ? '（空）' : old) + ' → ' + (v === '' ? '（空）' : v));
      };
      set('名前', name, '名前');
      set('ふりがな', String(p.kana || ''), 'ふりがな');
      set('グループID', groupId, 'グループ');
      set('役割', role, '役割');
      set('有効', active, '有効');
      set('いつもの枚数', usual, 'いつもの枚数');
      if (p.memo !== undefined) set('メモ', String(p.memo || ''), 'メモ');
      if (p.mode !== undefined) set('配り方', p.mode === '近く' ? '近く' : '', '配り方');
      if (p.near !== undefined) set('家の近く', String(p.near || ''), '家の近く');
      if (changes.length) log_(user, name + '（' + u.id + '）', changes.join('、'));
      return { ok: true, id: u.id, changed: changes.length };
    }
    let maxNo = 0;
    Object.keys(users).forEach(id => { const m = id.match(/^U(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
    const id = 'U' + ('00' + (maxNo + 1)).slice(-3);
    const key = newKey_();
    const row = new Array(U.head.length).fill('');
    row[c['利用者ID']] = id; row[c['名前']] = name; row[c['ふりがな']] = String(p.kana || '');
    row[c['グループID']] = groupId; row[c['役割']] = role; row[c['鍵']] = key; row[c['有効']] = active;
    row[c['作成日']] = new Date(); row[c['メモ']] = String(p.memo || ''); row[c['いつもの枚数']] = usual;
    row[c['配り方']] = p.mode === '近く' ? '近く' : ''; row[c['家の近く']] = String(p.near || '');
    const at = U.sh.getLastRow() + 1;
    U.sh.getRange(at, c['鍵'] + 1).setNumberFormat('@');
    U.sh.getRange(at, 1, 1, U.head.length).setValues([row]);
    log_(user, name + '（' + id + '）', '追加：' + role + (groupId ? '・' + groups[groupId].name : ''));
    return { ok: true, id: id, key: key };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 人をまとめて足す・変える（上位管理者。0.8.0）。people: [{id?, name, kana, groupId, role, usual, active, mode, near}]
 *   先に全部を確かめ、1つでもおかしければ何も変えない（どの行がおかしいかを返す）。
 *   変えたあとに上位管理者が1人もいなくなる変更はできない。シートへはまとめて書く（1人ずつより速い）
 */
function apiSavePeople_(user, req) {
  needTop_(user);
  const list = Array.isArray(req.people) ? req.people : [];
  if (!list.length) return { ok: true, results: [], added: 0, changed: 0 };
  if (list.length > 300) throw err_('TOO_MANY', '一度に変えられるのは300人までです');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const U = readTable_('利用者');
    const c = U.col;
    const users = readUsers_();
    const groups = readGroups_();
    const bad = [];
    const norm = list.map((p, i) => {
      const name = String(p.name || '').trim();
      const x = {
        i: i, id: String(p.id || ''), name: name, kana: String(p.kana || '').trim(),
        groupId: String(p.groupId || ''), role: String(p.role || '一般'), active: p.active !== false,
        usual: p.usual === '' || p.usual === null || p.usual === undefined ? '' : Math.max(0, Math.min(20, Number(p.usual) || 0)),
        mode: p.mode === '近く' ? '近く' : '', near: String(p.near || ''),
      };
      const why = [];
      if (!name) why.push('名前がありません');
      if (ROLES.indexOf(x.role) < 0) why.push('役割「' + x.role + '」はありません（一般・副責任者・責任者・上位管理者）');
      if (x.groupId && !groups[x.groupId]) why.push('グループが見つかりません');
      if (x.id && !users[x.id]) why.push('この人が見つかりません');
      if (why.length) bad.push({ i: i, name: name, message: why.join('、') });
      return x;
    });
    if (bad.length) return { ok: true, saved: false, message: bad.length + '行に直すところがあります', bad: bad };
    // 変えたあとに、使っている上位管理者が残るか
    const after = {};
    Object.keys(users).forEach(id => { after[id] = { role: users[id].role, active: users[id].active }; });
    norm.forEach(x => { if (x.id) after[x.id] = { role: x.role, active: x.active }; else after['new' + x.i] = { role: x.role, active: x.active }; });
    if (!Object.keys(after).some(id => after[id].role === '上位管理者' && after[id].active)) throw err_('LAST_TOP', '上位管理者が1人もいなくなるため、変えられません');

    const logs = [];
    const now = new Date();
    let changed = 0;
    const results = [];
    norm.filter(x => x.id).forEach(x => {
      const u = users[x.id];
      const row = U.rows[u.row - 2];
      const diff = [];
      const set = (col, v, label) => {
        const old = row[c[col]];
        if (String(old) === String(v)) return;
        row[c[col]] = v;
        diff.push(label + '：' + (old === '' ? '（空）' : old) + ' → ' + (v === '' ? '（空）' : v));
      };
      set('名前', x.name, '名前'); set('ふりがな', x.kana, 'ふりがな'); set('グループID', x.groupId, 'グループ'); set('役割', x.role, '役割');
      set('有効', x.active, '有効'); set('いつもの枚数', x.usual, 'いつもの枚数'); set('配り方', x.mode, '配り方'); set('家の近く', x.near, '家の近く');
      if (diff.length) { changed++; logs.push([now, user.name, x.name + '（' + x.id + '）', diff.join('、')]); }
      results.push({ i: x.i, id: x.id, changed: diff.length });
    });
    if (changed) U.sh.getRange(2, 1, U.rows.length, U.head.length).setValues(U.rows);
    // 足す人
    const adds = norm.filter(x => !x.id);
    if (adds.length) {
      let maxNo = 0;
      Object.keys(users).forEach(id => { const m = id.match(/^U(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
      const rows = adds.map(x => {
        const id = 'U' + ('00' + (++maxNo)).slice(-3);
        const key = newKey_();
        const row = new Array(U.head.length).fill('');
        row[c['利用者ID']] = id; row[c['名前']] = x.name; row[c['ふりがな']] = x.kana; row[c['グループID']] = x.groupId; row[c['役割']] = x.role;
        row[c['鍵']] = key; row[c['有効']] = x.active; row[c['作成日']] = now; row[c['いつもの枚数']] = x.usual; row[c['配り方']] = x.mode; row[c['家の近く']] = x.near;
        results.push({ i: x.i, id: id, key: key, added: true });
        logs.push([now, user.name, x.name + '（' + id + '）', '追加：' + x.role + (x.groupId ? '・' + groups[x.groupId].name : '')]);
        return row;
      });
      const at = U.sh.getLastRow() + 1;
      U.sh.getRange(at, c['鍵'] + 1, rows.length, 1).setNumberFormat('@');
      U.sh.getRange(at, 1, rows.length, U.head.length).setValues(rows);
    }
    if (logs.length) { try { appendRows_(readTable_('変更の記録'), logs); } catch (e) { /* 記録できなくても本体は止めない */ } }
    return { ok: true, saved: true, results: results.sort((a, b) => a.i - b.i), added: adds.length, changed: changed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * グループをまとめて足す・変える（上位管理者。0.8.0）。groups: [{id?, name, order, area, active}]
 *   メンバーがいるグループは、なくせない（先にほかのグループへ移す）
 */
function apiSaveGroups_(user, req) {
  needTop_(user);
  const list = Array.isArray(req.groups) ? req.groups : [];
  if (!list.length) return { ok: true, results: [] };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const G = readTable_('グループ');
    const c = G.col;
    const groups = readGroups_(true);
    const us = readUsers_();
    const bad = [];
    list.forEach((g, i) => {
      const why = [];
      if (!String(g.name || '').trim()) why.push('名前がありません');
      if (g.id && !groups[String(g.id)]) why.push('グループが見つかりません');
      if (g.id && g.active === false) {
        const n = Object.keys(us).filter(k => us[k].groupId === String(g.id) && us[k].active).length;
        if (n) why.push('メンバーが' + n + '人いるため、なくせません（先にほかのグループへ移してください）');
      }
      if (why.length) bad.push({ i: i, name: String(g.name || ''), message: why.join('、') });
    });
    if (bad.length) return { ok: true, saved: false, message: bad.length + '行に直すところがあります', bad: bad };
    const now = new Date();
    const logs = [];
    let changed = false;
    const results = [];
    let maxNo = 0;
    Object.keys(groups).forEach(id => { const m = id.match(/^G(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
    const adds = [];
    list.forEach((g, i) => {
      const name = String(g.name).trim();
      const active = g.active !== false;
      if (g.id) {
        const cur = groups[String(g.id)];
        const row = G.rows[cur.row - 2];
        const diff = [];
        const set = (col, v, label) => { if (String(row[c[col]]) === String(v)) return; diff.push(label + '：' + row[c[col]] + ' → ' + v); row[c[col]] = v; };
        set('名前', name, '名前');
        if (g.order !== undefined && g.order !== '') set('並び順', Number(g.order) || 0, '並び順');
        if (g.area !== undefined) set('主に回るエリア', String(g.area || ''), '主に回るエリア');
        set('有効', active, '有効');
        if (diff.length) { changed = true; logs.push([now, user.name, 'グループ ' + cur.id, diff.join('、')]); }
        results.push({ i: i, id: cur.id, changed: diff.length });
      } else {
        const id = 'G' + (++maxNo);
        adds.push([id, name, g.order !== undefined && g.order !== '' ? Number(g.order) || 0 : Object.keys(groups).length + adds.length + 1, String(g.area || ''), '', active]);
        logs.push([now, user.name, 'グループ ' + id, '追加：' + name]);
        results.push({ i: i, id: id, added: true });
      }
    });
    if (changed) G.sh.getRange(2, 1, G.rows.length, G.head.length).setValues(G.rows);
    if (adds.length) appendRows_(G, adds);
    if (logs.length) { try { appendRows_(readTable_('変更の記録'), logs); } catch (e) { /* 記録できなくても本体は止めない */ } }
    return { ok: true, saved: true, results: results, added: adds.length };
  } finally {
    lock.releaseLock();
  }
}

function apiReissueKey_(user, req) {
  needTop_(user);
  const users = readUsers_();
  const u = users[String(req.userId || '')];
  if (!u) throw err_('NO_USER', 'この人が見つかりません');
  const U = readTable_('利用者');
  const key = newKey_();
  U.sh.getRange(u.row, U.col['鍵'] + 1).setNumberFormat('@').setValue(key);
  log_(user, u.name + '（' + u.id + '）', '利用カードを作り直した（前のカードは使えない）');
  return { ok: true, id: u.id, key: key };
}

function apiSaveGroup_(user, g) {
  needTop_(user);
  const G = readTable_('グループ');
  const c = G.col;
  const groups = readGroups_(true);
  const name = String(g.name || '').trim();
  if (!name) throw err_('NO_NAME', 'グループの名前を入れてください');
  const active = g.active !== false;
  if (g.id) {
    const cur = groups[String(g.id)];
    if (!cur) throw err_('NO_GROUP', 'グループが見つかりません');
    if (!active) {
      const us = readUsers_();
      const members = Object.keys(us).map(k => us[k]).filter(u => u.groupId === cur.id && u.active);
      if (members.length) throw err_('HAS_MEMBERS', 'メンバーが' + members.length + '人いるため、なくせません。先にほかのグループへ移してください');
    }
    G.sh.getRange(cur.row, c['名前'] + 1).setValue(name);
    if (g.order !== undefined) G.sh.getRange(cur.row, c['並び順'] + 1).setValue(Number(g.order) || 0);
    if (g.area !== undefined) G.sh.getRange(cur.row, c['主に回るエリア'] + 1).setValue(String(g.area || ''));
    G.sh.getRange(cur.row, c['有効'] + 1).setValue(active);
    log_(user, 'グループ ' + cur.id, (cur.name !== name ? '名前：' + cur.name + ' → ' + name + '　' : '') + (active ? '' : 'なくした'));
    return { ok: true, id: cur.id };
  }
  let maxNo = 0;
  Object.keys(groups).forEach(id => { const m = id.match(/^G(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
  const id = 'G' + (maxNo + 1);
  const order = Object.keys(groups).length + 1;
  appendRows_(G, [[id, name, order, String(g.area || ''), '', true]]);
  log_(user, 'グループ ' + id, '追加：' + name);
  return { ok: true, id: id };
}

/* ============================== 建物（家・集合住宅の仕分け） ============================== */

function apiSetHouseState_(user, req) {
  needTop_(user);
  const state = String(req.state || '');
  if (HOUSE_STATES.indexOf(state) < 0) throw err_('BAD_STATE', '建物の状態が正しくありません');
  const hid = String(req.houseId || '');
  if (!hid) throw err_('NO_HOUSE', '建物を選んでください');
  const T = readTable_('家の状態');
  const rowNo = T.sh.getLastRow() + 1;
  appendRows_(T, [[new Date(), hid, state, String(req.buildingId || ''), user.name, String(req.note || '').slice(0, 200)]]);
  if (req.reportId) apiResolveReport_(user, { reportId: req.reportId, result: '反映した' });
  log_(user, '建物 ' + hid, '状態：' + state + (req.note ? '（' + req.note + '）' : ''));
  return { ok: true, houseId: hid, state: state, id: 'S' + rowNo };
}

/**
 * 集合住宅を登録・変更する。
 * building: {id?, name, type, autolock, routes（回り方IDの配列。どれか・いくつでも・なし）, city('Z'|'H'), houseId, lat, lon, address, active, memo}
 * rooms: [{entrance, floor, no}] を付けると、部屋の一覧をその形にそろえる（なくなった部屋は「有効」を外す）
 */
function apiSaveBuilding_(user, req) {
  needTop_(user);
  const b = req.building || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const st = settings_();
    const T = readTable_('建物');
    const c = T.col;
    const all = readBuildings_(true);
    const name = String(b.name || '').trim();
    if (!name) throw err_('NO_NAME', '建物の名前を入れてください');
    const type = BUILDING_TYPES.indexOf(String(b.type)) >= 0 ? String(b.type) : 'アパート';
    const routeIds = normRoutes_(b.routes !== undefined ? b.routes : b.route);
    const route = routeText_(routeIds);
    const autolock = ['あり', 'なし', '分からない'].indexOf(String(b.autolock)) >= 0 ? String(b.autolock) : '分からない';
    let id = String(b.id || '');
    let isNew = false;
    if (id) {
      const cur = all[id];
      if (!cur) throw err_('NO_BUILDING', '建物が見つかりません');
      const row = cur.row;
      const put = (col, v) => T.sh.getRange(row, c[col] + 1).setValue(v);
      put('名前', name); put('種類', type); put('オートロック', autolock); put('回り方', route);
      if (b.houseId !== undefined) put('家ID', String(b.houseId || ''));
      if (b.lat !== undefined) put('緯度', b.lat === '' ? '' : Number(b.lat));
      if (b.lon !== undefined) put('経度', b.lon === '' ? '' : Number(b.lon));
      if (b.address !== undefined) put('住所', String(b.address || ''));
      if (b.memo !== undefined) put('メモ', String(b.memo || ''));
      put('有効', b.active !== false);
      log_(user, '建物 ' + id, name + '・' + type + '・' + routeNames_(routeIds));
    } else {
      isNew = true;
      let maxNo = 0;
      Object.keys(all).forEach(k => { const m = k.match(/^AP(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
      id = 'AP' + ('00' + (maxNo + 1)).slice(-3);
      const city = String(b.city || '') === 'H' ? 'H' : 'Z';
      const head = String(type === 'マンション' ? (st['マンションの頭文字'] || 'M') : (st['アパートの頭文字'] || 'A')) + city;
      let seq = 0;
      Object.keys(all).forEach(k => { const no = String(all[k].no); if (no.indexOf(head) === 0) seq = Math.max(seq, Number(no.slice(head.length)) || 0); });
      const no = String(b.no || '') || head + (seq + 1);
      appendRows_(T, [[id, no, name, type, autolock, route, city, String(b.houseId || ''),
        b.lat === undefined || b.lat === '' ? '' : Number(b.lat), b.lon === undefined || b.lon === '' ? '' : Number(b.lon),
        String(b.address || ''), true, String(b.memo || ''), new Date()]]);
      log_(user, '建物 ' + id, '登録：' + no + ' ' + name + '・' + type + '・' + routeNames_(routeIds));
    }
    if (b.houseId) {
      appendRows_(readTable_('家の状態'), [[new Date(), String(b.houseId), '集合住宅', id, user.name, name]]);
    }
    let roomsChanged = null;
    if (Array.isArray(req.rooms)) roomsChanged = saveRooms_(id, req.rooms);
    if (req.reportId) apiResolveReport_(user, { reportId: req.reportId, result: '反映した' });
    return { ok: true, id: id, isNew: isNew, building: readBuildings_(true)[id], rooms: roomsChanged };
  } finally {
    lock.releaseLock();
  }
}

function saveRooms_(bid, rooms) {
  const T = readTable_('部屋');
  const c = T.col;
  const cur = {};
  let seq = 0;
  T.rows.forEach((r, i) => {
    if (String(r[c['建物ID']]) !== bid) return;
    const m = String(r[c['部屋ID']]).match(/-(\d+)$/);
    if (m) seq = Math.max(seq, Number(m[1]));
    cur[String(r[c['入口']]) + '|' + String(r[c['部屋番号']])] = { r: r, row: i + 2 };
  });
  const want = {};
  const add = [];
  rooms.forEach((x, i) => {
    const ent = String(x.entrance || '');
    const no = String(x.no || '').trim();
    if (!no) return;
    const k = ent + '|' + no;
    if (want[k]) return;
    want[k] = true;
    const floor = x.floor === undefined || x.floor === '' ? floorOf_(no) : Number(x.floor);
    const ex = cur[k];
    if (ex) {
      if (falsy_(ex.r[c['有効']])) T.sh.getRange(ex.row, c['有効'] + 1).setValue(true);
      T.sh.getRange(ex.row, c['並び順'] + 1).setValue(i + 1);
    } else {
      seq++;
      add.push([bid + '-' + ('00' + seq).slice(-3), bid, ent, floor, no, i + 1, true, '']);
    }
  });
  let removed = 0;
  Object.keys(cur).forEach(k => {
    if (!want[k] && !falsy_(cur[k].r[c['有効']])) { T.sh.getRange(cur[k].row, c['有効'] + 1).setValue(false); removed++; }
  });
  const rng = add.length ? T.sh.getRange(T.sh.getLastRow() + 1, 5, add.length, 1) : null;
  if (rng) rng.setNumberFormat('@');
  appendRows_(T, add);
  return { added: add.length, removed: removed, total: Object.keys(want).length };
}

function apiResolveReport_(user, req) {
  needTop_(user);
  const R = readTable_('報告');
  const c = R.col;
  const i = R.rows.findIndex(r => String(r[c['報告ID']]) === String(req.reportId));
  if (i < 0) throw err_('NO_REPORT', '報告が見つかりません');
  R.sh.getRange(i + 2, c['対応'] + 1).setValue(String(req.result || '確認した') + '（' + user.name + '）');
  return { ok: true };
}

/* ============================== 集合住宅の部屋ごとの様子・設定 ============================== */

/**
 * 集合住宅の部屋ごとの様子（部屋ごとに割り振るときに使う）。
 *   req.kind（回り方ID）でその回り方の建物、または req.ids で建物を選ぶ。回り直すまでの日数・1人の部屋数は、その回り方の決まり
 *   部屋ごとに：今だれが持っているか、拒否の印、最後の記録（日付と結果）
 */
/* ============================== 巡回（0.7.0） ============================== */

/**
 * 集合住宅の「巡回」：建物の部屋を一通り回るまでを1回と数える。
 *   ・部屋は、その部屋を配った配布が返却された日に「回った」とする（網羅は配布で数える。S-13の「完了した日付」と同じ考え方）
 *   ・一棟まとめての配布は、全部の部屋を回ったことになる。手持ち（グループに預けた分）は数えない。取り消した配布も数えない
 *   ・拒否の部屋は数えない（回らないため）。拒否をのぞく全部の部屋を回った返却の日に、その巡回が終わる（＝完了した日付）
 *   ・巡回を始めた日は、その巡回に入る配布のうち一番早い配布日（＝割り当てた日付）。配布中の分も今の巡回に入れる
 * D：「配布」の表、B：{建物ID: 建物}、R：{建物ID: [部屋]}、refused：{部屋ID: true}
 * 返り値 {建物ID: {rounds:[{n, start, end, people, rooms}], lastDone, cur:{n, start, done:{部屋ID: 日付}, covered, required, out}, months:{'yyyy-MM': {rooms, people}}}}
 */
function buildingCycles_(D, B, R, refused) {
  const dc = D.col;
  const byB = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    const tid = String(r[dc['区域ID']]);
    if (!B[tid] || String(r[dc['種別']]) === KIND_HOLD) return;
    (byB[tid] = byB[tid] || []).push(r);
  });
  const out = {};
  Object.keys(B).forEach(bid => {
    const all = (R[bid] || []).map(x => x.id);
    const need = all.filter(x => !refused[x]);
    const rows = byB[bid] || [];
    const ret = rows.filter(r => r[dc['返却日']]).map(r => ({
      at: toDate_(r[dc['返却日']]), from: toDate_(r[dc['配布日']]), rooms: roomsOf_(r, dc), name: String(r[dc['名前']] || ''),
    })).sort((a, b) => (a.at - b.at) || (a.from - b.from));
    const rounds = [], months = {};
    let done = {}, start = null, people = {};
    ret.forEach(x => {
      const rs = x.rooms.length ? x.rooms : all;
      const ym = fmtDate_(x.at).slice(0, 7);
      const m = months[ym] || (months[ym] = { rooms: {}, people: {} });
      rs.forEach(id => { m.rooms[id] = true; if (!done[id]) done[id] = x.at; });
      m.people[x.name] = true;
      people[x.name] = true;
      if (!start || x.from < start) start = x.from;
      const complete = need.length ? need.every(id => done[id]) : !x.rooms.length;
      if (complete) {
        rounds.push({ n: rounds.length + 1, start: fmtDate_(start), end: fmtDate_(x.at), people: Object.keys(people), rooms: Object.keys(done).length });
        done = {}; start = null; people = {};
      }
    });
    let outN = 0;
    rows.filter(r => !r[dc['返却日']]).forEach(r => {
      const f = toDate_(r[dc['配布日']]);
      if (!start || f < start) start = f;
      outN += roomsOf_(r, dc).length || all.length;
      people[String(r[dc['名前']] || '')] = true;
    });
    const doneOut = {};
    Object.keys(done).forEach(id => { doneOut[id] = fmtDate_(done[id]); });
    const ms = {};
    Object.keys(months).forEach(k => { ms[k] = { rooms: Object.keys(months[k].rooms).length, people: Object.keys(months[k].people) }; });
    out[bid] = {
      rounds: rounds, lastDone: rounds.length ? rounds[rounds.length - 1].end : '',
      cur: { n: rounds.length + 1, start: start ? fmtDate_(start) : '', done: doneOut, covered: need.filter(id => done[id]).length, required: need.length, out: outN, people: Object.keys(people).filter(Boolean) },
      months: ms,
    };
  });
  return out;
}

/** 画面に出す巡回のまとめ：何回目・始めた日・回った部屋/回る部屋・配布中の部屋・前の巡回が終わった日 */
function cycleSummary_(c) {
  if (!c) return null;
  return { n: c.cur.n, start: c.cur.start, covered: c.cur.covered, required: c.cur.required, out: c.cur.out, lastDone: c.lastDone, rounds: c.rounds.length };
}

/**
 * 部屋を拒否にする・拒否を解除する（上位管理者。集合住宅の画面から）。
 *   訪問記録に「拒否」「拒否解除」の行を足す（配布は付けない）。最後の行が効くので、記録は消さずに何度でも変えられる
 */
function apiSetRoomRefusal_(user, req) {
  needTop_(user);
  const bid = String(req.buildingId || '');
  const rid = String(req.roomId || '');
  const room = (readRooms_()[bid] || []).find(x => x.id === rid);
  if (!room) throw err_('NO_ROOM', '部屋が見つかりません');
  const res = req.refused ? '拒否' : '拒否解除';
  const now = new Date();
  const V = readTable_('訪問記録');
  const c = V.col;
  const row = new Array(V.head.length).fill('');
  row[c['記録ID']] = 'A' + Utilities.formatDate(now, TZ, 'yyMMddHHmmss') + '-' + shortId_();
  row[c['区域ID']] = bid; row[c['結果']] = res; row[c['訪問日時']] = now; row[c['利用者ID']] = user.id; row[c['名前']] = user.name;
  row[c['受信日時']] = now; row[c['無効']] = false; row[c['部屋ID']] = rid;
  appendRows_(V, [row]);
  log_(user, '部屋 ' + room.no + '（' + bid + '）', res + (req.note ? '（' + String(req.note).slice(0, 100) + '）' : ''));
  return { ok: true, roomId: rid, refused: !!req.refused };
}

/** 部屋ごとの拒否（最後の記録が「拒否」の部屋）。{部屋ID: true} */
function roomRefusals_() {
  const V = readTable_('訪問記録');
  const vc = V.col;
  const last = {};
  V.rows.forEach(r => {
    if (!r[vc['記録ID']] || truthy_(r[vc['無効']])) return;
    const rid = String(r[vc['部屋ID']] || '');
    const res = String(r[vc['結果']]);
    if (!rid || (res !== '拒否' && res !== '拒否解除')) return;
    const at = toDate_(r[vc['訪問日時']]);
    if (!last[rid] || last[rid].at <= at) last[rid] = { res: res, at: at };
  });
  const out = {};
  Object.keys(last).forEach(k => { if (last[k].res === '拒否') out[k] = true; });
  return out;
}

/**
 * 回った月（上位管理者）：区域と集合住宅ごとに、何月に回ったか。S-13の「割り当てた日付」「完了した日付」の元になる
 *   戸建ての区域：返却した配布（ふつうの配布。不在宅訪問・手持ちは数えない）を、返却した月に数える
 *   集合住宅：巡回（buildingCycles_）。月ごとに回った部屋の数と、巡回ごとの始めた日・終わった日
 *   req.months：何か月分か（既定12、1〜24）。今月までの分
 */
function apiCoverage_(user, req) {
  needTop_(user);
  const now = new Date();
  const nM = clampInt_(req.months, 1, 24, 12);
  const months = [];
  for (let i = nM - 1; i >= 0; i--) months.push(fmtDate_(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
  const from = months[0];
  const D = readTable_('配布');
  const dc = D.col;
  autoCollect_(D, now, false);
  const B = readBuildings_();
  const R = readRooms_();
  const cyc = buildingCycles_(D, B, R, roomRefusals_());
  const terrs = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    const tid = String(r[dc['区域ID']]);
    if (B[tid] || String(r[dc['種別']] || KIND_NORMAL) !== KIND_NORMAL) return;
    const t = terrs[tid] || (terrs[tid] = { id: tid, no: String(r[dc['区域番号']]), months: {}, last: '', out: null, hist: [] });
    const h = { distId: String(r[dc['配布ID']]), name: String(r[dc['名前']]), from: fmtDate_(r[dc['配布日']]), to: fmtDate_(r[dc['返却日']]), how: String(r[dc['終わり方']] || '') };
    if (!h.to) { t.out = h; return; }
    t.hist.push(h);
    if (h.to > t.last) t.last = h.to;
    const ym = h.to.slice(0, 7);
    if (ym >= from) t.months[ym] = (t.months[ym] || 0) + 1;
  });
  Object.keys(terrs).forEach(k => { terrs[k].hist.sort((a, b) => (a.to < b.to ? 1 : -1)); terrs[k].hist = terrs[k].hist.slice(0, 12); });
  const bldgs = Object.keys(B).map(id => {
    const c = cyc[id];
    const ms = {};
    Object.keys(c.months).forEach(k => { if (k >= from) ms[k] = c.months[k]; });
    return { id: id, no: B[id].no, name: B[id].name, routes: B[id].routes, rooms: (R[id] || []).length, months: ms, rounds: c.rounds.slice(-12).reverse(), round: cycleSummary_(c) };
  });
  return { ok: true, today: fmtDate_(now), months: months, terrs: Object.keys(terrs).map(k => terrs[k]), buildings: bldgs };
}

function apiRoomStatus_(user, req) {
  needTop_(user);
  const now = new Date();
  const B = readBuildings_();
  const RT = readRoutes_();
  const kind = RT.resolve(req.kind);
  const route = RT.byId[kind] || RT.byId[RT.resolve(req.route)] || RT.list.filter(x => x.active)[0] || { per: 5, cycle: 90 };
  const ids = Array.isArray(req.ids) && req.ids.length ? req.ids.map(String).filter(id => B[id])
    : Object.keys(B).filter(id => !kind || B[id].routes.indexOf(kind) >= 0);
  const want = {};
  ids.forEach(id => { want[id] = true; });
  const R = readRooms_();
  const D = readTable_('配布');
  const dc = D.col;
  const outRoom = {}, outWhole = {}, distRooms = {};
  D.rows.forEach(r => {
    const tid = String(r[dc['区域ID']]);
    if (!r[dc['配布ID']] || !want[tid] || truthy_(r[dc['無効']])) return;
    const rs = roomsOf_(r, dc);
    distRooms[String(r[dc['配布ID']])] = rs;
    if (r[dc['返却日']]) return;
    const o = { name: String(r[dc['名前']]), userId: String(r[dc['利用者ID']] || ''), distId: String(r[dc['配布ID']]), kind: String(r[dc['種別']]) };
    if (rs.length) rs.forEach(x => { outRoom[x] = o; }); else outWhole[tid] = o;
  });
  const roomBy = {};
  ids.forEach(id => (R[id] || []).forEach(x => { roomBy[x.id] = Object.assign({ bid: id }, x); }));
  // 配布ごとに：部屋の記録があればそれ、なければ入口ごとの「全部回った」（画面の数え方と同じ）
  const per = {}, refusal = {};
  const V = readTable_('訪問記録');
  const vc = V.col;
  V.rows.forEach(r => {
    if (!r[vc['記録ID']] || truthy_(r[vc['無効']])) return;
    const res = String(r[vc['結果']]);
    if (res === '取り消し') return;
    const at = toDate_(r[vc['訪問日時']]);
    const did = String(r[vc['配布ID']]);
    const rid = String(r[vc['部屋ID']] || '');
    const put = (x, slot) => {
      const k = did + '|' + x;
      const p = per[k] = per[k] || { room: null, block: null };
      if (!p[slot] || p[slot].at <= at) p[slot] = { res: res, at: at };
    };
    if (rid) {
      if (!roomBy[rid]) return;
      if (res === '拒否' || res === '拒否解除') { if (!refusal[rid] || refusal[rid].at <= at) refusal[rid] = { res: res, at: at }; }
      if (res !== '拒否解除') put(rid, 'room');
    } else if (res === '済') {
      // 入口ごとの「全部回った」：部屋ごとに配った分なら、その部屋だけ
      const m = String(r[vc['ブロックID']] || '').match(/^(.+)#(.*)$/);
      if (m && want[m[1]]) {
        const own = distRooms[did];
        const pool = own && own.length ? own : (R[m[1]] || []).map(x => x.id);
        pool.filter(x => roomBy[x] && String(roomBy[x].entrance || '') === m[2]).forEach(x => put(x, 'block'));
      }
    }
  });
  const last = {};
  Object.keys(per).forEach(k => {
    const x = k.slice(k.indexOf('|') + 1);
    const v = per[k].room || per[k].block;
    if (v && (!last[x] || last[x].at <= v.at)) last[x] = v;
  });
  // 巡回：今の巡回でもう回った部屋は、候補に出さない
  const refusedMap = {};
  Object.keys(refusal).forEach(k => { if (refusal[k].res === '拒否') refusedMap[k] = true; });
  const BB = {};
  ids.forEach(id => { BB[id] = B[id]; });
  const cyc = buildingCycles_(D, BB, R, refusedMap);
  return {
    ok: true,
    today: fmtDate_(now),
    cycleDays: route.cycle,
    roomsPer: route.per,
    roomsPerBuilding: route.perB || DEFAULT_PER_BUILDING,
    buildings: ids.map(id => ({
      id: id, no: B[id].no, name: B[id].name, routes: B[id].routes, whole: outWhole[id] || null,
      round: cycleSummary_(cyc[id]),
      rooms: (R[id] || []).map(x => ({
        id: x.id, no: x.no, entrance: x.entrance, floor: x.floor, order: x.order,
        out: outRoom[x.id] || null,
        refused: !!refusedMap[x.id],
        done: cyc[id].cur.done[x.id] || '',
        last: last[x.id] ? { at: fmtDate_(last[x.id].at), res: last[x.id].res } : null,
      })),
    })),
  };
}

/** アプリから変えてよい設定だけを変える（上位管理者） */
function apiSaveSetting_(user, req) {
  needTop_(user);
  const name = String(req.name || '');
  if (EDITABLE_SETTINGS.indexOf(name) < 0) throw err_('BAD_SETTING', 'この設定はアプリから変えられません');
  let v = req.value;
  if (name === '使う機能') {
    if (SCOPES.indexOf(String(v)) < 0) throw err_('BAD_VALUE', '「すべて」か「集合住宅だけ」を選んでください');
    v = String(v);
  } else if (name === '地図の下地') {
    if (BASEMAPS.indexOf(String(v)) < 0) throw err_('BAD_VALUE', '「国土地理院」か「保存した地図」を選んでください');
    v = String(v);
  } else if (name === '一巡の月数') {
    v = Number(v);
    if (!isFinite(v) || Math.round(v) !== v || v < PLAN_MONTHS[0] || v > PLAN_MONTHS[1]) throw err_('BAD_VALUE', '一巡の月数は' + PLAN_MONTHS[0] + '〜' + PLAN_MONTHS[1] + 'にしてください');
  } else if (name === '一巡の始まり') {
    v = ymOf_(v);
    if (req.value && !v) throw err_('BAD_VALUE', '月の書き方が正しくありません（例：2026-11）');
  } else if (name === '月ごとの配りやすさ' || name === '集合住宅の月ごとの配りやすさ') {
    // 12か月分（1月〜12月）の %。空ならどの月も同じ
    const raw = Array.isArray(v) ? v.join(',') : String(v === undefined || v === null ? '' : v);
    if (raw.trim() === '') v = '';
    else {
      const w = weightsOf_(raw);
      if (!w) throw err_('BAD_VALUE', '配りやすさは、1月〜12月の12個の数（0〜300）にしてください');
      if (!w.some(x => x > 0)) throw err_('BAD_VALUE', 'どれか1つの月は0より大きくしてください');
      v = w.every(x => x === 100) ? '' : w.join(',');
    }
  } else if (name === '集合住宅の一巡の月数') {
    if (v === '' || v === null || v === undefined || v === 'same') v = '';
    else {
      v = Number(v);
      if (!isFinite(v) || Math.round(v) !== v || v < APT_MONTHS[0] || v > APT_MONTHS[1]) throw err_('BAD_VALUE', '集合住宅の一巡の月数は' + APT_MONTHS[0] + '〜' + APT_MONTHS[1] + 'にしてください');
    }
  } else if (name === '毎晩のバックアップ') {
    if (['する', 'しない'].indexOf(String(v)) < 0) throw err_('BAD_VALUE', '「する」か「しない」を選んでください');
    v = String(v);
  } else if (name === '回収日') {
    if (DUE_CHOICES.indexOf(String(v)) < 0) throw err_('BAD_VALUE', '回収日は「月末」か「1か月」〜「6か月」にしてください');
    v = String(v);
  } else {
    v = Number(v);
    const rg = NUMBER_RANGES[name] || [0, 365];
    if (!isFinite(v) || Math.round(v) !== v || v < rg[0] || v > rg[1]) throw err_('BAD_VALUE', name + 'は' + rg[0] + '〜' + rg[1] + 'の数にしてください');
  }
  const old = setSetting_(name, v);
  log_(user, '設定 ' + name, String(name === '一巡の始まり' ? ymOf_(old) : old === '' ? '（空）' : old) + ' → ' + (v === '' ? '（空）' : v));
  return { ok: true, name: name, value: v };
}

/** 設定を1つ書く（なければ足す）。前の値を返す。文字の設定は、日付や数に変わらないように文字のまま入れる */
function setSetting_(name, v) {
  const T = readTable_('設定');
  const i = T.rows.findIndex(r => String(r[0]).trim() === name);
  const old = i >= 0 ? T.rows[i][1] : '';
  if (i >= 0) {
    const cell = T.sh.getRange(i + 2, 2);
    if (TEXT_SETTINGS.indexOf(name) >= 0) cell.setNumberFormat('@');
    cell.setValue(v);
  } else {
    const d = DEFAULT_SETTINGS.find(x => x[0] === name);
    const at = T.sh.getLastRow() + 1;
    if (TEXT_SETTINGS.indexOf(name) >= 0) T.sh.getRange(at, 2).setNumberFormat('@');
    T.sh.getRange(at, 1, 1, 3).setValues([[name, v, d ? d[2] : '']]);
  }
  return old;
}

/**
 * 回り方を足す・変える（上位管理者）。route: {id?, name, mode（部屋ごと／一棟まとめて）, per, perB（1つの建物から何部屋まで）, cycle, active}
 *   名前を変えても回り方IDは変わらないので、建物・配布・集まりとの結びつきはそのまま。前の名前は「前の名前」に残す
 */
function apiSaveRoute_(user, x) {
  needTop_(user);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const T = readTable_('回り方');
    const c = T.col;
    if (!T.rows.some(r => String(r[0] || '').trim())) appendRows_(T, DEFAULT_ROUTES.map(r => r.slice()));
    ROUTE_CACHE_ = null;
    const R = readRoutes_();
    const name = String(x.name || '').trim();
    if (!name) throw err_('NO_NAME', '回り方の名前を入れてください');
    if (name.length > 20) throw err_('BAD_NAME', '名前は20文字までにしてください');
    if (/[・,、]/.test(name)) throw err_('BAD_NAME', '名前に「・」「、」「,」は使えません');
    if (FIXED_KINDS.indexOf(name) >= 0 || name === NO_ROUTE || /^R\d+$/.test(name)) throw err_('BAD_NAME', '「' + name + '」は回り方の名前に使えません');
    const same = R.list.find(r => r.name === name && r.id !== String(x.id || ''));
    if (same) throw err_('SAME_NAME', '「' + name + '」という回り方はもうあります');
    const mode = HAND_MODES.indexOf(String(x.mode)) >= 0 ? String(x.mode) : '部屋ごと';
    const per = clampInt_(x.per, 1, 20, 5);
    const perB = clampInt_(x.perB, 1, 20, DEFAULT_PER_BUILDING);
    const cycle = clampInt_(x.cycle, 0, 365, 90);
    const active = x.active !== false;
    let id = String(x.id || '');
    if (id) {
      const cur = R.byId[id];
      if (!cur || !cur.row) throw err_('NO_ROUTE', '回り方が見つかりません');
      const put = (col, v) => T.sh.getRange(cur.row, c[col] + 1).setValue(v);
      const changes = [];
      if (cur.name !== name) {
        put('名前', name);
        const prev = cur.prev.filter(n => n !== name);
        if (prev.indexOf(cur.name) < 0) prev.push(cur.name);
        put('前の名前', prev.join('、'));
        changes.push('名前：' + cur.name + ' → ' + name);
      }
      if (cur.mode !== mode) { put('渡し方', mode); changes.push('渡し方：' + mode); }
      if (cur.per !== per) { put('1人の部屋数', per); changes.push('1人の部屋数：' + per); }
      const rawB = T.rows[cur.row - 2][c['1つの建物から']];
      if (cur.perB !== perB || rawB === '' || rawB === null || rawB === undefined) {
        if (!T.sh.getRange(1, c['1つの建物から'] + 1).getValue()) T.sh.getRange(1, c['1つの建物から'] + 1).setValue('1つの建物から').setFontWeight('bold');
        put('1つの建物から', perB);
        if (cur.perB !== perB) changes.push('1つの建物から：' + perB + '部屋まで');
      }
      if (cur.cycle !== cycle) { put('回り直すまでの日数', cycle); changes.push('回り直すまでの日数：' + cycle); }
      if (cur.active !== active) { put('使う', active); changes.push(active ? '使う' : '使わない'); }
      if (changes.length) log_(user, '回り方 ' + id, changes.join('、'));
    } else {
      let maxNo = 0, maxOrder = 0;
      R.list.forEach(r => { const m = r.id.match(/^R(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); maxOrder = Math.max(maxOrder, r.order); });
      id = 'R' + (maxNo + 1);
      appendRows_(T, [[id, name, mode, per, cycle, maxOrder + 1, active, '', '', perB]]);
      log_(user, '回り方 ' + id, '追加：' + name + '（' + mode + '）');
    }
    ROUTE_CACHE_ = null;
    const after = readRoutes_();
    return { ok: true, id: id, route: publicRoute_(after.byId[id]), routes: after.list.map(publicRoute_) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== 地図の手直し（家を足す・動かす・見送る） ============================== */

/**
 * edit: {type:'足す'|'動かす'|'見送り', houseId, territoryId, blockId, lat, lon, note, reportId}
 *   足す：地図にない家を足す。現地からの知らせ（reportId）からなら、家IDは「n-報告ID」（仮の家と同じ）
 *   動かす：家の印の場所を直す
 *   見送り：国土地理院との比べで出た候補を「家ではない・まだある」として、次から出さない
 */
function apiEditHouse_(user, e) {
  needTop_(user);
  const type = String(e.type || '');
  if (EDIT_TYPES.indexOf(type) < 0) throw err_('BAD_TYPE', '手直しの種類が正しくありません');
  const lat = Number(e.lat), lon = Number(e.lon);
  const hasLL = e.lat !== undefined && e.lat !== '' && e.lat !== null && isFinite(lat) && isFinite(lon);
  if ((type === '足す' || type === '動かす') && !hasLL) throw err_('NO_PLACE', '場所を選んでください');
  if (type === '足す' && !e.blockId) throw err_('NO_BLOCK', '区域の中の場所を選んでください');
  if (type === '動かす' && !e.houseId) throw err_('NO_HOUSE', '動かす家を選んでください');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const T = readTable_('家の手直し');
    let houseId = String(e.houseId || '');
    const reportId = String(e.reportId || '');
    if (type === '足す') {
      if (reportId) houseId = 'n-' + reportId;
      else {
        let maxNo = 0;
        T.rows.forEach(r => { const m = String(r[3] || '').match(/^hn(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
        houseId = 'hn' + ('000' + (maxNo + 1)).slice(-4);
      }
      if (T.rows.some(r => String(r[3]) === houseId && String(r[2]) === '足す' && !truthy_(r[10]))) throw err_('ALREADY', 'この家はもう足してあります');
    }
    const id = 'E' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + shortId_();
    const row = [id, new Date(), type, houseId, String(e.territoryId || ''), String(e.blockId || ''), hasLL ? lat : '', hasLL ? lon : '',
      String(e.note || '').slice(0, 200), user.name, false, reportId];
    appendRows_(T, [row]);
    if (reportId) apiResolveReport_(user, { reportId: reportId, result: type === '足す' ? '家を足した' : '見送り' });
    log_(user, '家 ' + (houseId || '（候補）'), type + (e.note ? '（' + e.note + '）' : '') + (hasLL ? ' ' + lat.toFixed(6) + ',' + lon.toFixed(6) : ''));
    return { ok: true, edit: editObj_(row) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== 区切りの手直し（0.12.0） ============================== */

/**
 * 区域の区切りを直す（上位管理者）。元のデータ（territories.json）は変えず、「区切りの手直し」シートの行を上に重ねる。
 *   req.items: [{type, targetId, to, no, town, shape, note}]  複数はひとつの「組」として入れ、まとめて元に戻せる
 *     家を移す：targetId=家ID、to=区域ID（家はもとのブロックの線の中のまま、別の区域の家として数える）
 *     ブロックを移す：targetId=ブロックID、to=区域ID
 *     ブロックを足す：to=区域ID、shape=[[緯度,経度],…]（3点以上の線）、town。IDはここで付ける（BN0001…）
 *     区域を作る：no=番号、town。IDはここで付ける（TN0001…）。同じ組のあとの行で 'to' に '$new' と書くと、この区域
 *     区域を外す：targetId=区域ID（配らない・数えない。記録は残る。戻せる）
 *     番号を変える：targetId=区域ID、no=新しい番号（town も変えられる）
 *   行は消さず、取り消しは「無効」の印（toggleBoundary）
 */
function apiEditBoundary_(user, req) {
  needTop_(user);
  const items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) throw err_('NO_ITEMS', '直す内容がありません');
  if (items.length > 200) throw err_('TOO_MANY', '一度に直せるのは200件までです');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const T = readTable_('区切りの手直し');
    const c = T.col;
    let maxT = 0, maxB = 0;
    T.rows.forEach(r => {
      let m = String(r[c['対象ID']] || '').match(/^TN(\d+)$/); if (m) maxT = Math.max(maxT, Number(m[1]));
      m = String(r[c['対象ID']] || '').match(/^BN(\d+)$/); if (m) maxB = Math.max(maxB, Number(m[1]));
    });
    const now = new Date();
    const batch = items.length > 1 ? 'K' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-' + shortId_() : '';
    const rows = [];
    const made = [];
    let newTid = '';
    items.forEach(it => {
      const type = String(it.type || '');
      if (BOUNDARY_TYPES.indexOf(type) < 0) throw err_('BAD_TYPE', '手直しの種類が正しくありません：' + type);
      let target = String(it.targetId || '').trim();
      let to = String(it.to || '').trim();
      if (to === '$new') { if (!newTid) throw err_('NO_NEW', '先に「区域を作る」を入れてください'); to = newTid; }
      const no = String(it.no || '').trim().toUpperCase();
      const town = String(it.town || '').trim().slice(0, 40);
      let shape = '';
      if (type === '区域を作る') {
        if (!no) throw err_('NO_NO', '新しい区域の番号を入れてください');
        if (!/^[A-Z]{1,2}\d{1,3}(-\d{1,3})?$/.test(no)) throw err_('BAD_NO', '番号は「Z07-9」「H12-3」のような形にしてください');
        target = 'TN' + ('000' + (++maxT)).slice(-4);
        newTid = target;
      } else if (type === 'ブロックを足す') {
        const pts = Array.isArray(it.shape) ? it.shape.filter(p => Array.isArray(p) && isFinite(Number(p[0])) && isFinite(Number(p[1]))) : [];
        if (pts.length < 3) throw err_('BAD_SHAPE', 'ブロックの線は3点以上さわって描いてください');
        if (!to) throw err_('NO_TO', 'どの区域のブロックにするかを選んでください');
        shape = JSON.stringify(pts.map(p => [Math.round(Number(p[0]) * 1e6) / 1e6, Math.round(Number(p[1]) * 1e6) / 1e6]));
        target = 'BN' + ('000' + (++maxB)).slice(-4);
      } else if (type === '番号を変える') {
        if (!target) throw err_('NO_TARGET', '区域を選んでください');
        if (!no) throw err_('NO_NO', '新しい番号を入れてください');
        if (!/^[A-Z]{1,2}\d{1,3}(-\d{1,3})?$/.test(no)) throw err_('BAD_NO', '番号は「Z07-9」「H12-3」のような形にしてください');
      } else if (type === '家を移す' || type === 'ブロックを移す') {
        if (!target) throw err_('NO_TARGET', (type === '家を移す' ? '家' : 'ブロック') + 'を選んでください');
        if (!to) throw err_('NO_TO', '移す先の区域を選んでください');
      } else if (type === '区域を外す') {
        if (!target) throw err_('NO_TARGET', '区域を選んでください');
      }
      const id = 'K' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-' + shortId_();
      const row = [id, now, type, target, to, no, town, shape, String(it.note || '').slice(0, 200), user.name, false, '', '', batch];
      rows.push(row);
      made.push(boundaryObj_(row));
    });
    appendRows_(T, rows);
    log_(user, '区切り', made.map(x => x.type + ' ' + (x.no || x.targetId) + (x.to ? '→' + x.to : '')).join('、').slice(0, 300));
    return { ok: true, edits: made, batch: batch, newId: newTid };
  } finally {
    lock.releaseLock();
  }
}

/** 区切りの手直しを元に戻す・もう一度反映する。editIds か batch（組）で指定 */
function apiToggleBoundary_(user, req) {
  needTop_(user);
  const off = !!req.off;
  const ids = Array.isArray(req.editIds) ? req.editIds.map(String) : [];
  const batch = String(req.batch || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const T = readTable_('区切りの手直し');
    const c = T.col;
    const now = new Date();
    let n = 0;
    T.rows.forEach((r, i) => {
      const hit = ids.indexOf(String(r[c['手直しID']])) >= 0 || (batch && String(r[c['組']]) === batch);
      if (!hit || truthy_(r[c['無効']]) === off) return;
      T.sh.getRange(i + 2, c['無効'] + 1, 1, 3).setValues([[off, off ? now : '', off ? user.name : '']]);
      n++;
    });
    if (!n) throw err_('NO_EDIT', '手直しが見つかりません');
    log_(user, '区切り', (off ? '元に戻した' : 'もう一度反映した') + '（' + n + '件）');
    return { ok: true, changed: n };
  } finally {
    lock.releaseLock();
  }
}

function boundaryObj_(r) {
  let shape = null;
  if (r[7]) { try { shape = JSON.parse(String(r[7])); } catch (e) { shape = null; } }
  return {
    id: String(r[0]), at: fmtDate_(r[1]), type: String(r[2]), targetId: String(r[3] || ''), to: String(r[4] || ''), no: String(r[5] || ''),
    town: String(r[6] || ''), shape: shape, note: String(r[8] || ''), by: String(r[9] || ''), off: truthy_(r[10]), batch: String(r[13] || ''),
  };
}
/** 区切りの手直し。all でなければ、効いているものだけ（古い順） */
function readBoundaryEdits_(all) {
  return readTable_('区切りの手直し').rows.filter(r => r[0]).map(boundaryObj_).filter(x => all || !x.off);
}

/** 手直しを取り消す（行は消さず「無効」に印を付ける） */
function apiUndoHouseEdit_(user, req) {
  needTop_(user);
  const T = readTable_('家の手直し');
  if (!T.rows.some(r => String(r[0]) === String(req.editId || ''))) throw err_('NO_EDIT', '手直しが見つかりません');
  apiToggleMapChanges_(user, { items: [{ kind: 'edit', id: req.editId }], off: true });
  return { ok: true };
}

/*
 * 地図の更新の記録（0.8.0）。家の手直し（足す・動かす・見送り）と、建物の状態の変更（なくなった・家ではない・集合住宅…）を
 * 1つの記録として出す。どれも行は消さず「無効」の印で、元に戻す・もう一度反映するを何度でもできる。
 *   状態は「無効でない最後の行」が効くので、ある変更を元に戻すと、その前の状態にもどる
 */
function isoOf_(v) { return v === '' || v === null || v === undefined ? '' : toDate_(v).toISOString(); }
function apiMapHistory_(user, req) {
  needTop_(user);
  const E = readTable_('家の手直し');
  const ec = E.col;
  const edits = E.rows.filter(r => r[0]).map(r => Object.assign(editObj_(r), {
    at: isoOf_(r[ec['日時']]), offAt: isoOf_(r[ec['取り消した日時']]), offBy: String(r[ec['取り消した人']] || ''),
  }));
  const S = readTable_('家の状態');
  const sc = S.col;
  const states = [];
  S.rows.forEach((r, i) => {
    const hid = String(r[sc['家ID']] || '');
    if (!hid) return;
    states.push({
      id: 'S' + (i + 2), at: isoOf_(r[sc['日時']]), houseId: hid, state: String(r[sc['状態']]), buildingId: String(r[sc['建物ID']] || ''),
      by: String(r[sc['変えた人']] || ''), note: String(r[sc['メモ']] || ''), off: truthy_(r[sc['無効']]),
      offAt: isoOf_(r[sc['取り消した日時']]), offBy: String(r[sc['取り消した人']] || ''),
    });
  });
  // その変更の前の状態と、今の地図に効いているか（同じ家の、無効でない最後の行）
  const last = {};
  states.forEach(x => { x.prev = last[x.houseId] ? last[x.houseId].state : '家'; if (!x.off) last[x.houseId] = x; });
  states.forEach(x => { x.current = last[x.houseId] === x; x.now = last[x.houseId] ? last[x.houseId].state : '家'; });
  const L = readTable_('変更の記録');
  const compares = L.rows.filter(r => String(r[2]) === '国土地理院と比べた').map(r => ({ at: isoOf_(r[0]), by: String(r[1] || ''), text: String(r[3] || '') }));
  return { ok: true, edits: edits.slice(-1500), states: states.slice(-1500), compares: compares.slice(-100) };
}
/** 地図の変更を、まとめて元に戻す（off: true）・もう一度反映する（off: false）。items: [{kind: 'edit'|'state', id, houseId}] */
function apiToggleMapChanges_(user, req) {
  needTop_(user);
  const items = Array.isArray(req.items) ? req.items : [];
  const off = !!req.off;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const E = readTable_('家の手直し');
    const ec = E.col;
    const S = readTable_('家の状態');
    const sc = S.col;
    const now = new Date();
    const logs = [];
    let n = 0;
    items.forEach(it => {
      if (it.kind === 'edit') {
        const i = E.rows.findIndex(r => String(r[0]) === String(it.id || ''));
        if (i < 0 || truthy_(E.rows[i][ec['無効']]) === off) return;
        E.sh.getRange(i + 2, ec['無効'] + 1).setValue(off);
        E.sh.getRange(i + 2, ec['取り消した日時'] + 1, 1, 2).setValues([[off ? now : '', off ? user.name : '']]);
        E.rows[i][ec['無効']] = off;
        logs.push([now, user.name, '家 ' + E.rows[i][ec['家ID']], (off ? '手直しを元に戻した（' : '手直しをもう一度反映した（') + E.rows[i][ec['種類']] + '）']);
        n++;
      } else if (it.kind === 'state') {
        const m = String(it.id || '').match(/^S(\d+)$/);
        if (!m) return;
        const row = Number(m[1]);
        const r = S.rows[row - 2];
        if (!r || (it.houseId && String(r[sc['家ID']]) !== String(it.houseId)) || truthy_(r[sc['無効']]) === off) return;
        S.sh.getRange(row, sc['無効'] + 1, 1, 3).setValues([[off, off ? now : '', off ? user.name : '']]);
        r[sc['無効']] = off;
        logs.push([now, user.name, '建物 ' + r[sc['家ID']], (off ? '状態の変更を元に戻した（' : '状態の変更をもう一度反映した（') + r[sc['状態']] + '）']);
        n++;
      }
    });
    if (logs.length) { try { appendRows_(readTable_('変更の記録'), logs); } catch (e) { /* 記録できなくても本体は止めない */ } }
    return { ok: true, changed: n };
  } finally {
    lock.releaseLock();
  }
}
/** 国土地理院の地図と比べたことを残す（いつ・何月の更新分まで・候補の数） */
/* ============================== 一巡と月ごとの組（0.10.0） ============================== */

/**
 * 一巡の設定。months：一巡の月数、start：始めた月（yyyy-MM。決めていなければ空）
 *   weights：1月〜12月の配りやすさ（%。決めていなければ null＝どの月も同じ。0.11.0）
 *   aptMonths・aptWeights：集合住宅の一巡（別枠。月数を決めていなければ戸建てと同じ。0.11.0）
 */
function planOf_(st) {
  const m = Math.round(numSetting_(st, '一巡の月数', 4));
  const months = Math.min(PLAN_MONTHS[1], Math.max(PLAN_MONTHS[0], m));
  const raw = st['集合住宅の一巡の月数'];
  const am = raw === '' || raw === null || raw === undefined || isNaN(Number(raw)) ? 0 : Math.round(Number(raw));
  return {
    months: months, start: ymOf_(st['一巡の始まり']), weights: weightsOf_(st['月ごとの配りやすさ']),
    aptMonths: am ? Math.min(APT_MONTHS[1], Math.max(APT_MONTHS[0], am)) : months, aptSame: !am, aptWeights: weightsOf_(st['集合住宅の月ごとの配りやすさ']),
  };
}

/** 「100,100,60,…」（12か月分）を数の配列に。正しくなければ null（どの月も同じ） */
function weightsOf_(v) {
  const a = String(v === undefined || v === null ? '' : v).split(/[,、\s]+/).filter(x => x !== '').map(Number);
  if (a.length !== 12 || a.some(x => !isFinite(x) || x < 0 || x > 300)) return null;
  return a.map(x => Math.round(x));
}

/** 今の一巡の始まりの日（'yyyy-MM-01'）。始まりを決めていなければ空。まだ始まっていなければ最初の月の1日 */
function cycleFrom_(start, months, now) {
  if (!start) return '';
  const p = start.split('-').map(Number);
  const q = fmtDate_(now).split('-').map(Number);
  const diff = (q[0] - p[0]) * 12 + (q[1] - p[1]);
  const k = diff < 0 ? 0 : Math.floor(diff / months);
  const mi = p[1] - 1 + k * months;
  return (p[0] + Math.floor(mi / 12)) + '-' + ('0' + (mi % 12 + 1)).slice(-2) + '-01';
}

/**
 * 集合住宅の一巡の進み具合（0.11.0）。from（一巡の始まりの日）からあとに返した配布で、建物ごとに：
 *   [回った部屋の数, 回る部屋の数（拒否をのぞく）, 全部回った日（まだなら空）]
 */
function aptProgress_(D, B, R, refused, from) {
  const dc = D.col;
  const first = {}, whole = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']]) || !r[dc['返却日']]) return;
    const bid = String(r[dc['区域ID']]);
    if (!B[bid] || String(r[dc['種別']]) === KIND_HOLD) return;
    const at = fmtDate_(r[dc['返却日']]);
    if (at < from) return;
    const rs = roomsOf_(r, dc);
    const f = first[bid] = first[bid] || {};
    (rs.length ? rs : (R[bid] || []).map(x => x.id)).forEach(id => { if (!f[id] || at < f[id]) f[id] = at; });
    if (!rs.length && (!whole[bid] || at < whole[bid])) whole[bid] = at;
  });
  const out = {};
  Object.keys(B).forEach(bid => {
    const need = (R[bid] || []).map(x => x.id).filter(id => !refused[id]);
    const f = first[bid] || {};
    const got = need.filter(id => f[id]);
    let at = '';
    if (need.length && got.length === need.length) at = got.reduce((m, id) => (f[id] > m ? f[id] : m), '');
    else if (!need.length && whole[bid]) at = whole[bid];
    out[bid] = [got.length, need.length, at];
  });
  return out;
}

/** 「2026-11」「2026/11」「2026年11月」・日付 → 'yyyy-MM'。読めなければ空 */
function ymOf_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  const m = String(v).trim().match(/^(\d{4})\s*[-\/年.]\s*(\d{1,2})/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '';
  return m[1] + '-' + ('0' + Number(m[2])).slice(-2);
}

/** 月ごとの組 {区域ID: 何か月目}。シートがなければ（前の版のまま）空 */
function readPlanGroups_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('月の組');
  if (!sh) return {};
  const T = readTable_('月の組');
  const c = T.col;
  const out = {};
  T.rows.forEach(r => {
    const tid = String(r[c['区域ID']] || '').trim();
    const n = Number(r[c['組']]);
    if (tid && n >= 1 && n <= APT_MONTHS[1] && Math.round(n) === n) out[tid] = n;
  });
  return out;
}

/**
 * 月ごとの組を保存する（上位管理者）。groups: {区域ID: 1〜6}、nos: {区域ID: 区域番号}（シートを読みやすくするため）、how: 作り方の説明
 *   frame: 'b' なら集合住宅の組（{建物ID: 1〜12}。0.11.0）。戸建てと集合住宅は別枠で、片方を保存してももう片方は変わらない
 *   シートは全部書き直す（設定のようなもの。変えた記録は「変更の記録」に残す）
 */
function apiSavePlan_(user, req) {
  needTop_(user);
  const frame = req.frame === 'b' ? 'b' : 'h';
  const groups = req.groups || {};
  const nos = req.nos || {};
  const pl = planOf_(settings_());
  const max = frame === 'b' ? pl.aptMonths : pl.months;
  const re = frame === 'b' ? /^AP\d{1,6}$/ : /^T\d{1,6}$/;
  const mine = id => (frame === 'b' ? /^AP/ : /^T/).test(id);
  const rows = [];
  const now = new Date();
  Object.keys(groups).sort().forEach(tid => {
    if (!re.test(tid)) throw err_('BAD_TERRITORY', (frame === 'b' ? '建物' : '区域') + 'が正しくありません：' + tid);
    const n = Number(groups[tid]);
    if (!(n >= 1 && n <= max && Math.round(n) === n)) throw err_('BAD_VALUE', '組は1〜' + max + 'にしてください（' + (nos[tid] || tid) + '）');
    rows.push([tid, String(nos[tid] || ''), n, now, user.name]);
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('月の組');
    const head = SHEETS['月の組'];
    if (!sh) {
      sh = ss.insertSheet('月の組');
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // もう片方の枠（戸建て／集合住宅）の行は、そのまま残す
    const keep = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().filter(r => String(r[0] || '').trim() && !mine(String(r[0]).trim())) : [];
    keep.forEach(r => rows.push(r));
    const old = Math.max(0, sh.getLastRow() - 1);
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    if (old > rows.length) sh.getRange(rows.length + 2, 1, old - rows.length, head.length).setValues(new Array(old - rows.length).fill(0).map(() => head.map(() => '')));
  } finally {
    lock.releaseLock();
  }
  const per = {};
  rows.filter(r => mine(String(r[0]))).forEach(r => { per[r[2]] = (per[r[2]] || 0) + 1; });
  log_(user, '月ごとの組' + (frame === 'b' ? '（集合住宅）' : ''), String(req.how || '保存') + '：' + Object.keys(per).sort((a, b) => a - b).map(k => k + 'か月目 ' + per[k]).join('・'));
  return { ok: true, saved: rows.filter(r => mine(String(r[0]))).length };
}

/* ============================== まとめて印刷（0.10.0） ============================== */

/**
 * 印刷に使うもの（上位管理者）：
 *   houses：戸建ての区域ごとの「訪問しない家」（最後の記録が拒否） {区域ID: [{h: 家ID, at: 日付}]}
 *   rooms：集合住宅の部屋の一覧（拒否の印つき） {建物ID: [{id, entrance, floor, no, refused, at}]}
 */
function apiPrintData_(user, req) {
  needTop_(user);
  const last = {};
  const V = readTable_('訪問記録');
  const vc = V.col;
  V.rows.forEach(r => {
    if (!r[vc['記録ID']] || truthy_(r[vc['無効']])) return;
    const res = String(r[vc['結果']]);
    if (res !== '拒否' && res !== '拒否解除') return;
    const rid = String(r[vc['部屋ID']] || '');
    const hid = String(r[vc['家ID']] || '');
    const key = rid ? 'r:' + rid : hid ? 'h:' + hid : '';
    if (!key) return;
    const at = toDate_(r[vc['訪問日時']]);
    if (!last[key] || last[key].at <= at) last[key] = { res: res, at: at, tid: String(r[vc['区域ID']] || '') };
  });
  // 家の拒否は家ごと（画面が今の区切りで区域に分ける）。部屋の拒否は部屋ごと
  const houses = [];
  const roomRef = {};
  Object.keys(last).forEach(k => {
    const x = last[k];
    if (x.res !== '拒否') return;
    if (k.indexOf('h:') === 0) houses.push({ h: k.slice(2), at: fmtDate_(x.at), tid: x.tid });
    else roomRef[k.slice(2)] = fmtDate_(x.at);
  });
  const R = readRooms_();
  const rooms = {};
  Object.keys(R).forEach(bid => {
    rooms[bid] = R[bid].map(x => ({ id: x.id, entrance: x.entrance, floor: x.floor, no: x.no, refused: !!roomRef[x.id], at: roomRef[x.id] || '' }));
  });
  return { ok: true, today: fmtDate_(new Date()), houses: houses, rooms: rooms };
}

/* ============================== 代理入力（0.11.0） ============================== */

/**
 * 代理入力に出す配布（管理者）：今配っている分と、返ってきてから days 日（既定200日）のうちの分。
 *   人に配った分だけ（グループの手持ちはのぞく）。責任者・副責任者は自分のグループの分だけ。
 *   recs：記録のある家・部屋の数、proxy：代理入力した記録の数
 */
function apiProxyList_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが使えます');
  const users = readUsers_();
  const D = readTable_('配布');
  const dc = D.col;
  const now = new Date();
  autoCollect_(D, now, false);
  const since = fmtDate_(addDays_(now, -clampInt_(req.days, 7, 800, 200)));
  const list = [];
  const want = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    if (String(r[dc['種別']]) === KIND_HOLD || !r[dc['利用者ID']]) return;
    if (r[dc['返却日']] && fmtDate_(r[dc['返却日']]) < since) return;
    if (!canHandleDist_(user, users, r, dc)) return;
    const o = Object.assign(distObj_(r, dc), { recs: 0, proxy: 0 });
    list.push(o);
    want[o.distId] = o;
  });
  const V = readTable_('訪問記録');
  const vc = V.col;
  const seen = {};
  V.rows.forEach(r => {
    const o = want[String(r[vc['配布ID']])];
    if (!o || !r[vc['記録ID']] || truthy_(r[vc['無効']]) || String(r[vc['結果']]) === '取り消し') return;
    const k = o.distId + '|' + (r[vc['部屋ID']] || r[vc['家ID']] || 'b:' + r[vc['ブロックID']]);
    if (!seen[k]) { seen[k] = true; o.recs++; }
    if (r[vc['入れた人']]) o.proxy++;
  });
  if (list.some(d => d.rooms && d.rooms.length)) {
    const no = {};
    const RR = readRooms_(true);
    Object.keys(RR).forEach(bid => RR[bid].forEach(x => { no[x.id] = x.no; }));
    list.forEach(d => { if (d.rooms && d.rooms.length) d.roomNos = d.rooms.map(x => no[x] || x); });
  }
  list.sort((a, b) => ((a.returnedAt ? 1 : 0) - (b.returnedAt ? 1 : 0)) || (a.returnedAt < b.returnedAt ? 1 : a.returnedAt > b.returnedAt ? -1 : 0) || (a.distributedAt < b.distributedAt ? 1 : a.distributedAt > b.distributedAt ? -1 : 0));
  return { ok: true, today: fmtDate_(now), dists: list.slice(0, 800) };
}

/** 1つの配布の記録（代理入力の画面）。records：その配布の記録、refused：その区域・建物で今「拒否」の家・部屋、rooms：建物の部屋 */
function apiDistRecords_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが使えます');
  const users = readUsers_();
  const D = readTable_('配布');
  const dc = D.col;
  const r = D.rows.find(x => String(x[dc['配布ID']]) === String(req.distId || ''));
  if (!r || truthy_(r[dc['無効']])) throw err_('NO_DIST', 'この配布が見つかりません');
  if (!canHandleDist_(user, users, r, dc)) throw err_('NOT_YOUR_GROUP', '自分のグループの配布だけ扱えます');
  const dist = distObj_(r, dc);
  const tid = dist.territoryId;
  const V = readTable_('訪問記録');
  const vc = V.col;
  const records = [];
  const last = {};
  V.rows.forEach(x => {
    if (!x[vc['記録ID']] || truthy_(x[vc['無効']])) return;
    const res = String(x[vc['結果']]);
    if (res === '取り消し') return;
    if (String(x[vc['配布ID']]) === dist.distId) records.push(recObj_(x, vc));
    if (res !== '拒否' && res !== '拒否解除') return;
    // 部屋の拒否はその建物の分だけ。家の拒否は全部（画面が、今の区切りでこの区域の家だけに絞る）
    if (x[vc['部屋ID']] && String(x[vc['区域ID']]) !== tid) return;
    const k = String(x[vc['部屋ID']] || x[vc['家ID']] || '');
    if (!k) return;
    const at = toDate_(x[vc['訪問日時']]).getTime();
    if (!last[k] || last[k].at <= at) last[k] = { res: res, at: at, dist: String(x[vc['配布ID']]) };
  });
  // この配布の記録の「拒否」は、記録の画面で見えるので、ほかの配布での拒否だけを「前からの拒否」にする
  const refused = Object.keys(last).filter(k => last[k].res === '拒否' && last[k].dist !== dist.distId);
  const B = readBuildings_();
  const rooms = B[tid] ? (readRooms_()[tid] || []) : [];
  return { ok: true, today: fmtDate_(new Date()), dist: dist, records: records, refused: refused, rooms: rooms, building: B[tid] || null };
}

/**
 * 代理入力（管理者）：紙に書かれた記録を、日付を指定して入れる。
 *   req: {distId, at（回った日 'yyyy-MM-dd'）, items: [{houseId | roomId | blockId, result（会えた・不在・拒否・済・拒否解除・消す）}]}
 *   記録はその配布を持っている人の記録として入れ、「入れた人」に自分の名前を残す。
 *   同じ家・部屋にもう記録があれば、それを取り消してから入れる（「消す」は取り消すだけ）。
 *   回った日は、配った日から（返していれば返した日、まだなら今日）までの日だけ
 */
function apiProxyVisits_(user, req) {
  if (!isAdmin_(user)) throw err_('ADMIN_ONLY', '管理者だけが使えます');
  const items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) return { ok: true, added: 0, cleared: 0 };
  if (items.length > 400) throw err_('TOO_MANY', '一度に入れられるのは400件までです');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const users = readUsers_();
    const D = readTable_('配布');
    const dc = D.col;
    const r = D.rows.find(x => String(x[dc['配布ID']]) === String(req.distId || ''));
    if (!r || truthy_(r[dc['無効']])) throw err_('NO_DIST', 'この配布が見つかりません');
    if (!canHandleDist_(user, users, r, dc)) throw err_('NOT_YOUR_GROUP', '自分のグループの配布だけ扱えます');
    if (String(r[dc['種別']]) === KIND_HOLD || !r[dc['利用者ID']]) throw err_('NO_PERSON', 'グループの手持ちには記録を入れられません。メンバーに配ってから入れてください');
    const now = new Date();
    const day = checkDay_(req.at, now, '回った日');
    const from = fmtDate_(r[dc['配布日']]);
    const to = r[dc['返却日']] ? fmtDate_(r[dc['返却日']]) : fmtDate_(now);
    if (day < from || day > to) throw err_('BAD_DATE', '回った日は、配った日（' + from + '）から' + (r[dc['返却日']] ? '返した日（' + to + '）' : '今日') + 'までの日にしてください');
    const distId = String(r[dc['配布ID']]);
    const tid = String(r[dc['区域ID']]);
    const isB = !!readBuildings_()[tid];
    const roomOk = {};
    if (isB) (readRooms_(true)[tid] || []).forEach(x => { roomOk[x.id] = true; });
    const V = readTable_('訪問記録');
    const vc = V.col;
    const keyOf = (h, rm, b) => (rm ? 'r:' + rm : h ? 'h:' + h : 'b:' + b);
    const existing = {};
    V.rows.forEach((x, j) => {
      if (String(x[vc['配布ID']]) !== distId || !x[vc['記録ID']] || truthy_(x[vc['無効']]) || String(x[vc['結果']]) === '取り消し') return;
      const k = keyOf(String(x[vc['家ID']] || ''), String(x[vc['部屋ID']] || ''), String(x[vc['ブロックID']] || ''));
      (existing[k] = existing[k] || []).push({ r: x, row: j + 2 });
    });
    const base = day === fmtDate_(now) ? now : dayAt_(day);
    const stamp = Utilities.formatDate(now, TZ, 'yyMMddHHmmss');
    const newV = [];
    const voidRows = [];
    const done = {};
    let added = 0, cleared = 0;
    items.forEach((it, n) => {
      const res = String(it.result || '');
      if (RESULTS.indexOf(res) < 0 && res !== '消す') throw err_('BAD_RESULT', '結果が正しくありません');
      const houseId = String(it.houseId || ''), roomId = String(it.roomId || ''), blockId = String(it.blockId || '');
      if (!houseId && !roomId && !blockId) throw err_('NO_TARGET', '家・部屋・ブロックのどれかを選んでください');
      [houseId, roomId, blockId].forEach(v => { if (v && !/^[A-Za-z0-9_#.:-]{1,60}$/.test(v)) throw err_('BAD_TARGET', '家・部屋の番号が正しくありません'); });
      if (roomId && !roomOk[roomId]) throw err_('NO_ROOM', 'この建物の部屋ではありません（' + roomId + '）');
      if (houseId && isB) throw err_('BAD_TARGET', '集合住宅には部屋で入れてください');
      const k = keyOf(houseId, roomId, blockId);
      if (done[k]) throw err_('TWICE', '同じ家・部屋が2回あります');
      done[k] = true;
      (existing[k] || []).forEach(e => {
        if (truthy_(e.r[vc['無効']])) return;
        e.r[vc['無効']] = true;
        voidRows.push(e.row);
        newV.push(['P' + stamp + '-' + shortId_(), distId, tid, e.r[vc['家ID']], e.r[vc['ブロックID']], '取り消し', now, user.id, user.name, now, false, String(e.r[vc['記録ID']]), e.r[vc['部屋ID']], user.name]);
        cleared++;
      });
      if (res === '消す') return;
      newV.push(['P' + stamp + '-' + shortId_(), distId, tid, houseId, blockId, res, new Date(base.getTime() + n * 1000), String(r[dc['利用者ID']]), String(r[dc['名前']]),
        now, false, '', roomId, user.name]);
      added++;
    });
    appendRows_(V, newV);
    voidRows.forEach(row => V.sh.getRange(row, vc['無効'] + 1).setValue(true));
    log_(user, '代理入力 ' + r[dc['区域番号']], r[dc['名前']] + 'さんの記録 ' + added + '件（' + day + '）' + (cleared ? '・取り消し ' + cleared + '件' : ''));
    return { ok: true, added: added, cleared: cleared };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 配った日・返した日を直す（上位管理者。台帳と合わせるとき・S-13 を正しくするとき）。req: {distId, from, to}
 *   返していない配布は、配った日だけ直せる。ほかの配布と期間が重なる日は断る
 */
function apiFixDist_(user, req) {
  needTop_(user);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const D = readTable_('配布');
    const dc = D.col;
    const i = D.rows.findIndex(x => String(x[dc['配布ID']]) === String(req.distId || ''));
    if (i < 0 || truthy_(D.rows[i][dc['無効']])) throw err_('NO_DIST', 'この配布が見つかりません');
    const r = D.rows[i];
    if (String(r[dc['種別']]) === KIND_HOLD) throw err_('HOLD', 'グループの手持ちの日付は直せません');
    const now = new Date();
    const from = checkDay_(req.from, now, '配った日');
    const returned = !!r[dc['返却日']];
    const to = returned ? checkDay_(req.to, now, '返した日') : '';
    if (to && to < from) throw err_('BAD_DATE', '返した日が、配った日より前です');
    const tid = String(r[dc['区域ID']]);
    const cl = overlapRow_(D, tid, roomsOf_(r, dc), from, to, String(r[dc['配布ID']]));
    if (cl) throw err_('OVERLAP', 'その期間は' + cl[dc['名前']] + (cl[dc['利用者ID']] ? 'さん' : '') + 'が持っていました（' + fmtDate_(cl[dc['配布日']]) + '〜' + (cl[dc['返却日']] ? fmtDate_(cl[dc['返却日']]) : '配布中') + '）');
    const oldF = fmtDate_(r[dc['配布日']]), oldT = fmtDate_(r[dc['返却日']]);
    const row = i + 2;
    if (from !== oldF) { r[dc['配布日']] = dayAt_(from); D.sh.getRange(row, dc['配布日'] + 1).setValue(r[dc['配布日']]); }
    if (returned && to !== oldT) { r[dc['返却日']] = dayAt_(to); D.sh.getRange(row, dc['返却日'] + 1).setValue(r[dc['返却日']]); }
    if (from !== oldF || (returned && to !== oldT)) {
      const note = '日付を直した（' + Utilities.formatDate(now, TZ, 'MM/dd') + ' ' + user.name + '）';
      r[dc['メモ']] = r[dc['メモ']] ? String(r[dc['メモ']]) + ' / ' + note : note;
      D.sh.getRange(row, dc['メモ'] + 1).setValue(r[dc['メモ']]);
      log_(user, '配布 ' + r[dc['配布ID']], r[dc['区域番号']] + '（' + r[dc['名前']] + '）：配った日 ' + oldF + ' → ' + from + (returned ? '、返した日 ' + oldT + ' → ' + to : ''));
    }
    return { ok: true, dist: distObj_(r, dc) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== S-13（区域割り当ての記録。0.11.0） ============================== */

/**
 * S-13 に書く中身（上位管理者）。year：奉仕年度（2027 なら 2026年9月1日〜2027年8月31日。既定は今の年度）
 *   terrs：戸建ての区域ごとに、その年度の割り当て（ふつうの配布。前の年度から持ち越した分も）と、年度の前に最後に完了した日
 *   buildings：集合住宅ごとに、その年度の巡回（始めた日＝割り当てた日付、全部の部屋を回り終えた日＝完了した日付）
 *   どちらも「完了した日付」は返した日（自動回収も含む。回った月と同じ数え方）
 */
function apiS13_(user, req) {
  needTop_(user);
  const now = new Date();
  const y0 = Number(Utilities.formatDate(now, TZ, 'yyyy'));
  const cur = Number(Utilities.formatDate(now, TZ, 'MM')) >= 9 ? y0 + 1 : y0;
  const year = clampInt_(req.year, 2000, cur + 1, cur);
  const from = (year - 1) + '-09-01', to = year + '-08-31';
  const D = readTable_('配布');
  const dc = D.col;
  autoCollect_(D, now, false);
  const B = readBuildings_();
  const terrs = {};
  D.rows.forEach(r => {
    if (!r[dc['配布ID']] || truthy_(r[dc['無効']])) return;
    const tid = String(r[dc['区域ID']]);
    if (B[tid] || String(r[dc['種別']] || KIND_NORMAL) !== KIND_NORMAL) return;
    const f = fmtDate_(r[dc['配布日']]);
    const t = r[dc['返却日']] ? fmtDate_(r[dc['返却日']]) : '';
    const x = terrs[tid] || (terrs[tid] = { id: tid, no: String(r[dc['区域番号']]), last: '', items: [] });
    if (t && t < from) { if (t > x.last) x.last = t; return; }
    if (f > to) return;
    x.items.push({ name: String(r[dc['名前']] || ''), from: f, to: t && t <= to ? t : '', how: String(r[dc['終わり方']] || '') });
  });
  Object.keys(terrs).forEach(k => terrs[k].items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)));
  const cyc = buildingCycles_(D, B, readRooms_(), roomRefusals_());
  const names = list => (list.length > 2 ? list.slice(0, 2).join('・') + 'ほか' + (list.length - 2) + '人' : list.join('・'));
  const bldgs = Object.keys(B).map(id => {
    const c = cyc[id];
    let last = '';
    const items = [];
    c.rounds.forEach(rd => {
      if (rd.end < from) { if (rd.end > last) last = rd.end; return; }
      if (rd.start > to) return;
      items.push({ name: names(rd.people), from: rd.start, to: rd.end <= to ? rd.end : '' });
    });
    if (c.cur.start && c.cur.start <= to) items.push({ name: names(c.cur.people || []), from: c.cur.start, to: '' });
    return { id: id, no: B[id].no, name: B[id].name, last: last, items: items };
  });
  return { ok: true, year: year, from: from, to: to, today: fmtDate_(now), terrs: Object.keys(terrs).map(k => terrs[k]), buildings: bldgs };
}

/* ============================== お知らせ（0.11.0） ============================== */

/** 今出すお知らせ {text, until, at}。書いていない・期限を過ぎたなら null */
function noticeOf_(st, now) {
  const text = String(st['お知らせ'] || '').trim();
  if (!text) return null;
  const until = fmtDate_(st['お知らせの期限']);
  if (until && until < fmtDate_(now)) return null;
  return { text: text, until: until, at: fmtDate_(st['お知らせを出した日']) };
}

/** お知らせを書く・消す（上位管理者）。req: {text（300字まで。空なら消す）, until（'yyyy-MM-dd'。空なら消すまで）} */
function apiSaveNotice_(user, req) {
  needTop_(user);
  const text = String(req.text || '').replace(/\r\n?/g, '\n').trim();
  if (text.length > 300) throw err_('TOO_LONG', 'お知らせは300字までにしてください');
  const now = new Date();
  let until = '';
  if (text && req.until) {
    until = String(req.until);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw err_('BAD_DATE', '期限の書き方が正しくありません');
    if (until < fmtDate_(now)) throw err_('BAD_DATE', '期限が今日より前です');
  }
  setSetting_('お知らせ', text);
  setSetting_('お知らせの期限', until);
  setSetting_('お知らせを出した日', text ? fmtDate_(now) : '');
  log_(user, 'お知らせ', text ? text.slice(0, 80) + (until ? '（' + until + 'まで）' : '') : '消した');
  return { ok: true, notice: noticeOf_(settings_(), now) };
}

/* ============================== 毎晩のバックアップ（0.11.0） ============================== */
/*
 * 全部のシートを、1つの小さな zip（シートごとの CSV と、戻すための data.json）にまとめて、
 * Google ドライブの「区域訪問管理のバックアップ」フォルダに残す。
 *   ・前のバックアップから何も変わっていない日は作らない
 *   ・残すのは、この7日は毎日・6週までは週に1つ・1年までは月に1つ（いつでも新しい3つは残す）。ほかはごみ箱へ
 *   ・戻すときは、メニューの「バックアップから戻す」で新しいスプレッドシートを作る（今のスプレッドシートは変えない）
 */
function nightlyBackup() { return backup_(false); }

/** メニューから：今すぐバックアップを作る */
function backupNow() {
  const r = backup_(true);
  try { SpreadsheetApp.getUi().alert('バックアップを作りました：' + r.made + '（' + Math.max(1, Math.round(r.size / 1024)) + 'KB）。残っているバックアップ ' + r.files + '個'); } catch (e) { /* 自動実行のとき */ }
  return r;
}

function apiBackupNow_(user) {
  needTop_(user);
  const r = backup_(true);
  return Object.assign({ ok: true }, r, { info: backupInfo_(settings_()) });
}

function backupStatus_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('backup') || '{}') || {}; } catch (e) { return {}; }
}

/** 管理の画面に出すバックアップの様子 */
function backupInfo_(st) {
  const s = backupStatus_();
  let trigger = null;
  try { trigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'nightlyBackup'); } catch (e) { trigger = null; }
  return { on: String(st['毎晩のバックアップ'] || 'する') !== 'しない', at: s.at || '', size: s.size || 0, files: s.files || 0, total: s.total || 0,
    name: s.name || '', error: s.error || '', checked: s.checked || '', skipped: s.skipped || '', trigger: trigger };
}

function backup_(force) {
  const st = settings_();
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const save = o => props.setProperty('backup', JSON.stringify(Object.assign(backupStatus_(), o)));
  if (!force && String(st['毎晩のバックアップ'] || 'する') === 'しない') { save({ checked: now.toISOString(), skipped: 'しない設定' }); return { skipped: 'off' }; }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const prev = backupStatus_();
    const name = BACKUP_PREFIX + fmtDate_(now) + '.zip';
    const data = { app: '区域訪問管理', version: APP_VERSION, made: now.toISOString(), sheets: {} };
    const blobs = [];
    Object.keys(SHEETS).concat(['取り込み']).forEach((nm, i) => {
      const sh = ss.getSheetByName(nm);
      if (!sh) return;
      const lr = sh.getLastRow(), lc = sh.getLastColumn();
      const vals = lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
      data.sheets[nm] = vals;
      blobs.push(Utilities.newBlob(csvOf_(vals), 'text/csv', ('0' + (i + 1)).slice(-2) + '_' + nm + '.csv'));
    });
    const keepDates = function (k, v) { const raw = this[k]; return isDate_(raw) ? { $d: raw.toISOString() } : v; };
    // 前のバックアップと中身が同じなら作らない（中身のしるしで比べる）
    const digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data.sheets, keepDates), Utilities.Charset.UTF_8));
    if (!force && prev.at && prev.digest === digest) { save({ checked: now.toISOString(), skipped: '前のバックアップから変わっていない' }); return { skipped: 'same' }; }
    blobs.push(Utilities.newBlob(JSON.stringify(data, keepDates), 'application/json', 'data.json'));
    blobs.push(Utilities.newBlob(['区域訪問管理のバックアップ（' + fmtDate_(now) + '・版 ' + APP_VERSION + '）', '',
      '・01_設定.csv など：シートごとの中身（Excel やスプレッドシートで開けます）',
      '・data.json：戻すためのデータ。スプレッドシートのメニュー［区域アプリ］→［バックアップから戻す］で、新しいスプレッドシートに戻せます', '',
      '利用カードの鍵など、会員の情報が入っています。共有アカウントの外に出さないでください。'].join('\r\n'), 'text/plain', 'はじめに読む.txt'));
    const zip = Utilities.zip(blobs, name);
    const folder = backupFolder_();
    const same = folder.getFilesByName(name);
    while (same.hasNext()) same.next().setTrashed(true);
    const file = folder.createFile(zip);
    const kept = rotateBackups_(folder, now);
    const size = file.getSize();
    save({ at: now.toISOString(), digest: digest, name: name, size: size, files: kept.n, total: kept.size, error: '', checked: now.toISOString(), skipped: '' });
    return { made: name, size: size, files: kept.n, total: kept.size, removed: kept.removed };
  } catch (e) {
    save({ error: String((e && e.message) || e), checked: now.toISOString() });
    throw err_('BACKUP', 'バックアップを作れませんでした（' + ((e && e.message) || e) + '）。スプレッドシートのメニュー［区域アプリ］→［初めの準備］を実行して、Google ドライブの許可を出してください');
  }
}

/** バックアップのフォルダ（なければ作る） */
function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('backup.folder');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 消されていた */ } }
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  props.setProperty('backup.folder', f.getId());
  return f;
}

/** バックアップの一覧（新しい順）[{f, day, size}] */
function backupFiles_(folder) {
  const list = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = String(f.getName()).match(/^区域訪問管理_(\d{4}-\d{2}-\d{2})\.zip$/);
    if (m && !f.isTrashed()) list.push({ f: f, day: m[1], size: f.getSize() });
  }
  return list.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** 古いバックアップを減らす：7日のうちは毎日、6週のうちは週に1つ、1年のうちは月に1つ。新しい3つはいつも残す */
function rotateBackups_(folder, now) {
  const list = backupFiles_(folder);
  const today = fmtDate_(now);
  const keep = new Set();
  const weeks = {}, months = {};
  const ageOf = day => Math.round((parseYmd_(today) - parseYmd_(day)) / 864e5);
  const weekOf = day => { const d = parseYmd_(day); return fmtDate_(addDays_(d, -((d.getDay() + 6) % 7))); };
  list.forEach((x, i) => {
    const age = ageOf(x.day), wk = weekOf(x.day), mo = x.day.slice(0, 7);
    if (i < 3 || age < 7) { keep.add(x); weeks[wk] = true; months[mo] = true; return; }
    if (age < 42 && !weeks[wk]) { keep.add(x); weeks[wk] = true; months[mo] = true; return; }
    if (age < 400 && !months[mo]) { keep.add(x); months[mo] = true; }
  });
  let n = 0, size = 0, removed = 0;
  list.forEach(x => { if (keep.has(x)) { n++; size += x.size; } else { x.f.setTrashed(true); removed++; } });
  return { n: n, size: size, removed: removed };
}

/** 表を CSV にする（Excel でも文字化けしないよう、最初に BOM を付ける） */
function csvOf_(vals) {
  const cell = v => {
    if (isDate_(v)) v = Utilities.formatDate(v, TZ, 'yyyy/MM/dd HH:mm:ss');
    else if (v === true || v === false) v = v ? 'TRUE' : 'FALSE';
    const t = String(v === null || v === undefined ? '' : v);
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return '﻿' + vals.map(r => r.map(cell).join(',')).join('\r\n');
}

/** メニューから：バックアップを、新しいスプレッドシートに戻す（今のスプレッドシートは変えない） */
function restoreBackup() {
  const ui = SpreadsheetApp.getUi();
  const list = backupFiles_(backupFolder_());
  if (!list.length) { ui.alert('バックアップがまだありません'); return; }
  const r = ui.prompt('バックアップから戻す', '戻す日付（例：' + list[0].day + '）。空なら最新（' + list[0].day + '）。\n今のスプレッドシートは変えずに、新しいスプレッドシートを作ります。\nある日付：' + list.slice(0, 12).map(x => x.day).join('、'), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const want = r.getResponseText().trim() || list[0].day;
  const x = list.find(f => f.day === want);
  if (!x) { ui.alert(want + ' のバックアップはありません'); return; }
  const res = restoreFrom_(x.f.getBlob(), want);
  ui.alert('新しいスプレッドシートを作りました（' + res.sheets + 'シート）：\n' + res.url);
}

/** バックアップの zip から、新しいスプレッドシートを作る。文字だけの列は文字のまま（「0012」「2026-11」が数や日付に変わらないように） */
function restoreFrom_(zipBlob, day) {
  const parts = Utilities.unzip(zipBlob);
  const j = parts.find(b => b.getName() === 'data.json');
  if (!j) throw err_('BAD_BACKUP', 'バックアップの中に data.json がありません');
  const data = JSON.parse(j.getDataAsString('UTF-8'), (k, v) => (v && typeof v === 'object' && typeof v.$d === 'string' ? new Date(v.$d) : v));
  const ss = SpreadsheetApp.create('区域訪問管理（' + day + ' のバックアップから）');
  const first = ss.getSheets()[0];
  let n = 0;
  Object.keys(data.sheets).forEach(name => {
    const vals = data.sheets[name] || [];
    const sh = n === 0 ? first.setName(name) : ss.insertSheet(name);
    n++;
    if (!vals.length) return;
    const w = Math.max.apply(null, vals.map(r => r.length));
    const rows = vals.map(r => r.concat(new Array(w - r.length).fill('')));
    for (let c = 0; c < w; c++) {
      if (rows.slice(1).some(r => typeof r[c] === 'string' && r[c] !== '')) sh.getRange(1, c + 1, rows.length, 1).setNumberFormat('@');
    }
    sh.getRange(1, 1, rows.length, w).setValues(rows);
    sh.setFrozenRows(1);
  });
  return { url: ss.getUrl(), id: ss.getId(), sheets: n };
}

function apiLogCompare_(user, req) {
  needTop_(user);
  log_(user, '国土地理院と比べた', String(req.text || '').slice(0, 300));
  return { ok: true };
}

function editObj_(r) {
  return {
    id: String(r[0]), at: fmtDate_(r[1]), type: String(r[2]), houseId: String(r[3] || ''), territoryId: String(r[4] || ''), blockId: String(r[5] || ''),
    lat: r[6] === '' || r[6] === null ? null : Number(r[6]), lon: r[7] === '' || r[7] === null ? null : Number(r[7]),
    note: String(r[8] || ''), by: String(r[9] || ''), off: truthy_(r[10]), reportId: String(r[11] || ''),
  };
}

/** 家の手直し。all でなければ、地図に効くもの（有効な「足す」「動かす」）だけ */
function readHouseEdits_(all) {
  return readTable_('家の手直し').rows.filter(r => r[0]).map(editObj_)
    .filter(x => all || (!x.off && (x.type === '足す' || x.type === '動かす')));
}

/* ============================== 準備（スプレッドシートのメニュー） ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('区域アプリ')
    .addItem('初めの準備（シートを作る・そろえる）', 'setup')
    .addItem('鍵がない人に鍵を作る', 'fillKeys')
    .addItem('マンションマスタを取り込む（「取り込み」シートから）', 'importMansionMaster')
    .addItem('完全回収日を過ぎた区域を今すぐ回収する', 'dailyCollect')
    .addSeparator()
    .addItem('バックアップを今すぐ作る', 'backupNow')
    .addItem('バックアップから戻す（新しいスプレッドシートに）', 'restoreBackup')
    .addToUi();
}

/** シートを作り、既定の設定・6グループ・最初の上位管理者を入れる。何度実行しても壊れない（新しい列も足す） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // 新しい版で足した列の見出しを、右側に足す。名前を変えた見出しは直す
      const have = sh.getRange(1, 1, 1, head.length).getValues()[0];
      const ren = RENAMED_HEADERS[name] || {};
      head.forEach((h, i) => {
        if (have[i] === '' || have[i] === null || ren[have[i]] === h) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold');
      });
    }
  });

  const S = ss.getSheetByName('設定');
  const have = {};
  if (S.getLastRow() > 1) {
    S.getRange(2, 1, S.getLastRow() - 1, 1).getValues().forEach((r, i) => {
      const nn = RENAMED_SETTINGS[r[0]];
      if (nn) {
        S.getRange(i + 2, 1).setValue(nn);
        const d = DEFAULT_SETTINGS.find(x => x[0] === nn);
        if (d) S.getRange(i + 2, 3).setValue(d[2]);
        have[nn] = true;
      } else have[r[0]] = true;
    });
  }
  const add = DEFAULT_SETTINGS.filter(r => !have[r[0]]);
  if (add.length) S.getRange(S.getLastRow() + 1, 1, add.length, 3).setValues(add);
  // 文字の設定（「2026-11」「100,100,…」など）は、日付や数に変わらないように文字のまま
  S.getRange(2, 1, Math.max(1, S.getLastRow() - 1), 1).getValues().forEach((r, i) => {
    if (TEXT_SETTINGS.indexOf(String(r[0])) >= 0) S.getRange(i + 2, 2).setNumberFormat('@');
  });

  // 回り方：シートが空なら、既定の2つ（マンション訪問・夕方のアパート）を入れる。前の版の設定（部屋の数・日数）を引き継ぐ
  const RS = ss.getSheetByName('回り方');
  if (RS.getLastRow() < 2) {
    const st0 = settings_();
    const per = clampInt_(st0['1人に割り振る部屋の数'], 1, 20, 5);
    const cycle = clampInt_(st0['マンションの部屋を回り直すまでの日数'], 0, 365, 90);
    const rows = DEFAULT_ROUTES.map(r => { const x = r.slice(); x[3] = per; x[4] = cycle; return x; });
    RS.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  if (S.getLastRow() > 1) {
    S.getRange(2, 1, S.getLastRow() - 1, 1).getValues().forEach((r, i) => {
      if (MOVED_SETTINGS.indexOf(String(r[0])) >= 0) S.getRange(i + 2, 3).setValue('（0.5.0から使っていません。「回り方」シートで、回り方ごとに決めます）');
    });
  }
  ROUTE_CACHE_ = null;

  const G = ss.getSheetByName('グループ');
  if (G.getLastRow() < 2) {
    G.getRange(2, 1, 6, 6).setValues([1, 2, 3, 4, 5, 6].map(n => ['G' + n, '第' + n + 'グループ', n, '', '', true]));
  }

  const U = ss.getSheetByName('利用者');
  // 鍵と部屋番号は文字として扱う（数字だけのものが数値に変わらないように）
  U.getRange(1, SHEETS['利用者'].indexOf('鍵') + 1, U.getMaxRows(), 1).setNumberFormat('@');
  const P = ss.getSheetByName('部屋');
  P.getRange(1, SHEETS['部屋'].indexOf('部屋番号') + 1, P.getMaxRows(), 1).setNumberFormat('@');
  if (U.getLastRow() < 2) {
    U.getRange(2, 1, 1, 10).setValues([['U001', '上位管理者（仮）', '', 'G1', '上位管理者', newKey_(), true, new Date(),
      '名前を自分の名前に直してください', '']]);
  }
  fillKeys();
  fillForcedDates_();
  installTrigger_();
  const first = readUsers_()['U001'];
  if (first) Logger.log('最初の上位管理者の鍵：' + fmtKey_(first.key) + '（利用者シートにもあります）');
  return { ok: true };
}

/**
 * 前の版から上げたとき：配っている区域で完全回収日が空のものに、日付を付ける。
 * 回収日＋設定の日数。ただし今日から数えて同じ日数より前にはしない（上げた日にいきなり回収しない）
 */
function fillForcedDates_() {
  const st = settings_();
  const D = readTable_('配布');
  const c = D.col;
  const now = new Date();
  let n = 0;
  D.rows.forEach((r, i) => {
    if (!r[c['配布ID']] || truthy_(r[c['無効']]) || r[c['返却日']] || String(r[c['種別']]) === KIND_HOLD) return;
    if (r[c['完全回収日']] !== '' && r[c['完全回収日']] !== null) return;
    if (!isDate_(r[c['回収日']])) return;
    const days = r[c['集まりID']] ? numSetting_(st, '集まりの完全回収までの日数', 2) : numSetting_(st, '完全回収までの日数', 14);
    let f = addDays_(r[c['回収日']], days);
    const min = addDays_(endOfDay_(now), days);
    if (f < min) f = min;
    D.sh.getRange(i + 2, c['完全回収日'] + 1).setValue(f);
    n++;
  });
  if (n) log_({ name: '初めの準備' }, '完全回収日', '配っている' + n + '枚に完全回収日を付けた');
  return n;
}

/** 毎日の自動回収（午前3時ごろ）と、毎晩のバックアップ（午前2時ごろ。0.11.0）を登録する。もうあれば何もしない */
function installTrigger_() {
  try {
    if (typeof ScriptApp === 'undefined') return false;
    const ts = ScriptApp.getProjectTriggers();
    if (!ts.some(t => t.getHandlerFunction() === 'dailyCollect')) ScriptApp.newTrigger('dailyCollect').timeBased().everyDays(1).atHour(3).create();
    if (!ts.some(t => t.getHandlerFunction() === 'nightlyBackup')) ScriptApp.newTrigger('nightlyBackup').timeBased().everyDays(1).atHour(2).create();
    // Google ドライブの許可を、ここで出してもらう（毎晩のバックアップのフォルダを作る）
    try { if (typeof DriveApp !== 'undefined') backupFolder_(); } catch (e) { Logger.log('Google ドライブの許可がまだです：' + e); }
    return true;
  } catch (e) {
    Logger.log('毎日の自動回収を登録できませんでした：' + e);
    return false;
  }
}

/** 利用者シートで、IDや鍵が空の行を埋める */
function fillKeys() {
  const U = readTable_('利用者');
  const c = U.col;
  let maxNo = 0;
  U.rows.forEach(r => {
    const m = String(r[c['利用者ID']] || '').match(/^U(\d+)$/);
    if (m) maxNo = Math.max(maxNo, Number(m[1]));
  });
  let changed = 0;
  U.rows.forEach((r, i) => {
    if (!String(r[c['名前']] || '').trim() && !r[c['利用者ID']]) return;
    const row = i + 2;
    if (!r[c['利用者ID']]) { maxNo++; U.sh.getRange(row, c['利用者ID'] + 1).setValue('U' + ('00' + maxNo).slice(-3)); changed++; }
    if (!r[c['鍵']]) { U.sh.getRange(row, c['鍵'] + 1).setNumberFormat('@').setValue(newKey_()); changed++; }
    if (r[c['有効']] === '' || r[c['有効']] === null) { U.sh.getRange(row, c['有効'] + 1).setValue(true); }
    if (!r[c['役割']]) { U.sh.getRange(row, c['役割'] + 1).setValue('一般'); }
    if (!r[c['作成日']]) { U.sh.getRange(row, c['作成日'] + 1).setValue(new Date()); }
  });
  return changed;
}

/**
 * マンション訪問管理（v5.5.0）の「マンションマスタ」を取り込む。
 * 「取り込み」シートを作り、A列から マンション名・住所・部屋番号・備考 を貼ってから実行する。
 * E列（なくてもよい）に「アパート」と書くとアパートとして入れる（回り方は「一棟まとめて」の回り方。ふつうは夕方のアパート）。
 * F列（なくてもよい）に回り方の名前を書ける（いくつもなら「マンション訪問・夕方のアパート」のように「・」でつなぐ）。
 * 「〇〇壱番館(2)」の (2) は入口として扱う。同じ名前の建物がもうあれば飛ばす。
 */
function importMansionMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('取り込み');
  if (!sh || sh.getLastRow() < 1) throw err_('NO_SHEET', '「取り込み」シートに、マンション名・住所・部屋番号・備考を貼ってください');
  const width = Math.max(4, Math.min(6, sh.getLastColumn()));
  const rows = sh.getRange(1, 1, sh.getLastRow(), width).getValues().filter(r => r[0] && r[0] !== 'マンション名' && r[2] !== '');
  const byName = {};
  const order = [];
  rows.forEach(r => {
    const full = String(r[0]).trim();
    const m = full.match(/^(.*?)[(（](\d+)[)）]\s*$/);
    const base = m ? m[1].trim() : full;
    const ent = m ? m[2] : '';
    if (!byName[base]) { byName[base] = { address: String(r[1] || ''), rooms: [], type: String(r[4] || '').trim(), routes: String(r[5] || '').trim() }; order.push(base); }
    byName[base].rooms.push({ entrance: ent, no: String(r[2]).replace(/\.0$/, ''), memo: String(r[3] || '') });
  });
  const exist = {};
  const all = readBuildings_(true);
  Object.keys(all).forEach(k => { exist[all[k].name] = true; });
  const me = { id: 'import', name: '取り込み', role: '上位管理者', active: true };
  let made = 0;
  order.forEach(base => {
    if (exist[base]) return;
    const x = byName[base];
    const city = /札幌/.test(x.address) ? 'H' : 'Z';
    const apt = x.type === 'アパート';
    const RT = readRoutes_();
    const act = RT.list.filter(r => r.active);
    const def = (apt ? act.find(r => r.mode === '一棟まとめて') : act.find(r => r.mode === '部屋ごと')) || act[0];
    const routes = x.routes ? normRoutes_(x.routes) : (def ? [def.id] : []);
    apiSaveBuilding_(me, { building: { name: base, type: apt ? 'アパート' : 'マンション', autolock: apt ? 'なし' : 'あり', routes: routes, city: city, address: x.address }, rooms: x.rooms });
    made++;
  });
  Logger.log('取り込んだ建物：' + made + '棟（' + rows.length + '部屋）');
  return made;
}

/* ============================== 共通の道具 ============================== */

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw err_('NO_SHEET', '「' + name + '」シートがありません。メニューの「初めの準備」を実行してください');
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const head = SHEETS[name];
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  const col = {};
  head.forEach((h, i) => { col[h] = i; });
  return { sh: sh, head: head, rows: rows, col: col };
}

function appendRows_(T, rows) {
  if (!rows.length) return;
  // 新しい版で右に列を足しても、前のままの行の形で足せるように、足りない列は空にする
  const w = T.head.length;
  const rs = rows.map(r => (r.length < w ? r.concat(new Array(w - r.length).fill('')) : r.slice(0, w)));
  T.sh.getRange(T.sh.getLastRow() + 1, 1, rs.length, w).setValues(rs);
}

/** 地図の下地（国土地理院／保存した地図）。決めていなければ国土地理院 */
function basemapOf_(st) {
  const v = String(st['地図の下地'] || '').trim();
  return BASEMAPS.indexOf(v) >= 0 ? v : '国土地理院';
}

function settings_() {
  const T = readTable_('設定');
  const out = {};
  T.rows.forEach(r => { if (r[0]) { const k = String(r[0]).trim(); out[RENAMED_SETTINGS[k] || k] = r[1]; } });
  return out;
}

function readGroups_(withRow) {
  const T = readTable_('グループ');
  const c = T.col;
  const out = {};
  T.rows.forEach((r, i) => {
    const id = String(r[c['グループID']] || '').trim();
    if (!id) return;
    const active = !falsy_(r[c['有効']]);
    if (!active && !withRow) return;
    out[id] = { id: id, name: String(r[c['名前']] || id), order: Number(r[c['並び順']]) || 99, area: String(r[c['主に回るエリア']] || ''), active: active };
    if (withRow) out[id].row = i + 2;
  });
  return out;
}

function readBuildings_(withRow) {
  const T = readTable_('建物');
  const c = T.col;
  const counts = {};
  readTable_('部屋').rows.forEach(r => { if (r[0] && !falsy_(r[6])) counts[String(r[1])] = (counts[String(r[1])] || 0) + 1; });
  const out = {};
  T.rows.forEach((r, i) => {
    const id = String(r[c['建物ID']] || '').trim();
    if (!id) return;
    const active = !falsy_(r[c['有効']]);
    if (!active && !withRow) return;
    out[id] = {
      id: id, no: String(r[c['表示番号']] || ''), name: String(r[c['名前']] || ''), type: String(r[c['種類']] || ''),
      autolock: String(r[c['オートロック']] || ''), route: routeNames_(normRoutes_(r[c['回り方']])), routes: normRoutes_(r[c['回り方']]), city: String(r[c['市']] || ''),
      houseId: String(r[c['家ID']] || ''), lat: r[c['緯度']] === '' ? null : Number(r[c['緯度']]), lon: r[c['経度']] === '' ? null : Number(r[c['経度']]),
      address: String(r[c['住所']] || ''), memo: String(r[c['メモ']] || ''), active: active, rooms: counts[id] || 0,
    };
    if (withRow) out[id].row = i + 2;
  });
  return out;
}

function readRooms_(withInactive) {
  const T = readTable_('部屋');
  const c = T.col;
  const out = {};
  T.rows.forEach(r => {
    if (!r[c['部屋ID']]) return;
    const active = !falsy_(r[c['有効']]);
    if (!active && !withInactive) return;
    const bid = String(r[c['建物ID']]);
    (out[bid] = out[bid] || []).push({
      id: String(r[c['部屋ID']]), entrance: String(r[c['入口']] || ''), floor: Number(r[c['階']]) || floorOf_(r[c['部屋番号']]),
      no: String(r[c['部屋番号']]).replace(/\.0$/, ''), order: Number(r[c['並び順']]) || 0, active: active,
    });
  });
  Object.keys(out).forEach(k => out[k].sort((a, b) => a.order - b.order));
  return out;
}

/** 家ごとの最新の状態（「家の状態」シートの最後の行が勝つ） */
function readHouseStates_() {
  const T = readTable_('家の状態');
  const out = {};
  T.rows.forEach(r => {
    const hid = String(r[1] || '');
    if (!hid || truthy_(r[6])) return;   // 元に戻した変更（無効）は数えない。前の状態が効く
    out[hid] = { state: String(r[2]), buildingId: String(r[3] || ''), at: fmtDate_(r[0]) };
  });
  return out;
}

function distObj_(r, c) {
  return {
    distId: String(r[c['配布ID']]),
    territoryId: String(r[c['区域ID']]),
    no: String(r[c['区域番号']]),
    kind: normKind_(r[c['種別']]),
    userId: String(r[c['利用者ID']] || ''),
    name: String(r[c['名前']]),
    groupId: String(r[c['グループID']] || ''),
    gatheringId: String(r[c['集まりID']] || ''),
    distributedAt: fmtDate_(r[c['配布日']]),
    due: fmtDate_(r[c['回収日']]),
    forced: fmtDate_(r[c['完全回収日']]),
    returnedAt: fmtDate_(r[c['返却日']]),
    endedBy: String(r[c['終わり方']] || ''),
    rooms: roomsOf_(r, c),
  };
}

function recObj_(r, c) {
  return {
    id: String(r[c['記録ID']]),
    distId: String(r[c['配布ID']]),
    territoryId: String(r[c['区域ID']]),
    houseId: String(r[c['家ID']] || ''),
    roomId: String(r[c['部屋ID']] || ''),
    blockId: String(r[c['ブロックID']] || ''),
    result: String(r[c['結果']]),
    at: toDate_(r[c['訪問日時']]).toISOString(),
    by: String(r[c['利用者ID']]),
    byName: String(r[c['名前']] || ''),
    proxyBy: String(r[c['入れた人']] || ''),
  };
}

function log_(user, target, content) {
  try {
    appendRows_(readTable_('変更の記録'), [[new Date(), user.name, target, content]]);
  } catch (e) { /* 記録できなくても本体は止めない */ }
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function toDate_(v) {
  if (isDate_(v)) return v;
  if (v === '' || v === null || v === undefined) return new Date(0);
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function fmtDate_(v) {
  if (v === '' || v === null || v === undefined) return '';
  return Utilities.formatDate(toDate_(v), TZ, 'yyyy-MM-dd');
}

/** スマホの時計の時刻を使う。おかしな時刻（未来・1年以上前）なら受け取った時刻にする */
function deviceTime_(s, now) {
  const d = new Date(s);
  if (!s || isNaN(d.getTime())) return now;
  const diff = d.getTime() - now.getTime();
  if (diff > 10 * 60 * 1000 || diff < -366 * 24 * 3600 * 1000) return now;
  return d;
}

/** 回収日：「月末」なら配布した月の月末、「Nか月」ならN か月後の同じ日 */
function dueDate_(d, rule) {
  const y = Number(Utilities.formatDate(d, TZ, 'yyyy'));
  const m = Number(Utilities.formatDate(d, TZ, 'MM')) - 1;
  const day = Number(Utilities.formatDate(d, TZ, 'dd'));
  const mm = String(rule || '月末').match(/(\d+)\s*か?ヶ?カ?月/);
  if (mm) return new Date(y, m + Number(mm[1]), day);
  return new Date(y, m + 1, 0);
}

/** 配布の行の部屋（部屋ごとに配ったとき）。空なら建物・区域まるごと */
function roomsOf_(r, c) {
  return String(r[c['部屋']] || '').split(',').map(x => x.trim()).filter(Boolean);
}

/* ---------- 回り方（「回り方」シート） ---------- */
let ROUTE_CACHE_ = null;

/**
 * 回り方の一覧。シートがまだなければ既定（マンション訪問・夕方のアパート）。
 * resolve(x)：回り方ID・今の名前・前の名前・0.4.0までの名前のどれでも、回り方IDにする（分からなければ ''）
 */
function readRoutes_() {
  if (ROUTE_CACHE_) return ROUTE_CACHE_;
  let rows = null;
  let fromSheet = false;
  try {
    const T = readTable_('回り方');
    const rs = T.rows.map((r, i) => ({ r: r, row: i + 2 })).filter(x => String(x.r[0] || '').trim());
    if (rs.length) { rows = rs; fromSheet = true; }
  } catch (e) { /* シートがまだない（前の版から上げたばかり） */ }
  if (!rows) rows = DEFAULT_ROUTES.map(r => ({ r: r, row: 0 }));
  const list = rows.map(x => {
    const r = x.r;
    const mode = HAND_MODES.indexOf(String(r[2])) >= 0 ? String(r[2]) : '部屋ごと';
    return {
      id: String(r[0]).trim(), name: String(r[1] || r[0]).trim(), mode: mode,
      per: clampInt_(r[3], 1, 20, 5), cycle: clampInt_(r[4], 0, 365, 90), order: Number(r[5]) || 99,
      // 1人に、1つの建物から何部屋まで（0.6.0から。空なら2）。いくつかの建物から少しずつ割り振る
      perB: clampInt_(r[9], 1, 20, DEFAULT_PER_BUILDING),
      active: !falsy_(r[6]), memo: String(r[7] || ''),
      prev: String(r[8] || '').split(/[,、]/).map(v => v.trim()).filter(Boolean), row: x.row,
    };
  }).sort((a, b) => a.order - b.order);
  const byId = {}, byName = {};
  list.forEach(x => { byId[x.id] = x; });
  list.forEach(x => { if (!(x.name in byName)) byName[x.name] = x.id; });
  list.forEach(x => x.prev.forEach(n => { if (!(n in byName)) byName[n] = x.id; }));
  Object.keys(LEGACY_ROUTES).forEach(n => { if (!(n in byName) && byId[LEGACY_ROUTES[n]]) byName[n] = LEGACY_ROUTES[n]; });
  ROUTE_CACHE_ = {
    list: list, byId: byId, fromSheet: fromSheet,
    resolve: v => { const k = String(v === undefined || v === null ? '' : v).trim(); return byId[k] ? k : (byName[k] || ''); },
    name: id => (byId[id] ? byId[id].name : String(id || '')),
  };
  return ROUTE_CACHE_;
}

function publicRoute_(x) {
  return { id: x.id, name: x.name, mode: x.mode, per: x.per, perB: x.perB, cycle: x.cycle, order: x.order, active: x.active };
}

/** 回り方：配列か「R1・R2」「マンション訪問・夕方のアパート」の文字 → 回り方IDの配列（どれか・いくつでも・なし） */
function normRoutes_(x) {
  const R = readRoutes_();
  const arr = Array.isArray(x) ? x.map(String) : String(x || '').split(/[・,、]/);
  const ids = [];
  arr.forEach(a => { const id = R.resolve(a); if (id && ids.indexOf(id) < 0) ids.push(id); });
  return R.list.filter(r => ids.indexOf(r.id) >= 0).map(r => r.id);
}
/** シートに書く形（回り方ID を「・」でつなぐ。なしは空） */
function routeText_(ids) { return ids.join('・'); }
/** 画面に出す形（名前を「・」でつなぐ） */
function routeNames_(ids) { const R = readRoutes_(); return ids.length ? ids.map(R.name).join('・') : NO_ROUTE; }

/** 配布の種別を読む：通常・不在宅訪問・手持ち、または回り方ID（前の版の名前も回り方IDに直す） */
function normKind_(v) {
  const k = String(v || KIND_NORMAL);
  if (FIXED_KINDS.indexOf(k) >= 0) return k;
  return readRoutes_().resolve(k) || k;
}
function isRouteKind_(k) { return !!readRoutes_().byId[k]; }

function clampInt_(v, min, max, def) {
  const n = Math.round(Number(v));
  if (v === '' || v === null || v === undefined || !isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function scopeOf_(st) { return String(st['使う機能'] || '') === '集合住宅だけ' ? '集合住宅だけ' : 'すべて'; }

/** 'yyyy-MM-dd' をその日の0時（日本時間）にする */
function parseYmd_(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function addDays_(d, n) {
  const x = toDate_(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() + Number(n || 0));
}

function numSetting_(st, name, def) {
  const v = st[name];
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return def;
  return Number(v);
}

function endOfDay_(d) {
  const y = Number(Utilities.formatDate(d, TZ, 'yyyy'));
  const m = Number(Utilities.formatDate(d, TZ, 'MM')) - 1;
  const day = Number(Utilities.formatDate(d, TZ, 'dd'));
  return new Date(y, m, day);
}

function floorOf_(no) {
  const n = Number(String(no).replace(/[^0-9]/g, ''));
  return n >= 100 ? Math.floor(n / 100) : 1;
}

function truthy_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'はい' || v === '無効';
}

function falsy_(v) {
  return v === false || v === 'FALSE' || v === 'false' || v === 0 || v === '0' || v === 'いいえ' || v === '停止';
}

function shortId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function newKey_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let k = '';
  for (let i = 0; k.length < 12 && i + 1 < hex.length; i += 2) {
    if (i === 12 || i === 16 || i === 44 || i === 48) continue; // UUIDの固定部分（版・種別）は使わない
    k += KEY_CHARS[parseInt(hex.substr(i, 2), 16) % 32];
  }
  return k;
}

function fmtKey_(k) {
  return normKey_(k).replace(/(.{4})(?=.)/g, '$1-');
}

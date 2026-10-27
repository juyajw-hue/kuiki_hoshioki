/*
 * GASの模擬環境（お試し版と自動テスト用）
 * 本物の Code.gs を、スプレッドシートの代わりにメモリ上の表で動かす。
 * ブラウザでは window.GasShim、Node では require() で使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GasShim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
  function clone(v) { return isDate(v) ? new Date(v.getTime()) : v; }

  // 未定義の書式メソッド（setFontWeight など）は何もせず自分を返す
  function chainable(obj) {
    if (typeof Proxy === 'undefined') return obj;
    return new Proxy(obj, {
      get: function (t, p) {
        if (p in t) return t[p];
        if (typeof p === 'symbol') return undefined;
        return function () { return chainable(t); };
      },
    });
  }

  function makeSheet(state, name, save) {
    const data = () => state.sheets[name];
    function lastRow() {
      const d = data();
      for (let r = d.length - 1; r >= 0; r--) {
        if ((d[r] || []).some(v => v !== '' && v !== null && v !== undefined)) return r + 1;
      }
      return 0;
    }
    function lastCol() {
      let m = 0;
      data().forEach(row => {
        for (let c = (row || []).length - 1; c >= 0; c--) {
          if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { m = Math.max(m, c + 1); break; }
        }
      });
      return m;
    }
    function range(row, col, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error('範囲が正しくありません: ' + [row, col, nr, nc].join(','));
      const r = {
        getValues: function () {
          const d = data(); const out = [];
          for (let i = 0; i < nr; i++) {
            const src = d[row - 1 + i] || []; const line = [];
            for (let j = 0; j < nc; j++) { const v = src[col - 1 + j]; line.push(v === undefined || v === null ? '' : clone(v)); }
            out.push(line);
          }
          return out;
        },
        getValue: function () { return r.getValues()[0][0]; },
        setValues: function (vals) {
          if (!Array.isArray(vals) || vals.length !== nr || vals.some(x => !Array.isArray(x) || x.length !== nc)) {
            throw new Error('値の行数・列数が範囲と合いません');
          }
          const d = data();
          for (let i = 0; i < nr; i++) {
            const ri = row - 1 + i;
            while (d.length <= ri) d.push([]);
            for (let j = 0; j < nc; j++) d[ri][col - 1 + j] = clone(vals[i][j]);
          }
          save();
          return chainable(r);
        },
        setValue: function (v) { const d = data(); while (d.length < row) d.push([]); d[row - 1][col - 1] = clone(v); save(); return chainable(r); },
        getRow: function () { return row; },
        getColumn: function () { return col; },
        getNumRows: function () { return nr; },
        getNumColumns: function () { return nc; },
      };
      return chainable(r);
    }
    const sh = {
      getName: function () { return name; },
      setName: function (nn) {
        if (nn === name) return chainable(sh);
        state.sheets[nn] = state.sheets[name];
        delete state.sheets[name];
        save();
        return makeSheet(state, nn, save);
      },
      getLastRow: lastRow,
      getLastColumn: lastCol,
      getMaxRows: function () { return Math.max(1000, data().length); },
      getMaxColumns: function () { return Math.max(26, lastCol()); },
      getRange: function (row, col, nr, nc) {
        if (typeof row === 'string') throw new Error('模擬環境はA1形式の範囲に対応していません');
        return range(row, col, nr, nc);
      },
      getDataRange: function () { return range(1, 1, Math.max(1, lastRow()), Math.max(1, lastCol())); },
      appendRow: function (vals) { const d = data(); const n = lastRow(); while (d.length < n) d.push([]); d.splice(n, 0, vals.map(clone)); save(); return chainable(sh); },
      clear: function () { state.sheets[name] = []; save(); return chainable(sh); },
    };
    return chainable(sh);
  }

  function formatDate(date, tz, fmt) {
    const d = isDate(date) ? date : new Date(date);
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
    const map = { yyyy: parts.year, yy: String(parts.year).slice(-2), MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
    return String(fmt).replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => map[t]);
  }

  function uuid() {
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => ('0' + x.toString(16)).slice(-2)).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* ---------- バックアップのための模擬（Google ドライブ・zip・スクリプトのプロパティ） ---------- */
  function utf8Len(s) { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return n; }
  function makeBlob(data, type, name) {
    const b = {
      _data: data === undefined || data === null ? '' : data, _type: type || '', _name: name || '', _parts: null, _size: null,
      getName: function () { return b._name; },
      setName: function (n) { b._name = n; return b; },
      getContentType: function () { return b._type; },
      getDataAsString: function () { return typeof b._data === 'string' ? b._data : ''; },
      getBytes: function () { return []; },
      size: function () { return b._size !== null ? b._size : utf8Len(String(b._data)); },
    };
    return b;
  }
  /** 中身のしるし（本物は MD5。ここでは同じ文字なら同じになる短いしるし） */
  function digest(text) {
    let h1 = 0x811c9dc5, h2 = 0x1b873593;
    const s = String(text);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822507) >>> 0; }
    const out = [];
    [h1, h2, h1 ^ h2, (h1 + h2) >>> 0].forEach(h => { for (let k = 0; k < 4; k++) out.push(((h >>> (k * 8)) & 255) - 128); });
    return out;
  }
  function b64(bytes) {
    const s = bytes.map(b => String.fromCharCode((b + 256) % 256)).join('');
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(s, 'binary').toString('base64');
  }
  function makeDrive(state, save, blobs) {
    const dv = state.drive || (state.drive = { seq: 0, folders: {}, files: {} });
    const nextId = p => p + (++dv.seq);
    function fileObj(id) {
      const x = dv.files[id];
      return {
        getId: () => id, getName: () => x.name, getSize: () => x.size, isTrashed: () => !!x.trashed,
        setTrashed: v => { x.trashed = !!v; save(); },
        getBlob: () => blobs[id] || makeBlob('', 'application/zip', x.name),
        getDateCreated: () => new Date(x.at), getLastUpdated: () => new Date(x.at),
      };
    }
    function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
    function folderObj(id) {
      const f = dv.folders[id];
      return {
        getId: () => id, getName: () => f.name, isTrashed: () => !!f.trashed, setTrashed: v => { f.trashed = !!v; save(); },
        getFiles: () => iter(Object.keys(dv.files).filter(k => dv.files[k].folder === id && !dv.files[k].trashed).map(fileObj)),
        getFilesByName: n => iter(Object.keys(dv.files).filter(k => dv.files[k].folder === id && !dv.files[k].trashed && dv.files[k].name === n).map(fileObj)),
        createFile: blob => {
          const fid = nextId('F');
          dv.files[fid] = { name: blob.getName(), folder: id, size: blob.size(), trashed: false, at: new Date().toISOString() };
          blobs[fid] = blob;
          save();
          return fileObj(fid);
        },
      };
    }
    return {
      getFolderById: id => { if (!dv.folders[id]) throw new Error('フォルダが見つかりません'); return folderObj(id); },
      getFoldersByName: n => iter(Object.keys(dv.folders).filter(k => dv.folders[k].name === n && !dv.folders[k].trashed).map(folderObj)),
      createFolder: n => { const id = nextId('D'); dv.folders[id] = { name: n, trashed: false }; save(); return folderObj(id); },
      getRootFolder: () => ({ getId: () => 'root', getName: () => 'マイドライブ' }),
      getFileById: id => { if (!dv.files[id]) throw new Error('ファイルが見つかりません'); return fileObj(id); },
      /** テスト用：今あるファイル（ごみ箱をのぞく） */
      _list: () => Object.keys(dv.files).filter(k => !dv.files[k].trashed).map(k => Object.assign({ id: k }, dv.files[k])),
    };
  }

  /** opts.state: { sheets: {名前: [[...]]} } ／ opts.save: 書き込みのたびに呼ばれる */
  function createEnv(opts) {
    opts = opts || {};
    const state = opts.state || { sheets: {} };
    if (!state.sheets) state.sheets = {};
    const save = opts.save || function () {};
    const sheets = {};
    const getSheet = name => {
      if (!state.sheets[name]) return null;
      return sheets[name] || (sheets[name] = makeSheet(state, name, save));
    };
    const ss = chainable({
      getSheetByName: getSheet,
      insertSheet: function (name) { if (!state.sheets[name]) state.sheets[name] = []; save(); return getSheet(name); },
      getSheets: function () { return Object.keys(state.sheets).map(getSheet); },
      getId: function () { return 'demo'; },
      getName: function () { return '区域訪問管理（模擬）'; },
      getUrl: function () { return ''; },
    });
    const lock = { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {}, hasLock: function () { return true; } };
    const cacheStore = {};
    const cache = {
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = String(v); },
      remove: k => { delete cacheStore[k]; },
    };
    const menu = chainable({ addToUi: function () {} });
    const props = state.props || (state.props = {});
    const PropertiesService = {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); save(); return this; },
        setProperties: o => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); save(); },
        deleteProperty: k => { delete props[k]; save(); },
        getProperties: () => Object.assign({}, props),
      }),
    };
    const blobStore = {};
    const DriveApp = makeDrive(state, save, blobStore);
    const created = [];
    function createSpreadsheet(name) {
      const st2 = { sheets: { 'シート1': [] } };
      const sheets2 = {};
      const get2 = n => (st2.sheets[n] ? (sheets2[n] = makeSheet(st2, n, function () {})) : null);
      const id = 'ss' + (created.length + 1);
      const ss2 = chainable({
        getSheetByName: get2,
        insertSheet: n => { if (!st2.sheets[n]) st2.sheets[n] = []; return get2(n); },
        getSheets: () => Object.keys(st2.sheets).map(get2),
        getId: () => id, getName: () => name, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
        _state: st2,
      });
      created.push(ss2);
      return ss2;
    }
    const triggers = state.triggers || (state.triggers = []);
    const ScriptApp = {
      getProjectTriggers: function () { return triggers.map(fn => ({ getHandlerFunction: function () { return fn; } })); },
      newTrigger: function (fn) {
        const b = chainable({ create: function () { triggers.push(fn); save(); return {}; } });
        return b;
      },
    };
    return {
      state: state,
      SpreadsheetApp: chainable({
        getActiveSpreadsheet: function () { return ss; },
        getActive: function () { return ss; },
        create: createSpreadsheet,
        getUi: function () { return chainable({ createMenu: function () { return menu; }, alert: function () {} }); },
        flush: function () {},
      }),
      LockService: { getScriptLock: () => lock, getDocumentLock: () => lock, getUserLock: () => lock },
      CacheService: { getScriptCache: () => cache, getDocumentCache: () => cache, getUserCache: () => cache },
      Utilities: {
        getUuid: uuid, formatDate: formatDate, sleep: function () {},
        newBlob: (data, type, name) => makeBlob(data, type, name),
        /** zip：本物は縮めて1つのファイルにする。ここでは中身を持ったまま、縮めたあとの大きさを見積もる（文字はおよそ5分の1） */
        zip: (list, name) => { const z = makeBlob('', 'application/zip', name || 'archive.zip'); z._parts = list.slice(); z._size = 120 + list.reduce((n, b) => n + 90 + Math.ceil(b.size() * 0.2), 0); return z; },
        unzip: blob => (blob && blob._parts ? blob._parts.slice() : []),
        computeDigest: (alg, text) => digest(text),
        base64Encode: bytes => b64(bytes),
        DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF-8' },
      },
      ContentService: {
        MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
        createTextOutput: function (s) {
          const o = { content: String(s), setMimeType: function () { return o; }, getContent: function () { return o.content; } };
          return o;
        },
      },
      Session: { getScriptTimeZone: function () { return 'Asia/Tokyo'; } },
      ScriptApp: ScriptApp,
      PropertiesService: PropertiesService,
      DriveApp: DriveApp,
      created: created,
      Logger: { log: function () { if (opts.log) opts.log.apply(null, arguments); } },
    };
  }

  /** Code.gs の文字列を読み込み、doGet/doPost などを返す */
  function loadBackend(source, env) {
    const names = ['SpreadsheetApp', 'LockService', 'CacheService', 'Utilities', 'ContentService', 'Session', 'Logger', 'ScriptApp', 'PropertiesService', 'DriveApp'];
    const exportsList = ['doGet', 'doPost', 'setup', 'fillKeys', 'handle_', 'dailyCollect', 'nightlyBackup', 'backupNow', 'restoreFrom_', 'settings_', 'APP_VERSION', 'SHEETS'];
    const body = source + '\n;return {' + exportsList.map(n => n + ': (typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined)').join(',') + '};';
    // eslint-disable-next-line no-new-func
    const fn = new Function(names.join(','), body);
    return fn.apply(null, names.map(n => env[n]));
  }

  function serialize(state) {
    return JSON.stringify(state, function (k, v) {
      const raw = this[k];
      return isDate(raw) ? { $d: raw.toISOString() } : v;
    });
  }

  function deserialize(text) {
    return JSON.parse(text, (k, v) => (v && typeof v === 'object' && typeof v.$d === 'string' ? new Date(v.$d) : v));
  }

  return { createEnv: createEnv, loadBackend: loadBackend, serialize: serialize, deserialize: deserialize, formatDate: formatDate };
});

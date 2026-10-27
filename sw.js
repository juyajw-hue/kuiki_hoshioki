/*
 * 区域訪問管理 — 電波がなくても開けるようにする仕組み（Service Worker）
 *   アプリの画面と区域データを端末に保存しておき、電波がなくても開く。
 *   地図は、アプリが担当区域の周りの「保存した地図」（basemap/ の .ktp）を保存したものを使う。
 *   国土地理院の地図（地理院タイル）・建物のデータ（.pbf）・基準の地図（gsi-base.json）は保存しない。
 * アプリを直したら、下の VERSION を上げる（上げると、次に開いたときに新しい版に入れ替わる）
 */
const VERSION = '0.12.0-1';
const SHELL = 'kuiki-shell-' + VERSION;
const TILES = 'kuiki-tiles-v2';
const OLD = ['kuiki-tiles-v1']; // 0.8.0までの保存（地理院タイルの写し）。消す
const FONTS = 'kuiki-fonts-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/config.js', 'js/store.js', 'js/app.js', 'js/terrmap.js', 'js/admin.js', 'js/plan.js', 'js/print.js', 'js/s13.js', 'js/proxy.js', 'js/bounds.js', 'js/gsi.js', 'js/mapedit.js', 'js/main.js', 'js/gas-shim.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/qrcode.js', 'vendor/jsQR.js',
  'data/territories.json', 'data/demo-buildings.json', 'gas/Code.gs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' }))))
      // 全体を見る地図（保存した地図のズーム12〜14）も入れておく。置いていなければ入れない
      .then(() => caches.open(TILES).then(c => c.addAll(['basemap/meta.json', 'basemap/low.ktp'].map(u => new Request(u, { cache: 'reload' })))).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.indexOf('kuiki-shell-') === 0 && k !== SHELL) || OLD.indexOf(k) >= 0).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(staleWhileRevalidate(req, FONTS)); return; }
  if (url.origin !== self.location.origin) return; // GAS などはそのまま
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  if (url.pathname.endsWith('/data/gsi-base.json')) return; // 管理の画面で、そのつど読む
  if (url.pathname.indexOf('/basemap/') >= 0) { e.respondWith(basemap(req)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});

/** 保存した地図：ふだんは保存してある分を使う。取り直すとき（no-cache）は先に取りに行き、だめなら保存してある分 */
async function basemap(req) {
  const fresh = req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store';
  if (!fresh) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
  }
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => hit || Response.error());
  return hit || net;
}

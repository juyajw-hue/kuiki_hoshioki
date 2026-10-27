/*
 * ここだけ書き換えます（ほかのファイルは触らなくて大丈夫です）
 */
self.KUIKI_CONFIG = {
  // GASウェブアプリのURL（デプロイしたときに出る https://script.google.com/macros/s/……/exec）
  gasUrl: 'https://script.google.com/macros/s/AKfycbwve36SRmKSIlmdBu9HQjCUZB3qwlnzncf56OIa3LWIweIXon33msenJYqpHNa-G6gEeQ/exec',

  // 利用カードのQRコードに入れるアドレス（このアプリを置いたURL）。空なら、今開いているアドレスを使う
  appUrl: '',

  // お試し版を選べるようにする。本番で使い始めたら false にする
  demo: true,

  // ---- 国土地理院の地図について（ふだんは書かなくて大丈夫です） ----
  // 国土地理院の地図を使わず、保存した地図（basemap フォルダ）だけで動かすときは true にする。
  //   管理の画面（上位管理者）の「地図の下地」でも切り替えられます。こちらは全員・いつも、になります
  // basemapOnly: true,

  // 国土地理院が、比べるときのデータ（ベクトルタイル）を新しい場所で同じ形のまま出したときは、ここに書く
  // gsiVtUrl: 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf',
};

/*
 * 区域訪問管理 — S-13（区域割り当ての記録。0.11.0）
 *   奉仕年度ごとに、区域の「割り当てられた人・割り当てた日付・完了した日付」を様式の形に並べる。
 *   見本（画面・印刷）、Word（.docx）、書き込める PDF（欄に入力できる）で出す。
 *   どれもこのファイルの中だけで作る（外の部品・外へのやり取りなし）。
 *
 *   Word：表の欄にそのまま書き足せる。PDF：どの欄も入力欄（区域番号・名前・日付・奉仕年度）。
 *   PDF の文字は日本語の標準の書体（平成角ゴシック）を指すだけで、ファイルには入れない（ファイルが軽い。
 *   見るときはパソコン・スマホの日本語の書体で出る）。
 */
(function (root) {
  'use strict';
  const K = root.K || (root.K = {});

  /* ==================== 紙と欄の形 ==================== */
  /** 紙（mm）。rows：1枚に入る区域の数（1区域＝名前の行と日付の行の2行） */
  const SHEETS = {
    A4: { w: 210, h: 297, ml: 12, mt: 11, mb: 9, rows: 20, rowH: 6.0, fName: 8.5, fDate: 7.5, fHead: 7, fTitle: 14 },
    B5: { w: 182, h: 257, ml: 10, mt: 9, mb: 8, rows: 17, rowH: 5.9, fName: 7.5, fDate: 6.8, fHead: 6.3, fTitle: 12.5 },
  };
  const PER = 4;   // 1行に書ける割り当て（様式は4回分）
  const TITLE = '区域割り当ての記録';
  const NOTE = '＊この用紙を使い始めるときに、それぞれの区域が最後に完了した日付を書きます。';

  function geo(paperKey) {
    const P = SHEETS[paperKey] || SHEETS.A4;
    const cw = P.w - 2 * P.ml;
    const noW = P === SHEETS.A4 ? 14 : 13, lastW = P === SHEETS.A4 ? 22 : 19;
    const subW = (cw - noW - lastW) / (PER * 2);
    const cols = [noW, lastW];
    for (let i = 0; i < PER * 2; i++) cols.push(subW);
    const titleH = P === SHEETS.A4 ? 13 : 11.5;
    const head1 = P === SHEETS.A4 ? 7 : 6.5, head2 = P === SHEETS.A4 ? 5.5 : 5;
    return Object.assign({ cw: cw, cols: cols, titleH: titleH, head1: head1, head2: head2, noteH: 7 }, P);
  }

  /** 日付 'yyyy-MM-dd' → '2026/8/2'（欄に入る短い形） */
  const dateTxt = s => { const p = String(s || '').split('-'); return p.length === 3 ? p[0] + '/' + Number(p[1]) + '/' + Number(p[2]) : ''; };

  /**
   * 様式に並べる。entries：[{no, name?, last, items:[{name, from, to}]}]（並べたい順）
   * 1つの区域の割り当てが4回より多ければ、次の行に同じ区域番号で続ける（最後に完了した日付は最初の行だけ）。
   * 返り値 {year, paper, kind, pages: [{blocks: [{no, last, cells: [{name, from, to}×4], cont}]}]}
   */
  function model(entries, opts) {
    const g = geo(opts.paper);
    const blocks = [];
    entries.forEach(e => {
      const items = e.items || [];
      const n = Math.max(1, Math.ceil(items.length / PER));
      for (let k = 0; k < n; k++) {
        const cells = [];
        for (let j = 0; j < PER; j++) {
          const it = items[k * PER + j];
          cells.push(it ? { name: String(it.name || ''), from: dateTxt(it.from), to: dateTxt(it.to) } : { name: '', from: '', to: '' });
        }
        blocks.push({ no: String(e.no || ''), last: k === 0 ? dateTxt(e.last) : '', cells: cells, cont: k > 0 });
      }
    });
    for (let i = 0; i < (opts.blank || 0); i++) blocks.push({ no: '', last: '', cells: new Array(PER).fill(0).map(() => ({ name: '', from: '', to: '' })), cont: false });
    const pages = [];
    for (let i = 0; i < blocks.length; i += g.rows) pages.push({ blocks: blocks.slice(i, i + g.rows) });
    if (!pages.length) pages.push({ blocks: [] });
    // 最後の紙も、空いた行を空の欄で埋める（あとから書き足せるように）
    const lastP = pages[pages.length - 1];
    while (lastP.blocks.length < g.rows) lastP.blocks.push({ no: '', last: '', cells: new Array(PER).fill(0).map(() => ({ name: '', from: '', to: '' })), cont: false });
    return { year: String(opts.year || ''), paper: opts.paper in SHEETS ? opts.paper : 'A4', kind: opts.kind || 'h', sub: opts.sub || '', made: opts.made || '', pages: pages };
  }

  /* ==================== 見本（画面と印刷） ==================== */
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function html(m) {
    const g = geo(m.paper);
    const colg = `<colgroup>${g.cols.map(w => `<col style="width:${w.toFixed(2)}mm">`).join('')}</colgroup>`;
    const head = `<tr class="h1" style="height:${g.head1}mm"><th rowspan="2">区域番号</th><th rowspan="2">最後に完了<br>した日付＊</th>${new Array(PER).fill('<th colspan="2">割り当てられた人</th>').join('')}</tr>
      <tr class="h2" style="height:${g.head2}mm">${new Array(PER).fill('<th>割り当てた日付</th><th>完了した日付</th>').join('')}</tr>`;
    return m.pages.map((p, pi) => `<section class="pr-card s13" style="--fn:${g.fName}pt;--fd:${g.fDate}pt;--fh:${g.fHead}pt;--ft:${g.fTitle}pt;--rh:${g.rowH}mm">
      <header class="s13-top" style="height:${g.titleH}mm"><h1>${TITLE}${m.sub ? '<small>（' + esc(m.sub) + '）</small>' : ''}</h1><p>奉仕年度：<b>${esc(m.year)}</b></p></header>
      <table class="s13-t">${colg}<thead>${head}</thead><tbody>${p.blocks.map(b => `<tr class="na${b.cont ? ' cont' : ''}"><td rowspan="2" class="no">${esc(b.no)}</td><td rowspan="2" class="last">${esc(b.last)}</td>${b.cells.map(c => `<td colspan="2" class="nm">${esc(c.name)}</td>`).join('')}</tr>
        <tr class="dt">${b.cells.map(c => `<td>${esc(c.from)}</td><td>${esc(c.to)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <footer class="s13-foot"><span>${NOTE}</span><span>${esc(m.made)}　${pi + 1} / ${m.pages.length}</span></footer></section>`).join('');
  }

  /* ==================== 小さな道具：UTF-8・CRC・圧縮・zip ==================== */
  const enc = new TextEncoder();
  let CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** 縮める（ブラウザの CompressionStream。使えなければ null） */
  async function squeeze(u8, format) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream(format);
      const out = new Response(new Blob([u8]).stream().pipeThrough(cs));
      return new Uint8Array(await out.arrayBuffer());
    } catch (e) { return null; }
  }
  function concat(parts) {
    const n = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }
  /** zip（ファイル名は UTF-8）。files：[{name, data: Uint8Array}] */
  async function zip(files) {
    const local = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const def = await squeeze(f.data, 'deflate-raw');
      const useDef = def && def.length < f.data.length;
      const body = useDef ? def : f.data;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, useDef ? 8 : 0, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, f.data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      local.push(new Uint8Array(h.buffer), name, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, useDef ? 8 : 0, true);
      c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, f.data.length, true);
      c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cd = concat(central);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
    return concat(local.concat([cd, new Uint8Array(e.buffer)]));
  }

  /* ==================== Word（.docx） ==================== */
  const TW = 56.6929;   // 1mm = 56.69 twip
  const tw = mm => Math.round(mm * TW);
  const xml = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function wRun(text, pt, bold) {
    const rp = `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${Math.round(pt * 2)}"/><w:szCs w:val="${Math.round(pt * 2)}"/></w:rPr>`;
    return String(text).split('\n').map((t, i) => `<w:r>${rp}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`).join('');
  }
  function wPara(inner, jc) { return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${jc || 'center'}"/></w:pPr>${inner}</w:p>`; }
  function wCell(width, text, o) {
    o = o || {};
    const pr = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
    if (o.span) pr.push(`<w:gridSpan w:val="${o.span}"/>`);
    if (o.vm === 'start') pr.push('<w:vMerge w:val="restart"/>'); else if (o.vm === 'cont') pr.push('<w:vMerge/>');
    if (o.topThick) pr.push('<w:tcBorders><w:top w:val="single" w:sz="10" w:space="0" w:color="000000"/></w:tcBorders>');
    if (o.fill) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`);
    pr.push('<w:tcMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/>');
    return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${wPara(text ? wRun(text, o.pt || 8, o.bold) : '', o.jc)}</w:tc>`;
  }
  function docxBody(m) {
    const g = geo(m.paper);
    const cw = g.cols.map(tw);
    const pairW = cw[2] + cw[3];
    const tblW = cw.reduce((a, b) => a + b, 0);
    const rowH = tw(g.rowH);
    const out = [];
    m.pages.forEach((p, pi) => {
      // 見出し：題（中央）と奉仕年度（右）。2つ目の紙からは、紙の頭で始める
      out.push(`<w:p><w:pPr>${pi ? '<w:pageBreakBefore/>' : ''}<w:tabs><w:tab w:val="right" w:pos="${tblW}"/></w:tabs><w:spacing w:before="0" w:after="${tw(2)}" w:line="240" w:lineRule="auto"/></w:pPr>
        ${wRun(TITLE + (m.sub ? '（' + m.sub + '）' : ''), g.fTitle, true)}<w:r><w:tab/></w:r>${wRun('奉仕年度：', 9)}${wRun(m.year || '　　　　', 11, true)}</w:p>`);
      const rows = [];
      const hh1 = tw(g.head1), hh2 = tw(g.head2);
      const H = (w, t, o) => wCell(w, t, Object.assign({ pt: g.fHead, fill: 'EDEDED' }, o));
      rows.push(`<w:tr><w:trPr><w:trHeight w:val="${hh1}" w:hRule="exact"/><w:tblHeader/><w:cantSplit/></w:trPr>${H(cw[0], '区域番号', { vm: 'start' })}${H(cw[1], '最後に完了\nした日付＊', { vm: 'start' })}${new Array(PER).fill(0).map(() => H(pairW, '割り当てられた人', { span: 2 })).join('')}</w:tr>`);
      rows.push(`<w:tr><w:trPr><w:trHeight w:val="${hh2}" w:hRule="exact"/><w:tblHeader/><w:cantSplit/></w:trPr>${H(cw[0], '', { vm: 'cont' })}${H(cw[1], '', { vm: 'cont' })}${new Array(PER).fill(0).map(() => H(cw[2], '割り当てた日付') + H(cw[3], '完了した日付')).join('')}</w:tr>`);
      p.blocks.forEach(b => {
        const thick = !b.cont;
        rows.push(`<w:tr><w:trPr><w:trHeight w:val="${rowH}" w:hRule="exact"/><w:cantSplit/></w:trPr>${wCell(cw[0], b.no, { vm: 'start', pt: g.fName, bold: true, topThick: thick })}${wCell(cw[1], b.last, { vm: 'start', pt: g.fDate, topThick: thick })}${b.cells.map(c => wCell(pairW, c.name, { span: 2, pt: g.fName, topThick: thick })).join('')}</w:tr>`);
        rows.push(`<w:tr><w:trPr><w:trHeight w:val="${rowH}" w:hRule="exact"/><w:cantSplit/></w:trPr>${wCell(cw[0], '', { vm: 'cont' })}${wCell(cw[1], '', { vm: 'cont' })}${b.cells.map(c => wCell(cw[2], c.from, { pt: g.fDate }) + wCell(cw[3], c.to, { pt: g.fDate })).join('')}</w:tr>`);
      });
      const border = (n, sz) => `<w:${n} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`;
      out.push(`<w:tbl><w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/><w:jc w:val="center"/>
        <w:tblBorders>${border('top', 10)}${border('left', 10)}${border('bottom', 10)}${border('right', 10)}${border('insideH', 4)}${border('insideV', 4)}</w:tblBorders>
        <w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>
        <w:tblGrid>${cw.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`);
      out.push(`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${tblW}"/></w:tabs><w:spacing w:before="${tw(1)}" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${wRun(NOTE, 6.5)}<w:r><w:tab/></w:r>${wRun((m.made ? m.made + '　' : '') + (pi + 1) + ' / ' + m.pages.length, 6.5)}</w:p>`);
    });
    return out.join('');
  }
  async function docx(m) {
    const g = geo(m.paper);
    const W = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const files = {
      '[Content_Types].xml': W + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
      '_rels/.rels': W + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
      'docProps/core.xml': W + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${xml(TITLE + '（' + m.year + '奉仕年度' + (m.sub ? '・' + m.sub : '') + '）')}</dc:title><dc:creator>区域訪問管理</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
      'docProps/app.xml': W + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>区域訪問管理</Application></Properties>',
      'word/_rels/document.xml.rels': W + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
      'word/styles.xml': W + `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Yu Gothic" w:eastAsia="游ゴシック" w:hAnsi="Yu Gothic" w:cs="Yu Gothic"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>` +
        '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="28" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>',
      'word/settings.xml': W + `<w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
      'word/document.xml': W + `<w:document ${NS}><w:body>${docxBody(m)}<w:sectPr><w:pgSz w:w="${tw(g.w)}" w:h="${tw(g.h)}"/><w:pgMar w:top="${tw(g.mt)}" w:right="${tw(g.ml)}" w:bottom="${tw(g.mb)}" w:left="${tw(g.ml)}" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="425"/></w:sectPr></w:body></w:document>`,
    };
    const u8 = await zip(Object.keys(files).map(k => ({ name: k, data: enc.encode(files[k]) })));
    return new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ==================== 書き込める PDF ==================== */
  const PT = 72 / 25.4;   // 1mm = 2.83pt
  const FONT = 'HeiseiKakuGo-W5';
  /** 文字 → UTF-16BE の16進（PDF の <…>） */
  function hex16(s) {
    let h = '';
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
    return h.toUpperCase();
  }
  /** 文字の幅（em）：半角は0.5、ほかは1（PDF の W と同じ決まり） */
  const cjkW = s => { let n = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); n += c < 0x7f || (c >= 0xff61 && c <= 0xff9f) ? 0.5 : 1; } return n; };
  /** 半角だけの文字（日付・番号）は Helvetica で書く（どの PDF の見る道具にもある書体。数字の間があかない） */
  const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const isAscii = s => /^[\x20-\x7e]*$/.test(String(s));
  const emW = s => (isAscii(s) ? String(s).split('').reduce((n, ch) => n + HELV[ch.charCodeAt(0) - 32] / 1000, 0) : cjkW(s));
  /** 文字を PDF に書く形：半角だけなら (…)（Helvetica・F2）、ほかは <UTF-16BE>（日本語の書体・F1） */
  const pdfStr = s => (isAscii(s) ? { f: 'F2', t: '(' + String(s).replace(/[\\()]/g, c => '\\' + c) + ')' } : { f: 'F1', t: '<' + hex16(s) + '>' });
  const num = v => (Math.round(v * 100) / 100).toString();
  /** 欄に収まるように文字を小さくする */
  const fitSize = (s, size, w) => { const e = emW(s); return e * size > w - 2 ? Math.max(4.5, (w - 2) / e) : size; };

  async function pdf(m) {
    const g = geo(m.paper);
    const PW = g.w * PT, PH = g.h * PT;
    const objs = [];   // [番号] = 中身（Uint8Array か 文字）
    const add = body => { objs.push(body); return objs.length; };
    const ref = n => n + ' 0 R';
    const catalog = add(null), pagesN = add(null), acro = add(null);
    const fontN = add(null), cidN = add(null), descN = add(null);
    const helvN = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const FONTS = `/Font << /F1 ${ref(fontN)} /F2 ${ref(helvN)} >>`;
    const widths = '[1 [' + new Array(95).fill(500).join(' ') + '] 231 632 500]';
    objs[fontN - 1] = `<< /Type /Font /Subtype /Type0 /BaseFont /${FONT} /Encoding /UniJIS-UTF16-H /DescendantFonts [${ref(cidN)}] >>`;
    objs[cidN - 1] = `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${FONT} /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor ${ref(descN)} /DW 1000 /W ${widths} >>`;
    objs[descN - 1] = `<< /Type /FontDescriptor /FontName /${FONT} /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 737 /StemV 114 /Style << /Panose <0801020B0600000000000000> >> >>`;
    const fields = [];
    const pageRefs = [];
    const X = mm => mm * PT;            // 左からの mm → pt
    const Y = mm => PH - mm * PT;       // 上からの mm → pt（PDF は下から）
    const text = (s, size, x, y) => { const q = pdfStr(s); return `BT /${q.f} ${num(size)} Tf ${num(x)} ${num(y)} Td ${q.t} Tj ET\n`; };
    /** 枠（左 x0・幅 w、縦の真ん中 cy。どれも pt）の真ん中に書く */
    const midText = (s, size, x0, w, cy) => {
      if (!s) return '';
      const sz = fitSize(s, size, w);
      return text(s, sz, x0 + (w - emW(s) * sz) / 2, cy - sz * 0.36);   // 日本語の字面のだいたいの中心が cy に来る
    };
    const centerText = (s, size, x0, w, yTop, h) => midText(s, size, x0, w, yTop - h / 2);
    /** 入力欄（文字の欄）。値があれば、見え方（AP）もここで作る */
    const field = (pageN, name, value, x, yTop, w, h, size) => {
      const rect = [x + 0.6, yTop - h + 0.6, x + w - 0.6, yTop - 0.6];
      const fw = rect[2] - rect[0], fh = rect[3] - rect[1];
      let ap = '';
      if (value) {
        const sz = fitSize(value, size, fw);
        const tw2 = emW(value) * sz;
        const q = pdfStr(value);
        const by = isAscii(value) ? fh / 2 - sz * 0.35 : fh / 2 - sz * 0.36;
        const stream = `/Tx BMC q BT /${q.f} ${num(sz)} Tf 0 g ${num((fw - tw2) / 2)} ${num(by)} Td ${q.t} Tj ET Q EMC`;
        const apN = add(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${num(fw)} ${num(fh)}] /Resources << ${FONTS} >> /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        ap = ` /AP << /N ${ref(apN)} >>`;
      }
      const v = value ? ` /V <FEFF${hex16(value)}>` : '';
      const n = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /F 4 /Q 1 /Ff 0 /DA (/F1 ${num(size)} Tf 0 g) /Rect [${rect.map(num).join(' ')}] /P ${ref(pageN)} /MK << >>${v}${ap} >>`);
      fields.push(n);
      return n;
    };
    for (let pi = 0; pi < m.pages.length; pi++) {
      const p = m.pages[pi];
      const pageN = add(null);
      pageRefs.push(pageN);
      const annots = [];
      let c = '';
      const left = g.ml;
      const cols = g.cols;
      const xs = [left];
      cols.forEach(w => xs.push(xs[xs.length - 1] + w));
      const right = xs[xs.length - 1];
      // 題と奉仕年度
      const tTop = g.mt;
      c += text(TITLE + (m.sub ? '（' + m.sub + '）' : ''), g.fTitle, X(left + g.cw / 2) - emW(TITLE + (m.sub ? '（' + m.sub + '）' : '')) * g.fTitle / 2, Y(tTop + 7));
      c += text('奉仕年度：', 9, X(right - 40), Y(tTop + 7));
      c += `0.3 w ${num(X(right - 24))} ${num(Y(tTop + 8.2))} m ${num(X(right))} ${num(Y(tTop + 8.2))} l S\n`;
      annots.push(field(pageN, 'p' + (pi + 1) + '_year', m.year, X(right - 24), Y(tTop + 1.6), 24 * PT, 6.4 * PT, 11));
      // 表の見出し（うすい灰色）
      const top = tTop + g.titleH;
      const hb = top + g.head1 + g.head2;
      c += `0.93 g ${num(X(left))} ${num(Y(hb))} ${num(g.cw * PT)} ${num((g.head1 + g.head2) * PT)} re f 0 g\n`;
      c += centerText('区域番号', g.fHead, X(xs[0]), cols[0] * PT, Y(top), (g.head1 + g.head2) * PT);
      const hcy = Y(top + (g.head1 + g.head2) / 2), gap = g.fHead * 0.62;
      c += midText('最後に完了', g.fHead, X(xs[1]), cols[1] * PT, hcy + gap);
      c += midText('した日付＊', g.fHead, X(xs[1]), cols[1] * PT, hcy - gap);
      for (let j = 0; j < PER; j++) {
        const x0 = xs[2 + j * 2];
        c += centerText('割り当てられた人', g.fHead, X(x0), (cols[2 + j * 2] + cols[3 + j * 2]) * PT, Y(top), g.head1 * PT);
        c += centerText('割り当てた日付', g.fHead * 0.92, X(x0), cols[2 + j * 2] * PT, Y(top + g.head1), g.head2 * PT);
        c += centerText('完了した日付', g.fHead * 0.92, X(xs[3 + j * 2]), cols[3 + j * 2] * PT, Y(top + g.head1), g.head2 * PT);
      }
      // 線
      const bodyTop = hb;
      const rowsN = p.blocks.length * 2;
      const bottom = bodyTop + rowsN * g.rowH;
      const line = (x1, y1, x2, y2) => `${num(X(x1))} ${num(Y(y1))} m ${num(X(x2))} ${num(Y(y2))} l S\n`;
      c += '0.4 w\n';
      // 横線：見出しの中・各区域の中（名前と日付のあいだ）
      c += line(xs[2], top + g.head1, right, top + g.head1);
      for (let b = 0; b < p.blocks.length; b++) c += line(xs[2], bodyTop + (b * 2 + 1) * g.rowH, right, bodyTop + (b * 2 + 1) * g.rowH);
      // 縦線：日付の欄の中の線（名前の行には入れない）
      for (let j = 0; j < PER; j++) {
        const xm = xs[3 + j * 2];
        c += line(xm, top + g.head1, xm, top + g.head1 + g.head2);
        for (let b = 0; b < p.blocks.length; b++) c += line(xm, bodyTop + (b * 2 + 1) * g.rowH, xm, bodyTop + (b * 2 + 2) * g.rowH);
      }
      c += '0.9 w\n';
      // 太い線：外枠・見出しの下・区域ごとの区切り・割り当てごとの区切り
      c += `${num(X(left))} ${num(Y(bottom))} ${num(g.cw * PT)} ${num((bottom - top) * PT)} re S\n`;
      c += line(left, bodyTop, right, bodyTop);
      p.blocks.forEach((b, i) => { if (i && !b.cont) c += line(left, bodyTop + i * 2 * g.rowH, right, bodyTop + i * 2 * g.rowH); });
      c += '0.6 w\n';
      p.blocks.forEach((b, i) => { if (i && b.cont) c += line(xs[2], bodyTop + i * 2 * g.rowH, right, bodyTop + i * 2 * g.rowH); });
      p.blocks.forEach((b, i) => { if (i && b.cont) c += line(left, bodyTop + i * 2 * g.rowH, xs[2], bodyTop + i * 2 * g.rowH); });
      for (let k = 1; k <= 2 + PER - 1; k++) {
        const xk = k === 1 ? xs[1] : xs[2 + (k - 2) * 2];
        c += line(xk, top, xk, bottom);
      }
      // 入力欄
      p.blocks.forEach((b, i) => {
        const y0 = bodyTop + i * 2 * g.rowH;
        const r = 'p' + (pi + 1) + '_r' + (i + 1);
        annots.push(field(pageN, r + '_no', b.no, X(xs[0]), Y(y0), cols[0] * PT, 2 * g.rowH * PT, g.fName));
        annots.push(field(pageN, r + '_last', b.last, X(xs[1]), Y(y0), cols[1] * PT, 2 * g.rowH * PT, g.fDate));
        b.cells.forEach((cl, j) => {
          const x0 = xs[2 + j * 2];
          annots.push(field(pageN, r + '_name' + (j + 1), cl.name, X(x0), Y(y0), (cols[2 + j * 2] + cols[3 + j * 2]) * PT, g.rowH * PT, g.fName));
          annots.push(field(pageN, r + '_from' + (j + 1), cl.from, X(x0), Y(y0 + g.rowH), cols[2 + j * 2] * PT, g.rowH * PT, g.fDate));
          annots.push(field(pageN, r + '_to' + (j + 1), cl.to, X(xs[3 + j * 2]), Y(y0 + g.rowH), cols[3 + j * 2] * PT, g.rowH * PT, g.fDate));
        });
      });
      // 注と、紙の番号
      c += text(NOTE, 6.5, X(left), Y(bottom + 4.2));
      const foot = (m.made ? m.made + '　' : '') + (pi + 1) + ' / ' + m.pages.length;
      c += text(foot, 6.5, X(right) - emW(foot) * 6.5, Y(bottom + 4.2));
      const raw = enc.encode(c);
      const z = await squeeze(raw, 'deflate');
      const contN = add(z ? { dict: `<< /Length ${z.length} /Filter /FlateDecode >>`, bin: z } : { dict: `<< /Length ${raw.length} >>`, bin: raw });
      objs[pageN - 1] = `<< /Type /Page /Parent ${ref(pagesN)} /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << ${FONTS} /ProcSet [/PDF /Text] >> /Contents ${ref(contN)} /Annots [${annots.map(ref).join(' ')}] >>`;
    }
    objs[pagesN - 1] = `<< /Type /Pages /Kids [${pageRefs.map(ref).join(' ')}] /Count ${pageRefs.length} >>`;
    objs[acro - 1] = `<< /Fields [${fields.map(ref).join(' ')}] /DR << ${FONTS} >> /DA (/F1 8 Tf 0 g) >>`;
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pagesN)} /AcroForm ${ref(acro)} /Lang (ja-JP) /ViewerPreferences << /DisplayDocTitle true >> >>`;
    const info = add(`<< /Title <FEFF${hex16(TITLE + '（' + m.year + '奉仕年度' + (m.sub ? '・' + m.sub : '') + '）')}> /Producer (kuiki) /Creator <FEFF${hex16('区域訪問管理')}> >>`);
    // 書き出し
    const parts = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];   // %PDF-1.7 と、文字でない印
    let pos = parts[0].length;
    const offs = [];
    objs.forEach((o, i) => {
      offs.push(pos);
      let chunk;
      if (o && o.bin) chunk = concat([enc.encode((i + 1) + ' 0 obj\n' + o.dict + '\nstream\n'), o.bin, enc.encode('\nendstream\nendobj\n')]);
      else chunk = enc.encode((i + 1) + ' 0 obj\n' + o + '\nendobj\n');
      parts.push(chunk);
      pos += chunk.length;
    });
    const xref = ['xref', '0 ' + (objs.length + 1), '0000000000 65535 f '].concat(offs.map(o => String(o).padStart(10, '0') + ' 00000 n ')).join('\n') + '\n';
    parts.push(enc.encode(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${ref(catalog)} /Info ${ref(info)} >>\nstartxref\n${pos}\n%%EOF\n`));
    return new Blob([concat(parts)], { type: 'application/pdf' });
  }

  K.s13 = { SHEETS: SHEETS, PER: PER, model: model, html: html, docx: docx, pdf: pdf, zip: zip, crc32: crc32, dateTxt: dateTxt };
})(typeof window !== 'undefined' ? window : globalThis);

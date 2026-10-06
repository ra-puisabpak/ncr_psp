// Goods receipt log (บันทึกการรับสินค้า): one Worker serves the page and its API.
// Records are stored in D1 (binding DB), photos in R2 (binding PHOTOS).
// Optional secret APP_PIN: when set, saving and viewing need that PIN.

const MAX_PHOTOS = 5;                    // per photo field
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // the page shrinks photos to far less than this
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const LIST_LIMIT = 50;
const PHOTO_KEY = /^(product|invoice)\/\d{8}\/[0-9a-f-]{36}\.jpg$/;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const fail = (status, message) => json({ error: message }, status);

function pinOk(request, env) {
  const want = String(env.APP_PIN || '');
  if (!want) return true;
  let got = '';
  try { got = decodeURIComponent(request.headers.get('X-Pin') || ''); } catch { return false; }
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// Form posts send line breaks as CR LF; records keep plain LF.
const text = (form, name, max) => String(form.get(name) ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// Reads the photos of one field and checks each really is a JPEG of a sane size.
async function readPhotos(form, field) {
  const files = form.getAll(field).filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');
  if (files.length > MAX_PHOTOS) throw new Error(`แนบได้สูงสุด ${MAX_PHOTOS} รูปต่อช่อง`);
  const out = [];
  for (const f of files) {
    if (!f.size || f.size > MAX_PHOTO_BYTES) throw new Error('ไฟล์รูปใหญ่เกินไปหรือว่างเปล่า');
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new Error('รับเฉพาะไฟล์รูป JPEG');
    out.push(bytes);
  }
  return out;
}

async function saveReceipt(request, env) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return fail(413, 'ข้อมูลใหญ่เกินไป');
  let form;
  try { form = await request.formData(); } catch { return fail(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }

  const receiver = text(form, 'receiver', 100), items = text(form, 'items', 2000), qty = text(form, 'qty', 200);
  if (!receiver || !items || !qty) return fail(400, 'กรุณากรอก ผู้รับของ รายการสินค้า และจำนวน');

  let product, invoice;
  try { product = await readPhotos(form, 'product'); invoice = await readPhotos(form, 'invoice'); }
  catch (e) { return fail(400, e.message); }

  const now = new Date();
  // Photo folders are named by the Thai calendar day (UTC+7).
  const day = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const saved = [];
  const put = async (kind, list) => {
    const keys = [];
    for (const bytes of list) {
      const key = `${kind}/${day}/${crypto.randomUUID()}.jpg`;
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      saved.push(key); keys.push(key);
    }
    return keys;
  };

  try {
    const productKeys = await put('product', product);
    const invoiceKeys = await put('invoice', invoice);
    await env.DB.prepare(
      'INSERT INTO receipts (created_at, receiver, items, qty, supplier, note, product_photos, invoice_photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(now.toISOString(), receiver, items, qty, text(form, 'supplier', 200), text(form, 'note', 1000),
      JSON.stringify(productKeys), JSON.stringify(invoiceKeys)).run();
  } catch (e) {
    // Nothing half-saved: remove photos already stored for a record that did not get written.
    await Promise.allSettled(saved.map((k) => env.PHOTOS.delete(k)));
    throw e;
  }
  return json({ ok: true, created_at: now.toISOString() }, 201);
}

const keys = (value) => {
  try { const a = JSON.parse(value); return Array.isArray(a) ? a.filter((k) => typeof k === 'string' && PHOTO_KEY.test(k)) : []; }
  catch { return []; }
};

async function listReceipts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, receiver, items, qty, supplier, note, product_photos, invoice_photos FROM receipts ORDER BY id DESC LIMIT ?'
  ).bind(LIST_LIMIT).all();
  return json(results.map((r) => ({ ...r, product_photos: keys(r.product_photos), invoice_photos: keys(r.invoice_photos) })));
}

async function getPhoto(key, env) {
  if (!PHOTO_KEY.test(key)) return fail(404, 'ไม่พบรูป');
  const obj = await env.PHOTOS.get(key);
  if (!obj) return fail(404, 'ไม่พบรูป');
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    return new Response(PAGE, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (method === 'GET' && path === '/api/config') return json({ needPin: !!env.APP_PIN });

  if (path.startsWith('/api/')) {
    if (!pinOk(request, env)) return fail(401, 'รหัส PIN ไม่ถูกต้อง');
    if (path === '/api/receipts' && method === 'GET') return listReceipts(env);
    if (path === '/api/receipts' && method === 'POST') return saveReceipt(request, env);
    if (path.startsWith('/api/photos/') && method === 'GET') return getPhoto(decodeURIComponent(path.slice('/api/photos/'.length)), env);
  }
  return fail(404, 'ไม่พบหน้านี้');
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) { console.error(e); return fail(500, 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง'); }
  },
};

// The page. Its script avoids backticks and dollar-brace so it can live inside this template string.
const PAGE = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b6e4f">
<title>บันทึกการรับสินค้า</title>
<style>
  :root{--bg:#f4f6f8;--card:#fff;--ink:#1c2733;--mute:#5d6b7a;--line:#d5dbe2;--brand:#0b6e4f;--brand-ink:#fff;--err:#b3261e;--ok:#0b6e4f}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Sarabun","Noto Sans Thai",Tahoma,sans-serif}
  header{background:var(--brand);color:var(--brand-ink);padding:14px 16px;font-size:18px;font-weight:700}
  nav{display:flex;background:var(--card);border-bottom:1px solid var(--line)}
  nav button{flex:1;padding:12px 8px;border:0;background:none;font:inherit;color:var(--mute);border-bottom:3px solid transparent}
  nav button.on{color:var(--brand);border-bottom-color:var(--brand);font-weight:700}
  main{max-width:560px;margin:0 auto;padding:16px}
  label{display:block;font-weight:600;margin:14px 0 4px}
  label small{font-weight:400;color:var(--mute)}
  input[type=text],input[type=password],textarea{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--card);color:var(--ink)}
  textarea{min-height:76px;resize:vertical}
  .pick{display:block;width:100%;padding:12px;border:1px dashed var(--brand);border-radius:8px;background:var(--card);color:var(--brand);font:inherit;font-weight:600;text-align:center;margin:0}
  input[type=file]{position:absolute;left:-9999px}
  .thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .thumbs div{position:relative}
  .thumbs img{width:76px;height:76px;object-fit:cover;border-radius:6px;border:1px solid var(--line);display:block}
  .thumbs button{position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;border:0;background:var(--err);color:#fff;font-size:14px;line-height:1}
  .go{width:100%;margin-top:20px;padding:14px;border:0;border-radius:8px;background:var(--brand);color:var(--brand-ink);font:inherit;font-size:17px;font-weight:700}
  .go:disabled{opacity:.55}
  #msg{margin-top:12px;padding:10px 12px;border-radius:8px;display:none}
  #msg.ok{display:block;background:#e3f3ec;color:var(--ok)}
  #msg.err{display:block;background:#fbe9e7;color:var(--err)}
  .rec{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .rec .top{display:flex;justify-content:space-between;gap:8px;color:var(--mute);font-size:14px}
  .rec .who{font-weight:700;color:var(--ink)}
  .rec .items{white-space:pre-wrap;margin:6px 0 2px;overflow-wrap:anywhere}
  .rec .sub{color:var(--mute);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
  .rec .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .rec .btns button{padding:6px 10px;border:1px solid var(--brand);border-radius:6px;background:none;color:var(--brand);font:inherit;font-size:14px}
  .rec img{max-width:100%;border-radius:6px;margin-top:8px;display:block}
  .hint{color:var(--mute);text-align:center;padding:24px 0}
  .hide{display:none}
</style>
</head>
<body>
<header>บันทึกการรับสินค้า</header>
<nav><button id="tabAdd" class="on">บันทึกรับของ</button><button id="tabList">รายการที่รับแล้ว</button></nav>
<main>
  <div id="pinBox" class="hide">
    <label for="pin">รหัส PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off">
  </div>

  <section id="pageAdd">
    <label for="receiver">ผู้รับของ</label>
    <input id="receiver" type="text" autocomplete="name" maxlength="100">
    <label for="items">รายการสินค้าที่รับ</label>
    <textarea id="items" maxlength="2000"></textarea>
    <label for="qty">จำนวนที่รับจริง</label>
    <input id="qty" type="text" maxlength="200">
    <label for="supplier">ผู้ขาย / บริษัทขนส่ง <small>(ไม่บังคับ)</small></label>
    <input id="supplier" type="text" maxlength="200">
    <label for="note">หมายเหตุ <small>(ไม่บังคับ)</small></label>
    <textarea id="note" maxlength="1000"></textarea>

    <label>รูปถ่ายสินค้า <small>(สูงสุด 5 รูป)</small></label>
    <label class="pick" for="fProduct">ถ่ายรูป / เลือกรูปสินค้า</label>
    <input id="fProduct" type="file" accept="image/*" multiple>
    <div id="tProduct" class="thumbs"></div>

    <label>รูปถ่าย Invoice <small>(สูงสุด 5 รูป)</small></label>
    <label class="pick" for="fInvoice">ถ่ายรูป / เลือกรูป Invoice</label>
    <input id="fInvoice" type="file" accept="image/*" multiple>
    <div id="tInvoice" class="thumbs"></div>

    <button id="save" class="go">บันทึก</button>
    <div id="msg"></div>
  </section>

  <section id="pageList" class="hide"><div id="list" class="hint">กำลังโหลด...</div></section>
</main>

<script>
var MAX = 5;
var needPin = false;
var photos = { product: [], invoice: [] };

function $(id){ return document.getElementById(id); }
function showMsg(text, kind){ var m = $('msg'); m.textContent = text; m.className = kind || ''; }
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function remember(key, value){ try { localStorage.setItem(key, value); } catch (e) {} }
function recall(key){ try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

$('receiver').value = recall('receiver');
$('pin').value = recall('pin');

function api(path, options){
  options = options || {};
  options.headers = { 'X-Pin': encodeURIComponent($('pin').value) };
  return fetch(path, options);
}
async function readError(res){
  try { var j = await res.json(); if (j && j.error) return j.error; } catch (e) {}
  return 'เกิดข้อผิดพลาด (' + res.status + ')';
}

fetch('/api/config').then(function(r){ return r.json(); }).then(function(c){
  needPin = !!c.needPin;
  if (needPin) $('pinBox').className = '';
}).catch(function(){});

function show(tab){
  $('pageAdd').className = tab === 'add' ? '' : 'hide';
  $('pageList').className = tab === 'list' ? '' : 'hide';
  $('tabAdd').className = tab === 'add' ? 'on' : '';
  $('tabList').className = tab === 'list' ? 'on' : '';
  if (tab === 'list') loadList();
}
$('tabAdd').onclick = function(){ show('add'); };
$('tabList').onclick = function(){ show('list'); };

// Shrinks a photo to a JPEG no longer than 1600px on its long side before sending.
function shrink(file){
  return new Promise(function(resolve){
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function(){
      var k = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function(blob){ resolve(blob ? { blob: blob, preview: URL.createObjectURL(blob) } : null); }, 'image/jpeg', 0.8);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function draw(kind){
  var box = $(kind === 'product' ? 'tProduct' : 'tInvoice');
  box.textContent = '';
  photos[kind].forEach(function(p, i){
    var d = el('div');
    var im = el('img'); im.src = p.preview; im.alt = 'รูปที่ ' + (i + 1);
    var x = el('button', '', '×'); x.type = 'button';
    x.setAttribute('aria-label', 'ลบรูปที่ ' + (i + 1));
    x.onclick = function(){ photos[kind].splice(i, 1); draw(kind); };
    d.appendChild(im); d.appendChild(x); box.appendChild(d);
  });
}

function bind(inputId, kind){
  $(inputId).onchange = async function(ev){
    var files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = '';
    var bad = 0;
    for (var i = 0; i < files.length; i++) {
      if (photos[kind].length >= MAX) { showMsg('แนบได้สูงสุด ' + MAX + ' รูปต่อช่อง', 'err'); break; }
      var p = await shrink(files[i]);
      if (p) { photos[kind].push(p); draw(kind); } else { bad++; }
    }
    if (bad) showMsg('มีรูปที่เปิดไม่ได้ ' + bad + ' รูป ลองถ่ายใหม่', 'err');
  };
}
bind('fProduct', 'product'); bind('fInvoice', 'invoice');

$('save').onclick = async function(){
  var d = {
    receiver: $('receiver').value.trim(), items: $('items').value.trim(), qty: $('qty').value.trim(),
    supplier: $('supplier').value.trim(), note: $('note').value.trim()
  };
  if (!d.receiver || !d.items || !d.qty) { showMsg('กรุณากรอก ผู้รับของ รายการสินค้า และจำนวน', 'err'); return; }
  if (needPin && !$('pin').value) { showMsg('กรุณาใส่รหัส PIN', 'err'); return; }

  var form = new FormData();
  Object.keys(d).forEach(function(k){ form.append(k, d[k]); });
  photos.product.forEach(function(p, i){ form.append('product', p.blob, 'product' + (i + 1) + '.jpg'); });
  photos.invoice.forEach(function(p, i){ form.append('invoice', p.blob, 'invoice' + (i + 1) + '.jpg'); });

  var btn = $('save'); btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  showMsg('');
  try {
    var res = await api('/api/receipts', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await readError(res));
    remember('receiver', d.receiver); remember('pin', $('pin').value);
    ['items', 'qty', 'supplier', 'note'].forEach(function(id){ $(id).value = ''; });
    photos.product = []; photos.invoice = []; draw('product'); draw('invoice');
    showMsg('บันทึกแล้ว', 'ok');
  } catch (err) {
    var why = (err && err.message) ? err.message : String(err);
    if (err instanceof TypeError) why = 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต';
    showMsg('บันทึกไม่สำเร็จ: ' + why + ' (ข้อมูลยังอยู่ กดบันทึกอีกครั้งได้)', 'err');
  }
  btn.disabled = false; btn.textContent = 'บันทึก';
};

function when(iso){
  var t = new Date(iso);
  if (isNaN(t)) return '';
  return t.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
}

function photoButtons(card, list, label){
  (list || []).forEach(function(key, i){
    var name = label + ' ' + (i + 1);
    var b = el('button', '', name); b.type = 'button';
    b.onclick = async function(){
      b.disabled = true; b.textContent = 'กำลังโหลด...';
      try {
        var res = await api('/api/photos/' + key);
        if (!res.ok) throw new Error();
        var im = el('img'); im.src = URL.createObjectURL(await res.blob()); im.alt = name;
        card.appendChild(im); b.remove();
      } catch (e) { b.disabled = false; b.textContent = name + ' (โหลดไม่ได้ กดอีกครั้ง)'; }
    };
    card.querySelector('.btns').appendChild(b);
  });
}

async function loadList(){
  var box = $('list');
  box.className = 'hint';
  if (needPin && !$('pin').value) { box.textContent = 'ใส่รหัส PIN ด้านบนก่อน แล้วกดแท็บนี้อีกครั้ง'; return; }
  box.textContent = 'กำลังโหลด...';
  var rows;
  try {
    var res = await api('/api/receipts');
    if (!res.ok) { box.textContent = 'โหลดไม่สำเร็จ: ' + await readError(res); return; }
    rows = await res.json();
    remember('pin', $('pin').value);
  } catch (e) { box.textContent = 'โหลดไม่สำเร็จ: เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต'; return; }
  if (!rows.length) { box.textContent = 'ยังไม่มีรายการ'; return; }
  box.textContent = ''; box.className = '';
  rows.forEach(function(r){
    var card = el('div', 'rec');
    var top = el('div', 'top'); top.appendChild(el('span', 'who', r.receiver)); top.appendChild(el('span', '', when(r.created_at)));
    card.appendChild(top);
    card.appendChild(el('div', 'items', r.items));
    var sub = 'จำนวน: ' + r.qty;
    if (r.supplier) sub += '\\nผู้ขาย/ขนส่ง: ' + r.supplier;
    if (r.note) sub += '\\nหมายเหตุ: ' + r.note;
    card.appendChild(el('div', 'sub', sub));
    card.appendChild(el('div', 'btns'));
    photoButtons(card, r.product_photos, 'รูปสินค้า');
    photoButtons(card, r.invoice_photos, 'รูป Invoice');
    box.appendChild(card);
  });
}
</script>
</body>
</html>`;

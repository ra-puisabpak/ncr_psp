// Goods receipt log (บันทึกการรับสินค้า): one Worker serves the page and its API.
// Records are stored in D1 (binding DB), photos in R2 (binding PHOTOS).
// Optional secret APP_PIN: when set, saving and viewing need that PIN.
// Optional secrets LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET (a LINE Official Account with the
// Messaging API): when set, every saved record is announced in one LINE group. The group is chosen by
// typing the BIND phrase in it; LINE delivers that message to /line/webhook.

const MAX_PHOTOS = 5;                    // per photo field
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // the page shrinks photos to far less than this
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const LIST_LIMIT = 50;
const REPORT_LIMIT = 300;                // records on one daily report
const MAX_LINES = 30;                  // goods lines in one record
const LINE_BIND = 'ตั้งกลุ่มแจ้งเตือน';     // typed in a LINE group: announce records here
const LINE_UNBIND = 'ยกเลิกกลุ่มแจ้งเตือน'; // typed in that same group: stop announcing
const LINE_TEXT_MAX = 4500;              // LINE allows 5000 characters in one text message
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

// Goods lines arrive as a JSON list of { item, qty }. Blank rows are dropped; a row needs both parts.
function readLines(form) {
  let list;
  try { list = JSON.parse(String(form.get('lines') ?? '[]')); } catch { list = null; }
  if (!Array.isArray(list)) throw new Error('รูปแบบรายการสินค้าไม่ถูกต้อง');
  const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const lines = [];
  for (const row of list) {
    const item = clean(row && row.item, 200), qty = clean(row && row.qty, 100);
    if (!item && !qty) continue;
    if (!item || !qty) throw new Error('กรุณากรอกทั้งชื่อสินค้าและจำนวนให้ครบทุกแถว');
    lines.push({ item, qty });
  }
  if (!lines.length) throw new Error('กรุณากรอกสินค้าและจำนวนอย่างน้อย 1 รายการ');
  if (lines.length > MAX_LINES) throw new Error(`บันทึกได้สูงสุด ${MAX_LINES} รายการสินค้าต่อครั้ง`);
  return lines;
}

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

// ---------- LINE group announcements ----------

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
const setSetting = (env, key, value) => env.DB.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).bind(key, value).run();
const clearSetting = (env, key) => env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();

const lineOn = (env) => !!(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET);

function lineCall(env, kind, payload) {
  return fetch('https://api.line.me/v2/bot/message/' + kind, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
}

// Thai time (UTC+7) as dd/mm/yyyy hh:mm.
function thaiTime(date) {
  const t = new Date(date.getTime() + 7 * 3600 * 1000).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}`;
}

function lineText(rec, appUrl) {
  const head = [`📦 รับสินค้า ${thaiTime(rec.when)}`, `ผู้รับของ: ${rec.receiver}`];
  if (rec.supplier) head.push(`ผู้ขาย/ขนส่ง: ${rec.supplier}`);
  const tail = [];
  if (rec.note) tail.push(`หมายเหตุ: ${rec.note}`);
  tail.push(`รูปสินค้า ${rec.productCount} รูป · รูป Invoice ${rec.invoiceCount} รูป`);
  tail.push(`ดูรายการและรูป: ${appUrl}`);
  // Goods lines are added while the whole message still fits; the rest are counted, never silently lost.
  const room = LINE_TEXT_MAX - head.join('\n').length - tail.join('\n').length - 40;
  const goods = [];
  let used = 0;
  for (const l of rec.lines) {
    const row = `• ${l.item} — ${l.qty}`;
    if (used + row.length + 1 > room) break;
    goods.push(row); used += row.length + 1;
  }
  if (goods.length < rec.lines.length) goods.push(`… และอีก ${rec.lines.length - goods.length} รายการ`);
  return [...head, ...goods, ...tail].join('\n').slice(0, 5000);
}

// Announces a saved record. Returns 'off' (LINE not set up or no group chosen), 'sent' or 'failed'.
// A failure never undoes the save: the record is already stored.
async function announce(env, rec, appUrl) {
  if (!lineOn(env)) return 'off';
  try {
    const groupId = await getSetting(env, 'line_group_id');
    if (!groupId) return 'off';
    const res = await lineCall(env, 'push', { to: groupId, messages: [{ type: 'text', text: lineText(rec, appUrl) }] });
    if (res.ok) return 'sent';
    console.error('LINE push refused', res.status, await res.text());
  } catch (e) { console.error('LINE push failed', e); }
  return 'failed';
}

async function lineSignatureOk(raw, signature, secret) {
  if (!signature) return false;
  let sig;
  try { sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sig, raw);
}

// LINE calls this for messages sent where the Official Account is present. Only the two phrases
// typed in a group do anything. The first group to ask becomes the announcement group; it can be
// changed only after that same group releases it, so another group cannot take the announcements over.
async function lineWebhook(request, env) {
  if (!lineOn(env)) return fail(503, 'ยังไม่ได้ตั้งค่า LINE');
  const raw = await request.arrayBuffer();
  if (!(await lineSignatureOk(raw, request.headers.get('X-Line-Signature'), env.LINE_CHANNEL_SECRET))) return fail(401, 'ลายเซ็นไม่ถูกต้อง');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return fail(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }

  for (const ev of Array.isArray(body.events) ? body.events : []) {
    if (!ev || ev.type !== 'message' || !ev.message || ev.message.type !== 'text') continue;
    if (!ev.source || ev.source.type !== 'group' || !ev.source.groupId) continue;
    const said = String(ev.message.text || '').trim();
    if (said !== LINE_BIND && said !== LINE_UNBIND) continue;

    const groupId = ev.source.groupId;
    const current = await getSetting(env, 'line_group_id');
    let reply = null;
    if (said === LINE_BIND) {
      if (!current) { await setSetting(env, 'line_group_id', groupId); reply = 'ตั้งกลุ่มนี้เป็นกลุ่มรับแจ้งเตือนการรับสินค้าแล้ว ✅'; }
      else if (current === groupId) reply = 'กลุ่มนี้รับแจ้งเตือนการรับสินค้าอยู่แล้ว';
      else reply = 'มีกลุ่มอื่นรับแจ้งเตือนอยู่แล้ว ให้พิมพ์ "' + LINE_UNBIND + '" ในกลุ่มเดิมก่อน';
    } else if (current === groupId) {
      await clearSetting(env, 'line_group_id'); reply = 'ยกเลิกการแจ้งเตือนในกลุ่มนี้แล้ว';
    }
    if (reply && ev.replyToken) {
      try { await lineCall(env, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text: reply }] }); }
      catch (e) { console.error('LINE reply failed', e); }
    }
  }
  return json({ ok: true });
}

// ---------- Records ----------

async function saveReceipt(request, env) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return fail(413, 'ข้อมูลใหญ่เกินไป');
  let form;
  try { form = await request.formData(); } catch { return fail(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }

  const receiver = text(form, 'receiver', 100);
  if (!receiver) return fail(400, 'กรุณากรอกผู้รับของ');
  let lines;
  try { lines = readLines(form); } catch (e) { return fail(400, e.message); }

  let product, invoice;
  try { product = await readPhotos(form, 'product'); invoice = await readPhotos(form, 'invoice'); }
  catch (e) { return fail(400, e.message); }

  const now = new Date();
  // Photo folders are named by the Thai calendar day (UTC+7).
  const day = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const supplier = text(form, 'supplier', 200), note = text(form, 'note', 1000);
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
    // One batch is one transaction: the record and all its goods lines are saved together or not at all.
    await env.DB.batch([
      env.DB.prepare(
        // items and qty are the old free-text columns; goods now go to receipt_lines, so they stay empty.
        "INSERT INTO receipts (created_at, receiver, items, qty, supplier, note, product_photos, invoice_photos) VALUES (?, ?, '', '', ?, ?, ?, ?)"
      ).bind(now.toISOString(), receiver, supplier, note, JSON.stringify(productKeys), JSON.stringify(invoiceKeys)),
      ...lines.map((l, i) => env.DB.prepare(
        'INSERT INTO receipt_lines (receipt_id, line_no, item, qty) VALUES ((SELECT MAX(id) FROM receipts), ?, ?, ?)'
      ).bind(i + 1, l.item, l.qty)),
    ]);
  } catch (e) {
    // Nothing half-saved: remove photos already stored for a record that did not get written.
    await Promise.allSettled(saved.map((k) => env.PHOTOS.delete(k)));
    throw e;
  }
  const notify = await announce(env, {
    when: now, receiver, supplier, note, lines, productCount: product.length, invoiceCount: invoice.length,
  }, new URL(request.url).origin + '/');
  return json({ ok: true, created_at: now.toISOString(), notify }, 201);
}

const keys = (value) => {
  try { const a = JSON.parse(value); return Array.isArray(a) ? a.filter((k) => typeof k === 'string' && PHOTO_KEY.test(k)) : []; }
  catch { return []; }
};

// Turns receipt rows into what the page shows, attaching each record's goods lines.
async function withLines(env, results) {
  if (!results.length) return [];
  const ids = results.map((r) => r.id);
  const { results: lineRows } = await env.DB.prepare(
    'SELECT receipt_id, item, qty FROM receipt_lines WHERE receipt_id BETWEEN ? AND ? ORDER BY receipt_id, line_no'
  ).bind(Math.min(...ids), Math.max(...ids)).all();
  const byReceipt = new Map();
  for (const l of lineRows) {
    if (!byReceipt.has(l.receipt_id)) byReceipt.set(l.receipt_id, []);
    byReceipt.get(l.receipt_id).push({ item: l.item, qty: l.qty });
  }
  return results.map((r) => ({
    id: r.id, created_at: r.created_at, receiver: r.receiver, supplier: r.supplier, note: r.note,
    // Records saved before goods lines existed kept one free-text item and quantity.
    lines: byReceipt.get(r.id) || (r.items ? [{ item: r.items, qty: r.qty }] : []),
    product_photos: keys(r.product_photos), invoice_photos: keys(r.invoice_photos),
  }));
}

const RECEIPT_COLUMNS = 'id, created_at, receiver, items, qty, supplier, note, product_photos, invoice_photos';

// Latest records, newest first (the list tab).
async function listReceipts(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${RECEIPT_COLUMNS} FROM receipts ORDER BY id DESC LIMIT ?`
  ).bind(LIST_LIMIT).all();
  return json(await withLines(env, results));
}

// Every record of one Thai calendar day (UTC+7), in the order received (the daily report).
async function listDay(env, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const start = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 7 * 3600 * 1000 : NaN;
  if (!m || Number.isNaN(start) || new Date(start + 7 * 3600 * 1000).toISOString().slice(0, 10) !== day) {
    return fail(400, 'วันที่ไม่ถูกต้อง');
  }
  const { results } = await env.DB.prepare(
    `SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE created_at >= ? AND created_at < ? ORDER BY id ASC LIMIT ?`
  ).bind(new Date(start).toISOString(), new Date(start + 24 * 3600 * 1000).toISOString(), REPORT_LIMIT + 1).all();
  const more = results.length > REPORT_LIMIT;
  return json({ day, receipts: await withLines(env, results.slice(0, REPORT_LIMIT)), more });
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
  if (method === 'POST' && path === '/line/webhook') return lineWebhook(request, env);

  if (path.startsWith('/api/')) {
    if (!pinOk(request, env)) return fail(401, 'รหัส PIN ไม่ถูกต้อง');
    if (path === '/api/receipts' && method === 'GET') {
      const day = url.searchParams.get('date');
      return day === null ? listReceipts(env) : listDay(env, day);
    }
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
  .rec .sub{color:var(--mute);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
  .rec .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .rec .btns button{padding:6px 10px;border:1px solid var(--brand);border-radius:6px;background:none;color:var(--brand);font:inherit;font-size:14px}
  .rec img{max-width:100%;border-radius:6px;margin-top:8px;display:block}
  .hint{color:var(--mute);text-align:center;padding:24px 0}
  #pinBox{margin-bottom:14px}
  .now{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .now b{font-size:17px}
  .now small{color:var(--mute)}
  .line{display:flex;gap:6px;margin-bottom:6px;align-items:flex-start}
  .line .item{flex:2;min-width:0}
  .line .qty{flex:1;min-width:0}
  .line .del{flex:none;width:40px;height:46px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--err);font-size:18px;line-height:1}
  .line .del:disabled{opacity:.35}
  .linehead{display:flex;gap:6px;color:var(--mute);font-size:13px;margin-bottom:2px}
  .linehead span:first-child{flex:2}
  .linehead span:nth-child(2){flex:1}
  .linehead span:last-child{flex:none;width:40px}
  .add{width:100%;padding:10px;border:1px solid var(--brand);border-radius:8px;background:none;color:var(--brand);font:inherit;font-weight:600}
  .rec table{width:100%;border-collapse:collapse;margin:8px 0 4px}
  .rec td{padding:4px 0;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
  .rec td:last-child{text-align:right;padding-left:10px;width:38%}
  .hide{display:none}
  .tools{display:flex;gap:8px;align-items:flex-end;margin-bottom:12px}
  .tools label{margin:0 0 4px}
  .tools > div{flex:1}
  input[type=date]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--card);color:var(--ink)}
  .tools button{flex:none;padding:11px 16px;border:0;border-radius:8px;background:var(--brand);color:var(--brand-ink);font:inherit;font-weight:700}
  .tools button:disabled{opacity:.55}
  .sheetwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:#fff}
  .sheet{min-width:700px;padding:14px;color:#1a2130;font-size:12px;line-height:1.35;background:#fff}
  .sheet .hd{display:flex;align-items:flex-end;gap:10px;border-bottom:2px solid #0f2744;padding-bottom:6px}
  .sheet .co{font-size:16px;font-weight:700;color:#0f2744;line-height:1.25}
  .sheet .co2{font-size:11px;color:#5c6470}
  .sheet .ref{margin-left:auto;text-align:right;font-size:11px;line-height:1.5}
  .sheet h1{font-size:15px;text-align:center;color:#0f2744;margin:9px 0 2px}
  .sheet .sum{text-align:center;font-size:12px;margin-bottom:8px}
  .sheet table{width:100%;border-collapse:collapse;table-layout:fixed}
  .sheet th{background:#e9edf2;font-weight:700;font-size:11px;padding:4px 3px;border:1px solid #1a2130;text-align:center}
  .sheet td{border:1px solid #1a2130;padding:3px 5px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
  .sheet td.c{text-align:center}
  .sheet td.none{text-align:center;padding:14px;color:#5c6470}
  .sheet .warn{font-weight:700}
  .sheet .sg{display:flex;gap:40px;margin-top:26px;padding:0 20px}
  .sheet .sg div{flex:1;text-align:center;font-size:11.5px;line-height:1.9}
  .sheet .nt{font-size:10px;color:#5c6470;margin-top:8px}
  @page{size:A4 portrait;margin:10mm 12mm}
  @media print{
    body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    header,nav,#pinBox,#pageAdd,#pageList,.tools,#reportMsg{display:none!important}
    main{max-width:none;padding:0;margin:0}
    #pageReport{display:block!important}
    .sheetwrap{overflow:visible;border:0;border-radius:0}
    .sheet{min-width:0;padding:0;font-size:10.5pt}
    .sheet .co{font-size:14pt}.sheet .co2,.sheet .ref{font-size:9.5pt}
    .sheet h1{font-size:13pt}.sheet .sum{font-size:10.5pt}
    .sheet th{font-size:9.5pt}.sheet .sg div{font-size:10pt}.sheet .nt{font-size:8.5pt}
    .sheet thead{display:table-header-group}
    .sheet tbody,.sheet tr,.sheet .sg{break-inside:avoid;page-break-inside:avoid}
  }
</style>
</head>
<body>
<header>บันทึกการรับสินค้า</header>
<nav><button id="tabAdd" class="on">บันทึกรับของ</button><button id="tabList">รายการที่รับแล้ว</button><button id="tabReport">รายงาน</button></nav>
<main>
  <div id="pinBox" class="hide">
    <label for="pin">รหัส PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off">
  </div>

  <section id="pageAdd">
    <div class="now"><span><small>วันที่ / เวลา</small><br><b id="now"></b></span><small>บันทึกให้อัตโนมัติ</small></div>

    <label for="receiver">ผู้รับของ</label>
    <input id="receiver" type="text" autocomplete="name" maxlength="100">
    <label for="supplier">ผู้ขาย / บริษัทขนส่ง <small>(ไม่บังคับ)</small></label>
    <input id="supplier" type="text" maxlength="200">

    <label>รายการสินค้า</label>
    <div class="linehead"><span>สินค้า</span><span>จำนวน</span><span></span></div>
    <div id="lines"></div>
    <button id="addLine" type="button" class="add">+ เพิ่มสินค้า</button>

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

  <section id="pageReport" class="hide">
    <div class="tools">
      <div><label for="reportDay">วันที่ของรายงาน</label><input id="reportDay" type="date"></div>
      <button id="printReport" type="button" disabled>พิมพ์รายงาน</button>
    </div>
    <div id="reportMsg" class="hint">กำลังโหลด...</div>
    <div class="sheetwrap hide" id="sheetWrap"><div class="sheet" id="sheet"></div></div>
  </section>
</main>

<script>
var MAX = 5;
var MAX_LINES = 30;
var needPin = false;
var photos = { product: [], invoice: [] };

function $(id){ return document.getElementById(id); }
function showMsg(text, kind){ var m = $('msg'); m.textContent = text; m.className = kind || ''; }
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function remember(key, value){ try { localStorage.setItem(key, value); } catch (e) {} }
function recall(key){ try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

function clock(iso){
  var t = iso ? new Date(iso) : new Date();
  if (isNaN(t)) return '';
  return t.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
}
function tick(){ $('now').textContent = clock(); }
tick(); setInterval(tick, 15000);

// Goods rows: each row pairs one item with its quantity.
function addLine(focus){
  var box = $('lines');
  if (box.children.length >= MAX_LINES) { showMsg('บันทึกได้สูงสุด ' + MAX_LINES + ' รายการสินค้าต่อครั้ง', 'err'); return; }
  var n = box.children.length + 1;
  var row = el('div', 'line');
  var item = el('input', 'item'); item.type = 'text'; item.maxLength = 200; item.setAttribute('aria-label', 'สินค้า');
  var qty = el('input', 'qty'); qty.type = 'text'; qty.maxLength = 100; qty.setAttribute('aria-label', 'จำนวน');
  var del = el('button', 'del', '×'); del.type = 'button'; del.setAttribute('aria-label', 'ลบแถวสินค้า');
  del.onclick = function(){ row.remove(); if (!box.children.length) addLine(); syncLines(); };
  row.appendChild(item); row.appendChild(qty); row.appendChild(del); box.appendChild(row);
  syncLines();
  if (focus) item.focus();
}
// The only row cannot be removed, so there is always somewhere to type.
function syncLines(){
  var rows = $('lines').children;
  for (var i = 0; i < rows.length; i++) rows[i].querySelector('.del').disabled = rows.length === 1;
}
function readLines(){
  var out = [], rows = $('lines').children;
  for (var i = 0; i < rows.length; i++) {
    out.push({ item: rows[i].querySelector('.item').value.trim(), qty: rows[i].querySelector('.qty').value.trim() });
  }
  return out;
}
function resetLines(){ $('lines').textContent = ''; addLine(); }
$('addLine').onclick = function(){ addLine(true); };
addLine();

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
  $('pageReport').className = tab === 'report' ? '' : 'hide';
  $('tabAdd').className = tab === 'add' ? 'on' : '';
  $('tabList').className = tab === 'list' ? 'on' : '';
  $('tabReport').className = tab === 'report' ? 'on' : '';
  if (tab === 'list') loadList();
  if (tab === 'report') loadReport();
}
$('tabAdd').onclick = function(){ show('add'); };
$('tabList').onclick = function(){ show('list'); };
$('tabReport').onclick = function(){ show('report'); };

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
  var d = { receiver: $('receiver').value.trim(), supplier: $('supplier').value.trim(), note: $('note').value.trim() };
  var lines = readLines().filter(function(l){ return l.item || l.qty; });
  if (!d.receiver) { showMsg('กรุณากรอกผู้รับของ', 'err'); return; }
  if (!lines.length) { showMsg('กรุณากรอกสินค้าและจำนวนอย่างน้อย 1 รายการ', 'err'); return; }
  if (lines.some(function(l){ return !l.item || !l.qty; })) { showMsg('กรุณากรอกทั้งชื่อสินค้าและจำนวนให้ครบทุกแถว', 'err'); return; }
  if (needPin && !$('pin').value) { showMsg('กรุณาใส่รหัส PIN', 'err'); return; }

  var form = new FormData();
  Object.keys(d).forEach(function(k){ form.append(k, d[k]); });
  form.append('lines', JSON.stringify(lines));
  photos.product.forEach(function(p, i){ form.append('product', p.blob, 'product' + (i + 1) + '.jpg'); });
  photos.invoice.forEach(function(p, i){ form.append('invoice', p.blob, 'invoice' + (i + 1) + '.jpg'); });

  var btn = $('save'); btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  showMsg('');
  try {
    var res = await api('/api/receipts', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await readError(res));
    var saved = await res.json();
    remember('receiver', d.receiver); remember('pin', $('pin').value);
    ['supplier', 'note'].forEach(function(id){ $(id).value = ''; });
    resetLines();
    photos.product = []; photos.invoice = []; draw('product'); draw('invoice');
    var done = 'บันทึกแล้ว เวลา ' + clock(saved.created_at);
    if (saved.notify === 'sent') done += ' และแจ้งเตือนในกลุ่ม LINE แล้ว';
    if (saved.notify === 'failed') done += ' แต่แจ้งเตือนในกลุ่ม LINE ไม่สำเร็จ กรุณาแจ้งในกลุ่มเอง';
    showMsg(done, 'ok');
  } catch (err) {
    var why = (err && err.message) ? err.message : String(err);
    if (err instanceof TypeError) why = 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต';
    showMsg('บันทึกไม่สำเร็จ: ' + why + ' (ข้อมูลยังอยู่ กดบันทึกอีกครั้งได้)', 'err');
  }
  btn.disabled = false; btn.textContent = 'บันทึก';
};

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
    var top = el('div', 'top'); top.appendChild(el('span', 'who', r.receiver)); top.appendChild(el('span', '', clock(r.created_at)));
    card.appendChild(top);
    if (r.supplier) card.appendChild(el('div', 'sub', 'ผู้ขาย/ขนส่ง: ' + r.supplier));
    var table = el('table');
    (r.lines || []).forEach(function(l){
      var tr = el('tr'); tr.appendChild(el('td', '', l.item)); tr.appendChild(el('td', '', l.qty)); table.appendChild(tr);
    });
    card.appendChild(table);
    if (r.note) card.appendChild(el('div', 'sub', 'หมายเหตุ: ' + r.note));
    card.appendChild(el('div', 'btns'));
    photoButtons(card, r.product_photos, 'รูปสินค้า');
    photoButtons(card, r.invoice_photos, 'รูป Invoice');
    box.appendChild(card);
  });
}

// ---------- Daily report (A4 portrait) ----------
var COMPANY = 'บริษัท พระจันทร์ ๕๐ จำกัด';
var COMPANY_SUB = 'Puisabpak';
var WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// Today's date in Thailand as yyyy-mm-dd.
function thaiToday(){ return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }
function dayLabel(day){
  var p = day.split('-');
  var w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return 'วัน' + WEEKDAYS[w] + 'ที่ ' + p[2] + '/' + p[1] + '/' + p[0];
}
$('reportDay').value = thaiToday();
$('reportDay').max = thaiToday();
$('reportDay').onchange = loadReport;
$('printReport').onclick = function(){ window.print(); };

function cell(tag, text, cls, span){
  var c = el(tag, cls, text);
  if (span > 1) c.rowSpan = span;
  return c;
}

function drawReport(day, receipts, more){
  var sheet = $('sheet');
  sheet.textContent = '';

  var hd = el('div', 'hd');
  var left = el('div'); left.appendChild(el('div', 'co', COMPANY)); left.appendChild(el('div', 'co2', COMPANY_SUB));
  var ref = el('div', 'ref');
  ref.appendChild(el('div', '', 'วันที่รับสินค้า: ' + day.split('-').reverse().join('/')));
  ref.appendChild(el('div', '', 'พิมพ์เมื่อ: ' + clock()));
  hd.appendChild(left); hd.appendChild(ref); sheet.appendChild(hd);

  sheet.appendChild(el('h1', '', 'รายงานการรับสินค้าประจำวัน'));
  var items = 0;
  receipts.forEach(function(r){ items += r.lines.length; });
  sheet.appendChild(el('div', 'sum', dayLabel(day) + '   รับทั้งหมด ' + receipts.length + ' ครั้ง   ' + items + ' รายการสินค้า'));

  var table = el('table');
  var widths = ['6%', '7%', '14%', '17%', '21%', '16%', '8%', '11%'];
  var cg = el('colgroup');
  widths.forEach(function(w){ var c = el('col'); c.style.width = w; cg.appendChild(c); });
  table.appendChild(cg);
  var thead = el('thead'), hr = el('tr');
  ['ลำดับ', 'เวลา', 'ผู้รับของ', 'ผู้ขาย / บริษัทขนส่ง', 'สินค้า', 'จำนวน', 'รูปสินค้า / Invoice', 'หมายเหตุ'].forEach(function(h){ hr.appendChild(el('th', '', h)); });
  thead.appendChild(hr); table.appendChild(thead);

  if (!receipts.length) {
    var tb0 = el('tbody'), tr0 = el('tr'), td0 = el('td', 'none', 'ไม่มีการรับสินค้าในวันนี้');
    td0.colSpan = 8; tr0.appendChild(td0); tb0.appendChild(tr0); table.appendChild(tb0);
  }
  receipts.forEach(function(r, i){
    // One tbody per receipt so a receipt is not split across two pages.
    var tb = el('tbody');
    var lines = r.lines.length ? r.lines : [{ item: '-', qty: '-' }];
    var n = lines.length;
    lines.forEach(function(l, j){
      var tr = el('tr');
      if (j === 0) {
        tr.appendChild(cell('td', String(i + 1), 'c', n));
        tr.appendChild(cell('td', clock(r.created_at).slice(11), 'c', n));
        tr.appendChild(cell('td', r.receiver, '', n));
        tr.appendChild(cell('td', r.supplier || '-', '', n));
      }
      tr.appendChild(el('td', '', l.item));
      tr.appendChild(el('td', '', l.qty));
      if (j === 0) {
        var missing = !r.product_photos.length || !r.invoice_photos.length;
        tr.appendChild(cell('td', r.product_photos.length + ' / ' + r.invoice_photos.length, missing ? 'c warn' : 'c', n));
        tr.appendChild(cell('td', r.note || '', '', n));
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
  });
  sheet.appendChild(table);

  var note = 'คอลัมน์รูป: จำนวนรูปสินค้า / จำนวนรูป Invoice (ตัวหนา = ขาดรูปอย่างใดอย่างหนึ่ง) ดูรูปได้ในแอปบันทึกการรับสินค้า';
  if (more) note = 'รายงานนี้แสดงเฉพาะ ' + receipts.length + ' ครั้งแรกของวัน   ' + note;
  sheet.appendChild(el('div', 'nt', note));

  var sg = el('div', 'sg');
  ['ผู้จัดทำ', 'ผู้ตรวจสอบ'].forEach(function(role){
    var d = el('div');
    d.appendChild(el('div', '', 'ลงชื่อ ........................................................'));
    d.appendChild(el('div', '', '(........................................................)'));
    d.appendChild(el('div', '', role + '     วันที่ ......../......../............'));
    sg.appendChild(d);
  });
  sheet.appendChild(sg);
}

async function loadReport(){
  var msg = $('reportMsg'), wrap = $('sheetWrap'), day = $('reportDay').value;
  wrap.className = 'sheetwrap hide'; $('printReport').disabled = true;
  msg.className = 'hint';
  if (!day) { msg.textContent = 'เลือกวันที่ของรายงาน'; return; }
  if (needPin && !$('pin').value) { msg.textContent = 'ใส่รหัส PIN ด้านบนก่อน แล้วกดแท็บนี้อีกครั้ง'; return; }
  msg.textContent = 'กำลังโหลด...';
  try {
    var res = await api('/api/receipts?date=' + encodeURIComponent(day));
    if (!res.ok) { msg.textContent = 'โหลดไม่สำเร็จ: ' + await readError(res); return; }
    var data = await res.json();
    if ($('reportDay').value !== day) return;   // the date was changed while this one was loading
    remember('pin', $('pin').value);
    drawReport(data.day, data.receipts, data.more);
    msg.className = 'hide'; wrap.className = 'sheetwrap'; $('printReport').disabled = false;
  } catch (e) { msg.textContent = 'โหลดไม่สำเร็จ: เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต'; }
}
</script>
</body>
</html>`;

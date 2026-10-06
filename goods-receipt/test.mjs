// Local end-to-end test of the Worker: in-memory SQLite stands in for D1, a Map stands in for R2.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
});
const store = new Map();
export const makeEnv = (extra = {}) => ({
  DB: {
    prepare: (sql) => stmt(sql),
    // Like D1, a batch is one transaction: all statements are saved or none.
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) await s.run(); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  },
  PHOTOS: {
    put: async (k, v) => { store.set(k, v); },
    get: async (k) => (store.has(k) ? { body: store.get(k) } : null),
    delete: async (k) => { store.delete(k); },
  },
  ...extra,
});

let pass = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { failed++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const call = async (env, method, path, { form, pin } = {}) => {
  const res = await worker.fetch(new Request('https://app.example' + path, {
    method, body: form, headers: pin !== undefined ? { 'X-Pin': encodeURIComponent(pin) } : {},
  }), env);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, res, j: type.includes('json') ? await res.json() : null };
};
const jpeg = (n = 100) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return new Blob([b], { type: 'image/jpeg' }); };
const formOf = (fields, product = [], invoice = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, k === 'lines' ? JSON.stringify(v) : v);
  product.forEach((b, i) => f.append('product', b, `p${i}.jpg`));
  invoice.forEach((b, i) => f.append('invoice', b, `i${i}.jpg`));
  return f;
};
const twoLines = [{ item: 'หมูบด', qty: '5 ถุง' }, { item: 'พริกแห้ง', qty: '2 ลัง' }];
const good = { receiver: 'สมชาย', supplier: 'บจก. ตัวอย่าง', note: 'บรรทัดแรก\nบรรทัดสอง', lines: twoLines };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const env = makeEnv();
  let r;

  r = await call(env, 'GET', '/');
  check('page is served as HTML', r.status === 200 && (r.res.headers.get('Content-Type') || '').startsWith('text/html'));
  check('page has a content security policy', !!r.res.headers.get('Content-Security-Policy'));
  r = await call(env, 'GET', '/api/config');
  check('no PIN needed when APP_PIN is not set', r.j.needPin === false, r.j);
  r = await call(env, 'GET', '/api/receipts');
  check('empty list at first', r.status === 200 && r.j.length === 0, r.j);

  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, receiver: '' }) });
  check('missing receiver is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, lines: [] }) });
  check('record with no goods line is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, lines: [{ item: 'หมูบด', qty: '' }] }) });
  check('goods line without quantity is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, lines: [{ item: '', qty: '5 ถุง' }] }) });
  check('quantity without item is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, lines: Array.from({ length: 31 }, (_, i) => ({ item: 'x' + i, qty: '1' })) }) });
  check('more than 30 goods lines is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ receiver: 'ก', lines: 'not a list' }) });
  check('malformed goods lines are refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [new Blob(['not a photo'])]) });
  check('non-JPEG file is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, Array.from({ length: 6 }, () => jpeg())) });
  check('more than 5 photos in one field is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [jpeg(5 * 1024 * 1024 + 1)]) });
  check('oversized photo is refused', r.status === 400, r);
  check('refused saves leave no photos, records or lines', store.size === 0 && db.prepare('SELECT COUNT(*) n FROM receipts').get().n === 0 && db.prepare('SELECT COUNT(*) n FROM receipt_lines').get().n === 0);

  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [jpeg(), jpeg()], [jpeg()]) });
  check('record with photos is saved', r.status === 201 && r.j.ok, r);
  check('three photos stored', store.size === 3, store.size);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, receiver: 'สมหญิง', lines: [{ item: 'ถุงซีล', qty: '1,000 ใบ' }, { item: '', qty: '' }] }) });
  check('record without photos is saved', r.status === 201, r);

  r = await call(env, 'GET', '/api/receipts');
  check('list shows newest first', r.j.length === 2 && r.j[0].receiver === 'สมหญิง' && r.j[1].receiver === 'สมชาย', r.j);
  const rec = r.j[1];
  check('each item keeps its own quantity, in order', JSON.stringify(rec.lines) === JSON.stringify(twoLines), rec.lines);
  check('blank goods rows are dropped', JSON.stringify(r.j[0].lines) === JSON.stringify([{ item: 'ถุงซีล', qty: '1,000 ใบ' }]), r.j[0].lines);
  check('record keeps note line breaks and photo keys', rec.note === good.note && rec.product_photos.length === 2 && rec.invoice_photos.length === 1, rec);
  check('server stamps the time', Math.abs(Date.now() - Date.parse(rec.created_at)) < 60000, rec.created_at);
  r = await call(env, 'GET', '/api/photos/' + rec.product_photos[0]);
  check('photo can be fetched', r.status === 200 && r.res.headers.get('Content-Type') === 'image/jpeg');
  r = await call(env, 'GET', '/api/photos/product/20260101/00000000-0000-0000-0000-000000000000.jpg');
  check('unknown photo is not found', r.status === 404, r);
  r = await call(env, 'GET', '/api/photos/..%2F..%2Fsecret');
  check('odd photo path is not found', r.status === 404, r);
  r = await call(env, 'DELETE', '/api/receipts');
  check('records cannot be deleted through the API', r.status === 404, r);

  // Database failure after photos were stored: the photos are removed again.
  const before = store.size;
  const broken = makeEnv({ DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('db down'); } } });
  r = await call(broken, 'POST', '/api/receipts', { form: formOf(good, [jpeg()]) });
  check('database failure reports an error', r.status === 500, r);
  check('photos of a failed save are removed', store.size === before, store.size);

  // A goods line that cannot be saved takes the whole record back with it.
  const realBatch = env.DB.batch;
  const half = makeEnv();
  half.DB.batch = (list) => realBatch([...list, stmt('INSERT INTO receipt_lines (receipt_id, line_no, item, qty) VALUES (NULL, 1, NULL, NULL)')]);
  const countBefore = db.prepare('SELECT COUNT(*) n FROM receipts').get().n;
  r = await call(half, 'POST', '/api/receipts', { form: formOf(good) });
  check('a failed goods line saves nothing', r.status === 500 && db.prepare('SELECT COUNT(*) n FROM receipts').get().n === countBefore, r);

  // A record saved before goods lines existed still shows its free-text item and quantity.
  db.prepare("INSERT INTO receipts (created_at, receiver, items, qty) VALUES ('2026-10-06T06:00:00.000Z', 'เก่า', 'ของเดิม', '3 กล่อง')").run();
  r = await call(env, 'GET', '/api/receipts');
  check('older free-text record is still shown', r.j[0].receiver === 'เก่า' && r.j[0].lines.length === 1 && r.j[0].lines[0].item === 'ของเดิม' && r.j[0].lines[0].qty === '3 กล่อง', r.j[0]);
  const total = r.j.length;

  const locked = makeEnv({ APP_PIN: '2468' });
  r = await call(locked, 'GET', '/api/config');
  check('PIN needed when APP_PIN is set', r.j.needPin === true, r.j);
  r = await call(locked, 'GET', '/api/receipts');
  check('list without PIN is refused', r.status === 401, r);
  r = await call(locked, 'GET', '/api/receipts', { pin: '0000' });
  check('list with wrong PIN is refused', r.status === 401, r);
  r = await call(locked, 'POST', '/api/receipts', { form: formOf(good), pin: '0000' });
  check('save with wrong PIN is refused', r.status === 401, r);
  r = await call(locked, 'GET', '/api/photos/' + rec.product_photos[0], { pin: '' });
  check('photo without PIN is refused', r.status === 401, r);
  r = await call(locked, 'GET', '/api/receipts', { pin: '2468' });
  check('list with right PIN works', r.status === 200 && r.j.length === total, r);
  r = await call(locked, 'POST', '/api/receipts', { form: formOf(good), pin: '2468' });
  check('save with right PIN works', r.status === 201, r);

  // ---------- LINE group announcements ----------
  const { createHmac } = await import('node:crypto');
  const sent = [];
  let lineStatus = 200;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response(lineStatus === 200 ? '{}' : '{"message":"limit"}', { status: lineStatus });
  };
  const line = makeEnv({ LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_CHANNEL_SECRET: 'sec' });
  const hook = async (env2, events, { secret = 'sec', sign = true } = {}) => {
    const body = JSON.stringify({ events });
    const res = await worker.fetch(new Request('https://app.example/line/webhook', {
      method: 'POST', body,
      headers: sign ? { 'X-Line-Signature': createHmac('sha256', secret).update(body).digest('base64') } : {},
    }), env2);
    return { status: res.status };
  };
  const say = (groupId, text, type = 'group') => ({ type: 'message', replyToken: 'rt', message: { type: 'text', text }, source: { type, groupId, userId: 'U1' } });
  const group = () => (db.prepare("SELECT value FROM settings WHERE key = 'line_group_id'").get() || {}).value;

  r = await hook(env, []);
  check('webhook is closed until LINE is set up', r.status === 503, r);
  r = await hook(line, [say('G1', 'ตั้งกลุ่มแจ้งเตือน')], { sign: false });
  check('webhook without signature is refused', r.status === 401 && !group(), r);
  r = await hook(line, [say('G1', 'ตั้งกลุ่มแจ้งเตือน')], { secret: 'other' });
  check('webhook with wrong signature is refused', r.status === 401 && !group(), r);
  r = await hook(line, []);
  check('LINE verify call (no events) is accepted', r.status === 200, r);

  r = await call(line, 'POST', '/api/receipts', { form: formOf(good) });
  check('no group chosen yet: saved, nothing announced', r.status === 201 && r.j.notify === 'off' && sent.length === 0, r.j);

  await hook(line, [say('G1', 'สวัสดี'), say('U1', 'ตั้งกลุ่มแจ้งเตือน', 'user')]);
  check('ordinary chat and one-to-one messages choose no group', !group() && sent.length === 0, sent);
  await hook(line, [say('G1', ' ตั้งกลุ่มแจ้งเตือน ')]);
  check('typing the phrase in a group chooses it', group() === 'G1', group());
  check('the group gets a confirmation reply', sent.length === 1 && sent[0].url.endsWith('/reply') && sent[0].body.replyToken === 'rt', sent);
  await hook(line, [say('G2', 'ตั้งกลุ่มแจ้งเตือน')]);
  check('another group cannot take the announcements over', group() === 'G1', group());
  await hook(line, [say('G2', 'ยกเลิกกลุ่มแจ้งเตือน')]);
  check('another group cannot switch them off', group() === 'G1', group());

  sent.length = 0;
  r = await call(line, 'POST', '/api/receipts', { form: formOf(good, [jpeg()], [jpeg(), jpeg()]) });
  const push = sent[0] || { body: { messages: [{}] } };
  const msg = push.body.messages[0].text || '';
  check('saved record is announced once to the chosen group', r.j.notify === 'sent' && sent.length === 1 && sent[0].url.endsWith('/push') && push.body.to === 'G1' && push.auth === 'Bearer tok', sent);
  check('announcement lists who, supplier, each item with quantity, and photo counts',
    msg.includes('ผู้รับของ: สมชาย') && msg.includes('บจก. ตัวอย่าง') && msg.includes('• หมูบด — 5 ถุง') && msg.includes('• พริกแห้ง — 2 ลัง')
    && msg.includes('รูปสินค้า 1 รูป') && msg.includes('รูป Invoice 2 รูป') && msg.includes('https://app.example/'), msg);
  check('announcement shows Thai time', /รับสินค้า \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(msg), msg);

  const long = Array.from({ length: 30 }, (_, i) => ({ item: 'ก'.repeat(200) + i, qty: 'ข'.repeat(100) }));
  sent.length = 0;
  r = await call(line, 'POST', '/api/receipts', { form: formOf({ ...good, lines: long }) });
  const longMsg = sent[0].body.messages[0].text;
  check('very long record still fits one LINE message and says how many items were left out', longMsg.length <= 5000 && /และอีก \d+ รายการ/.test(longMsg) && longMsg.includes('https://app.example/'), longMsg.length);

  lineStatus = 429; sent.length = 0;
  const n1 = db.prepare('SELECT COUNT(*) n FROM receipts').get().n;
  r = await call(line, 'POST', '/api/receipts', { form: formOf(good) });
  check('LINE refusing the message does not lose the record', r.status === 201 && r.j.notify === 'failed' && db.prepare('SELECT COUNT(*) n FROM receipts').get().n === n1 + 1, r.j);
  globalThis.fetch = async () => { throw new Error('network down'); };
  r = await call(line, 'POST', '/api/receipts', { form: formOf(good) });
  check('LINE being unreachable does not lose the record', r.status === 201 && r.j.notify === 'failed', r.j);
  lineStatus = 200;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}'); };

  await hook(line, [say('G1', 'ยกเลิกกลุ่มแจ้งเตือน')]);
  check('the chosen group can switch announcements off', !group(), group());
  sent.length = 0;
  r = await call(line, 'POST', '/api/receipts', { form: formOf(good) });
  check('after switching off nothing is announced', r.j.notify === 'off' && sent.length === 0, sent);
  await hook(line, [say('G2', 'ตั้งกลุ่มแจ้งเตือน')]);
  check('a new group can then be chosen', group() === 'G2', group());
  globalThis.fetch = realFetch;

  console.log(`\n${pass} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

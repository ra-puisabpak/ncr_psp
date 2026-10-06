// Local end-to-end test of the Worker: in-memory SQLite stands in for D1, a Map stands in for R2.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
});
const store = new Map();
export const makeEnv = (extra = {}) => ({
  DB: { prepare: (sql) => stmt(sql) },
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
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  product.forEach((b, i) => f.append('product', b, `p${i}.jpg`));
  invoice.forEach((b, i) => f.append('invoice', b, `i${i}.jpg`));
  return f;
};
const good = { receiver: 'สมชาย', items: 'หมูบด\nพริกแห้ง', qty: '5 ถุง', supplier: 'บจก. ตัวอย่าง', note: '' };

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

  r = await call(env, 'POST', '/api/receipts', { form: formOf({ receiver: 'ก', items: '', qty: '1' }) });
  check('missing required field is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [new Blob(['not a photo'])]) });
  check('non-JPEG file is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, Array.from({ length: 6 }, () => jpeg())) });
  check('more than 5 photos in one field is refused', r.status === 400, r);
  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [jpeg(5 * 1024 * 1024 + 1)]) });
  check('oversized photo is refused', r.status === 400, r);
  check('refused saves leave no photos and no records', store.size === 0 && db.prepare('SELECT COUNT(*) n FROM receipts').get().n === 0);

  r = await call(env, 'POST', '/api/receipts', { form: formOf(good, [jpeg(), jpeg()], [jpeg()]) });
  check('record with photos is saved', r.status === 201 && r.j.ok, r);
  check('three photos stored', store.size === 3, store.size);
  r = await call(env, 'POST', '/api/receipts', { form: formOf({ ...good, receiver: 'สมหญิง' }) });
  check('record without photos is saved', r.status === 201, r);

  r = await call(env, 'GET', '/api/receipts');
  check('list shows newest first', r.j.length === 2 && r.j[0].receiver === 'สมหญิง' && r.j[1].receiver === 'สมชาย', r.j);
  const rec = r.j[1];
  check('record keeps text and photo keys', rec.items === good.items && rec.product_photos.length === 2 && rec.invoice_photos.length === 1, rec);
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
  const broken = makeEnv({ DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('db down'); } }) }) } });
  r = await call(broken, 'POST', '/api/receipts', { form: formOf(good, [jpeg()]) });
  check('database failure reports an error', r.status === 500, r);
  check('photos of a failed save are removed', store.size === before, store.size);

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
  check('list with right PIN works', r.status === 200 && r.j.length === 2, r);
  r = await call(locked, 'POST', '/api/receipts', { form: formOf(good), pin: '2468' });
  check('save with right PIN works', r.status === 201, r);

  console.log(`\n${pass} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

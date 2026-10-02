// Local end-to-end test of the Worker against an in-memory SQLite standing in for D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './src/index.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const env = { DB, SETUP_KEY: 'setup-secret', ALLOWED_ORIGINS: 'https://app.example' };

let pass = 0, failed = 0;
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('https://api.example' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, j, res };
};
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { failed++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
};

let r;
r = await call('GET', '/api/ncr');
check('list without login is refused', r.status === 401, r);
r = await call('POST', '/api/ncr', { body: { nc_description: 'x' } });
check('create without login is refused', r.status === 401, r);
r = await call('PATCH', '/api/ncr/NCR-0000-001', { body: { status: 'Closed' } });
check('patch without login is refused', r.status === 401, r);

r = await call('POST', '/api/setup', { body: { username: 'qam', display_name: 'QA Manager', password: 'password1' }, headers: { 'X-Setup-Key': 'wrong' } });
check('setup with wrong key is refused', r.status === 403, r);
r = await call('POST', '/api/setup', { body: { username: 'qam', display_name: 'QA Manager', password: 'password1' }, headers: { 'X-Setup-Key': 'setup-secret' } });
check('setup creates first QA manager', r.status === 201, r);
r = await call('POST', '/api/setup', { body: { username: 'qa2', display_name: 'X', password: 'password1' }, headers: { 'X-Setup-Key': 'setup-secret' } });
check('setup cannot run twice', r.status === 409, r);

r = await call('POST', '/api/login', { body: { username: 'qam', password: 'nope' } });
check('wrong password is refused', r.status === 401, r);
r = await call('POST', '/api/login', { body: { username: 'qam', password: 'password1' } });
check('login works', r.status === 200 && r.j.token, r);
const qa = r.j.token;

r = await call('POST', '/api/users', { token: qa, body: { username: 'qc1', display_name: 'QC One', role: 'QC', password: 'password2' } });
check('QA manager creates QC user', r.status === 201, r);
r = await call('POST', '/api/login', { body: { username: 'qc1', password: 'password2' } });
const qc = r.j.token;
r = await call('POST', '/api/users', { token: qc, body: { username: 'x1', display_name: 'X', role: 'QA_MANAGER', password: 'password3' } });
check('QC cannot create users', r.status === 403, r);
r = await call('GET', '/api/audit', { token: qc });
check('QC cannot read audit log', r.status === 403, r);

r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'พบเศษพลาสติกในพริกแห้ง', source_type: 'RM_RECEIVING', severity: 'Major', supplier_name: 'ABC Supply', material_name: 'พริกแห้ง', lot_no: 'L001', defect_qty: 20, defect_unit: 'kg', ncr_id: 'HACK-1' } });
check('QC creates NCR with server-made number', r.status === 201 && /^NCR-\d{4}-001$/.test(r.j.ncr_id), r);
const id = r.j.ncr_id;
r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'second' } });
check('second NCR gets next number', r.status === 201 && r.j.ncr_id.endsWith('-002'), r);
r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'bad', source_type: 'NOPE' } });
check('invalid source type is refused', r.status === 400, r);

r = await call('PATCH', `/api/ncr/${id}`, { token: qc, body: { issue_date: '2020-01-01' } });
check('issue date cannot be changed', r.status === 400, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qc, body: { disposition: 'RELEASE' } });
check('QC cannot set disposition', r.status === 403, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qc, body: { status: 'Closed' } });
check('QC cannot close', r.status === 403, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qa, body: { status: 'Closed' } });
check('QA cannot close incomplete NCR', r.status === 422, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qc, body: { immediate_action: 'กักทั้ง Lot', hold_location: 'HOLD-1', suggestion: 'ขอให้ตรวจตะแกรงก่อนส่งรอบถัดไป' } });
check('QC updates base fields', r.status === 200, r);

// supplier link
r = await call('POST', `/api/ncr/${id}/supplier-link`, { token: qc });
check('supplier link created', r.status === 201 && r.j.token.length > 40, r);
const tok1 = r.j.token;
r = await call('POST', `/api/ncr/${id}/supplier-link`, { token: qc });
const tok = r.j.token;
r = await call('GET', `/api/supplier/${tok1}`);
check('older link is revoked when a new one is made', r.status === 404, r);
r = await call('GET', `/api/supplier/${tok}`);
check('supplier sees limited fields only', r.status === 200 && r.j.ncr_id === id && r.j.suggestion === 'ขอให้ตรวจตะแกรงก่อนส่งรอบถัดไป' && r.j.type === 'ncr' && !('hold_location' in r.j) && !('disposition' in r.j) && !('created_by' in r.j) && !('assignee' in r.j), r);
r = await call('GET', '/api/supplier/' + 'A'.repeat(43));
check('unknown supplier token is refused', r.status === 404, r);
r = await call('GET', '/api/ncr', { token: tok });
check('supplier token is not a login', r.status === 401, r);
r = await call('POST', `/api/supplier/${tok}`, { body: { root_cause: 'x', corrective_action: 'y' } });
check('supplier reply needs a name', r.status === 400, r);
r = await call('POST', `/api/supplier/${tok}`, { body: { root_cause: 'ตะแกรงคัดแยกชำรุด', corrective_action: 'เปลี่ยนตะแกรง', preventive_action: 'ตรวจทุกกะ', replied_by: 'สมชาย QA Supplier', status: 'Closed', severity: 'Minor', disposition: 'RELEASE' } });
check('supplier reply accepted', r.status === 200, r);
r = await call('GET', `/api/ncr/${id}`, { token: qa });
check('reply stored, status moved, extra fields ignored', r.j.root_cause === 'ตะแกรงคัดแยกชำรุด' && r.j.status === 'Pending Verification' && r.j.severity === 'Major' && r.j.disposition === null && r.j.supplier_reply_by === 'สมชาย QA Supplier', r.j);

// close
r = await call('PATCH', `/api/ncr/${id}`, { token: qa, body: { disposition: 'RETURN_SUPPLIER', disposition_reason: 'ไม่ผ่านข้อกำหนด', verification_result: 'Effective', verified_by: 'someone-else', closed_by: 'someone-else' } });
check('QA sets disposition and verification', r.status === 200, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qa, body: { status: 'Closed', closed_date: '1999-01-01' } });
check('QA closes complete NCR', r.status === 200, r);
r = await call('GET', `/api/ncr/${id}`, { token: qa });
check('server stamps who verified and closed', r.j.verified_by === 'qam' && r.j.closed_by === 'qam' && r.j.dispositioned_by === 'qam' && r.j.closed_date !== '1999-01-01' && r.j.days_open === 0, r.j);
r = await call('PATCH', `/api/ncr/${id}`, { token: qc, body: { nc_description: 'changed' } });
check('closed NCR is locked', r.status === 409, r);
r = await call('POST', `/api/supplier/${tok}`, { body: { root_cause: 'a', corrective_action: 'b', replied_by: 'zz' } });
check('supplier link dies when NCR closes', r.status === 404, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qa, body: { status: 'Open' } });
check('reopen needs a reason', r.status === 409, r);
r = await call('PATCH', `/api/ncr/${id}`, { token: qa, body: { status: 'Open', status_reason: 'พบปัญหาซ้ำ' } });
check('QA manager reopens with reason', r.status === 200, r);

// shipped product needs a recall decision, CCP needs limits
r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'CCP เบี่ยงเบน', source_type: 'CCP', severity: 'Critical', shipped_status: 'SHIPPED', immediate_action: 'กัก' } });
const id2 = r.j.ncr_id;
await call('PATCH', `/api/ncr/${id2}`, { token: qa, body: { severity: 'Critical', disposition: 'DESTROY', disposition_reason: 'ไม่ปลอดภัย', root_cause: 'rc', corrective_action: 'ca', verification_result: 'Effective' } });
r = await call('PATCH', `/api/ncr/${id2}`, { token: qa, body: { status: 'Closed' } });
check('CCP + shipped NCR needs limits and recall decision', r.status === 422 && r.j.error.includes('ค่าวิกฤต') && r.j.error.includes('เรียกคืน'), r);

// CAPA
r = await call('POST', '/api/capa', { token: qc, body: { description: 'CAPA for ' + id, source_ref: id } });
check('CAPA created', r.status === 201 && /^CAPA-\d{4}-001$/.test(r.j.capa_id), r);
const capa = r.j.capa_id;
r = await call('PATCH', `/api/capa/${capa}`, { token: qa, body: { status: 'Closed Effective' } });
check('CAPA cannot close incomplete', r.status === 422, r);
r = await call('PATCH', `/api/capa/${capa}`, { token: qc, body: { effectiveness_result: 'Effective' } });
check('QC cannot verify CAPA', r.status === 403, r);
r = await call('POST', `/api/capa/${capa}/supplier-link`, { token: qc });
check('CAPA supplier link created', r.status === 201, r);
const ctok = r.j.token;
r = await call('GET', `/api/supplier/${ctok}`);
check('CAPA link shows the CAPA only', r.status === 200 && r.j.type === 'capa' && r.j.capa_id === capa && !('created_by' in r.j), r);
r = await call('POST', `/api/supplier/${ctok}`, { body: { root_cause_summary: 'สรุปสาเหตุ', why1: 'w1', corrective_action: 'ca', replied_by: 'Supplier B', status: 'Closed Effective', effectiveness_result: 'Effective' } });
check('CAPA supplier reply accepted', r.status === 200, r);
r = await call('GET', `/api/capa/${capa}`, { token: qa });
check('CAPA reply stored, cannot self-verify', r.j.status === 'Verification' && r.j.why1 === 'w1' && r.j.effectiveness_result === null && r.j.supplier_reply_by === 'Supplier B', r.j);
r = await call('POST', `/api/capa/${capa}/supplier-link/revoke`, { token: qc });
r = await call('GET', `/api/supplier/${ctok}`);
check('revoked CAPA link stops working', r.status === 404, r);
r = await call('PATCH', `/api/capa/${capa}`, { token: qa, body: { effectiveness_result: 'Effective' } });
r = await call('PATCH', `/api/capa/${capa}`, { token: qa, body: { status: 'Closed Effective' } });
check('QA closes complete CAPA', r.status === 200, r);
r = await call('GET', `/api/capa/${capa}`, { token: qa });
check('server stamps CAPA verifier and closer', r.j.verified_by === 'qam' && r.j.closed_by === 'qam' && r.j.approved_by === 'qam', r.j);

// photos
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
r = await call('POST', `/api/ncr/${id2}/photos`, { body: { content_type: 'image/png', data: PNG } });
check('photo upload needs login', r.status === 401, r);
r = await call('POST', `/api/ncr/${id2}/photos`, { token: qc, body: { content_type: 'image/jpeg', data: PNG } });
check('photo with wrong type is refused', r.status === 400, r);
r = await call('POST', `/api/ncr/${id2}/photos`, { token: qc, body: { content_type: 'text/html', data: 'PGh0bWw+' } });
check('non-image upload is refused', r.status === 400, r);
r = await call('POST', `/api/ncr/${id2}/photos`, { token: qc, body: { content_type: 'image/png', data: 'data:image/png;base64,' + PNG } });
check('QC uploads a photo', r.status === 201 && r.j.id > 0, r);
const pid = r.j.id;
r = await call('GET', `/api/ncr/${id2}/photos`, { token: qc });
check('photo is listed', r.status === 200 && r.j.length === 1 && r.j[0].id === pid && !('data' in r.j[0]), r.j);
{
  const res = await worker.fetch(new Request(`https://api.example/api/ncr/${id2}/photos/${pid}`, { headers: { Authorization: `Bearer ${qc}` } }), env);
  const bytes = new Uint8Array(await res.arrayBuffer());
  check('photo downloads as the original image', res.status === 200 && res.headers.get('Content-Type') === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50);
}
r = await call('GET', `/api/ncr/${id2}/photos/${pid}`);
check('photo download needs login', r.status === 401, r);
r = await call('POST', `/api/ncr/${id2}/supplier-link`, { token: qc });
const ptok = r.j.token;
r = await call('GET', `/api/supplier/${ptok}`);
check('supplier link lists the NCR photos', r.status === 200 && r.j.photos.length === 1 && r.j.photos[0].id === pid, r.j);
{
  const res = await worker.fetch(new Request(`https://api.example/api/supplier/${ptok}/photos/${pid}`), env);
  check('supplier opens the photo through the link', res.status === 200 && res.headers.get('Content-Type') === 'image/png');
}
r = await call('POST', `/api/ncr/${id}/photos`, { token: qc, body: { content_type: 'image/png', data: PNG } });
const otherPid = r.j.id;
r = await call('GET', `/api/supplier/${ptok}/photos/${otherPid}`);
check('supplier link cannot open photos of another NCR', r.status === 404, r);
r = await call('POST', `/api/supplier/${ptok}/photos`, { body: { content_type: 'image/png', data: PNG } });
check('supplier attaches a photo to the reply', r.status === 201, r);
const spid = r.j.id;
r = await call('GET', `/api/ncr/${id2}/photos`, { token: qc });
check('staff see which photos came from the supplier', r.j.find((p) => p.id === spid)?.source === 'supplier' && r.j.find((p) => p.id === pid)?.source === 'internal', r.j);
r = await call('POST', `/api/ncr/${id2}/photos`, { token: qc, body: { content_type: 'image/png', data: PNG, kind: 'correction' } });
const cpid = r.j.id;
r = await call('GET', `/api/ncr/${id2}/photos`, { token: qc });
check('photos carry their kind: problem vs correction', r.j.find((p) => p.id === pid)?.kind === 'problem' && r.j.find((p) => p.id === cpid)?.kind === 'correction' && r.j.find((p) => p.id === spid)?.kind === 'correction', r.j);
r = await call('GET', `/api/supplier/${ptok}`);
check('supplier does not see the factory correction photos', !r.j.photos.some((p) => p.id === cpid) && r.j.photos.some((p) => p.id === pid) && r.j.photos.some((p) => p.id === spid), r.j.photos);
r = await call('GET', `/api/supplier/${ptok}/photos/${cpid}`);
check('supplier cannot open a factory correction photo', r.status === 404, r);
r = await call('POST', `/api/supplier/${ptok}/photos/${pid}/remove`);
check('supplier cannot remove the factory photos', r.status === 403, r);
r = await call('POST', `/api/supplier/${ptok}/photos`, { body: { content_type: 'text/html', data: 'PGh0bWw+' } });
check('supplier cannot upload a non-image', r.status === 400, r);
for (let i = 0; i < 5; i++) await call('POST', `/api/supplier/${ptok}/photos`, { body: { content_type: 'image/png', data: PNG } });
r = await call('POST', `/api/supplier/${ptok}/photos`, { body: { content_type: 'image/png', data: PNG } });
check('supplier photo count is capped', r.status === 409, r);
r = await call('POST', `/api/supplier/${ptok}/photos/${spid}/remove`);
check('supplier can remove own photo', r.status === 200, r);
r = await call('POST', `/api/supplier/${'B'.repeat(43)}/photos`, { body: { content_type: 'image/png', data: PNG } });
check('photo upload with an unknown link is refused', r.status === 404, r);
r = await call('POST', `/api/ncr/${id2}/photos/${pid}/remove`, { token: qc });
check('photo can be removed while NCR is open', r.status === 200, r);
r = await call('GET', `/api/supplier/${ptok}/photos/${pid}`);
check('removed photo is no longer served', r.status === 404, r);

// receiving inspection records (FM-QC-001)
const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
const recvBody = (uid, docNo, ncs = []) => ({ uid, ncs, record: { docNo, date: '2026-10-03', time: '09:00', supplier: 'ABC Supply', inspector: 'QC One',
  mats: [{ idx: 1, code: 'RM-001', lot: 'L1', qty: '10', result: 'REJECT', photo1: jpg, photo2: null }, { idx: 2, code: 'RM-002', result: 'PASS', photo1: null, photo2: null }],
  sig: { signerName: 'QC One', sigBase64: 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64') } } });
r = await call('GET', '/api/recv');
check('receiving records need a login', r.status === 401, r);
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-aaaa-0001', 'FM-QC-001-20261003-001', [{ uid: 'uid-nc-00001', id: 'NC001', failType: 'Rejected Material', supplier: 'ABC Supply', matIdx: 1, note: 'x' }]) });
check('receiving record saved with the proposed number and its NC', r.status === 201 && r.j.docNo === 'FM-QC-001-20261003-001' && r.j.ncs[0].id === 'NC001', r);
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-aaaa-0001', 'FM-QC-001-20261003-001') });
check('the same save sent twice is stored once', r.status === 200 && r.j.docNo === 'FM-QC-001-20261003-001', r);
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-bbbb-0002', 'FM-QC-001-20261003-001', [{ uid: 'uid-nc-00002', id: 'NC001', failType: 'Hold', matIdx: 1 }]) });
check('a second phone with the same number gets the next one', r.status === 201 && r.j.docNo === 'FM-QC-001-20261003-002' && r.j.ncs[0].id === 'NC002', r);
r = await call('POST', '/api/recv', { token: qc, body: { uid: 'uid-cccc-0003', record: { date: '2026-10-03', supplier: '', inspector: 'x', mats: [{}] } } });
check('receiving record without supplier is refused', r.status === 400, r);
r = await call('POST', '/api/recv', { token: qc, body: { ...recvBody('uid-dddd-0004', ''), record: { ...recvBody('x', '').record, mats: [{ idx: 1, result: 'PASS', photo1: 'data:image/jpeg;base64,' + Buffer.from('<script>').toString('base64') }] } } });
check('a file that is not a picture is refused', r.status === 400, r);
r = await call('GET', '/api/recv', { token: qc });
check('receiving list returns records without photo data and the NC log', r.status === 200 && r.j.records.length === 2 && r.j.ncLogs.length === 2
  && r.j.records.every((x) => x.mats[0].photo1 === null && x.mats[0].hasPhoto1 === 1 && x.sig.hasSig === 1 && x.sig.sigBase64 === null && x.savedBy === 'qc1') && !JSON.stringify(r.j).includes('base64,/9j'), r.j);
r = await call('GET', '/api/recv/FM-QC-001-20261003-001/photos', { token: qc });
check('photos of a receiving record come back on request', r.status === 200 && r.j.length === 2 && r.j[0].slot === 0 && r.j[0].data.startsWith('data:image/png') && r.j[1].idx === 1 && r.j[1].slot === 1 && r.j[1].data === jpg, r.j);
r = await call('POST', '/api/recv-nc', { token: qc, body: { uid: 'uid-nc-00003', id: 'NC001', docNo: 'FM-QC-001-20261003-001', failType: 'Other', note: 'manual' } });
check('manual NC gets the next free number', r.status === 201 && r.j.id === 'NC003', r);
r = await call('PATCH', '/api/recv-nc/NC001', { token: qc, body: { ncrId: 'bad' } });
check('bad NCR number on an NC is refused', r.status === 400, r);
r = await call('PATCH', '/api/recv-nc/NC001', { token: qc, body: { ncrId: id, status: 'Closed' } });
check('NC linked to its NCR and closed', r.status === 200 && r.j.ncrId === id && r.j.status === 'Closed' && r.j.closedDate, r);
r = await call('GET', '/api/audit?entity_id=NC001', { token: qa });
check('receiving changes are in the audit log', r.status === 200 && r.j.some((x) => x.entity === 'recv_nc' && x.action === 'close'), r.j);

// conditional acceptance: supervisor or QA only
const condBody = (uid, note) => { const x = recvBody(uid, ''); x.record.mats = [{ idx: 1, code: 'PKG-001', result: 'COND', note, condBy: 'someone else', photo1: null, photo2: null }]; return x; };
r = await call('POST', '/api/recv', { token: qc, body: condBody('uid-cond-0001', 'กล่องบุบ ใช้ก่อน') });
check('QC cannot receive with conditions', r.status === 403, r);
r = await call('POST', '/api/recv', { token: qa, body: condBody('uid-cond-0002', '') });
check('conditional acceptance needs a stated condition', r.status === 400, r);
r = await call('POST', '/api/recv', { token: qa, body: condBody('uid-cond-0003', 'กล่องบุบ ใช้ก่อน') });
check('QA manager can receive with conditions', r.status === 201, r);
r = await call('GET', '/api/recv', { token: qa });
check('the record names who granted the condition', r.j.records.find((x) => x.uid === 'uid-cond-0003').mats[0].condBy === 'QA Manager', r.j.records[0]);

// print hand-over
r = await call('POST', '/api/print-doc', { body: { html: '<html><body>x</body></html>' } });
check('print hand-over needs a login', r.status === 401, r);
const bigDoc = '<!DOCTYPE html><html><body>ใบตรวจรับ' + 'ก'.repeat(1200000) + '</body></html>';
r = await call('POST', '/api/print-doc', { token: qc, body: { html: bigDoc } });
check('print document accepted', r.status === 201 && /\/p\/[A-Za-z0-9_-]{40,}$/.test(r.j.url), r.status);
const printPath = new URL(r.j.url).pathname;
r = await call('GET', printPath);
check('print document opens without login, complete and boxed in', r.status === 200 && r.j === bigDoc && r.res.headers.get('Content-Security-Policy').startsWith('sandbox allow-scripts allow-modals;') && r.res.headers.get('Cache-Control') === 'no-store', r.status);
r = await call('GET', '/p/' + 'A'.repeat(43));
check('unknown print address is refused', r.status === 404, r.status);
db.prepare("UPDATE print_docs SET created_at='2020-01-01T00:00:00.000Z'").run();
r = await call('GET', printPath);
check('print document expires', r.status === 404, r.status);
await call('POST', '/api/print-doc', { token: qc, body: { html: '<html><body>second document</body></html>' } });
check('expired print documents are cleared', db.prepare('SELECT COUNT(*) AS n FROM print_docs').get().n === 1);

// audit, paging, lockout, CORS, logout
r = await call('GET', `/api/audit?entity_id=${id}`, { token: qa });
check('audit trail has full history', r.status === 200 && r.j.some((a) => a.action === 'supplier_reply' && a.actor_type === 'supplier') && r.j.some((a) => a.action === 'close') && r.j.some((a) => a.action === 'reopen'), r.j.map((a) => a.action));
r = await call('GET', '/api/ncr?limit=1&q=CCP', { token: qc });
check('search and paging', r.status === 200 && r.j.total === 1 && r.j.items.length === 1, r.j);
r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'อุณหภูมิเกิน', source_type: 'RM_RECEIVING', source_ref: 'FM-QC-001-20261003-001 / NC001' } });
check('NCR keeps the receiving document reference', r.status === 201, r);
r = await call('GET', '/api/ncr?q=FM-QC-001-20261003-001', { token: qc });
check('NCR can be found by its reference document', r.status === 200 && r.j.total === 1 && r.j.items[0].source_ref === 'FM-QC-001-20261003-001 / NC001', r.j);
for (let i = 0; i < 5; i++) await call('POST', '/api/login', { body: { username: 'qc1', password: 'bad' } });
r = await call('POST', '/api/login', { body: { username: 'qc1', password: 'password2' } });
check('account locks after 5 bad passwords', r.status === 429, r);
r = await call('GET', '/api/health', { headers: { Origin: 'https://evil.example' } });
check('unknown origin gets no CORS header', !r.res.headers.get('Access-Control-Allow-Origin'));
r = await call('GET', '/api/health', { headers: { Origin: 'https://app.example' } });
check('allowed origin gets CORS header', r.res.headers.get('Access-Control-Allow-Origin') === 'https://app.example');
r = await call('DELETE', `/api/ncr/${id}`, { token: qa });
check('no delete route', r.status === 404, r);
await call('POST', '/api/logout', { token: qa });
r = await call('GET', '/api/me', { token: qa });
check('logout ends the session', r.status === 401, r);

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

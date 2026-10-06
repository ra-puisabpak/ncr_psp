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

// Rename a login and its display name
await call('POST', '/api/users', { token: qa, body: { username: 'ren1', display_name: 'Old Name', role: 'QC', password: 'password4' } });
r = await call('POST', '/api/login', { body: { username: 'ren1', password: 'password4' } });
const renTok = r.j.token;
r = await call('PATCH', '/api/users/ren1', { token: qc, body: { username: 'ren2' } });
check('QC cannot rename users', r.status === 403, r);
r = await call('PATCH', '/api/users/ren1', { token: qa, body: { username: 'qc1' } });
check('rename to a taken username is refused', r.status === 409, r);
r = await call('PATCH', '/api/users/ren1', { token: qa, body: { username: 'Bad Name!' } });
check('rename to an invalid username is refused', r.status === 400, r);
r = await call('PATCH', '/api/users/ren1', { token: qa, body: { display_name: '  ' } });
check('blank display name is refused', r.status === 400, r);
r = await call('PATCH', '/api/users/ren1', { token: qa, body: { username: ' Ren2 ', display_name: 'New Name' } });
check('QA manager renames login and display name', r.status === 200 && r.j.username === 'ren2', r);
r = await call('GET', '/api/me', { token: renTok });
check('renamed user stays signed in under the new name', r.status === 200 && r.j.username === 'ren2' && r.j.display_name === 'New Name', r);
r = await call('POST', '/api/login', { body: { username: 'ren1', password: 'password4' } });
check('old username no longer logs in', r.status === 401, r);
r = await call('POST', '/api/login', { body: { username: 'ren2', password: 'password4' } });
check('new username logs in', r.status === 200, r);
r = await call('GET', '/api/audit?entity_id=ren2', { token: qa });
check('rename is in the audit log', r.j.some((a) => a.action === 'update' && JSON.parse(a.changes).username?.from === 'ren1'), r);
r = await call('PATCH', '/api/users/ren2', { token: qa, body: { username: 'ren2', display_name: 'New Name' } });
check('saving unchanged names is a no-op', r.status === 200, r);

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
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-aaaa-0001', 'FM-QC-001-20261003-001', [{ uid: 'uid-nc-00001', id: 'NC001', failType: 'Rejected Material', supplier: 'ABC Supply', matIdx: 1, result: 'REJECT', note: 'มีกลิ่น', mat: { code: 'RM-001', name: 'หอมแขกจีนปอกเปลือก', lot: 'L1', qty: '10', unit: 'กิโลกรัม' } }]) });
check('receiving record saved with the proposed number; its NC is an NCR number', r.status === 201 && r.j.docNo === 'FM-QC-001-20261003-001' && /^NCR-\d{4}-\d{3}$/.test(r.j.ncs[0].id), r);
const recvNcr = r.j.ncs[0].id;
r = await call('GET', `/api/ncr/${recvNcr}`, { token: qa });
check('the NCR exists in the e-Form with the receiving details', r.status === 200 && r.j.source_type === 'RM_RECEIVING' && r.j.source_ref === 'FM-QC-001-20261003-001' && r.j.supplier_name === 'ABC Supply' && r.j.material_code === 'RM-001' && r.j.lot_no === 'L1' && r.j.defect_qty === 10 && r.j.status === 'Open' && r.j.nc_description.includes('มีกลิ่น') && r.j.immediate_action.includes('REJECT'), r.j);
r = await call('GET', `/api/ncr/${recvNcr}/photos`, { token: qa });
check('the inspection photo of that item is attached to the NCR', r.status === 200 && r.j.length === 1 && r.j[0].kind === 'problem', r.j);
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-aaaa-0001', 'FM-QC-001-20261003-001') });
check('the same save sent twice is stored once', r.status === 200 && r.j.docNo === 'FM-QC-001-20261003-001', r);
r = await call('POST', '/api/recv', { token: qc, body: recvBody('uid-bbbb-0002', 'FM-QC-001-20261003-001', [{ uid: 'uid-nc-00002', id: 'NC001', failType: 'Hold', matIdx: 1 }]) });
check('a second phone with the same number gets the next one', r.status === 201 && r.j.docNo === 'FM-QC-001-20261003-002' && /^NCR-/.test(r.j.ncs[0].id) && r.j.ncs[0].id !== recvNcr, r);
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
check('manual NC is an NCR too', r.status === 201 && /^NCR-\d{4}-\d{3}$/.test(r.j.id) && r.j.id !== recvNcr, r);
const manualNcr = r.j.id;
r = await call('GET', `/api/ncr/${manualNcr}`, { token: qa });
check('manual NC carries supplier and reference from its receiving record', r.j.supplier_name === 'ABC Supply' && r.j.source_ref === 'FM-QC-001-20261003-001' && r.j.nc_description.includes('manual'), r.j);
r = await call('PATCH', `/api/recv-nc/${recvNcr}`, { token: qc, body: { status: 'Closed' } });
check('an NC that is an NCR cannot be closed from the receiving app', r.status === 409, r);
await call('PATCH', `/api/ncr/${recvNcr}`, { token: qa, body: { status: 'Cancelled', status_reason: 'ทดสอบ' } });
r = await call('GET', '/api/recv', { token: qc });
check('receiving NC log follows the NCR status', r.j.ncLogs.find((n) => n.id === recvNcr).status === 'Closed' && r.j.ncLogs.find((n) => n.id === manualNcr).status === 'Open' && r.j.ncLogs.find((n) => n.id === recvNcr).ncrId === recvNcr, r.j.ncLogs);
// NC rows made before the two logs were joined keep working
db.prepare("INSERT INTO recv_nc (nc_id,uid,doc_no,status,data,created_by,created_at,updated_by,updated_at) VALUES ('NC001','uid-old-0001','FM-QC-001-20261003-001','Open','{}','qc1','2026-10-01','qc1','2026-10-01')").run();
r = await call('PATCH', '/api/recv-nc/NC001', { token: qc, body: { ncrId: 'bad' } });
check('bad NCR number on an old NC is refused', r.status === 400, r);
r = await call('PATCH', '/api/recv-nc/NC001', { token: qc, body: { ncrId: id, status: 'Closed' } });
check('old NC linked to its NCR and closed', r.status === 200 && r.j.ncrId === id && r.j.status === 'Closed' && r.j.closedDate, r);
r = await call('GET', '/api/audit?entity_id=NC001', { token: qa });
check('receiving changes are in the audit log', r.status === 200 && r.j.some((x) => x.entity === 'recv_nc' && x.action === 'close'), r.j);

// conditional acceptance
const condBody = (uid, note) => { const x = recvBody(uid, ''); x.record.mats = [{ idx: 1, code: 'PKG-001', result: 'COND', note, condBy: 'someone else', photo1: null, photo2: null }]; return x; };
r = await call('POST', '/api/recv', { token: qc, body: condBody('uid-cond-0001', 'กล่องบุบ ใช้ก่อน') });
check('QC can receive with conditions', r.status === 201, r);
r = await call('GET', '/api/recv', { token: qc });
check('the record names the QC inspector who granted it, not what the phone sent', r.j.records.find((x) => x.uid === 'uid-cond-0001').mats[0].condBy === 'QC One', r.j.records[0]);
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
r = await call('POST', '/api/ncr', { token: qc, body: { nc_description: 'อุณหภูมิเกิน', source_type: 'RM_RECEIVING', source_ref: 'FM-QC-001-20260901-099 / NC001' } });
check('NCR keeps the receiving document reference', r.status === 201, r);
r = await call('GET', '/api/ncr?q=FM-QC-001-20260901-099', { token: qc });
check('NCR can be found by its reference document', r.status === 200 && r.j.total === 1 && r.j.items[0].source_ref === 'FM-QC-001-20260901-099 / NC001', r.j);
for (let i = 0; i < 5; i++) await call('POST', '/api/login', { body: { username: 'qc1', password: 'bad' } });
r = await call('POST', '/api/login', { body: { username: 'qc1', password: 'password2' } });
check('account locks after 5 bad passwords', r.status === 429, r);
r = await call('GET', '/api/health', { headers: { Origin: 'https://evil.example' } });
check('unknown origin gets no CORS header', !r.res.headers.get('Access-Control-Allow-Origin'));
r = await call('GET', '/api/health', { headers: { Origin: 'https://app.example' } });
check('allowed origin gets CORS header', r.res.headers.get('Access-Control-Allow-Origin') === 'https://app.example');
r = await call('DELETE', `/api/ncr/${id}`, { token: qa });
check('no delete route', r.status === 404, r);
// ----- Smart QA: control points and monitoring records -----
r = await call('GET', '/api/control-points', { token: qc });
check('control point register follows QP-HA-001 Rev.01, all draft', r.status === 200 && r.j.length === 8 && r.j.every((c) => c.status === 'DRAFT')
  && r.j.filter((c) => c.cp_type === 'CCP').length === 2 && r.j.find((c) => c.cp_id === 'CCP-01').params[0].min === 85, r.j.map((c) => c.cp_id));
r = await call('PATCH', '/api/control-points/CCP-01', { token: qc, body: { status: 'APPROVED' } });
check('QC cannot change a control point', r.status === 403, r);
r = await call('PATCH', '/api/control-points/CCP-02', { token: qa, body: { status: 'APPROVED' } });
check('a control point with an open limit cannot be approved', r.status === 422 && /น้ำมัน/.test(r.j.error), r);
r = await call('PATCH', '/api/control-points/CCP-01', { token: qa, body: { params: [{ key: 'a', label: 'x', type: 'number', min: 5, max: 1 }] } });
check('min above max is refused', r.status === 400, r);
r = await call('PATCH', '/api/control-points/CCP-01', { token: qa, body: { status: 'APPROVED' } });
check('QA approves a control point whose limits are all set, and its version moves on', r.status === 200 && r.j.version === 2, r);
r = await call('POST', '/api/control-points', { token: qa, body: { cp_id: 'prp-uv', name: 'UV ฆ่าเชื้อบรรจุภัณฑ์ (M12)', params: [{ key: 'uv_min', label: 'เวลาฉาย UV', type: 'number', unit: 'นาที', min: 15 }] } });
check('QA adds a control point', r.status === 201 && r.j.cp_id === 'PRP-UV', r);
r = await call('POST', '/api/control-points', { token: qa, body: { cp_id: 'PRP-UV', name: 'x', params: [{ key: 'a', label: 'a', type: 'check' }] } });
check('duplicate control point is refused', r.status === 409, r);
r = await call('POST', '/api/control-points', { token: qa, body: { cp_id: 'uv', name: 'x', params: [{ key: 'a', label: 'a', type: 'check' }] } });
check('a malformed control point code is refused', r.status === 400, r);
r = await call('PATCH', '/api/control-points/PRP-UV', { token: qa, body: { status: 'APPROVED' } });
check('a control point must be classified before approval', r.status === 422, r);

const qcBody = (o = {}) => ({ uid: 'qc-uid-' + Math.random().toString(36).slice(2, 10), cp_id: 'CCP-01', record_date: '2026-09-15', record_time: '10:30',
  product_code: 'FG0002', product_name: 'น้ำพริกตาแดงมันกุ้ง', batch_no: 'B260915-01',
  values: { temp_start: 88.5, temp_min: 86.2, temp_end: 87, hold_min: 125, thermo_ok: true, times: '08:10-10:15' }, ...o });
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ values: { temp_start: 88 } }) });
check('a record must answer every check', r.status === 400, r);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ product_code: 'FG0007' }) });
check('a product outside the control point is refused', r.status === 400, r);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ batch_no: '' }) });
check('a record needs a batch number', r.status === 400, r);
const passBody = qcBody();
r = await call('POST', '/api/qc', { token: qc, body: passBody });
check('a passing record is saved without an NCR', r.status === 201 && r.j.result === 'PASS' && !r.j.ncr_id && /^QC-260915-0001$/.test(r.j.rec_id), r);
const passId = r.j.rec_id;
r = await call('POST', '/api/qc', { token: qc, body: passBody });
check('the same save sent twice is stored once', r.status === 200 && r.j.rec_id === passId, r);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ result: 'PASS', inspector: 'someone else', values: { temp_start: 86, temp_min: 80.2, temp_end: 86, hold_min: 125, thermo_ok: true } }) });
check('a failing CCP record opens a critical NCR, whatever the device claims', r.status === 201 && r.j.result === 'FAIL' && /^NCR-\d{4}-\d{3}$/.test(r.j.ncr_id) && r.j.failed[0].key === 'temp_min', r);
const failRec = r.j;
r = await call('GET', `/api/ncr/${failRec.ncr_id}`, { token: qa });
check('the NCR carries the batch, limit, value and record', r.status === 200 && r.j.source_type === 'CCP' && r.j.severity === 'Critical' && r.j.product_lot_no === 'B260915-01'
  && r.j.source_ref === failRec.rec_id && /85/.test(r.j.critical_limit) && /80.2/.test(r.j.actual_result) && /กักกัน Batch/.test(r.j.immediate_action), r.j);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ cp_id: 'OPRP-02', product_code: 'FG0007', values: { machine: 'M06', before_ok: true, after_ok: false, count_ok: true } }) });
check('a failed check on a draft OPRP opens a major in-process NCR', r.status === 201 && r.j.result === 'FAIL' && r.j.ncr_id, r);
const bladeNcr = r.j.ncr_id;
r = await call('GET', `/api/ncr/${bladeNcr}`, { token: qa });
check('the NCR says the limits are still draft', r.j.source_type === 'IN_PROCESS' && r.j.severity === 'Major' && /รอ validate/.test(r.j.nc_description), r.j);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ cp_id: 'OPRP-06', product_code: 'FG0010', values: { aw: 0.51, meter_ok: true } }) });
check('a decimal limit is judged correctly', r.status === 201 && r.j.result === 'PASS', r);
r = await call('GET', '/api/qc?from=2026-09-15&to=2026-09-15', { token: qc });
check('records are listed with the inspector from the login', r.status === 200 && r.j.length === 4 && r.j.every((x) => x.inspector === 'QC One') && r.j.find((x) => x.rec_id === failRec.rec_id).cp_version === 2, r.j);
r = await call('GET', '/api/qc/summary?date=2026-09-15', { token: qc });
check('daily summary counts passes, fails and open NCRs', r.status === 200 && r.j.total === 4 && r.j.fail === 2 && r.j.ncrOpen >= 2, r.j);
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ record_date: '2999-01-01' }) });
check('a record cannot be dated in the future', r.status === 400, r);
r = await call('PATCH', '/api/control-points/PRP-UV', { token: qa, body: { status: 'RETIRED' } });
r = await call('POST', '/api/qc', { token: qc, body: qcBody({ cp_id: 'PRP-UV', product_code: '', values: { uv_min: 15 } }) });
check('a retired control point takes no records', r.status === 409, r);
r = await call('GET', '/api/audit?entity_id=CCP-01', { token: qa });
check('control point changes are in the audit trail', r.status === 200 && r.j.some((a) => a.action === 'approve'), r.j);
// ----- Smart QA: finished-goods release and traceability -----
const gateOf = (p, b) => call('GET', `/api/release/check?product_code=${p}&batch_no=${encodeURIComponent(b)}`, { token: qc });
r = await gateOf('FG0002', 'B260915-01');
const st = (g, id) => g.requirements.find((x) => x.cp_id === id)?.state;
check('the gate lists the per-batch points for the product and what blocks release', r.status === 200 && !r.j.releasable
  && st(r.j, 'CCP-01') === 'FAIL' && st(r.j, 'OPRP-05') === 'MISSING' && !st(r.j, 'CCP-02') && !st(r.j, 'OPRP-04')
  && r.j.reasons.some((x) => x.includes(failRec.ncr_id)), r.j);
r = await gateOf('FG0004', 'B1');
check('a product outside the HACCP plan cannot be released', r.status === 200 && !r.j.releasable && r.j.requirements.length === 0, r.j);
const relBody = (o = {}) => ({ uid: 'rel-uid-' + Math.random().toString(36).slice(2, 10), product_code: 'FG0002', product_name: 'น้ำพริกตาแดงมันกุ้ง', batch_no: 'B260915-01',
  decision: 'RELEASE', qty: 120, unit: 'กระปุก', mfg_date: '2026-09-15', exp_date: '2027-03-15',
  rm_lots: [{ code: 'RM-010', name: 'กุ้งแห้ง', lot: 'LOT-SHRIMP-77', doc_no: 'FM-QC-001-20260910-001' }],
  checks: { label_ok: true, pack_ok: true, spec_ok: true }, ...o });
r = await call('POST', '/api/release', { token: qc, body: relBody() });
check('only QA decides on release', r.status === 403, r);
r = await call('POST', '/api/release', { token: qa, body: relBody() });
check('a batch with a failed CCP and an open NCR cannot be released', r.status === 422 && r.j.reasons.length >= 2, r.j);
r = await call('POST', '/api/release', { token: qa, body: relBody({ decision: 'HOLD' }) });
check('holding a batch needs a reason', r.status === 400, r);
r = await call('POST', '/api/release', { token: qa, body: relBody({ decision: 'HOLD', note: 'รอผล NCR' }) });
check('QA can hold a batch with a reason, and the gate is kept with the decision', r.status === 201 && r.j.decision === 'HOLD', r);
// a clean batch: both per-batch points pass
await call('POST', '/api/qc', { token: qc, body: qcBody({ batch_no: 'B260916-01', record_date: '2026-09-16' }) });
await call('POST', '/api/qc', { token: qc, body: qcBody({ cp_id: 'OPRP-05', batch_no: 'B260916-01', record_date: '2026-09-16', values: { to_cap_min: 35, fill_temp: 55, cap_temp: 45, chilled: true } }) });
r = await gateOf('FG0002', 'B260916-01');
check('a batch whose records all pass is releasable', r.status === 200 && r.j.releasable && r.j.requirements.every((x) => x.state === 'PASS'), r.j);
r = await call('POST', '/api/release', { token: qa, body: relBody({ batch_no: 'B260916-01', rm_lots: [], checks: { label_ok: true, pack_ok: false, spec_ok: true } }) });
check('raw-material lots are optional for release', r.status === 422 && !r.j.reasons.some((x) => /ล็อตวัตถุดิบ/.test(x)), r.j);
r = await call('POST', '/api/release', { token: qa, body: relBody({ batch_no: 'B260916-01', checks: { label_ok: true, pack_ok: false, spec_ok: true } }) });
check('release needs every release check confirmed', r.status === 422, r.j);
r = await call('POST', '/api/release', { token: qa, body: relBody({ batch_no: 'B260916-01', exp_date: '2026-09-01' }) });
check('expiry must come after manufacture', r.status === 400, r);
const relOk = relBody({ batch_no: 'B260916-01' });
r = await call('POST', '/api/release', { token: qa, body: relOk });
check('QA releases a clean batch', r.status === 201 && /^REL-\d{6}-002$/.test(r.j.rel_id) && r.j.decision === 'RELEASE', r);
const relId = r.j.rel_id;
r = await call('POST', '/api/release', { token: qa, body: relOk });
check('the same release sent twice is stored once', r.status === 200 && r.j.rel_id === relId, r);
r = await call('POST', '/api/release', { token: qa, body: relBody({ batch_no: 'B260916-01' }) });
check('a batch is released only once', r.status === 422 && r.j.reasons.some((x) => x.includes(relId)), r.j);
// a failed CCP can be released only through a closed NCR that decided so
await call('POST', '/api/qc', { token: qc, body: qcBody({ cp_id: 'OPRP-05', values: { to_cap_min: 35, fill_temp: 55, cap_temp: 45, chilled: true } }) });
await call('PATCH', `/api/ncr/${failRec.ncr_id}`, { token: qa, body: { disposition: 'RELEASE', disposition_reason: 'ให้ความร้อนซ้ำครบ 120 นาที ผลจุลินทรีย์ผ่าน', root_cause: 'แก๊สหมด', corrective_action: 'ตรวจถังแก๊สก่อนเริ่ม', verification_result: 'Effective' } });
r = await call('PATCH', `/api/ncr/${failRec.ncr_id}`, { token: qa, body: { status: 'Closed' } });
r = await gateOf('FG0002', 'B260915-01');
check('a failed CCP whose NCR QA closed with "release" counts as a concession', r.status === 200 && st(r.j, 'CCP-01') === 'CONCESSION' && r.j.releasable, r.j);
r = await call('GET', '/api/release?decision=RELEASE', { token: qc });
check('releases are listed with the lots and the gate', r.status === 200 && r.j.length === 1 && r.j[0].rm_lots[0].lot === 'LOT-SHRIMP-77' && r.j[0].gate.requirements.length === 2 && r.j[0].decided_by === 'QA Manager', r.j);
r = await call('GET', '/api/trace?q=SHRIMP-77', { token: qc });
check('tracing a raw-material lot finds the batches, their records and NCRs', r.status === 200 && r.j.releases.length === 2
  && r.j.qc.some((x) => x.batch_no === 'B260916-01') && r.j.ncrs.some((x) => x.ncr_id === failRec.ncr_id), r.j);
r = await call('GET', '/api/trace?q=B260916-01', { token: qc });
check('tracing a batch finds its records and its raw-material lots', r.status === 200 && r.j.releases[0].rm_lots[0].lot === 'LOT-SHRIMP-77' && r.j.qc.length === 2, r.j);
r = await call('GET', '/api/trace?q=x', { token: qc });
check('a trace search needs at least two characters', r.status === 400, r);
r = await call('PATCH', '/api/control-points/OPRP-05', { token: qa, body: { release_required: false } });
r = await gateOf('FG0002', 'B999');
check('QA can take a point off the release list', r.status === 200 && !r.j.requirements.some((x) => x.cp_id === 'OPRP-05'), r.j);
r = await call('GET', '/api/control-points', { token: qc });
check('the register shows which points are needed for release', r.j.find((c) => c.cp_id === 'CCP-01').release_required === 1 && r.j.find((c) => c.cp_id === 'OPRP-05').release_required === 0, r.j.map((c) => [c.cp_id, c.release_required]));

// ----- Smart QA: personal hygiene check -----
r = await call('GET', '/api/hyg/items', { token: qc });
check('hygiene check starts with the 12 items plus health status (critical)', r.status === 200 && r.j.length === 13 && r.j[12].item_key === 'H13' && r.j[12].critical === 1 && r.j[0].label.startsWith('หมวก'), r.j.map((i) => i.item_key));
r = await call('PATCH', '/api/hyg/items/H09', { token: qc, body: { active: false } });
check('QC cannot change the check items', r.status === 403, r);
r = await call('POST', '/api/hyg/employees', { token: qc, body: { name: '  สมศรี   ใจดี ', dept: 'ผลิต' } });
check('an inspector adds an employee', r.status === 201 && r.j.name === 'สมศรี ใจดี' && r.j.active === 1, r);
const emp = r.j;
r = await call('POST', '/api/hyg/employees', { token: qc, body: { name: 'สมศรี ใจดี' } });
check('the same employee cannot be added twice', r.status === 409, r);
const allP = (o = {}) => ({ ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`H${String(i + 1).padStart(2, '0')}`, 'P'])), ...o });
const hygBody = (o = {}) => ({ uid: 'hyg-uid-' + Math.random().toString(36).slice(2, 10), inspect_date: '2026-09-20', inspect_time: '07:45', shift: 'เช้า', emp_id: emp.emp_id, results: allP(), ...o });
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H05: undefined }) }) });
check('every item must be answered', r.status === 400 && /รองเท้า/.test(r.j.error), r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H05: 'Fail' }) }) });
check('only P or F is accepted as an answer', r.status === 400, r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody() });
check('a passing check is saved with a server number and the inspector from the login', r.status === 201 && r.j.result === 'PASS' && r.j.rec_id === 'PH-260920-0001', r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H08: 'F' }) }) });
check('a failed item needs an action', r.status === 400, r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H08: 'F' }), action: 'CORRECTED', note: 'ถอดแหวนแล้ว' }) });
check('a failed item corrected on the spot is recorded', r.status === 201 && r.j.result === 'FAIL' && r.j.action === 'CORRECTED', r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H13: 'F' }), action: 'CORRECTED' }) });
check('a failed health check cannot be "corrected" — the person stays out', r.status === 400, r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H13: 'F' }), action: 'EXCLUDED' }) });
check('keeping someone out needs the details', r.status === 400, r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ results: allP({ H13: 'F' }), action: 'EXCLUDED', note: 'ท้องเสีย ส่งพบแพทย์ ย้ายไปงานนอกพื้นที่ผลิต' }) });
check('a person with a health issue is kept out of production', r.status === 201 && r.j.action === 'EXCLUDED', r);
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody({ inspect_date: '2999-01-01' }) });
check('a hygiene check cannot be dated in the future', r.status === 400, r);
await call('PATCH', '/api/hyg/items/H09', { token: qa, body: { label: 'น้ำหอม / โลชั่นกลิ่นแรง' } });
r = await call('GET', '/api/hyg/records?date=2026-09-20', { token: qc });
check('records keep the wording in force when they were made', r.status === 200 && r.j.length === 3 && r.j.every((x) => x.inspector === 'QC One')
  && r.j[0].items.find((i) => i.item_key === 'H09').label === 'น้ำหอม', r.j.map((x) => x.rec_id));
r = await call('GET', '/api/qc/summary?date=2026-09-20', { token: qc });
check('daily summary counts hygiene checks', r.j.hygTotal === 3 && r.j.hygFail === 2, r.j);
r = await call('PATCH', `/api/hyg/employees/${emp.emp_id}`, { token: qc, body: { active: false } });
check('QC cannot deactivate an employee', r.status === 403, r);
await call('PATCH', `/api/hyg/employees/${emp.emp_id}`, { token: qa, body: { active: false } });
r = await call('POST', '/api/hyg/records', { token: qc, body: hygBody() });
check('a deactivated employee cannot be checked', r.status === 409, r);
r = await call('GET', '/api/hyg/records', { headers: {} });
check('hygiene records need a login', r.status === 401, r);

// ----- FM-QC-07 frying oil -----
const oilBody = (o = {}) => ({ uid: 'oil-uid-' + Math.random().toString(36).slice(2, 10), check_date: '2026-09-21', check_time: '08:05', stage: 'BEFORE',
  line: 'พริกผัดน้ำมันมะกอก', oil_type: 'น้ำมันรำข้าว', tank: 'T1', tpm: [12, 13], temps: [160], temp_result: 'PASS', tpm_meter: 'TPM-01', thermometer: 'TH-03', ...o });
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ tpm: [] }) });
check('an oil check needs a TPM reading', r.status === 400, r);
r = await call('POST', '/api/oil', { token: qc, body: oilBody() });
check('oil under 20% TPM passes', r.status === 201 && r.j.result === 'PASS' && r.j.chk_id === 'OIL-260921-001' && !r.j.ncr_id, r);
const oilId = r.j.chk_id;
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ tpm: [21.5] }) });
check('20–25% TPM needs an assessment note', r.status === 400, r);
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ tpm: [21.5], note: 'เฝ้าระวัง ตรวจซ้ำหลังทอด 2 Batch' }) });
check('20–25% TPM is recorded as watch', r.status === 201 && r.j.result === 'WATCH', r);
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ stage: 'AFTER', tpm: [24, 25.5] }) });
check('25% TPM or more needs an immediate action', r.status === 400, r);
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ stage: 'AFTER', tpm: [24, 25.5], action: 'หยุดใช้ เปลี่ยนน้ำมันใหม่' }) });
check('25% TPM or more fails and opens an NCR', r.status === 201 && r.j.result === 'FAIL' && /^NCR-/.test(r.j.ncr_id), r);
r = await call('GET', `/api/ncr/${r.j.ncr_id}`, { token: qa });
check('the oil NCR names the tank and the reading', r.j.lot_no === 'T1' && /25.5/.test(r.j.actual_result) && /กักกัน/.test(r.j.immediate_action), r.j);
r = await call('POST', '/api/oil', { token: qc, body: oilBody({ temp_result: 'NA', temps: [] }) });
check('N/A temperature needs a reason', r.status === 400, r);
r = await call('POST', `/api/oil/${oilId}/verify`, { token: qc, body: { decision: 'APPROVE' } });
check('QC cannot verify an oil check', r.status === 403, r);
r = await call('POST', `/api/oil/${oilId}/verify`, { token: qa, body: { decision: 'APPROVE' } });
check('QA verifies an oil check', r.status === 200, r);
r = await call('POST', `/api/oil/${oilId}/verify`, { token: qa, body: { decision: 'REJECT', note: 'x' } });
check('an oil check is verified once', r.status === 409, r);
r = await call('GET', '/api/oil?from=2026-09-21&to=2026-09-21', { token: qc });
check('oil checks are listed with readings and verification', r.status === 200 && r.j.length === 3 && r.j.find((x) => x.chk_id === oilId).verify_decision === 'APPROVE'
  && r.j.find((x) => x.chk_id === oilId).tpm[1] === 13, r.j.map((x) => x.chk_id));

// ----- FM-QC-05 refrigerator / freezer -----
r = await call('POST', '/api/cold/units', { token: qc, body: { unit_id: 'FZ-01', name: 'ตู้แช่ FG', area: 'FG', unit_type: 'FREEZE' } });
check('QC cannot register a cold unit', r.status === 403, r);
r = await call('POST', '/api/cold/units', { token: qa, body: { unit_id: 'ch-01', name: 'ตู้เย็นวัตถุดิบ 1', area: 'RM', unit_type: 'CHILL', thermometer: 'TH-07', calib_due: '2026-12-31' } });
check('QA registers a chill unit with the SOP limits', r.status === 201 && r.j.unit_id === 'CH-01', r);
r = await call('POST', '/api/cold/units', { token: qa, body: { unit_id: 'FZ-01', name: 'ตู้แช่แข็ง FG', area: 'FG', unit_type: 'FREEZE', thermometer: 'TH-08', calib_due: '2026-01-31' } });
r = await call('GET', '/api/cold/units', { token: qc });
const ch = r.j.find((u) => u.unit_id === 'CH-01'), fz = r.j.find((u) => u.unit_id === 'FZ-01');
check('default limits: chill 0–5 (escalate 8), freeze ≤-18 (escalate -12)', ch.spec_min === 0 && ch.spec_max === 5 && ch.escalate_at === 8 && fz.spec_min === null && fz.spec_max === -18 && fz.escalate_at === -12, r.j);
r = await call('PATCH', '/api/cold/units/CH-01', { token: qa, body: { escalate_at: 4 } });
check('the escalation limit must be above the specification', r.status === 400, r);
const coldBody = (o = {}) => ({ uid: 'cold-uid-' + Math.random().toString(36).slice(2, 10), unit_id: 'CH-01', read_date: '2026-09-21', slot: '11:00', read_time: '11:02', temp: 3.5, ...o });
const COND_OK = { clean: 'P', door: 'P', gasket: 'P', water: 'P', ice: 'P', general: 'P' };
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: '08:00' }) });
check('the 08:00 reading needs the condition check', r.status === 400, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: '08:00', condition: COND_OK }) });
check('a reading within 0–5 °C passes', r.status === 201 && r.j.status === 'PASS' && r.j.rd_id === 'TMP-260921-0001', r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: '08:00', condition: COND_OK }) });
check('the same slot cannot be recorded twice', r.status === 409, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ temp: 6.5 }) });
check('out of spec needs an action and a cause', r.status === 400, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ temp: 6.5, actions: ['RECHECK'], note: 'เพิ่งโหลดสินค้า เปิดประตูนาน' }) });
check('out of spec below the escalation limit is a FAIL without NCR', r.status === 201 && r.j.status === 'FAIL' && !r.j.ncr_id, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: 'RECHECK', temp: 9.2, actions: ['RECHECK'], note: 'คอมเพรสเซอร์ไม่ทำงาน' }) });
check('past the escalation limit the supervisor must be notified', r.status === 400, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: 'RECHECK', temp: 9.2, actions: ['NOTIFY', 'HOLD'], note: 'คอมเพรสเซอร์ไม่ทำงาน' }) });
check('holding product needs the affected lot', r.status === 400, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ slot: 'RECHECK', temp: 9.2, actions: ['NOTIFY', 'HOLD', 'ENGINEERING'], affected: 'หอมแขก LOT-SH-77', note: 'คอมเพรสเซอร์ไม่ทำงาน' }) });
check('past the escalation limit opens an NCR', r.status === 201 && r.j.status === 'ESCALATE' && /^NCR-/.test(r.j.ncr_id), r);
r = await call('GET', `/api/ncr/${r.j.ncr_id}`, { token: qa });
check('the temperature NCR carries unit, limit, value and lot', r.j.source_type === 'WAREHOUSE' && r.j.hold_location === 'CH-01' && r.j.actual_result === '9.2 °C' && /LOT-SH-77/.test(r.j.nc_description), r.j);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ unit_id: 'FZ-01', slot: '08:00', temp: -19, condition: { ...COND_OK, ice: 'F' } }) });
check('a failed condition item needs a remark', r.status === 400, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ unit_id: 'FZ-01', slot: '08:00', temp: -19, condition: { ...COND_OK, ice: 'F' }, note: 'น้ำแข็งเกาะหนา แจ้ง defrost' }) });
check('a freezer reading flags an expired thermometer', r.status === 201 && r.j.status === 'PASS' && r.j.calib_expired === 1, r);
r = await call('POST', '/api/cold/readings', { token: qc, body: coldBody({ unit_id: 'FZ-01', slot: '11:00', temp: -16, actions: ['RECHECK'], note: 'defrost' }) });
check('a freezer at -16 °C is out of spec but not escalated', r.status === 201 && r.j.status === 'FAIL', r);
r = await call('GET', '/api/cold/readings?unit_id=CH-01&from=2026-09-01&to=2026-09-30', { token: qc });
check('readings are listed per unit with the limits in force', r.status === 200 && r.j.length === 3 && r.j.every((x) => x.limits.spec_max === 5 && x.inspector === 'QC One'), r.j);

// ----- formulas and PD_03 weighing -----
r = await call('GET', '/api/formulas', { token: qc });
const fg4 = r.j.find((f) => f.product_code === 'FG0004');
check('formulas start from the latest PD_03 weighings, all draft', r.status === 200 && r.j.length === 10 && r.j.every((f) => f.status === 'DRAFT' && f.tolerance_pct === null)
  && fg4.items.find((i) => i.name === 'หมูบด').target === 46.51 && /เจือปน/.test(fg4.items.find((i) => i.name === 'โปแตสเซียม').note), r.j.map((f) => f.product_code));
r = await call('PATCH', '/api/formulas/FG0004', { token: qa, body: { status: 'APPROVED' } });
check('a formula cannot be approved without a weighing tolerance', r.status === 422, r);
r = await call('PATCH', '/api/formulas/FG0004', { token: qc, body: { tolerance_pct: 2 } });
check('QC cannot change a formula', r.status === 403, r);
const fgItems = fg4.items.map((i) => ({ ...i, target: i.name === 'หมูบด' ? 45 : i.target }));
r = await call('PATCH', '/api/formulas/FG0004', { token: qa, body: { items: fgItems, tolerance_pct: 2, status: 'APPROVED' } });
check('QA sets targets and tolerance, approves, and the version moves on', r.status === 200 && r.j.version === 2, r);
const linesFor = (o = {}) => fgItems.map((i) => ({ name: i.name, lot: `LOT-${i.name}`, weights: [o[i.name] ?? i.target] }));
const wBody = (o = {}) => ({ uid: 'wr-uid-' + Math.random().toString(36).slice(2, 10), product_code: 'FG0004', prod_date: '2026-09-22', batch_no: 'B260922-01', sets: 1, scale_id: 'MDB009', lines: linesFor(), ...o });
r = await call('POST', '/api/weigh', { token: qc, body: wBody({ lines: linesFor().slice(1) }) });
check('every formula item must be weighed', r.status === 400, r);
r = await call('POST', '/api/weigh', { token: qc, body: wBody() });
check('weights within tolerance pass', r.status === 201 && r.j.result === 'PASS' && r.j.wr_id === 'PD-260922-001', r);
r = await call('POST', '/api/weigh', { token: qc, body: wBody() });
check('a batch is weighed once', r.status === 409, r);
const devBody = wBody({ batch_no: 'B260922-02', lines: linesFor({ หมูบด: 46.51 }) });
r = await call('POST', '/api/weigh', { token: qc, body: devBody });
check('out of tolerance cannot be saved by QC', r.status === 403, r);
r = await call('POST', '/api/weigh', { token: qa, body: devBody });
check('out of tolerance needs the assessment', r.status === 400, r);
r = await call('POST', '/api/weigh', { token: qa, body: { ...devBody, note: 'หมูบดเกิน 3.4% ประเมินแล้วไม่กระทบความปลอดภัย ปรับเครื่องปรุงตามสัดส่วน' } });
check('QA records an out-of-tolerance weighing with the assessment', r.status === 201 && r.j.result === 'DEVIATION' && /\+3\.4%/.test(r.j.deviations[0].text), r);
r = await call('POST', '/api/weigh', { token: qa, body: wBody({ batch_no: 'B260922-03', lines: [...linesFor(), { name: 'ผงชูรสเพิ่ม', lot: 'LOT-X', weights: [0.2] }], note: 'ทดลอง' }) });
check('an item outside the formula is a deviation', r.status === 201 && r.j.result === 'DEVIATION' && r.j.deviations[0].kind === 'EXTRA', r);
r = await call('GET', '/api/weigh?product_code=FG0004&batch_no=B260922-01', { token: qc });
check('a weighing keeps lots, weights, weigher and formula version', r.status === 200 && r.j.length === 1 && r.j[0].lines.length === 9 && r.j[0].weigher === 'QC One' && r.j[0].formula_version === 2 && r.j[0].tolerance_pct === 2, r.j);
r = await call('GET', '/api/trace?q=LOT-หมูบด', { token: qc });
check('tracing a raw-material lot finds the batches that weighed it', r.status === 200 && r.j.weighings.length === 3 && r.j.weighings.some((w) => w.batch_no === 'B260922-02' && w.lots.some((l) => l.kg === 46.51)), r.j.weighings);
r = await call('POST', '/api/weigh', { token: qc, body: wBody({ batch_no: 'B260922-09', lines: linesFor().map((l, i) => (i ? l : { ...l, lot: '' })) }) });
check('a line may leave its raw-material lot blank', r.status === 201 && r.j.result === 'PASS', r);

// ----- QC_08 production control → CCP-01 / CCP-02 / OPRP-05 records -----
const fryOff = { garlic: { done: false }, shallot: { done: false }, chili: { done: false } };
const pcA = (o = {}) => ({ uid: 'pc-uid-' + Math.random().toString(36).slice(2, 10), product_code: 'FG0002', product_name: 'น้ำพริกตาแดงมันกุ้ง', prod_date: '2026-09-23', batch_no: 'B260923-01', oil_type: 'น้ำมันรำข้าว',
  fry: { garlic: { done: true, temp: 87, min: 9 }, shallot: { done: true, w_before: 15.5, w_after: 6.2, temp: 93.6, min: 7 }, chili: { done: false } },
  ccp1: { reach_time: '09:10', end_time: '11:15', readings: [86.5, 88, 87.2, 88.4, 89], thermo_ok: true },
  heat: { temp: 88, min: 125 }, cool: { temp: 58, min: 40, foreign_ok: true, fill_temp: 55, to_cap_min: 60, cap_temp: 45, chilled: true }, ...o });
r = await call('POST', '/api/prodctl', { token: qc, body: pcA({ ccp1: null }) });
check('a group A batch must record the CCP-01 heating', r.status === 400 && /CCP-01/.test(r.j.error), r);
r = await call('POST', '/api/prodctl', { token: qc, body: pcA({ cool: { temp: 58, min: 40, fill_temp: 55, to_cap_min: 60, chilled: true } }) });
check('the foreign-matter check must be answered', r.status === 400, r);
r = await call('POST', '/api/prodctl', { token: qc, body: pcA({ ccp1: { reach_time: '09:10', end_time: '11:15', readings: [86.5, 88, 89] } }) });
check('nothing is saved while a derived check is unanswered', r.status === 400 && /เทอร์โมมิเตอร์/.test(r.j.error)
  && !db.prepare("SELECT 1 FROM prod_controls WHERE batch_no='B260923-01'").get(), r);
const goodA = pcA();
r = await call('POST', '/api/prodctl', { token: qc, body: goodA });
check('a passing group A batch derives CCP-01 and OPRP-05 records', r.status === 201 && r.j.result === 'PASS' && /^Q8-260923-001$/.test(r.j.pc_id)
  && r.j.derived.map((x) => x.cp_id).sort().join() === 'CCP-01,OPRP-05' && r.j.derived.every((x) => x.result === 'PASS'), r.j);
const a1 = r.j;
r = await call('GET', `/api/qc?cp_id=CCP-01&q=B260923-01`, { token: qc });
check('the CCP-01 record holds the hold time worked out from the clock times', r.j.length === 1 && r.j[0].values.hold_min === 125 && r.j[0].values.temp_min === 86.5, r.j);
r = await call('POST', '/api/prodctl', { token: qc, body: goodA });
check('the same QC_08 sent twice derives nothing twice', r.status === 200 && r.j.pc_id === a1.pc_id && r.j.derived.map((x) => x.rec_id).join() === a1.derived.map((x) => x.rec_id).join()
  && db.prepare("SELECT COUNT(*) AS n FROM qc_records WHERE batch_no='B260923-01'").get().n === 2, r.j);
r = await call('POST', '/api/prodctl', { token: qc, body: pcA({ uid: 'pc-uid-dup00001' }) });
check('a batch has one QC_08', r.status === 409, r);
r = await call('POST', '/api/prodctl', { token: qc, body: pcA({ batch_no: 'B260923-02', ccp1: { reach_time: '13:00', end_time: '14:40', readings: [86, 84.2, 88], thermo_ok: true } }) });
check('heating held 100 min with a dip below 85 °C fails CCP-01 and opens a critical NCR', r.status === 201 && r.j.result === 'FAIL'
  && r.j.derived.find((x) => x.cp_id === 'CCP-01').result === 'FAIL' && /^NCR-/.test(r.j.derived.find((x) => x.cp_id === 'CCP-01').ncr_id), r.j);
r = await call('GET', `/api/ncr/${r.j.derived.find((x) => x.cp_id === 'CCP-01').ncr_id}`, { token: qa });
check('that NCR names the dip and the short hold', r.j.severity === 'Critical' && /84.2/.test(r.j.actual_result) && /100/.test(r.j.actual_result), r.j.actual_result);
const pcB = (o = {}) => pcA({ product_code: 'FG0007', product_name: 'พริกผัดน้ำมันมะกอก สูตรออริจินอล', batch_no: 'B260923-11', ccp1: null,
  fry: { garlic: { done: true, w_after: 9.58, temp: 122.4, min: 8 }, shallot: { done: true, w_after: 15.92, temp: 132.2, min: 18 }, chili: { done: false } },
  fry_thermo_ok: true, heat: { temp: 46.6, min: 21 }, cool: { temp: 39.5, min: 9, foreign_ok: true }, ...o });
r = await call('POST', '/api/prodctl', { token: qc, body: pcB() });
check('a group B batch derives only CCP-02, with chili frying not applicable', r.status === 201 && r.j.result === 'PASS' && r.j.derived.length === 1 && r.j.derived[0].cp_id === 'CCP-02', r.j);
r = await call('GET', `/api/qc?cp_id=CCP-02&q=B260923-11`, { token: qc });
check('the CCP-02 record marks chili as N/A and takes the lowest oil temperature', r.j[0].values.chili_min === 'NA' && r.j[0].values.oil_temp === 122.4, r.j[0].values);
r = await call('POST', '/api/prodctl', { token: qc, body: pcB({ batch_no: 'B260923-12', fry: { garlic: { done: true, temp: 121.1, min: 6 }, shallot: { done: true, temp: 132.5, min: 20 }, chili: { done: false } } }) });
check('garlic fried 6 min (as on the paper form of 02/10) fails CCP-02', r.status === 201 && r.j.result === 'FAIL' && r.j.derived[0].result === 'FAIL', r.j);
r = await call('POST', '/api/prodctl', { token: qc, body: pcB({ batch_no: 'B260923-13', cool: { temp: 40, min: 9, foreign_ok: false } }) });
check('foreign matter needs details', r.status === 400, r);
r = await call('POST', '/api/prodctl', { token: qc, body: pcB({ batch_no: 'B260923-13', cool: { temp: 40, min: 9, foreign_ok: false }, note: 'พบเศษพลาสติกสีฟ้า' }) });
check('foreign matter opens an NCR and fails the batch', r.status === 201 && r.j.result === 'FAIL' && /^NCR-/.test(r.j.ncr_id), r.j);
r = await call('GET', '/api/prodctl?from=2026-09-23&to=2026-09-23', { token: qc });
check('QC_08 records are listed with their derived checks', r.status === 200 && r.j.length === 5 && r.j.every((x) => x.inspector === 'QC One' && x.result !== 'PENDING'), r.j.map((x) => [x.pc_id, x.result]));
r = await call('GET', '/api/release/check?product_code=FG0002&batch_no=B260923-01', { token: qc });
check('FG Release sees the derived CCP records', r.status === 200 && r.j.requirements.find((x) => x.cp_id === 'CCP-01').state === 'PASS', r.j.requirements);

// The schema runs at every deploy: running it again changes nothing people entered, and retires only untouched first-register entries.
db.prepare("INSERT INTO control_points (cp_id,name,cp_type,status,params,version,created_by,created_at,updated_by,updated_at) VALUES ('CP-HEAT','old','TBD','DRAFT','[]',1,'system','x','system','x'),('CP-BONE','old','TBD','DRAFT','[]',2,'system','x','qam','x')").run();
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const cpAfter = Object.fromEntries(db.prepare('SELECT cp_id, status, version FROM control_points').all().map((c) => [c.cp_id, c]));
check('re-applying the schema keeps edits and retires untouched old entries once', cpAfter['CCP-01'].status === 'APPROVED' && cpAfter['CCP-01'].version === 2
  && cpAfter['CP-HEAT'].status === 'RETIRED' && cpAfter['CP-HEAT'].version === 2 && cpAfter['CP-BONE'].status === 'DRAFT'
  && db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id='CP-HEAT'").get().n === 1, cpAfter);

await call('POST', '/api/logout', { token: qa });
r = await call('GET', '/api/me', { token: qa });
check('logout ends the session', r.status === 401, r);

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

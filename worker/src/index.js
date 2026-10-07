// Puisabpak NCR e-Form API (Cloudflare Worker + D1)
// Adds over the previous version: login + roles, enforced workflow, audit trail,
// server-generated NCR numbers, paging/search, and a restricted supplier reply link.

const SESSION_HOURS = 12;
const SUPPLIER_LINK_DAYS = 14;
const MAX_FAILED = 5;
const MAX_PHOTOS = 8;            // per NCR and per kind (problem / correction), attached by staff
const MAX_SUPPLIER_PHOTOS = 6;   // per NCR, attached by the supplier with the reply
const PRINT_DOC_MINUTES = 30; // how long a document handed over for printing can be opened
const MAX_PHOTO_BYTES = 1024 * 1024; // after the phone has resized the picture
const PHOTO_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const LOCK_MINUTES = 15;

const ROLES = ['QA_MANAGER', 'FSTL', 'QC', 'SUPERVISOR', 'VIEWER'];
const WRITERS = new Set(['QA_MANAGER', 'FSTL', 'QC', 'SUPERVISOR']);
const QA = new Set(['QA_MANAGER', 'FSTL']);
// Validation and release decisions: the QA Manager alone (control point register, FG Release).
const QAM = new Set(['QA_MANAGER']);
// Production-side checks (CCP/OPRP records, FM-QC-002, FM-QC-005, FM-QC-006) open NCRs only when
// AUTO_NCR_PRODUCTION = "on". Off during the trial: a failed check is still recorded as FAIL. Receiving NCs are unaffected.
let AUTO_NCR = false;
// Receiving NCs become NCRs only when AUTO_NCR_RECEIVING = "on". Off: an NC (NC-YYMM-NNN) is followed up and closed
// in the receiving app with what was done and the re-check result, with no NCR.
let AUTO_NCR_RECV = false;
const COND_ROLES = new Set(['QA_MANAGER', 'FSTL', 'SUPERVISOR', 'QC']); // who may receive material with conditions
const ASSESSORS = new Set(['QA_MANAGER', 'FSTL', 'SUPERVISOR']); // who may assess a weighing out of tolerance (FM-QC-004)

// Fields any writer may set while the NCR is still open.
const NCR_BASE = [
  'source_type', 'source_ref', 'nc_description', 'immediate_action', 'suggestion', 'lot_no', 'product_lot_no',
  'found_date', 'found_time', 'hold_location', 'reported_by', 'assignee', 'target_date',
  'defect_qty', 'defect_unit', 'photo_urls', 'process_ref', 'material_code', 'material_name',
  'supplier_id', 'supplier_name', 'parameter_id', 'parameter_name', 'critical_limit',
  'actual_result', 'visual_check', 'allergen', 'shipped_status', 'shipped_qty', 'shipped_customer',
  'root_cause', 'corrective_action', 'preventive_action', 'reply_date', 'related_capa_id',
];
// Fields only QA Manager / Food Safety Team Leader may set.
const NCR_QA = ['severity', 'disposition', 'disposition_reason', 'recall_required',
  'verification_result', 'verification_note', 'status', 'status_reason'];
// Supplier reply links: what the supplier may see and write, per document type.
const FISHBONE = ['fishbone_man', 'fishbone_machine', 'fishbone_material', 'fishbone_method',
  'fishbone_environment', 'fishbone_measurement'];
const SUPPLIER = {
  ncr: {
    table: 'ncr_records', pk: 'ncr_id',
    view: ['ncr_id', 'issue_date', 'found_date', 'source_type', 'severity', 'material_code', 'material_name',
      'supplier_name', 'lot_no', 'product_lot_no', 'nc_description', 'immediate_action', 'suggestion', 'defect_qty',
      'defect_unit', 'photo_urls', 'target_date', 'status', 'root_cause', 'corrective_action',
      'preventive_action', 'supplier_reply_by', 'supplier_reply_at'],
    write: ['root_cause', 'corrective_action', 'preventive_action', 'target_date'],
    required: { root_cause: 'สาเหตุของปัญหา', corrective_action: 'การแก้ไข' },
    nextStatus: 'Pending Verification',
    locked: (r) => r.status === 'Closed' || r.status === 'Cancelled',
  },
  capa: {
    table: 'capa_actions', pk: 'capa_id',
    view: ['capa_id', 'source_ref', 'severity_label', 'description', 'detail', 'target_date', 'status',
      'why1', 'why2', 'why3', 'why4', 'why5', 'root_cause_summary', ...FISHBONE, 'containment_action',
      'corrective_action', 'preventive_action', 'responsible_person', 'supplier_reply_by', 'supplier_reply_at'],
    write: ['why1', 'why2', 'why3', 'why4', 'why5', 'root_cause_summary', ...FISHBONE, 'containment_action',
      'corrective_action', 'preventive_action', 'target_date', 'responsible_person'],
    required: { root_cause_summary: 'สรุปสาเหตุ', corrective_action: 'การแก้ไข' },
    nextStatus: 'Verification',
    locked: (r) => String(r.status).startsWith('Closed') || r.status === 'Cancelled',
  },
};

const CAPA_BASE = ['description', 'detail', 'priority', 'severity_label', 'responsible_person',
  'target_date', 'actual_completion', 'why1', 'why2', 'why3', 'why4', 'why5', 'root_cause_summary',
  'root_cause_analysis', 'fishbone_man', 'fishbone_machine', 'fishbone_material', 'fishbone_method',
  'fishbone_environment', 'fishbone_measurement', 'containment_action', 'corrective_action',
  'preventive_action', 'effectiveness_criteria', 'effectiveness_check_date', 'status'];
const CAPA_QA = ['effectiveness_result'];

// ---------- helpers ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/.{2}/g).map((h) => parseInt(h, 16)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const nowIso = () => new Date().toISOString();
const bkk = () => new Date(Date.now() + 7 * 3600e3).toISOString(); // Asia/Bangkok wall clock
const today = () => bkk().slice(0, 10);
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const nz = (v) => (blank(v) ? null : v);

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, key, 256);
  return hex(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  return null;
}

function decodePhoto(b) {
  const type = String(b.content_type || '');
  const magic = PHOTO_TYPES[type];
  if (!magic) fail(400, 'รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP');
  const b64 = String(b.data || '').replace(/^data:[^,]*,/, '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) fail(400, 'ข้อมูลภาพไม่ถูกต้อง');
  if (b64.length * 0.75 > MAX_PHOTO_BYTES) fail(413, 'ไฟล์ภาพใหญ่เกิน 1 MB');
  let head;
  try { head = atob(b64.slice(0, 16)); } catch { fail(400, 'ข้อมูลภาพไม่ถูกต้อง'); }
  if (!magic.every((v, i) => head.charCodeAt(i) === v)) fail(400, 'ไฟล์ไม่ใช่ภาพตามชนิดที่ระบุ');
  return { type, b64, size: Math.floor(b64.length * 0.75) };
}
function photoResponse(row, cors) {
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: {
    'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', ...cors } });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

async function audit(DB, actor, actorType, action, entity, entityId, changes) {
  await DB.prepare(
    'INSERT INTO audit_log (ts,actor,actor_type,action,entity,entity_id,changes) VALUES (?,?,?,?,?,?,?)'
  ).bind(nowIso(), actor, actorType, action, entity, entityId ?? null,
    changes ? JSON.stringify(changes) : null).run();
}
function diff(before, after, fields) {
  const out = {};
  for (const k of fields) {
    const a = before?.[k] ?? null, b = after[k] ?? null;
    if (String(a ?? '') !== String(b ?? '')) out[k] = { from: a, to: b };
  }
  return out;
}

async function nextId(DB, table, col, prefix) {
  const yymm = bkk().slice(2, 4) + bkk().slice(5, 7);
  const like = `${prefix}-${yymm}-%`;
  const row = await DB.prepare(`SELECT ${col} AS id FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`)
    .bind(like).first();
  const n = row ? parseInt(row.id.split('-').pop(), 10) + 1 : 1;
  return `${prefix}-${yymm}-${String(n).padStart(3, '0')}`;
}

// ---------- auth ----------
async function currentUser(req, DB) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) fail(401, 'กรุณาเข้าสู่ระบบ');
  const row = await DB.prepare(
    `SELECT u.username, u.display_name, u.role, s.expires_at, s.token_hash
       FROM sessions s JOIN users u ON u.username = s.username
      WHERE s.token_hash = ? AND u.active = 1`
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < nowIso()) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return row;
}
const need = (user, set, msg = 'ไม่มีสิทธิ์ทำรายการนี้') => { if (!set.has(user.role)) fail(403, msg); };

function cleanUsername(v) {
  const u = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) fail(400, 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3–32 ตัว');
  return u;
}

async function createUser(DB, { username, display_name, role, password }, by) {
  username = cleanUsername(username);
  if (!ROLES.includes(role)) fail(400, 'บทบาทไม่ถูกต้อง');
  if (blank(display_name)) fail(400, 'กรุณาระบุชื่อที่แสดง');
  const p = passwordProblem(password);
  if (p) fail(400, p);
  if (await DB.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) fail(409, 'มีชื่อผู้ใช้นี้แล้ว');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await DB.prepare(
    'INSERT INTO users (username,display_name,role,pass_hash,salt,created_by) VALUES (?,?,?,?,?,?)'
  ).bind(username, String(display_name).trim(), role, await hashPassword(password, salt), salt, by).run();
  await audit(DB, by, by === 'setup' ? 'system' : 'user', 'create', 'user', username, { role });
  return username;
}

// ---------- NCR rules ----------
function closeProblems(r) {
  const p = [];
  if (blank(r.immediate_action)) p.push('การแก้ไขเบื้องต้น');
  if (blank(r.disposition)) p.push('การตัดสินใจจัดการสินค้า');
  if (blank(r.disposition_reason)) p.push('เหตุผลของการตัดสินใจ');
  if (r.severity !== 'Minor') {
    if (blank(r.root_cause)) p.push('สาเหตุที่แท้จริง');
    if (blank(r.corrective_action)) p.push('การปฏิบัติการแก้ไข');
  }
  if (r.source_type === 'CCP') {
    if (blank(r.critical_limit)) p.push('ค่าวิกฤต');
    if (blank(r.actual_result)) p.push('ค่าที่วัดได้');
  }
  if (r.shipped_status === 'SHIPPED' && (r.recall_required === null || r.recall_required === undefined)) {
    p.push('ผลการพิจารณาเรียกคืน (สินค้าส่งมอบแล้ว)');
  }
  if (r.verification_result !== 'Effective') p.push('ผลการทวนสอบต้องเป็น Effective');
  return p;
}

// ---------- PSP QUALITY APP: control points ----------
const CP_TYPES = ['CCP', 'OPRP', 'PRP', 'TBD'];
const CP_STATUS = ['DRAFT', 'APPROVED', 'RETIRED'];
const CP_TEXT = ['name', 'process_ref', 'hazard', 'monitoring', 'frequency', 'corrective_action', 'verification', 'form_code'];
const PARAM_TYPES = ['number', 'check', 'text'];

const cpRow = (r) => r && { ...r, params: JSON.parse(r.params), products: r.products ? JSON.parse(r.products) : [] };

function cleanParams(list) {
  if (!Array.isArray(list) || !list.length || list.length > 20) fail(400, 'ต้องมีรายการตรวจ 1–20 รายการ');
  const seen = new Set();
  return list.map((p) => {
    const key = String(p?.key || '').trim();
    if (!/^[a-z0-9_]{1,30}$/.test(key) || seen.has(key)) fail(400, `รหัสรายการตรวจไม่ถูกต้องหรือซ้ำ: ${key || '(ว่าง)'}`);
    seen.add(key);
    if (blank(p.label) || String(p.label).length > 120) fail(400, `กรุณาระบุชื่อรายการตรวจ ${key}`);
    if (!PARAM_TYPES.includes(p.type)) fail(400, `ชนิดของรายการตรวจ ${key} ไม่ถูกต้อง`);
    const out = { key, label: String(p.label).trim(), type: p.type };
    if (p.type === 'number') {
      if (!blank(p.unit)) out.unit = String(p.unit).trim().slice(0, 20);
      for (const k of ['min', 'max']) {
        if (blank(p[k])) continue;
        const n = Number(p[k]);
        if (!Number.isFinite(n)) fail(400, `ค่า ${k} ของ ${out.label} ต้องเป็นตัวเลข`);
        out[k] = n;
      }
      if (out.min !== undefined && out.max !== undefined && out.min > out.max) fail(400, `ค่าต่ำสุดของ ${out.label} มากกว่าค่าสูงสุด`);
    }
    return out;
  });
}
function cleanProducts(list) {
  if (list === null || list === undefined || list === '') return null;
  if (!Array.isArray(list) || list.length > 100 || list.some((c) => !/^[A-Za-z0-9_-]{1,30}$/.test(String(c)))) fail(400, 'รายการผลิตภัณฑ์ไม่ถูกต้อง');
  return list.length ? JSON.stringify([...new Set(list.map(String))]) : null;
}
const limitText = (p) => {
  const u = p.unit ? ` ${p.unit}` : '';
  if (p.min !== undefined && p.max !== undefined) return `${p.min}–${p.max}${u}`;
  if (p.min !== undefined) return `≥ ${p.min}${u}`;
  if (p.max !== undefined) return `≤ ${p.max}${u}`;
  return p.type === 'check' ? 'ต้องเป็น "ใช่"' : 'บันทึกค่า';
};
// Checks one entry against the limits in force. Every number and every check must be answered.
function evaluate(params, values, na = []) {
  const out = {}, failed = [];
  for (const p of params) {
    if (na.includes(p.key)) { out[p.key] = 'NA'; continue; }
    const v = values?.[p.key];
    if (p.type === 'number') {
      if (blank(v)) fail(400, `กรุณากรอก ${p.label}`);
      const n = Number(v);
      if (!Number.isFinite(n)) fail(400, `${p.label} ต้องเป็นตัวเลข`);
      out[p.key] = n;
      if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) {
        failed.push({ key: p.key, label: p.label, value: `${n}${p.unit ? ' ' + p.unit : ''}`, limit: limitText(p) });
      }
    } else if (p.type === 'check') {
      if (v !== true && v !== false) fail(400, `กรุณาเลือกผลของ "${p.label}"`);
      out[p.key] = v;
      if (!v) failed.push({ key: p.key, label: p.label, value: 'ไม่ใช่', limit: limitText(p) });
    } else if (!blank(v)) {
      out[p.key] = String(v).trim().slice(0, 200);
    }
  }
  return { values: out, failed };
}

// Saves one monitoring record against the limits in force; a failed check opens an NCR in the same write.
// Used by the monitoring form and by the forms that derive records from what they capture (FM-QC-002).
// `na`: checks that do not apply to this batch (recorded as NA, never judged).
async function saveQcRecord(DB, user, b, na = []) {
  const uid = String(b.uid || '');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(uid)) fail(400, 'รหัสอ้างอิงรายการไม่ถูกต้อง');
  const done = await DB.prepare('SELECT rec_id, result, ncr_id FROM qc_records WHERE uid=?').bind(uid).first();
  if (done) return { status: 200, body: done }; // the same save arriving twice
  const cp = cpRow(await DB.prepare('SELECT * FROM control_points WHERE cp_id=?').bind(String(b.cp_id || '')).first());
  if (!cp) fail(404, 'ไม่พบจุดควบคุม');
  if (cp.status === 'RETIRED') fail(409, 'จุดควบคุมนี้ยกเลิกการใช้งานแล้ว');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.record_date || ''))) fail(400, 'กรุณาระบุวันที่ตรวจ');
  if (b.record_date > today()) fail(400, 'วันที่ตรวจต้องไม่เป็นวันในอนาคต');
  if (!blank(b.record_time) && !/^\d{2}:\d{2}$/.test(String(b.record_time))) fail(400, 'รูปแบบเวลาไม่ถูกต้อง');
  if (blank(b.batch_no) || String(b.batch_no).length > 60) fail(400, 'กรุณาระบุเลขที่ Batch');
  if (cp.products.length && !cp.products.includes(String(b.product_code || ''))) fail(400, 'ผลิตภัณฑ์นี้ไม่อยู่ในขอบเขตของจุดควบคุม');
  const { values, failed } = evaluate(cp.params, b.values, na);
  const result = failed.length ? 'FAIL' : 'PASS';
  const rec = {
    cp_id: cp.cp_id, cp_version: cp.version, cp_status: cp.status, record_date: b.record_date, record_time: nz(b.record_time),
    shift: nz(blank(b.shift) ? null : String(b.shift).trim().slice(0, 20)), product_code: nz(b.product_code),
    product_name: nz(blank(b.product_name) ? null : String(b.product_name).trim().slice(0, 200)),
    batch_no: String(b.batch_no).trim(), result, values: JSON.stringify(values), failed: failed.length ? JSON.stringify(failed) : null,
    note: nz(blank(b.note) ? null : String(b.note).trim().slice(0, 1000)), inspector: user.display_name,
  };
  for (let attempt = 0; ; attempt++) {
    const day = rec.record_date.slice(2).replace(/-/g, '');
    const last = await DB.prepare('SELECT rec_id FROM qc_records WHERE rec_id LIKE ? ORDER BY rec_id DESC LIMIT 1').bind(`QC-${day}-%`).first();
    const recId = `QC-${day}-${String((last ? parseInt(last.rec_id.slice(-4), 10) : 0) + 1).padStart(4, '0')}`;
    const ncrId = failed.length && AUTO_NCR ? (await nextId(DB, 'ncr_records', 'ncr_id', 'NCR')) : null;
    const stmts = [];
    if (ncrId) {
      // A failed check is a deviation: the batch is held and an NCR opened in the same write, so neither can be lost.
      const ccp = cp.cp_type === 'CCP';
      const f = {
        source_type: ccp ? 'CCP' : 'IN_PROCESS', source_ref: recId, process_ref: cp.process_ref,
        found_date: rec.record_date, found_time: rec.record_time, reported_by: user.display_name,
        material_code: rec.product_code, material_name: rec.product_name, product_lot_no: rec.batch_no,
        parameter_id: cp.cp_id, parameter_name: failed.map((x) => x.label).join(', ').slice(0, 300),
        critical_limit: failed.map((x) => `${x.label}: ${x.limit}`).join('\n').slice(0, 1000),
        actual_result: failed.map((x) => `${x.label}: ${x.value}`).join('\n').slice(0, 1000),
        nc_description: [
          `${cp.name} (${cp.cp_id}${cp.cp_type !== 'TBD' ? ' · ' + cp.cp_type : ''}) ไม่ผ่านเกณฑ์ — บันทึก ${recId}`,
          `ผลิตภัณฑ์: ${[rec.product_code, rec.product_name].filter(Boolean).join(' ') || '-'} · Batch ${rec.batch_no}`,
          ...failed.map((x) => `• ${x.label}: ${x.value} (เกณฑ์ ${x.limit})`),
          cp.status === 'DRAFT' ? 'หมายเหตุ: เกณฑ์ของจุดควบคุมนี้ยังเป็นฉบับร่าง รอ validate' : '',
          rec.note ? `หมายเหตุผู้ตรวจ: ${rec.note}` : '',
        ].filter(Boolean).join('\n').slice(0, 2000),
        immediate_action: `กักกัน Batch ${rec.batch_no} รอ QA ตัดสิน${cp.corrective_action ? ' — ' + cp.corrective_action : ''}`.slice(0, 1000),
        hold_location: null, severity: ccp ? 'Critical' : 'Major', shipped_status: 'NOT_SHIPPED',
      };
      const cols = Object.keys(f);
      stmts.push(DB.prepare(
        `INSERT INTO ncr_records (ncr_id,issue_date,status,created_by,updated_by,created_at,updated_at,${cols.join(',')})
         VALUES (?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`
      ).bind(ncrId, today(), 'Open', user.username, user.username, nowIso(), nowIso(), ...cols.map((k) => f[k])));
    }
    const cols = Object.keys(rec);
    stmts.push(DB.prepare(
      `INSERT INTO qc_records (rec_id,uid,${cols.map((c) => (c === 'values' ? '"values"' : c)).join(',')},ncr_id,created_by,created_at)
       VALUES (?,?,${cols.map(() => '?').join(',')},?,?,?)`
    ).bind(recId, uid, ...cols.map((k) => rec[k]), ncrId, user.username, nowIso()));
    try { await DB.batch(stmts); } catch (e) {
      if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
        const again = await DB.prepare('SELECT rec_id, result, ncr_id FROM qc_records WHERE uid=?').bind(uid).first();
        if (again) return { status: 200, body: again };
        continue;
      }
      throw e;
    }
    await audit(DB, user.username, 'user', 'create', 'qc_record', recId, { cp_id: cp.cp_id, batch_no: rec.batch_no, result, ncr_id: ncrId });
    if (ncrId) await audit(DB, user.username, 'user', 'create', 'ncr', ncrId, { source_type: cp.cp_type === 'CCP' ? 'CCP' : 'IN_PROCESS', qc_record: recId });
    return { status: 201, body: { rec_id: recId, result, ncr_id: ncrId, failed } };
  }
}

// ---------- PSP QUALITY APP: finished-goods release gate ----------
const NCR_DONE = ['Closed', 'Cancelled'];
const NCR_DISCARD = { DESTROY: 'ทำลาย', RECALL: 'เรียกคืน', RETURN_SUPPLIER: 'คืนผู้ขาย' };
const cleanBatch = (v) => { const s = String(v ?? '').trim(); if (!s || s.length > 60) fail(400, 'กรุณาระบุเลขที่ Batch'); return s; };

// Everything QA needs to see before deciding on one batch, worked out on the server so the
// decision rests on the records themselves and not on what a screen showed.
async function batchGate(DB, productCode, batchNo) {
  const { results: cps } = await DB.prepare(
    `SELECT c.cp_id, c.name, c.cp_type, c.status, c.products FROM control_points c JOIN cp_release r ON r.cp_id = c.cp_id
      WHERE r.release_required = 1 AND c.status <> 'RETIRED' ORDER BY c.process_ref, c.cp_id`).all();
  const applies = cps.filter((c) => !c.products || JSON.parse(c.products).includes(productCode));
  const { results: ncrs } = await DB.prepare(
    `SELECT ncr_id, status, severity, disposition, source_type, source_ref FROM ncr_records
      WHERE product_lot_no = ? AND (material_code = ? OR material_code IS NULL OR material_code = '') ORDER BY ncr_id`).bind(batchNo, productCode).all();
  const ncrById = Object.fromEntries(ncrs.map((n) => [n.ncr_id, n]));
  const reasons = [];
  const requirements = [];
  for (const c of applies) {
    const rec = await DB.prepare(
      `SELECT rec_id, result, ncr_id, record_date, record_time, cp_status FROM qc_records
        WHERE cp_id = ? AND batch_no = ? AND (product_code = ? OR product_code IS NULL OR product_code = '')
        ORDER BY created_at DESC, rec_id DESC LIMIT 1`).bind(c.cp_id, batchNo, productCode).first();
    let state = 'MISSING';
    if (rec?.result === 'PASS') state = 'PASS';
    else if (rec) {
      // A failed check stands until a newer passing record, or QA closes its NCR deciding to release.
      const n = ncrById[rec.ncr_id];
      state = n && n.status === 'Closed' && n.disposition === 'RELEASE' ? 'CONCESSION' : 'FAIL';
    }
    if (state === 'MISSING') reasons.push(`ยังไม่มีบันทึก ${c.cp_id} ${c.name}`);
    if (state === 'FAIL') reasons.push(`${c.cp_id} ไม่ผ่านเกณฑ์ (บันทึก ${rec.rec_id}${rec.ncr_id ? ' · ' + rec.ncr_id : ''})`);
    requirements.push({ cp_id: c.cp_id, name: c.name, cp_type: c.cp_type, cp_status: c.status, state,
      rec_id: rec?.rec_id || null, ncr_id: rec?.ncr_id || null, record_date: rec?.record_date || null, record_time: rec?.record_time || null });
  }
  if (!applies.length) reasons.push('ผลิตภัณฑ์นี้ยังไม่มีจุดควบคุมที่ต้องตรวจก่อนปล่อย (ยังไม่อยู่ในแผน HACCP) ให้ QA กำหนดในทะเบียนจุดควบคุมก่อน');
  for (const n of ncrs) {
    if (!NCR_DONE.includes(n.status)) reasons.push(`${n.ncr_id} ยังไม่ปิด (${n.status})`);
    else if (n.status === 'Closed' && NCR_DISCARD[n.disposition]) reasons.push(`${n.ncr_id} ตัดสินให้${NCR_DISCARD[n.disposition]}สินค้า`);
  }
  const released = await DB.prepare("SELECT rel_id FROM fg_releases WHERE product_code=? AND batch_no=? AND decision='RELEASE'").bind(productCode, batchNo).first();
  if (released) reasons.push(`Batch นี้ปล่อยแล้ว (${released.rel_id})`);
  return { product_code: productCode, batch_no: batchNo, requirements, ncrs, reasons, releasable: !reasons.length };
}
const relRow = (r) => ({ ...r, rm_lots: r.rm_lots ? JSON.parse(r.rm_lots) : [], checks: r.checks ? JSON.parse(r.checks) : {}, gate: JSON.parse(r.gate) });
const RELEASE_CHECKS = ['label_ok', 'pack_ok', 'spec_ok'];

// An NCR opened by the system from a failed check, written in the same batch as the check itself.
function autoNcrStmt(DB, user, ncrId, f) {
  const rec = { shipped_status: 'NOT_SHIPPED', reported_by: user.display_name, ...f };
  const cols = Object.keys(rec);
  return DB.prepare(
    `INSERT INTO ncr_records (ncr_id,issue_date,status,created_by,updated_by,created_at,updated_at,${cols.join(',')})
     VALUES (?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`
  ).bind(ncrId, today(), 'Open', user.username, user.username, nowIso(), nowIso(), ...cols.map((k) => rec[k]));
}
// Next number of the form PREFIX-YYMMDD-NNN for a day, from the highest one used.
async function dayId(DB, table, col, prefix, date, width = 3) {
  const day = date.slice(2).replace(/-/g, '');
  const last = await DB.prepare(`SELECT ${col} AS id FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`).bind(`${prefix}-${day}-%`).first();
  return `${prefix}-${day}-${String((last ? parseInt(last.id.split('-').pop(), 10) : 0) + 1).padStart(width, '0')}`;
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = (v) => /^\d{2}:\d{2}$/.test(String(v || ''));
const txt = (v, n) => (blank(v) ? null : String(v).trim().slice(0, n));

// ---------- FM-QC-002 production control: what it captures, and the control-point values derived from it ----------
const FRY_STEPS = ['garlic', 'shallot', 'chili'];
const FRY_TH = { garlic: 'กระเทียม', shallot: 'หอม', chili: 'พริก / เห็ด / หมูบด' };
const minutesBetween = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d < 0) d += 1440; return d; };
function cleanProdData(b) {
  const num = (v, label, lo, hi) => {
    if (blank(v)) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${label} ต้องเป็นตัวเลข ${lo}–${hi}`);
    return n;
  };
  const fry = {};
  for (const k of FRY_STEPS) {
    const s = b.fry?.[k] || {};
    if (!s.done) { fry[k] = { done: false }; continue; }
    fry[k] = { done: true, kind: k === 'chili' ? (['พริก', 'เห็ด', 'หมูบด'].includes(s.kind) ? s.kind : 'พริก') : undefined,
      w_before: num(s.w_before, `น้ำหนักก่อน (${FRY_TH[k]})`, 0, 1000), w_after: num(s.w_after, `น้ำหนักหลัง (${FRY_TH[k]})`, 0, 1000),
      temp: num(s.temp, `อุณหภูมิ (${FRY_TH[k]})`, 0, 300), min: num(s.min, `เวลาคั่ว/ทอด (${FRY_TH[k]})`, 0, 600) };
    if (fry[k].temp === null || fry[k].min === null) fail(400, `กรุณากรอกอุณหภูมิและเวลาของ${FRY_TH[k]}`);
  }
  const c1 = b.ccp1 || {};
  const ccp1 = (c1.reach_time || c1.end_time || (Array.isArray(c1.readings) && c1.readings.some((v) => !blank(v)))) ? {
    reach_time: c1.reach_time, end_time: c1.end_time, thermo_ok: c1.thermo_ok === true ? true : c1.thermo_ok === false ? false : null,
    readings: (Array.isArray(c1.readings) ? c1.readings : []).filter((v) => !blank(v)).slice(0, 12).map((v) => num(v, 'อุณหภูมิแกนกลาง', 0, 150)),
  } : null;
  if (ccp1) {
    if (!isTime(ccp1.reach_time) || !isTime(ccp1.end_time)) fail(400, 'กรุณาระบุเวลาที่ถึง 85°C และเวลาสิ้นสุด');
    if (ccp1.readings.length < 2) fail(400, 'บันทึกอุณหภูมิแกนกลางอย่างน้อย 2 ค่า (เริ่มนับเวลา และสิ้นสุด) และทุก 30 นาที');
  }
  const cool = b.cool || {};
  return {
    fry, fry_thermo_ok: b.fry_thermo_ok === true ? true : b.fry_thermo_ok === false ? false : null,
    grind: { count: num(b.grind?.count, 'จำนวนครั้งที่บด', 0, 50), w_after: num(b.grind?.w_after, 'น้ำหนักหลังบด', 0, 1000) },
    heat: { temp: num(b.heat?.temp, 'อุณหภูมิผัด/กวน', 0, 200), min: num(b.heat?.min, 'เวลาผัด/กวน', 0, 1000) },
    ccp1,
    cool: { temp: num(cool.temp, 'อุณหภูมิพักเย็น', 0, 150), min: num(cool.min, 'เวลาพักเย็น', 0, 2000), foreign_ok: cool.foreign_ok === true ? true : cool.foreign_ok === false ? false : null,
      fill_temp: num(cool.fill_temp, 'อุณหภูมิขณะบรรจุ', 0, 150), to_cap_min: num(cool.to_cap_min, 'เวลาจนปิดฝา', 0, 3000), cap_temp: num(cool.cap_temp, 'อุณหภูมิขณะปิดฝา', 0, 150),
      chilled: cool.chilled === true ? true : cool.chilled === false ? false : null },
  };
}
// Values for each control point that applies to the product. Keys follow the register (QP-HA-001 sheet 7);
// if QA renames a check there, the record asks for it by name, so the mismatch shows instead of passing silently.
function deriveValues(cpId, d) {
  if (cpId === 'CCP-01') {
    if (!d.ccp1) fail(400, 'ผลิตภัณฑ์นี้ผ่าน CCP-01 ต้องบันทึกการผัดฆ่าเชื้อ (เวลาที่ถึง 85°C, อุณหภูมิทุก 30 นาที, เวลาสิ้นสุด)');
    const r = d.ccp1.readings;
    return { values: { temp_start: r[0], temp_min: Math.min(...r), temp_end: r[r.length - 1], hold_min: minutesBetween(d.ccp1.reach_time, d.ccp1.end_time),
      thermo_ok: d.ccp1.thermo_ok, times: `${d.ccp1.reach_time}–${d.ccp1.end_time} · ${r.join(' / ')} °C` }, na: [], time: d.ccp1.end_time };
  }
  if (cpId === 'CCP-02') {
    const done = FRY_STEPS.filter((k) => d.fry[k].done);
    if (!done.length) fail(400, 'ผลิตภัณฑ์นี้ผ่าน CCP-02 ต้องบันทึกการทอด/เจียวอย่างน้อย 1 ขั้นตอน');
    const chiliFried = d.fry.chili.done && d.fry.chili.kind === 'พริก';
    const na = [!d.fry.garlic.done && 'garlic_min', !d.fry.shallot.done && 'shallot_min', !chiliFried && 'chili_min'].filter(Boolean);
    return { values: { oil_temp: Math.min(...done.map((k) => d.fry[k].temp)), garlic_min: d.fry.garlic.min, shallot_min: d.fry.shallot.min,
      chili_min: chiliFried ? d.fry.chili.min : null, thermo_ok: d.fry_thermo_ok }, na };
  }
  if (cpId === 'OPRP-05') {
    const c = d.cool;
    return { values: { to_cap_min: c.to_cap_min, fill_temp: c.fill_temp, cap_temp: c.cap_temp, chilled: c.chilled }, na: c.cap_temp === null ? ['cap_temp'] : [] };
  }
  return null;
}
const DERIVED_CPS = ['CCP-01', 'CCP-02', 'OPRP-05'];

// ---------- router ----------
export default {
  async fetch(req, env) {
    AUTO_NCR = env.AUTO_NCR_PRODUCTION === 'on';
    AUTO_NCR_RECV = env.AUTO_NCR_RECEIVING === 'on';
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    const origin = req.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Setup-Key',
      'Vary': 'Origin',
    };
    if (origin && allowed.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    });

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const DB = env.DB;
    if (!DB) return json({ error: 'Database not connected' }, 503);

    try {
      const body = async () => {
        try { const b = await req.json(); if (b && typeof b === 'object') return b; } catch { /* fall through */ }
        fail(400, 'รูปแบบข้อมูลไม่ถูกต้อง');
      };

      if (path === '/api/health') return json({ ok: true, ts: nowIso() });

      // ----- first-time setup: creates the first QA Manager, only while no user exists -----
      if (method === 'POST' && path === '/api/setup') {
        if (blank(env.SETUP_KEY) || !safeEqual(req.headers.get('X-Setup-Key') || '', env.SETUP_KEY)) fail(403, 'Setup key ไม่ถูกต้อง');
        const { n } = await DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        if (n > 0) fail(409, 'ตั้งค่าระบบไปแล้ว');
        const b = await body();
        const username = await createUser(DB, { ...b, role: 'QA_MANAGER' }, 'setup');
        return json({ success: true, username }, 201);
      }

      // ----- login / logout -----
      if (method === 'POST' && path === '/api/login') {
        const b = await body();
        const username = String(b.username || '').trim().toLowerCase();
        const u = await DB.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(username).first();
        const bad = () => fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        if (!u) bad();
        if (u.locked_until && u.locked_until > nowIso()) fail(429, `บัญชีถูกล็อกชั่วคราว ลองใหม่ใน ${LOCK_MINUTES} นาที`);
        const okPw = safeEqual(await hashPassword(String(b.password || ''), u.salt), u.pass_hash);
        if (!okPw) {
          const failed = u.failed_count + 1;
          const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString() : null;
          await DB.prepare('UPDATE users SET failed_count=?, locked_until=? WHERE username=?')
            .bind(lock ? 0 : failed, lock, username).run();
          if (lock) await audit(DB, username, 'user', 'lockout', 'user', username, null);
          bad();
        }
        const token = randomToken();
        const expires = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
        await DB.batch([
          DB.prepare('UPDATE users SET failed_count=0, locked_until=NULL WHERE username=?').bind(username),
          DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
          DB.prepare('INSERT INTO sessions (token_hash,username,expires_at) VALUES (?,?,?)')
            .bind(await sha256(token), username, expires),
        ]);
        await audit(DB, username, 'user', 'login', 'user', username, null);
        return json({ token, expires_at: expires, user: { username, display_name: u.display_name, role: u.role, auto_ncr: AUTO_NCR, auto_ncr_recv: AUTO_NCR_RECV } });
      }

      // ----- supplier link endpoints (the token is the only credential; no login) -----
      const sup = path.match(/^\/api\/supplier\/([A-Za-z0-9_-]{20,})(?:\/(photos)(?:\/(\d+)(\/remove)?)?)?$/);
      if (sup) {
        const link = await DB.prepare('SELECT * FROM supplier_links WHERE token_hash=?').bind(await sha256(sup[1])).first();
        const cfg = link && SUPPLIER[link.entity];
        if (!cfg || link.revoked || link.expires_at < nowIso()) fail(404, 'ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาติดต่อฝ่าย QA');
        const doc = await DB.prepare(`SELECT * FROM ${cfg.table} WHERE ${cfg.pk}=?`).bind(link.entity_id).first();
        if (!doc) fail(404, 'ไม่พบเอกสาร');
        const locked = cfg.locked(doc);
        if (sup[2]) {
          // Photos of the one NCR this link opens; photos of other documents are not reachable.
          if (link.entity !== 'ncr') fail(404, 'ไม่พบภาพ');
          const ncrId = link.entity_id;
          if (!sup[3]) {
            if (method !== 'POST') fail(404, 'ไม่พบภาพ');
            if (locked) fail(409, 'เอกสารนี้ปิดแล้ว เพิ่มภาพไม่ได้');
            const ph = decodePhoto(await body());
            const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM ncr_photos WHERE ncr_id=? AND removed=0 AND source='supplier'").bind(ncrId).first();
            if (n >= MAX_SUPPLIER_PHOTOS) fail(409, `แนบภาพได้ไม่เกิน ${MAX_SUPPLIER_PHOTOS} ภาพ`);
            const ts = nowIso();
            await DB.prepare("INSERT INTO ncr_photos (ncr_id,content_type,size,data,created_by,created_at,source,kind) VALUES (?,?,?,?,?,?,'supplier','correction')")
              .bind(ncrId, ph.type, ph.size, ph.b64, 'supplier', ts).run();
            const row = await DB.prepare("SELECT id FROM ncr_photos WHERE ncr_id=? AND created_at=? AND source='supplier' ORDER BY id DESC LIMIT 1").bind(ncrId, ts).first();
            await audit(DB, 'supplier', 'supplier', 'add_photo', 'ncr', ncrId, { photo_id: row.id, size: ph.size });
            return json({ success: true, id: row.id }, 201);
          }
          // The supplier sees the problem photos and the supplier's own photos, not the factory's internal correction photos.
          const ph = await DB.prepare("SELECT id, source, content_type, data FROM ncr_photos WHERE id=? AND ncr_id=? AND removed=0 AND (kind='problem' OR source='supplier')")
            .bind(Number(sup[3]), ncrId).first();
          if (!ph) fail(404, 'ไม่พบภาพ');
          if (!sup[4] && method === 'GET') return photoResponse(ph, cors);
          if (sup[4] && method === 'POST') {
            // A supplier may take back only photos the supplier attached.
            if (ph.source !== 'supplier') fail(403, 'ลบได้เฉพาะภาพที่ผู้ส่งมอบแนบ');
            if (locked) fail(409, 'เอกสารนี้ปิดแล้ว ลบภาพไม่ได้');
            await DB.prepare('UPDATE ncr_photos SET removed=1, removed_by=?, removed_at=? WHERE id=?').bind('supplier', nowIso(), ph.id).run();
            await audit(DB, 'supplier', 'supplier', 'remove_photo', 'ncr', ncrId, { photo_id: ph.id });
            return json({ success: true });
          }
          fail(404, 'ไม่พบภาพ');
        }
        if (method === 'GET') {
          const photos = link.entity === 'ncr'
            ? (await DB.prepare("SELECT id, source, kind FROM ncr_photos WHERE ncr_id=? AND removed=0 AND (kind='problem' OR source='supplier') ORDER BY id").bind(link.entity_id).all()).results
            : [];
          return json({ type: link.entity, ...Object.fromEntries(cfg.view.map((k) => [k, doc[k] ?? null])),
            photos, can_reply: !locked, link_expires_at: link.expires_at });
        }
        if (method === 'POST') {
          if (locked) fail(409, 'เอกสารนี้ปิดแล้ว ไม่สามารถแก้ไขคำตอบได้');
          const b = await body();
          const by = String(b.replied_by || '').trim().slice(0, 120);
          if (by.length < 2) fail(400, 'กรุณาระบุชื่อผู้ตอบ');
          const missing = Object.entries(cfg.required).filter(([k]) => blank(b[k])).map(([, label]) => label);
          if (missing.length) fail(400, `กรุณากรอก: ${missing.join(', ')}`);
          const next = {};
          for (const k of cfg.write) next[k] = blank(b[k]) ? null : String(b[k]).slice(0, 4000);
          const changes = diff(doc, next, cfg.write);
          const ts = nowIso();
          const extra = { supplier_reply_by: by, supplier_reply_at: ts, status: cfg.nextStatus, updated_at: ts, updated_by: `supplier:${by}` };
          if (link.entity === 'ncr') extra.reply_date = today();
          const all = { ...next, ...extra };
          const keys = Object.keys(all);
          await DB.batch([
            DB.prepare(`UPDATE ${cfg.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${cfg.pk}=?`)
              .bind(...keys.map((k) => all[k]), link.entity_id),
            DB.prepare('UPDATE supplier_links SET last_used_at=? WHERE token_hash=?').bind(ts, link.token_hash),
          ]);
          await audit(DB, by, 'supplier', 'supplier_reply', link.entity, link.entity_id,
            { ...changes, status: { from: doc.status, to: cfg.nextStatus } });
          return json({ success: true });
        }
      }

      // ----- a document handed over for printing, opened by its one-off address (no login: the phone's own browser opens it) -----
      const pd = path.match(/^\/p\/([A-Za-z0-9_-]{40,})$/);
      if (pd && method === 'GET') {
        const { results } = await DB.prepare(
          'SELECT chunk FROM print_docs WHERE token_hash=? AND created_at > ? ORDER BY seq'
        ).bind(await sha256(pd[1]), new Date(Date.now() - PRINT_DOC_MINUTES * 60e3).toISOString()).all();
        const page = results.length ? results.map((r) => r.chunk).join('')
          : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px">ลิงก์เอกสารนี้หมดอายุแล้ว กรุณากลับไปที่แอปแล้วกดพิมพ์ใหม่</body>';
        return new Response(page, { status: results.length ? 200 : 404, headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
          // The page is whatever a signed-in user sent, so it runs boxed in: no access to this site, no network beyond fonts.
          'Content-Security-Policy': "sandbox allow-scripts allow-modals; default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'",
        } });
      }

      // ===== everything below requires a logged-in user =====
      if (!path.startsWith('/api/')) fail(404, 'Not found');
      const user = await currentUser(req, DB);

      if (method === 'GET' && path === '/api/me') {
        return json({ username: user.username, display_name: user.display_name, role: user.role, auto_ncr: AUTO_NCR, auto_ncr_recv: AUTO_NCR_RECV });
      }
      if (method === 'POST' && path === '/api/logout') {
        await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
        return json({ success: true });
      }
      if (method === 'POST' && path === '/api/me/password') {
        const b = await body();
        const u = await DB.prepare('SELECT * FROM users WHERE username=?').bind(user.username).first();
        if (!safeEqual(await hashPassword(String(b.current_password || ''), u.salt), u.pass_hash)) fail(403, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
        const p = passwordProblem(b.new_password);
        if (p) fail(400, p);
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        await DB.batch([
          DB.prepare('UPDATE users SET pass_hash=?, salt=? WHERE username=?').bind(await hashPassword(b.new_password, salt), salt, user.username),
          DB.prepare('DELETE FROM sessions WHERE username=? AND token_hash<>?').bind(user.username, user.token_hash),
        ]);
        await audit(DB, user.username, 'user', 'change_password', 'user', user.username, null);
        return json({ success: true });
      }

      // ----- user administration (QA Manager) -----
      if (path === '/api/users') {
        need(user, new Set(['QA_MANAGER']));
        if (method === 'GET') {
          const { results } = await DB.prepare('SELECT username,display_name,role,active,created_at FROM users ORDER BY username').all();
          return json(results);
        }
        if (method === 'POST') {
          const username = await createUser(DB, await body(), user.username);
          return json({ success: true, username }, 201);
        }
      }
      const um = path.match(/^\/api\/users\/([a-z0-9._-]+)$/);
      if (um && method === 'PATCH') {
        need(user, new Set(['QA_MANAGER']));
        const target = await DB.prepare('SELECT * FROM users WHERE username=?').bind(um[1]).first();
        if (!target) fail(404, 'ไม่พบผู้ใช้');
        const b = await body();
        const sets = [], vals = [], ch = {};
        if ('role' in b) { if (!ROLES.includes(b.role)) fail(400, 'บทบาทไม่ถูกต้อง'); sets.push('role=?'); vals.push(b.role); ch.role = { from: target.role, to: b.role }; }
        if ('display_name' in b) {
          if (blank(b.display_name)) fail(400, 'กรุณาระบุชื่อที่แสดง');
          const dn = String(b.display_name).trim().slice(0, 100);
          if (dn !== target.display_name) { sets.push('display_name=?'); vals.push(dn); ch.display_name = { from: target.display_name, to: dn }; }
        }
        // A new login name. Records already saved keep the old one (it is who signed them then); the audit entry links both.
        let rename = null;
        if ('username' in b) {
          const nu = cleanUsername(b.username);
          if (nu !== target.username) {
            if (await DB.prepare('SELECT 1 FROM users WHERE username=?').bind(nu).first()) fail(409, 'มีชื่อผู้ใช้นี้แล้ว');
            rename = nu; sets.push('username=?'); vals.push(nu); ch.username = { from: target.username, to: nu };
          }
        }
        if ('active' in b) {
          const act = b.active ? 1 : 0;
          if (!act && target.username === user.username) fail(400, 'ไม่สามารถปิดบัญชีของตนเองได้');
          sets.push('active=?'); vals.push(act); ch.active = { from: target.active, to: act };
        }
        if ('password' in b) {
          const p = passwordProblem(b.password);
          if (p) fail(400, p);
          const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
          sets.push('pass_hash=?', 'salt=?', 'failed_count=0', 'locked_until=NULL');
          vals.push(await hashPassword(b.password, salt), salt); ch.password = 'reset';
        }
        if (!sets.length) {
          if ('display_name' in b || 'username' in b) return json({ success: true, username: target.username });
          fail(400, 'ไม่มีข้อมูลให้แก้ไข');
        }
        if (target.role === 'QA_MANAGER' && ((b.role && b.role !== 'QA_MANAGER') || b.active === false || b.active === 0)) {
          const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='QA_MANAGER' AND active=1 AND username<>?").bind(target.username).first();
          if (n === 0) fail(400, 'ต้องมี QA Manager ที่ใช้งานได้อย่างน้อย 1 คน');
        }
        vals.push(target.username);
        const stmts = [DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE username=?`).bind(...vals)];
        if ('password' in b || b.active === false || b.active === 0) stmts.push(DB.prepare('DELETE FROM sessions WHERE username=?').bind(target.username));
        else if (rename) stmts.push(DB.prepare('UPDATE sessions SET username=? WHERE username=?').bind(rename, target.username));
        await DB.batch(stmts);
        await audit(DB, user.username, 'user', 'update', 'user', rename || target.username, ch);
        return json({ success: true, username: rename || target.username });
      }

      // ----- audit trail (QA only) -----
      if (method === 'GET' && path === '/api/audit') {
        need(user, QA);
        const id = url.searchParams.get('entity_id');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
        const q = id
          ? DB.prepare('SELECT * FROM audit_log WHERE entity_id=? ORDER BY id DESC LIMIT ?').bind(id, limit)
          : DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit);
        return json((await q.all()).results);
      }

      // ----- NCR list -----
      if (method === 'GET' && path === '/api/ncr') {
        const sp = url.searchParams;
        const where = ['1=1'], p = [];
        for (const k of ['status', 'severity', 'source_type']) if (sp.get(k)) { where.push(`${k}=?`); p.push(sp.get(k)); }
        if (sp.get('q')) {
          where.push('(ncr_id LIKE ? OR nc_description LIKE ? OR lot_no LIKE ? OR product_lot_no LIKE ? OR supplier_name LIKE ? OR material_name LIKE ? OR source_ref LIKE ?)');
          const like = `%${sp.get('q')}%`; p.push(like, like, like, like, like, like, like);
        }
        const limit = Math.min(parseInt(sp.get('limit') || '50', 10) || 50, 200);
        const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);
        const w = where.join(' AND ');
        const { n } = await DB.prepare(`SELECT COUNT(*) AS n FROM ncr_records WHERE ${w}`).bind(...p).first();
        const { results } = await DB.prepare(
          `SELECT * FROM ncr_records WHERE ${w} ORDER BY issue_date DESC, ncr_id DESC LIMIT ? OFFSET ?`
        ).bind(...p, limit, offset).all();
        return json({ total: n, limit, offset, items: results });
      }

      // ----- NCR create -----
      if (method === 'POST' && path === '/api/ncr') {
        need(user, WRITERS);
        const b = await body();
        if (blank(b.nc_description)) fail(400, 'กรุณาระบุรายละเอียดปัญหา');
        const rec = {};
        for (const k of NCR_BASE) rec[k] = nz(b[k]);
        rec.severity = ['Critical', 'Major', 'Minor'].includes(b.severity) ? b.severity : 'Major';
        rec.source_type = rec.source_type || 'IN_PROCESS';
        rec.shipped_status = rec.shipped_status || 'NOT_SHIPPED';
        rec.reported_by = rec.reported_by || user.display_name;
        const cols = [...NCR_BASE, 'severity'];
        for (let attempt = 0; ; attempt++) {
          const ncr_id = await nextId(DB, 'ncr_records', 'ncr_id', 'NCR');
          try {
            await DB.prepare(
              `INSERT INTO ncr_records (ncr_id,issue_date,status,created_by,updated_by,created_at,updated_at,${cols.join(',')})
               VALUES (?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`
            ).bind(ncr_id, today(), 'Open', user.username, user.username, nowIso(), nowIso(), ...cols.map((k) => rec[k])).run();
            await audit(DB, user.username, 'user', 'create', 'ncr', ncr_id, { severity: rec.severity, source_type: rec.source_type });
            return json({ success: true, ncr_id }, 201);
          } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) continue;
            if (/CHECK constraint/i.test(e.message)) fail(400, 'ค่าที่เลือกไม่อยู่ในรายการที่กำหนด');
            throw e;
          }
        }
      }

      // ----- supplier links for an NCR or a CAPA -----
      const lm = path.match(/^\/api\/(ncr|capa)\/([^/]+)\/supplier-link(\/revoke)?$/);
      if (lm && method === 'POST') {
        need(user, WRITERS);
        const entity = lm[1], cfg = SUPPLIER[entity], id = decodeURIComponent(lm[2]);
        const doc = await DB.prepare(`SELECT ${cfg.pk}, status FROM ${cfg.table} WHERE ${cfg.pk}=?`).bind(id).first();
        if (!doc) fail(404, 'ไม่พบเอกสาร');
        const revoke = DB.prepare('UPDATE supplier_links SET revoked=1 WHERE entity=? AND entity_id=?').bind(entity, id);
        if (lm[3]) {
          await revoke.run();
          await audit(DB, user.username, 'user', 'revoke_supplier_link', entity, id, null);
          return json({ success: true });
        }
        if (cfg.locked(doc)) fail(409, 'เอกสารปิดแล้ว ไม่สามารถสร้างลิงก์ได้');
        const token = randomToken();
        const expires = new Date(Date.now() + SUPPLIER_LINK_DAYS * 86400e3).toISOString();
        await DB.batch([
          revoke, // only one live link per document
          DB.prepare('INSERT INTO supplier_links (token_hash,entity,entity_id,created_by,expires_at) VALUES (?,?,?,?,?)')
            .bind(await sha256(token), entity, id, user.username, expires),
        ]);
        await audit(DB, user.username, 'user', 'create_supplier_link', entity, id, { expires_at: expires });
        return json({ token, expires_at: expires }, 201);
      }

      // ----- NCR photos -----
      const pm = path.match(/^\/api\/ncr\/([^/]+)\/photos(?:\/(\d+)(\/remove)?)?$/);
      if (pm) {
        const id = decodeURIComponent(pm[1]);
        const ncr = await DB.prepare('SELECT ncr_id, status FROM ncr_records WHERE ncr_id=?').bind(id).first();
        if (!ncr) fail(404, 'ไม่พบ NCR');
        const locked = ncr.status === 'Closed' || ncr.status === 'Cancelled';
        if (!pm[2]) {
          if (method === 'GET') {
            const { results } = await DB.prepare(
              'SELECT id, source, kind, content_type, size, created_by, created_at FROM ncr_photos WHERE ncr_id=? AND removed=0 ORDER BY id').bind(id).all();
            return json(results);
          }
          if (method === 'POST') {
            need(user, WRITERS);
            if (locked) fail(409, 'NCR ปิดแล้ว เพิ่มภาพไม่ได้');
            const b = await body();
            const ph = decodePhoto(b);
            // "problem" = what was found; "correction" = evidence of the fix.
            const kind = b.kind === 'correction' ? 'correction' : 'problem';
            const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM ncr_photos WHERE ncr_id=? AND removed=0 AND source='internal' AND kind=?").bind(id, kind).first();
            if (n >= MAX_PHOTOS) fail(409, `แนบภาพได้ไม่เกิน ${MAX_PHOTOS} ภาพต่อหัวข้อ`);
            const ts = nowIso();
            await DB.prepare('INSERT INTO ncr_photos (ncr_id,content_type,size,data,created_by,created_at,kind) VALUES (?,?,?,?,?,?,?)')
              .bind(id, ph.type, ph.size, ph.b64, user.username, ts, kind).run();
            const row = await DB.prepare('SELECT id FROM ncr_photos WHERE ncr_id=? AND created_at=? AND created_by=? ORDER BY id DESC LIMIT 1')
              .bind(id, ts, user.username).first();
            await audit(DB, user.username, 'user', 'add_photo', 'ncr', id, { photo_id: row.id, kind, size: ph.size });
            return json({ success: true, id: row.id }, 201);
          }
        } else {
          const ph = await DB.prepare('SELECT id, content_type, data FROM ncr_photos WHERE id=? AND ncr_id=? AND removed=0')
            .bind(Number(pm[2]), id).first();
          if (!ph) fail(404, 'ไม่พบภาพ');
          if (!pm[3] && method === 'GET') return photoResponse(ph, cors);
          if (pm[3] && method === 'POST') {
            need(user, WRITERS);
            if (locked) fail(409, 'NCR ปิดแล้ว ลบภาพไม่ได้');
            // Photos are hidden, not erased, so the record of what was attached stays intact.
            await DB.prepare('UPDATE ncr_photos SET removed=1, removed_by=?, removed_at=? WHERE id=?').bind(user.username, nowIso(), ph.id).run();
            await audit(DB, user.username, 'user', 'remove_photo', 'ncr', id, { photo_id: ph.id });
            return json({ success: true });
          }
        }
      }

      // ----- NCR read / update -----
      const nm = path.match(/^\/api\/ncr\/([^/]+)$/);
      if (nm) {
        const id = decodeURIComponent(nm[1]);
        const row = await DB.prepare('SELECT * FROM ncr_records WHERE ncr_id=?').bind(id).first();
        if (!row) fail(404, 'ไม่พบ NCR');
        if (method === 'GET') return json(row);
        if (method === 'PATCH') {
          need(user, WRITERS);
          const b = await body();
          for (const k of ['ncr_id', 'issue_date', 'created_by', 'created_at']) {
            if (k in b && String(b[k]) !== String(row[k])) fail(400, `ไม่อนุญาตให้แก้ไข ${k}`);
          }
          const locked = row.status === 'Closed' || row.status === 'Cancelled';
          if (locked) {
            // The only change allowed on a closed record is a reopen by the QA Manager, with a reason.
            if (user.role !== 'QA_MANAGER' || b.status !== 'Open' || blank(b.status_reason)) {
              fail(409, 'NCR ปิดแล้ว แก้ไขไม่ได้ (QA Manager เปิดใหม่ได้โดยระบุเหตุผล)');
            }
            await DB.prepare(
              `UPDATE ncr_records SET status='Open', status_reason=?, closed_date=NULL, closed_by=NULL, days_open=NULL,
                 verification_result='Pending', verified_by=NULL, verified_at=NULL, updated_at=?, updated_by=? WHERE ncr_id=?`
            ).bind(String(b.status_reason), nowIso(), user.username, id).run();
            await audit(DB, user.username, 'user', 'reopen', 'ncr', id, { status: { from: row.status, to: 'Open' }, reason: b.status_reason });
            return json({ success: true, ncr_id: id });
          }

          const next = {};
          for (const k of NCR_BASE) if (k in b) next[k] = nz(b[k]);
          for (const k of NCR_QA) {
            if (!(k in b)) continue;
            if (String(b[k] ?? '') === String(row[k] ?? '')) continue; // unchanged values are fine from anyone
            if (!QA.has(user.role)) fail(403, `เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไข ${k} ได้`);
            next[k] = k === 'recall_required' ? (b[k] === null || b[k] === '' ? null : (b[k] ? 1 : 0)) : nz(b[k]);
          }
          if (!Object.keys(next).length) fail(400, 'ไม่มีข้อมูลให้แก้ไข');
          if ('nc_description' in next && blank(next.nc_description)) fail(400, 'รายละเอียดปัญหาห้ามว่าง');

          const ts = nowIso();
          if ('disposition' in next) { next.dispositioned_by = user.username; next.dispositioned_at = ts; }
          if ('verification_result' in next) {
            next.verified_by = next.verification_result === 'Pending' ? null : user.username;
            next.verified_at = next.verification_result === 'Pending' ? null : ts;
          }
          const merged = { ...row, ...next };
          if (next.status === 'Closed') {
            if (user.role !== 'QA_MANAGER') fail(403, 'เฉพาะ QA Manager เท่านั้นที่ปิด NCR ได้');
            const p = closeProblems(merged);
            if (p.length) fail(422, `ยังปิด NCR ไม่ได้ ข้อมูลไม่ครบ: ${p.join(', ')}`);
            next.closed_by = user.username;
            next.closed_date = today();
            next.days_open = Math.max(0, Math.round((Date.parse(next.closed_date) - Date.parse(row.issue_date)) / 86400e3));
          }
          if (next.status === 'Cancelled' && blank(merged.status_reason)) fail(422, 'กรุณาระบุเหตุผลที่ยกเลิก');

          const keys = Object.keys(next);
          const changes = diff(row, next, keys);
          if (!Object.keys(changes).length) return json({ success: true, ncr_id: id, unchanged: true });
          const stmts = [DB.prepare(
            `UPDATE ncr_records SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=?, updated_by=? WHERE ncr_id=?`
          ).bind(...keys.map((k) => next[k]), ts, user.username, id)];
          if (next.status === 'Closed' || next.status === 'Cancelled') {
            stmts.push(DB.prepare("UPDATE supplier_links SET revoked=1 WHERE entity='ncr' AND entity_id=?").bind(id));
          }
          try { await DB.batch(stmts); } catch (e) {
            if (/CHECK constraint/i.test(e.message)) fail(400, 'ค่าที่เลือกไม่อยู่ในรายการที่กำหนด');
            throw e;
          }
          await audit(DB, user.username, 'user', next.status === 'Closed' ? 'close' : 'update', 'ncr', id, changes);
          return json({ success: true, ncr_id: id });
        }
      }

      // ----- CAPA -----
      if (method === 'GET' && path === '/api/capa') {
        const where = ['1=1'], p = [];
        if (url.searchParams.get('ncr_id')) { where.push("source_ref=? AND source='NCR'"); p.push(url.searchParams.get('ncr_id')); }
        if (url.searchParams.get('status')) { where.push('status=?'); p.push(url.searchParams.get('status')); }
        const { results } = await DB.prepare(`SELECT * FROM capa_actions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`).bind(...p).all();
        return json(results);
      }
      if (method === 'POST' && path === '/api/capa') {
        need(user, WRITERS);
        const b = await body();
        if (blank(b.description)) fail(400, 'กรุณาระบุรายละเอียด CAPA');
        const cols = CAPA_BASE.filter((k) => k !== 'status');
        const capa_id = await nextId(DB, 'capa_actions', 'capa_id', 'CAPA');
        try {
          await DB.prepare(
            `INSERT INTO capa_actions (capa_id,source,source_ref,status,created_by,updated_by,created_at,updated_at,${cols.join(',')})
             VALUES (?,?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`
          ).bind(capa_id, nz(b.source) || 'NCR', nz(b.source_ref), 'Open', user.username, user.username, nowIso(), nowIso(),
            ...cols.map((k) => (k === 'priority' ? (nz(b[k]) || 'MEDIUM') : nz(b[k])))).run();
        } catch (e) {
          if (/CHECK constraint/i.test(e.message)) fail(400, 'ค่าที่เลือกไม่อยู่ในรายการที่กำหนด');
          throw e;
        }
        await audit(DB, user.username, 'user', 'create', 'capa', capa_id, { source_ref: nz(b.source_ref) });
        return json({ success: true, capa_id }, 201);
      }
      const cm = path.match(/^\/api\/capa\/([^/]+)$/);
      if (cm) {
        const id = decodeURIComponent(cm[1]);
        const row = await DB.prepare('SELECT * FROM capa_actions WHERE capa_id=?').bind(id).first();
        if (!row) fail(404, 'ไม่พบ CAPA');
        if (method === 'GET') return json(row);
        if (method === 'PATCH') {
          need(user, WRITERS);
          if (String(row.status).startsWith('Closed') || row.status === 'Cancelled') fail(409, 'CAPA ปิดแล้ว แก้ไขไม่ได้');
          const b = await body();
          const next = {};
          for (const k of CAPA_BASE) if (k in b) next[k] = nz(b[k]);
          for (const k of CAPA_QA) if (k in b && String(b[k] ?? '') !== String(row[k] ?? '')) {
            if (!QA.has(user.role)) fail(403, `เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไข ${k} ได้`);
            next[k] = nz(b[k]);
          }
          if (!Object.keys(next).length) fail(400, 'ไม่มีข้อมูลให้แก้ไข');
          const ts = nowIso();
          if ('effectiveness_result' in next && next.effectiveness_result && next.effectiveness_result !== 'Pending') {
            next.verified_by = user.username; next.verified_date = today();
          }
          const closing = typeof next.status === 'string' && next.status.startsWith('Closed') && next.status !== row.status;
          if (closing) {
            if (user.role !== 'QA_MANAGER') fail(403, 'เฉพาะ QA Manager เท่านั้นที่ปิด CAPA ได้');
            const m = { ...row, ...next };
            const miss = [];
            if (blank(m.root_cause_summary) && blank(m.root_cause_analysis)) miss.push('สาเหตุที่แท้จริง');
            if (blank(m.corrective_action)) miss.push('การปฏิบัติการแก้ไข');
            if (blank(m.effectiveness_result) || m.effectiveness_result === 'Pending') miss.push('ผลการทวนสอบประสิทธิผล');
            if (miss.length) fail(422, `ยังปิด CAPA ไม่ได้ ข้อมูลไม่ครบ: ${miss.join(', ')}`);
            next.closed_by = user.username; next.closed_date = today();
            next.approved_by = user.username; next.approved_date = today();
          }
          const keys = Object.keys(next);
          const changes = diff(row, next, keys);
          if (!Object.keys(changes).length) return json({ success: true, unchanged: true });
          try {
            const stmts = [DB.prepare(`UPDATE capa_actions SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=?, updated_by=? WHERE capa_id=?`)
              .bind(...keys.map((k) => next[k]), ts, user.username, id)];
            if (closing || next.status === 'Cancelled') {
              stmts.push(DB.prepare("UPDATE supplier_links SET revoked=1 WHERE entity='capa' AND entity_id=?").bind(id));
            }
            await DB.batch(stmts);
          } catch (e) {
            if (/CHECK constraint/i.test(e.message)) fail(400, 'ค่าที่เลือกไม่อยู่ในรายการที่กำหนด');
            throw e;
          }
          await audit(DB, user.username, 'user', closing ? 'close' : 'update', 'capa', id, changes);
          return json({ success: true });
        }
      }

      if (path === '/api/print-doc' && method === 'POST') {
        const html = String((await body()).html || '');
        if (html.length < 20) fail(400, 'ไม่มีเอกสารสำหรับพิมพ์');
        if (html.length > 8000000) fail(413, 'เอกสารใหญ่เกินไป');
        const token = randomToken(32), hash = await sha256(token), now = nowIso();
        const stmts = [DB.prepare('DELETE FROM print_docs WHERE created_at < ?').bind(new Date(Date.now() - PRINT_DOC_MINUTES * 60e3).toISOString())];
        for (let i = 0, seq = 0; i < html.length; i += 500000, seq++) {
          stmts.push(DB.prepare('INSERT INTO print_docs (token_hash,seq,chunk,created_by,created_at) VALUES (?,?,?,?,?)')
            .bind(hash, seq, html.slice(i, i + 500000), user.username, now));
        }
        await DB.batch(stmts);
        return json({ url: `${url.origin}/p/${token}`, minutes: PRINT_DOC_MINUTES }, 201);
      }

      // ===== Receiving inspection (FM-QC-001) =====
      // Records are kept as the app's own JSON; photos sit in their own rows so one record never outgrows a D1 row.
      if (path === '/api/recv' && method === 'GET') {
        const recs = await DB.prepare(
          'SELECT doc_no, uid, data, created_by, created_at FROM recv_records ORDER BY recv_date DESC, doc_no DESC LIMIT 1000').all();
        const ncs = await DB.prepare(
          `SELECT n.nc_id, n.uid, n.doc_no, n.status, n.ncr_id, n.closed_date, n.data, r.status AS ncr_status, r.closed_date AS ncr_closed
             FROM recv_nc n LEFT JOIN ncr_records r ON r.ncr_id = n.ncr_id ORDER BY n.created_at DESC, n.nc_id DESC LIMIT 1000`).all();
        return json({
          records: recs.results.map((r) => ({ ...JSON.parse(r.data), docNo: r.doc_no, uid: r.uid, savedBy: r.created_by, savedAt: r.created_at })),
          // An NC that is an NCR takes its status from the NCR: it is closed in the e-Form, not here.
          ncLogs: ncs.results.map((n) => {
            const linked = n.nc_id === n.ncr_id && n.ncr_status;
            const closed = linked ? ['Closed', 'Cancelled'].includes(n.ncr_status) : n.status === 'Closed';
            return { ...JSON.parse(n.data), id: n.nc_id, uid: n.uid, docNo: n.doc_no, status: closed ? 'Closed' : 'Open', ncrId: n.ncr_id || '',
              ncrStatus: n.ncr_status || '', closedDate: (linked ? String(n.ncr_closed || '').slice(0, 10) : n.closed_date) || '' };
          }),
        });
      }

      const recvUid = (v) => { const u = String(v || ''); if (!/^[A-Za-z0-9-]{8,64}$/.test(u)) fail(400, 'รหัสอ้างอิงรายการไม่ถูกต้อง'); return u; };
      // Keeps the number the device proposed when it is free, otherwise gives the next one for that day.
      const recvDocNo = async (proposed) => {
        const m = /^FM-QC-001-(\d{8})-(\d{3})$/.exec(String(proposed || ''));
        if (m && !(await DB.prepare('SELECT 1 FROM recv_records WHERE doc_no=?').bind(proposed).first())) return proposed;
        const day = m ? m[1] : today().replace(/-/g, '');
        const last = await DB.prepare('SELECT doc_no FROM recv_records WHERE doc_no LIKE ? ORDER BY doc_no DESC LIMIT 1').bind(`FM-QC-001-${day}-%`).first();
        return `FM-QC-001-${day}-${String((last ? parseInt(last.doc_no.slice(-3), 10) : 0) + 1).padStart(3, '0')}`;
      };
      // Every NC raised at receiving is an NCR in the e-Form from the start, so both apps show one number.
      const nextNcrIds = async (count) => {
        const first = AUTO_NCR_RECV ? await nextId(DB, 'ncr_records', 'ncr_id', 'NCR') : await nextId(DB, 'recv_nc', 'nc_id', 'NC');
        const cut = first.lastIndexOf('-') + 1, n0 = parseInt(first.slice(cut), 10), stem = first.slice(0, cut);
        return Array.from({ length: count }, (_, i) => stem + String(n0 + i).padStart(3, '0'));
      };
      const RES_TH = { REJECT: 'REJECT — ไม่ผ่านการตรวจรับ', HOLD: 'HOLD — กักรอการพิจารณา', COND: 'รับแบบมีเงื่อนไข' };
      const ACTION_TH = { REJECT: 'ปฏิเสธการรับ (REJECT) แยกสินค้าและแจ้งผู้ส่งมอบ', HOLD: 'กักสินค้า (HOLD) ติดป้ายบ่งชี้ รอผลการพิจารณา' };
      const ncrFromNc = (ncrId, docNo, nc, rec) => {
        const mat = nc.mat && typeof nc.mat === 'object' ? nc.mat : {};
        const qty = parseFloat(mat.qty);
        const f = {
          source_type: 'RM_RECEIVING', source_ref: docNo,
          found_date: nz(rec?.date) || nz(nc.date) || today(), found_time: nz(rec?.time),
          supplier_name: nz(rec?.supplier) || nz(nc.supplier), reported_by: nz(rec?.inspector) || nz(nc.qa) || user.display_name,
          material_code: nz(mat.code), material_name: nz(mat.name), lot_no: nz(mat.lot),
          defect_qty: Number.isFinite(qty) ? qty : null, defect_unit: nz(mat.unit),
          nc_description: [
            `ตรวจรับวัตถุดิบ (ใบตรวจรับ ${docNo})${RES_TH[nc.result] ? ' — ผล: ' + RES_TH[nc.result] : ''}`,
            mat.name ? `รายการ: ${[mat.code, mat.name].filter(Boolean).join(' ')}` : '',
            !RES_TH[nc.result] && nc.failType ? `ประเภทปัญหา: ${nc.failType}` : '',
            nc.note ? `รายละเอียด: ${nc.note}` : '',
            rec?.carReg ? `ทะเบียนรถ: ${rec.carReg}${rec.carTemp != null ? ' | อุณหภูมิรถ ' + rec.carTemp + '°C' : ''}` : '',
            rec?.poNo ? `PO/DO: ${rec.poNo}` : '',
          ].filter(Boolean).join('\n').slice(0, 2000),
          immediate_action: nc.result === 'COND' ? `รับแบบมีเงื่อนไข: ${String(nc.brief || nc.note || '').slice(0, 300)}` : ACTION_TH[nc.result] || nz(nc.corrective === '—' ? '' : nc.corrective),
          severity: nc.result === 'COND' ? 'Minor' : 'Major', shipped_status: 'NOT_SHIPPED',
        };
        const cols = Object.keys(f);
        return DB.prepare(
          `INSERT INTO ncr_records (ncr_id,issue_date,status,created_by,updated_by,created_at,updated_at,${cols.join(',')})
           VALUES (?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`
        ).bind(ncrId, today(), 'Open', user.username, user.username, nowIso(), nowIso(), ...cols.map((k) => f[k]));
      };
      const ncInsert = (id, uid, docNo, nc) => {
        const ncrId = /^NCR-\d{4}-\d{3,}$/.test(id) ? id : null;
        const status = nc.status === 'Closed' ? 'Closed' : 'Open';
        const { id: _i, uid: _u, docNo: _d, status: _s, ncrId: _n, closedDate: _c, synced: _y, dirty: _t, ...rest } = nc;
        const data = JSON.stringify(rest);
        if (data.length > 20000) fail(413, 'ข้อมูล NC ยาวเกินไป');
        return DB.prepare(
          'INSERT INTO recv_nc (nc_id,uid,doc_no,status,ncr_id,closed_date,data,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(id, uid, docNo, status, ncrId, status === 'Closed' ? nz(nc.closedDate) || today() : null, data, user.username, nowIso(), user.username, nowIso());
      };

      if (path === '/api/recv' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const rec = b.record;
        if (!rec || typeof rec !== 'object' || !Array.isArray(rec.mats) || !rec.mats.length) fail(400, 'ข้อมูลใบตรวจรับไม่ครบ');
        if (rec.mats.length > 60) fail(400, 'รายการวัตถุดิบมากเกินไป');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rec.date || '')) || blank(rec.supplier) || blank(rec.inspector)) fail(400, 'กรุณาระบุวันที่ ผู้ส่งมอบ และผู้ตรวจรับ');
        // Receiving with conditions is a concession: a condition must be stated, and the record names who granted it.
        if (rec.mats.some((m) => m && m.result === 'COND')) {
          need(user, COND_ROLES, 'บัญชีนี้ไม่มีสิทธิ์รับแบบมีเงื่อนไข');
          if (rec.mats.some((m) => m.result === 'COND' && blank(m.note))) fail(400, 'รับแบบมีเงื่อนไข ต้องระบุเงื่อนไขในช่องหมายเหตุ');
        }
        const ncList = Array.isArray(b.ncs) ? b.ncs.slice(0, 60) : [];
        for (let attempt = 0; ; attempt++) {
          const done = await DB.prepare('SELECT doc_no FROM recv_records WHERE uid=?').bind(uid).first();
          if (done) { // the same save arriving twice (a retry after a lost reply)
            const ncs = await DB.prepare('SELECT nc_id, uid FROM recv_nc WHERE doc_no=?').bind(done.doc_no).all();
            return json({ docNo: done.doc_no, ncs: ncs.results.map((n) => ({ uid: n.uid, id: n.nc_id })) });
          }
          const docNo = await recvDocNo(rec.docNo);
          const photos = [];
          const mats = rec.mats.map((m, i) => {
            const o = { ...m };
            if (o.result === 'COND') { o.condBy = user.display_name; o.condRole = user.role; } else { delete o.condBy; delete o.condRole; }
            for (const slot of [1, 2]) {
              const src = o['photo' + slot];
              o['photo' + slot] = null;
              if (typeof src === 'string' && src.startsWith('data:')) {
                const ph = decodePhoto({ content_type: (/^data:([^;,]+)/.exec(src) || [])[1], data: src });
                photos.push({ idx: Number.isInteger(o.idx) ? o.idx : i + 1, slot, ph });
                o['hasPhoto' + slot] = 1;
              }
            }
            return o;
          });
          const { materials: _m, docNo: _d, uid: _u, synced: _s, savedBy: _b, savedAt: _a, ...rest } = rec;
          // The signature image travels with the photos, so the list of records stays small.
          const sig = rec.sig && typeof rec.sig === 'object' ? { ...rec.sig } : null;
          if (sig && typeof sig.sigBase64 === 'string' && sig.sigBase64.startsWith('data:')) {
            photos.push({ idx: 0, slot: 0, ph: decodePhoto({ content_type: (/^data:([^;,]+)/.exec(sig.sigBase64) || [])[1], data: sig.sigBase64 }) });
            sig.hasSig = 1;
          }
          if (sig) sig.sigBase64 = null;
          const data = JSON.stringify({ ...rest, sig, mats });
          if (data.length > 1500000) fail(413, 'ข้อมูลใบตรวจรับใหญ่เกินไป');
          // COND (accepted with conditions) is a deviation, so the record as a whole counts as not clean: it is filed under HOLD here.
          const worst = mats.some((m) => m.result === 'REJECT') ? 'REJECT' : mats.some((m) => m.result === 'HOLD' || m.result === 'COND') ? 'HOLD' : 'PASS';
          const ncIds = await nextNcrIds(ncList.length);
          const stmts = [DB.prepare(
            'INSERT INTO recv_records (doc_no,uid,recv_date,supplier,inspector,result,data,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
          ).bind(docNo, uid, rec.date, String(rec.supplier).trim(), String(rec.inspector).trim(), worst, data, user.username, nowIso())];
          for (const p of photos) stmts.push(DB.prepare(
            'INSERT INTO recv_photos (doc_no,mat_idx,slot,content_type,size,data,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(docNo, p.idx, p.slot, p.ph.type, p.ph.size, p.ph.b64, user.username, nowIso()));
          ncList.forEach((nc, i) => {
            if (!AUTO_NCR_RECV) { stmts.push(ncInsert(ncIds[i], recvUid(nc.uid), docNo, nc)); return; }
            stmts.push(ncrFromNc(ncIds[i], docNo, nc, rec), ncInsert(ncIds[i], recvUid(nc.uid), docNo, nc));
            // the inspection photos of that item become the NCR's problem photos
            for (const p of photos.filter((x) => x.slot && x.idx === nc.matIdx)) stmts.push(DB.prepare(
              "INSERT INTO ncr_photos (ncr_id,content_type,size,data,created_by,created_at,source,kind) VALUES (?,?,?,?,?,?,'internal','problem')"
            ).bind(ncIds[i], p.ph.type, p.ph.size, p.ph.b64, user.username, nowIso()));
          });
          try { await DB.batch(stmts); } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) continue; // another phone took the number first
            throw e;
          }
          for (const id of ncIds) await audit(DB, user.username, 'user', 'create', AUTO_NCR_RECV ? 'ncr' : 'recv_nc', id, { source_type: 'RM_RECEIVING', receiving_doc: docNo });
          await audit(DB, user.username, 'user', 'create', 'recv', docNo, { supplier: rec.supplier, result: worst, items: mats.length, photos: photos.filter((p) => p.slot).length, nc: ncIds });
          return json({ docNo, ncs: ncList.map((nc, i) => ({ uid: nc.uid, id: ncIds[i] })) }, 201);
        }
      }

      const rp = path.match(/^\/api\/recv\/(FM-QC-001-\d{8}-\d{3})\/photos$/);
      if (rp && method === 'GET') {
        const { results } = await DB.prepare('SELECT mat_idx, slot, content_type, data FROM recv_photos WHERE doc_no=? ORDER BY mat_idx, slot').bind(rp[1]).all();
        return json(results.map((r) => ({ idx: r.mat_idx, slot: r.slot, data: `data:${r.content_type};base64,${r.data}` })));
      }

      if (path === '/api/recv-nc' && method === 'POST') {
        need(user, WRITERS);
        const nc = await body();
        const uid = recvUid(nc.uid);
        if (blank(nc.docNo) || blank(nc.failType)) fail(400, 'กรุณาระบุเลขที่ใบตรวจรับและประเภทปัญหา');
        for (let attempt = 0; ; attempt++) {
          const done = await DB.prepare('SELECT nc_id FROM recv_nc WHERE uid=?').bind(uid).first();
          if (done) return json({ id: done.nc_id });
          const [id] = await nextNcrIds(1);
          const parent = await DB.prepare('SELECT data, supplier, inspector, recv_date FROM recv_records WHERE doc_no=?').bind(String(nc.docNo)).first();
          const prec = parent ? { ...JSON.parse(parent.data), supplier: parent.supplier, inspector: nz(nc.qa) || parent.inspector, date: parent.recv_date } : null;
          try { await DB.batch(AUTO_NCR_RECV ? [ncrFromNc(id, String(nc.docNo), nc, prec), ncInsert(id, uid, String(nc.docNo), nc)] : [ncInsert(id, uid, String(nc.docNo), nc)]); } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) continue;
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', AUTO_NCR_RECV ? 'ncr' : 'recv_nc', id, { source_type: 'RM_RECEIVING', receiving_doc: nc.docNo, fail_type: nc.failType });
          return json({ id }, 201);
        }
      }
      const rn = path.match(/^\/api\/recv-nc\/(NC\d{3,6}|NC-\d{4}-\d{3,}|NCR-\d{4}-\d{3,})$/);
      if (rn && method === 'PATCH') {
        need(user, WRITERS);
        const b = await body();
        const row = await DB.prepare('SELECT status, ncr_id, closed_date, data FROM recv_nc WHERE nc_id=?').bind(rn[1]).first();
        if (!row) fail(404, 'ไม่พบ NC นี้');
        if (rn[1].startsWith('NCR-')) fail(409, 'NC นี้คือ NCR ในระบบ NCR e-Form ให้แก้ไขและปิดในระบบ NCR e-Form');
        const next = { ...row };
        if ('ncrId' in b) {
          if (!blank(b.ncrId) && !/^NCR-\d{4}-\d{3,}$/.test(String(b.ncrId))) fail(400, 'รูปแบบเลข NCR ไม่ถูกต้อง');
          next.ncr_id = nz(b.ncrId);
        }
        let data = row.data;
        if (b.status === 'Closed' && row.status !== 'Closed') {
          // Closed here (no NCR): what was done and the re-check result are kept with the NC, e.g. re-weighed 3 bags, 10.02 kg each.
          const closeNote = txt(b.closeNote, 1000);
          if (!next.ncr_id && !closeNote) fail(400, 'กรุณาระบุการแก้ไขและผลการตรวจซ้ำก่อนปิด NC');
          next.status = 'Closed'; next.closed_date = today();
          if (closeNote) data = JSON.stringify({ ...JSON.parse(row.data || '{}'), closeNote, closedBy: user.display_name });
        }
        const changes = diff(row, next, ['status', 'ncr_id', 'closed_date']);
        if (data !== row.data) changes.close_note = txt(b.closeNote, 1000);
        if (Object.keys(changes).length) {
          await DB.prepare('UPDATE recv_nc SET status=?, ncr_id=?, closed_date=?, data=?, updated_by=?, updated_at=? WHERE nc_id=?')
            .bind(next.status, next.ncr_id, next.closed_date, data, user.username, nowIso(), rn[1]).run();
          await audit(DB, user.username, 'user', next.status !== row.status ? 'close' : 'update', 'recv_nc', rn[1], changes);
        }
        return json({ success: true, status: next.status, closedDate: next.closed_date || '', ncrId: next.ncr_id || '', closeNote: JSON.parse(data || '{}').closeNote || '' });
      }

      // ===== Finished-product inspection (FM-QC-008) =====
      if (path === '/api/pack-sizes' && method === 'GET') {
        const { results } = await DB.prepare('SELECT * FROM pack_sizes ORDER BY sort, pack_key').all();
        return json(results);
      }
      const FG_SENSORY = [['appearance', 'ลักษณะภายนอก'], ['color', 'สี'], ['odor', 'กลิ่น'], ['taste', 'รสชาติ']];
      const FG_PACK = [['pack_ok', 'สภาพบรรจุภัณฑ์ (สะอาด ไม่ชำรุด)'], ['seal_ok', 'การปิดผนึก'], ['label_ok', 'ฉลากถูกต้อง (ชื่อ อย. วันผลิต/หมดอายุ)']];
      const fgRow = (r) => ({ ...r, gross: JSON.parse(r.gross), net: JSON.parse(r.net), sensory: JSON.parse(r.sensory), pack: JSON.parse(r.pack), failed: r.failed ? JSON.parse(r.failed) : [] });
      if (path === '/api/fgcheck' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (isDate(sp.get('from'))) { where.push('check_date>=?'); p.push(sp.get('from')); }
        if (isDate(sp.get('to'))) { where.push('check_date<=?'); p.push(sp.get('to')); }
        for (const k of ['product_code', 'batch_no']) if (sp.get(k)) { where.push(`${k}=?`); p.push(sp.get(k)); }
        const { results } = await DB.prepare(`SELECT * FROM fg_checks WHERE ${where.join(' AND ')} ORDER BY check_date DESC, fc_id DESC LIMIT 500`).bind(...p).all();
        const ids = results.map((r) => r.fc_id);
        const rc = ids.length ? (await DB.prepare(`SELECT * FROM fg_check_rechecks WHERE fc_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results : [];
        return json(results.map((r) => {
          const row = fgRow(r);
          row.recheck = row.gross.map((_, i) => { const x = rc.find((y) => y.fc_id === r.fc_id && y.jar === i + 1); return x ? { gross: x.gross, net: x.net } : null; });
          return row;
        }));
      }
      if (path === '/api/fgcheck' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT fc_id, result FROM fg_checks WHERE uid=?').bind(uid).first();
        if (done) return json(done);
        if (!isDate(b.check_date) || b.check_date > today()) fail(400, 'กรุณาระบุวันที่ตรวจ (ไม่เป็นวันในอนาคต)');
        const product = String(b.product_code || '').trim();
        if (!/^FG\d{3,5}$/.test(product)) fail(400, 'กรุณาเลือกผลิตภัณฑ์');
        const batch = cleanBatch(b.batch_no);
        const pk = await DB.prepare('SELECT * FROM pack_sizes WHERE pack_key=? AND active=1').bind(String(b.pack_key || '')).first();
        if (!pk) fail(400, 'กรุณาเลือกขนาดบรรจุก่อน เพื่อหักน้ำหนักกระปุก');
        const numOpt = (v, label, lo, hi) => {
          if (blank(v)) return null;
          const n = Number(v);
          if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${label} ต้องเป็นตัวเลข ${lo} ถึง ${hi}`);
          return n;
        };
        const gross = (Array.isArray(b.gross) ? b.gross : []).slice(0, 10).filter((v) => !blank(v)).map((v) => numOpt(v, 'น้ำหนักรวม', 0, 5000));
        if (gross.length < 2) fail(400, 'กรุณาชั่งน้ำหนักอย่างน้อย 2 กระปุก');
        const net = gross.map((g) => Math.round((g - pk.tare_g) * 100) / 100);
        // A numeric criterion that fails is checked again: a jar under the label weight is re-weighed, and the re-check decides.
        const rcIn = Array.isArray(b.recheck) ? b.recheck : [];
        const recheck = net.map((n, i) => {
          if (n >= pk.label_net_g) return null;
          if (blank(rcIn[i])) fail(400, `น้ำหนักสุทธิกระปุกที่ ${i + 1} = ${n} g ต่ำกว่า ${pk.label_net_g} g บนฉลาก กรุณาชั่งซ้ำแล้วกรอกน้ำหนักที่ชั่งซ้ำ`);
          const g = numOpt(rcIn[i], 'น้ำหนักที่ชั่งซ้ำ', 0, 5000);
          return { gross: g, net: Math.round((g - pk.tare_g) * 100) / 100 };
        });
        const bool = (o, k, label) => { const v = o?.[k]; if (v !== true && v !== false) fail(400, `กรุณาเลือกผล "${label}"`); return v; };
        const sensory = Object.fromEntries(FG_SENSORY.map(([k, l]) => [k, bool(b.sensory, k, l)]));
        const pack = Object.fromEntries(FG_PACK.map(([k, l]) => [k, bool(b.pack, k, l)]));
        const failed = [];
        recheck.forEach((x, i) => { if (x && x.net < pk.label_net_g) failed.push(`น้ำหนักสุทธิกระปุกที่ ${i + 1}: ${net[i]} g ชั่งซ้ำ ${x.net} g (ต่ำกว่า ${pk.label_net_g} g บนฉลาก)`); });
        FG_SENSORY.forEach(([k, l]) => { if (!sensory[k]) failed.push(`${l} ไม่ผ่าน`); });
        FG_PACK.forEach(([k, l]) => { if (!pack[k]) failed.push(`${l} ไม่ผ่าน`); });
        const result = failed.length ? 'FAIL' : 'PASS';
        const note = txt(b.note, 1000);
        if (result === 'FAIL' && !note) fail(400, 'ผลไม่ผ่าน กรุณาระบุสิ่งที่ทำ (เช่น กักสินค้า แจ้งหัวหน้างาน/QA)');
        const rec = [b.check_date, product, txt(b.product_name, 200), batch, pk.pack_key, pk.label, pk.label_net_g, pk.tare_g, JSON.stringify(gross), JSON.stringify(net), JSON.stringify(sensory),
          numOpt(b.aw, 'ค่า aw', 0, 1), numOpt(b.aw_temp, 'อุณหภูมิขณะวัด aw', 0, 60), numOpt(b.ph, 'ค่า pH', 0, 14), JSON.stringify(pack),
          numOpt(b.store_temp, 'อุณหภูมิสถานที่จัดเก็บ', -40, 60), txt(b.store_area, 40), result, failed.length ? JSON.stringify(failed) : null, note, user.display_name, user.username, nowIso()];
        for (let attempt = 0; ; attempt++) {
          const fcId = await dayId(DB, 'fg_checks', 'fc_id', 'FGC', b.check_date);
          try {
            await DB.batch([DB.prepare(`INSERT INTO fg_checks (fc_id,uid,check_date,product_code,product_name,batch_no,pack_key,pack_label,label_net_g,tare_g,gross,net,sensory,aw,aw_temp,ph,pack,store_temp,store_area,result,failed,note,inspector,created_by,created_at)
              VALUES (?,?,${rec.map(() => '?').join(',')})`).bind(fcId, uid, ...rec),
              ...recheck.map((x, i) => (x ? DB.prepare('INSERT INTO fg_check_rechecks (fc_id,jar,gross,net) VALUES (?,?,?,?)').bind(fcId, i + 1, x.gross, x.net) : null)).filter(Boolean)]);
          } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await DB.prepare('SELECT fc_id, result FROM fg_checks WHERE uid=?').bind(uid).first();
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'fg_check', fcId, { product_code: product, batch_no: batch, pack: pk.pack_key, net, recheck, result });
          return json({ fc_id: fcId, result, net, recheck, failed }, 201);
        }
      }

      // ===== Central raw-material register =====
      if (path === '/api/materials' && method === 'GET') {
        const { results } = await DB.prepare("SELECT * FROM materials ORDER BY CASE type WHEN 'RM' THEN 0 WHEN 'PM' THEN 1 ELSE 2 END, code").all();
        return json(results);
      }
      const mm = path.match(/^\/api\/materials(?:\/([A-Z]{2,4}-\d{3,4}))?$/);
      if (mm && (method === 'POST' || method === 'PATCH')) {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไขทะเบียนวัตถุดิบได้');
        const b = await body();
        const row = mm[1] ? await DB.prepare('SELECT * FROM materials WHERE code=?').bind(mm[1]).first() : null;
        if (method === 'PATCH' && !row) fail(404, 'ไม่พบวัตถุดิบนี้');
        if (method === 'POST' && mm[1]) fail(405, 'ใช้ PATCH เพื่อแก้ไข');
        const num = (v, label, lo, hi) => {
          if (blank(v)) return null;
          const n = Number(v);
          if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${label} ต้องเป็นตัวเลข ${lo} ถึง ${hi}`);
          return n;
        };
        const cur = row || {};
        const has = (k) => k in b;
        const next = {
          name: has('name') ? txt(b.name, 200) : cur.name,
          type: has('type') ? String(b.type || '') : cur.type,
          unit: has('unit') ? txt(b.unit, 40) : cur.unit ?? null,
          cat: has('cat') ? txt(b.cat, 60) : cur.cat ?? null,
          min_temp: has('min_temp') ? num(b.min_temp, 'อุณหภูมิต่ำสุด', -80, 100) : cur.min_temp ?? null,
          max_temp: has('max_temp') ? num(b.max_temp, 'อุณหภูมิสูงสุด', -80, 100) : cur.max_temp ?? null,
          temp_label: has('temp_label') ? txt(b.temp_label, 40) : cur.temp_label ?? null,
          store: has('store') ? txt(b.store, 300) : cur.store ?? null,
          aql_crop: has('aql_crop') ? (blank(b.aql_crop) ? null : String(b.aql_crop)) : cur.aql_crop ?? null,
          ph_min: has('ph_min') ? num(b.ph_min, 'pH ต่ำสุด', 0, 14) : cur.ph_min ?? null,
          ph_max: has('ph_max') ? num(b.ph_max, 'pH สูงสุด', 0, 14) : cur.ph_max ?? null,
          active: has('active') ? (b.active ? 1 : 0) : cur.active ?? 1,
        };
        if (!next.name) fail(400, 'กรุณาระบุชื่อวัตถุดิบ');
        if (!['RM', 'PM', 'CM'].includes(next.type)) fail(400, 'ประเภทต้องเป็น วัตถุดิบ (RM) บรรจุภัณฑ์ (PM) หรือวัสดุสิ้นเปลือง (CM)');
        if ((next.min_temp === null) !== (next.max_temp === null)) fail(400, 'ระบุอุณหภูมิต่ำสุดและสูงสุดให้ครบทั้งสองค่า หรือเว้นว่างทั้งคู่');
        if (next.min_temp !== null && next.max_temp !== null && next.min_temp > next.max_temp) fail(400, 'อุณหภูมิต่ำสุดต้องไม่มากกว่าสูงสุด');
        if ((next.ph_min === null) !== (next.ph_max === null)) fail(400, 'ระบุเกณฑ์ pH ต่ำสุดและสูงสุดให้ครบทั้งสองค่า หรือเว้นว่างทั้งคู่');
        if (next.ph_min !== null && next.ph_min > next.ph_max) fail(400, 'pH ต่ำสุดต้องไม่มากกว่าสูงสุด');
        if (next.aql_crop !== null && !['shallot', 'garlic', 'chili'].includes(next.aql_crop)) fail(400, 'แผนสุ่ม OPL ต้องเป็น หอม กระเทียม หรือพริก');
        if (next.aql_crop !== null && next.type !== 'RM') fail(400, 'แผนสุ่ม OPL ใช้กับวัตถุดิบ (RM) เท่านั้น');
        // The receiving app measures pH in the OPL sample (หอม กระเทียม พริก); ground pork has its own IQC plan.
        if (next.ph_min !== null && next.aql_crop === null) fail(400, 'เกณฑ์ pH ตอนรับใช้กับวัตถุดิบที่ใช้แผนสุ่ม OPL (หอม กระเทียม พริก)');
        const keys = Object.keys(next);
        if (method === 'POST') {
          const code = String(b.code || '').trim().toUpperCase();
          if (!/^[A-Z]{2,4}-\d{3,4}$/.test(code)) fail(400, 'รหัสต้องเป็นรูปแบบ เช่น RM-053 PKG-045 SUP-027');
          if (await DB.prepare('SELECT 1 FROM materials WHERE code=?').bind(code).first()) fail(409, 'มีรหัสนี้ในทะเบียนแล้ว');
          const ts = nowIso();
          await DB.prepare(`INSERT INTO materials (code,${keys.join(',')},version,created_by,created_at,updated_by,updated_at) VALUES (?,${keys.map(() => '?').join(',')},1,?,?,?,?)`)
            .bind(code, ...keys.map((k) => next[k]), user.username, ts, user.username, ts).run();
          await audit(DB, user.username, 'user', 'create', 'material', code, next);
          return json({ success: true, code }, 201);
        }
        const changes = diff(row, next, keys);
        if (!Object.keys(changes).length) return json({ success: true, code: row.code, version: row.version });
        await DB.prepare(`UPDATE materials SET ${keys.map((k) => `${k}=?`).join(',')}, version=version+1, updated_by=?, updated_at=? WHERE code=?`)
          .bind(...keys.map((k) => next[k]), user.username, nowIso(), row.code).run();
        await audit(DB, user.username, 'user', 'update', 'material', row.code, changes);
        return json({ success: true, code: row.code, version: row.version + 1 });
      }

      // ===== PSP QUALITY APP: control point register =====
      if (path === '/api/control-points' && method === 'GET') {
        const { results } = await DB.prepare(
          "SELECT c.*, COALESCE(r.release_required, 0) AS release_required FROM control_points c LEFT JOIN cp_release r ON r.cp_id = c.cp_id ORDER BY c.status='RETIRED', c.process_ref, c.cp_id").all();
        return json(results.map(cpRow));
      }
      if (path === '/api/control-points' && method === 'POST') {
        need(user, QAM, 'เฉพาะ QA Manager เท่านั้นที่เพิ่มจุดควบคุมได้');
        const b = await body();
        const id = String(b.cp_id || '').trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9]{1,5}-[A-Z0-9-]{1,20}$/.test(id)) fail(400, 'รหัสจุดควบคุมต้องเป็นรูปแบบ CCP-03, OPRP-07 หรือ PRP-01');
        if (blank(b.name)) fail(400, 'กรุณาระบุชื่อจุดควบคุม');
        if (await DB.prepare('SELECT 1 FROM control_points WHERE cp_id=?').bind(id).first()) fail(409, 'มีรหัสจุดควบคุมนี้แล้ว');
        const rec = { cp_type: CP_TYPES.includes(b.cp_type) ? b.cp_type : 'TBD', status: 'DRAFT',
          params: JSON.stringify(cleanParams(b.params)), products: cleanProducts(b.products) };
        for (const k of CP_TEXT) rec[k] = nz(typeof b[k] === 'string' ? b[k].trim().slice(0, 1000) : null);
        const cols = Object.keys(rec);
        await DB.prepare(`INSERT INTO control_points (cp_id,${cols.join(',')},version,created_by,created_at,updated_by,updated_at)
          VALUES (?,${cols.map(() => '?').join(',')},1,?,?,?,?)`).bind(id, ...cols.map((k) => rec[k]), user.username, nowIso(), user.username, nowIso()).run();
        if (b.release_required) await DB.prepare('INSERT OR REPLACE INTO cp_release (cp_id, release_required) VALUES (?,1)').bind(id).run();
        await audit(DB, user.username, 'user', 'create', 'control_point', id, { name: rec.name, cp_type: rec.cp_type, release_required: b.release_required ? 1 : 0 });
        return json({ success: true, cp_id: id }, 201);
      }
      const cpm = path.match(/^\/api\/control-points\/([A-Z][A-Z0-9]{1,5}-[A-Z0-9-]{1,20})$/);
      if (cpm && method === 'PATCH') {
        need(user, QAM, 'เฉพาะ QA Manager เท่านั้นที่แก้ไขจุดควบคุมได้');
        const b = await body();
        const row = await DB.prepare('SELECT * FROM control_points WHERE cp_id=?').bind(cpm[1]).first();
        if (!row) fail(404, 'ไม่พบจุดควบคุม');
        const next = { ...row };
        for (const k of CP_TEXT) if (k in b) next[k] = nz(typeof b[k] === 'string' ? b[k].trim().slice(0, 1000) : null);
        if (blank(next.name)) fail(400, 'กรุณาระบุชื่อจุดควบคุม');
        if ('cp_type' in b) { if (!CP_TYPES.includes(b.cp_type)) fail(400, 'ประเภทจุดควบคุมไม่ถูกต้อง'); next.cp_type = b.cp_type; }
        if ('status' in b) { if (!CP_STATUS.includes(b.status)) fail(400, 'สถานะไม่ถูกต้อง'); next.status = b.status; }
        if ('params' in b) next.params = JSON.stringify(cleanParams(b.params));
        if ('products' in b) next.products = cleanProducts(b.products);
        // Approving says the limits are validated: every measured value then needs a limit to be judged against.
        if (next.status === 'APPROVED') {
          if (next.cp_type === 'TBD') fail(422, 'ต้องกำหนดประเภท (CCP / OPRP / PRP) ก่อนอนุมัติ');
          const open = JSON.parse(next.params).filter((p) => p.type === 'number' && p.min === undefined && p.max === undefined);
          if (open.length) fail(422, `ต้องกำหนดค่าเกณฑ์ก่อนอนุมัติ: ${open.map((p) => p.label).join(', ')}`);
        }
        const fields = [...CP_TEXT, 'cp_type', 'status', 'params', 'products'];
        const changes = diff(row, next, fields);
        if ('release_required' in b) {
          const want = b.release_required ? 1 : 0;
          const cur = (await DB.prepare('SELECT release_required FROM cp_release WHERE cp_id=?').bind(row.cp_id).first())?.release_required ?? 0;
          if (want !== cur) {
            await DB.prepare('INSERT INTO cp_release (cp_id, release_required) VALUES (?,?) ON CONFLICT(cp_id) DO UPDATE SET release_required=excluded.release_required')
              .bind(row.cp_id, want).run();
            changes.release_required = { from: cur, to: want };
          }
        }
        if (!Object.keys(changes).length) return json({ success: true, version: row.version });
        // A new version whenever what a record is judged against changes, so old records keep their meaning.
        const bump = ['params', 'products', 'status', 'cp_type'].some((k) => k in changes);
        next.version = row.version + (bump ? 1 : 0);
        await DB.prepare(`UPDATE control_points SET ${fields.map((k) => `${k}=?`).join(',')}, version=?, updated_by=?, updated_at=? WHERE cp_id=?`)
          .bind(...fields.map((k) => next[k]), next.version, user.username, nowIso(), row.cp_id).run();
        await audit(DB, user.username, 'user', b.status === 'APPROVED' && row.status !== 'APPROVED' ? 'approve' : 'update',
          'control_point', row.cp_id, { ...changes, version: { from: row.version, to: next.version } });
        return json({ success: true, version: next.version });
      }

      // ===== PSP QUALITY APP: monitoring records =====
      if (path === '/api/qc' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (sp.get('from')) { where.push('record_date>=?'); p.push(sp.get('from')); }
        if (sp.get('to')) { where.push('record_date<=?'); p.push(sp.get('to')); }
        for (const k of ['cp_id', 'result']) if (sp.get(k)) { where.push(`${k}=?`); p.push(sp.get(k)); }
        if (sp.get('q')) { where.push('(batch_no LIKE ? OR rec_id LIKE ? OR product_name LIKE ? OR ncr_id LIKE ?)'); const l = `%${sp.get('q')}%`; p.push(l, l, l, l); }
        const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 500);
        const { results } = await DB.prepare(
          `SELECT * FROM qc_records WHERE ${where.join(' AND ')} ORDER BY record_date DESC, rec_id DESC LIMIT ?`).bind(...p, limit).all();
        return json(results.map((r) => ({ ...r, values: JSON.parse(r.values), failed: r.failed ? JSON.parse(r.failed) : [] })));
      }
      if (path === '/api/qc/summary' && method === 'GET') {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : today();
        const { results: byCp } = await DB.prepare(
          `SELECT cp_id, COUNT(*) AS total, SUM(result='FAIL') AS fail FROM qc_records WHERE record_date=? GROUP BY cp_id`).bind(day).all();
        const ncr = await DB.prepare(
          "SELECT COUNT(*) AS open, SUM(source_type IN ('CCP','IN_PROCESS')) AS process FROM ncr_records WHERE status NOT IN ('Closed','Cancelled')").first();
        const { results: recent } = await DB.prepare(
          'SELECT rec_id, cp_id, record_date, record_time, product_name, batch_no, result, ncr_id, inspector FROM qc_records ORDER BY created_at DESC LIMIT 10').all();
        const total = byCp.reduce((s, r) => s + r.total, 0), failCount = byCp.reduce((s, r) => s + (r.fail || 0), 0);
        const hyg = await DB.prepare("SELECT COUNT(*) AS total, SUM(result='FAIL') AS fail FROM hyg_records WHERE inspect_date=?").bind(day).first();
        return json({ date: day, total, fail: failCount, pass: total - failCount, byCp, hygTotal: hyg?.total || 0, hygFail: hyg?.fail || 0,
          ncrOpen: ncr?.open || 0, ncrProcessOpen: ncr?.process || 0, recent });
      }
      if (path === '/api/qc' && method === 'POST') {
        need(user, WRITERS);
        const r = await saveQcRecord(DB, user, await body());
        return json(r.body, r.status);
      }

      // Raw-material lots received recently (FM-QC-001), for picking the lots a batch used.
      if (path === '/api/recv/lots' && method === 'GET') {
        const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '120', 10) || 120, 1), 730);
        const since = new Date(Date.parse(today()) - days * 86400e3).toISOString().slice(0, 10);
        const { results } = await DB.prepare('SELECT doc_no, recv_date, supplier, data FROM recv_records WHERE recv_date >= ? ORDER BY recv_date DESC, doc_no DESC LIMIT 500').bind(since).all();
        const lots = [];
        for (const r of results) {
          for (const m of JSON.parse(r.data).mats || []) {
            if (blank(m.lot) || m.result === 'REJECT') continue; // a rejected lot never entered the store
            lots.push({ doc_no: r.doc_no, recv_date: r.recv_date, supplier: r.supplier, code: m.code || '', lot: String(m.lot), exp: m.exp || '', result: m.result || '' });
          }
        }
        return json(lots);
      }

      // ===== PSP QUALITY APP: finished-goods release =====
      if (path === '/api/release/check' && method === 'GET') {
        need(user, QAM, 'FG Release ใช้ได้เฉพาะ QA Manager');
        const product = String(url.searchParams.get('product_code') || '');
        if (!product) fail(400, 'กรุณาเลือกผลิตภัณฑ์');
        const batch = cleanBatch(url.searchParams.get('batch_no'));
        const gate = await batchGate(DB, product, batch);
        const { results } = await DB.prepare('SELECT * FROM fg_releases WHERE product_code=? AND batch_no=? ORDER BY created_at DESC').bind(product, batch).all();
        return json({ ...gate, history: results.map(relRow) });
      }
      if (path === '/api/release' && method === 'GET') {
        need(user, QAM, 'FG Release ใช้ได้เฉพาะ QA Manager');
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (sp.get('from')) { where.push('substr(created_at,1,10)>=?'); p.push(sp.get('from')); }
        if (sp.get('to')) { where.push('substr(created_at,1,10)<=?'); p.push(sp.get('to')); }
        if (sp.get('decision')) { where.push('decision=?'); p.push(sp.get('decision')); }
        if (sp.get('q')) { where.push('(batch_no LIKE ? OR rel_id LIKE ? OR product_name LIKE ? OR rm_lots LIKE ?)'); const l = `%${sp.get('q')}%`; p.push(l, l, l, l); }
        const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 500);
        const { results } = await DB.prepare(`SELECT * FROM fg_releases WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).bind(...p, limit).all();
        return json(results.map(relRow));
      }
      if (path === '/api/release' && method === 'POST') {
        need(user, QAM, 'เฉพาะ QA Manager เท่านั้นที่ตัดสินการปล่อยสินค้าได้');
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT rel_id, decision FROM fg_releases WHERE uid=?').bind(uid).first();
        if (done) return json(done);
        const product = String(b.product_code || '');
        if (!product) fail(400, 'กรุณาเลือกผลิตภัณฑ์');
        const batch = cleanBatch(b.batch_no);
        if (!['RELEASE', 'HOLD', 'REJECT'].includes(b.decision)) fail(400, 'กรุณาเลือกผลการตัดสิน');
        for (const k of ['mfg_date', 'exp_date']) if (!blank(b[k]) && !/^\d{4}-\d{2}-\d{2}$/.test(String(b[k]))) fail(400, 'รูปแบบวันที่ไม่ถูกต้อง');
        if (!blank(b.mfg_date) && !blank(b.exp_date) && b.exp_date <= b.mfg_date) fail(400, 'วันหมดอายุต้องหลังวันผลิต');
        const qty = blank(b.qty) ? null : Number(b.qty);
        if (qty !== null && !(Number.isFinite(qty) && qty >= 0)) fail(400, 'จำนวนต้องเป็นตัวเลข');
        const checks = {};
        for (const k of RELEASE_CHECKS) checks[k] = b.checks?.[k] === true;
        const lots = Array.isArray(b.rm_lots) ? b.rm_lots.slice(0, 100).map((l) => ({
          code: String(l?.code || '').slice(0, 40), name: String(l?.name || '').slice(0, 200),
          lot: String(l?.lot || '').trim().slice(0, 60), doc_no: String(l?.doc_no || '').slice(0, 40),
        })).filter((l) => l.lot) : [];
        if (blank(b.note) && b.decision !== 'RELEASE') fail(400, 'กรุณาระบุเหตุผลของการกักหรือไม่ปล่อย');
        const gate = await batchGate(DB, product, batch);
        if (b.decision === 'RELEASE') {
          // Release is the last line of defence: every record, every NCR and every check must be in order.
          const problems = [...gate.reasons];
          if (RELEASE_CHECKS.some((k) => !checks[k])) problems.push('ต้องยืนยันการตรวจก่อนปล่อยครบทุกข้อ');
          if (blank(b.mfg_date) || blank(b.exp_date)) problems.push('ต้องระบุวันผลิตและวันหมดอายุ');
          if (problems.length) return json({ error: 'ยังปล่อยสินค้าไม่ได้', reasons: problems }, 422);
        }
        const productName = blank(b.product_name) ? null : String(b.product_name).trim().slice(0, 200);
        for (let attempt = 0; ; attempt++) {
          const day = today().slice(2).replace(/-/g, '');
          const last = await DB.prepare('SELECT rel_id FROM fg_releases WHERE rel_id LIKE ? ORDER BY rel_id DESC LIMIT 1').bind(`REL-${day}-%`).first();
          const relId = `REL-${day}-${String((last ? parseInt(last.rel_id.slice(-3), 10) : 0) + 1).padStart(3, '0')}`;
          try {
            await DB.prepare(`INSERT INTO fg_releases (rel_id,uid,product_code,product_name,batch_no,decision,qty,unit,mfg_date,exp_date,rm_lots,checks,gate,note,decided_by,created_by,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(relId, uid, product, productName, batch, b.decision, qty, nz(blank(b.unit) ? null : String(b.unit).slice(0, 20)),
              nz(b.mfg_date), nz(b.exp_date), JSON.stringify(lots), JSON.stringify(checks),
              JSON.stringify({ requirements: gate.requirements, ncrs: gate.ncrs, reasons: gate.reasons }),
              nz(blank(b.note) ? null : String(b.note).trim().slice(0, 1000)), user.display_name, user.username, nowIso()).run();
          } catch (e) {
            if (/idx_rel_once|fg_releases\.product_code/i.test(e.message)) fail(409, 'Batch นี้ปล่อยแล้ว');
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await DB.prepare('SELECT rel_id, decision FROM fg_releases WHERE uid=?').bind(uid).first();
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', b.decision === 'RELEASE' ? 'release' : b.decision === 'HOLD' ? 'hold' : 'reject', 'fg_release', relId,
            { product_code: product, batch_no: batch, decision: b.decision, rm_lots: lots.map((l) => l.lot), open_reasons: gate.reasons });
          return json({ rel_id: relId, decision: b.decision }, 201);
        }
      }

      // ===== PSP QUALITY APP: traceability =====
      // One search across raw-material lots, batches and finished-goods lots: what went in, what came out, and what went wrong.
      if (path === '/api/trace' && method === 'GET') {
        const q = String(url.searchParams.get('q') || '').trim();
        if (q.length < 2) fail(400, 'กรุณาระบุเลขล็อตหรือเลข Batch อย่างน้อย 2 ตัวอักษร');
        const like = `%${q}%`;
        const { results: rels } = await DB.prepare('SELECT * FROM fg_releases WHERE batch_no LIKE ? OR rm_lots LIKE ? ORDER BY created_at DESC LIMIT 100').bind(like, like).all();
        const { results: recvRows } = await DB.prepare('SELECT doc_no, recv_date, supplier, result, data FROM recv_records WHERE data LIKE ? ORDER BY recv_date DESC LIMIT 100').bind(like).all();
        const received = [];
        for (const r of recvRows) {
          for (const m of JSON.parse(r.data).mats || []) {
            if (String(m.lot || '').toLowerCase().includes(q.toLowerCase())) {
              received.push({ doc_no: r.doc_no, recv_date: r.recv_date, supplier: r.supplier, code: m.code || '', lot: m.lot, qty: m.qty ?? null, unit: m.unit || '', mfg: m.mfg || '', exp: m.exp || '', result: m.result || r.result });
            }
          }
        }
        // Weighing records (FM-QC-004) show which batches used a lot even before any release.
        const { results: weighRows } = await DB.prepare('SELECT * FROM weigh_records WHERE batch_no LIKE ? OR lines LIKE ? ORDER BY prod_date DESC LIMIT 100').bind(like, like).all();
        const weighings = weighRows.map((r) => {
          const lines = JSON.parse(r.lines);
          return { wr_id: r.wr_id, product_code: r.product_code, product_name: r.product_name, prod_date: r.prod_date, batch_no: r.batch_no, sets: r.sets, result: r.result,
            lots: lines.map((l) => ({ name: l.name, lot: l.lot, doc_no: l.doc_no, kg: Math.round(l.weights.reduce((a, n) => a + n, 0) * 1000) / 1000 })) };
        });
        const batches = [...new Set([...rels.map((r) => r.batch_no), ...weighings.map((w) => w.batch_no), q])];
        const ph = batches.map(() => '?').join(',');
        const { results: qc } = await DB.prepare(`SELECT rec_id, cp_id, record_date, product_code, product_name, batch_no, result, ncr_id FROM qc_records WHERE batch_no IN (${ph}) ORDER BY record_date, rec_id`).bind(...batches).all();
        const { results: ncrs } = await DB.prepare(
          `SELECT ncr_id, issue_date, status, severity, disposition, source_type, lot_no, product_lot_no, material_name, nc_description FROM ncr_records
            WHERE lot_no LIKE ? OR product_lot_no LIKE ? OR product_lot_no IN (${ph}) ORDER BY ncr_id LIMIT 200`).bind(like, like, ...batches).all();
        return json({ q, received, weighings, releases: QAM.has(user.role) ? rels.map(relRow) : [], qc, ncrs: ncrs.map((n) => ({ ...n, nc_description: String(n.nc_description || '').slice(0, 200) })) });
      }

      // ===== PSP QUALITY APP: personal hygiene check before work =====
      if (path === '/api/hyg/items' && method === 'GET') {
        return json((await DB.prepare('SELECT * FROM hyg_items ORDER BY active DESC, sort, item_key').all()).results);
      }
      const hi = path.match(/^\/api\/hyg\/items(?:\/(H\d{2,3}))?$/);
      if (hi && (method === 'POST' || (method === 'PATCH' && hi[1]))) {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไขหัวข้อการตรวจได้');
        const b = await body();
        const str = (v, n) => (blank(v) ? null : String(v).trim().slice(0, n));
        if (method === 'POST') {
          if (blank(b.label)) fail(400, 'กรุณาระบุหัวข้อการตรวจ');
          const last = await DB.prepare('SELECT item_key, sort FROM hyg_items ORDER BY item_key DESC LIMIT 1').first();
          const key = `H${String((last ? parseInt(last.item_key.slice(1), 10) : 0) + 1).padStart(2, '0')}`;
          const sort = (await DB.prepare('SELECT MAX(sort) AS m FROM hyg_items').first())?.m ?? 0;
          await DB.prepare('INSERT INTO hyg_items (item_key,sort,label,note,pass_desc,fail_desc,critical,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
            .bind(key, sort + 1, str(b.label, 120), str(b.note, 300), str(b.pass_desc, 300), str(b.fail_desc, 300), b.critical ? 1 : 0, user.username, nowIso()).run();
          await audit(DB, user.username, 'user', 'create', 'hyg_item', key, { label: b.label, critical: b.critical ? 1 : 0 });
          return json({ success: true, item_key: key }, 201);
        }
        const row = await DB.prepare('SELECT * FROM hyg_items WHERE item_key=?').bind(hi[1]).first();
        if (!row) fail(404, 'ไม่พบหัวข้อการตรวจ');
        const next = { ...row };
        for (const [k, n] of [['label', 120], ['note', 300], ['pass_desc', 300], ['fail_desc', 300]]) if (k in b) next[k] = str(b[k], n);
        if (blank(next.label)) fail(400, 'กรุณาระบุหัวข้อการตรวจ');
        for (const k of ['critical', 'active']) if (k in b) next[k] = b[k] ? 1 : 0;
        if ('sort' in b) { const n = parseInt(b.sort, 10); if (!(n >= 0 && n < 1000)) fail(400, 'ลำดับไม่ถูกต้อง'); next.sort = n; }
        const fields = ['label', 'note', 'pass_desc', 'fail_desc', 'critical', 'active', 'sort'];
        const changes = diff(row, next, fields);
        if (Object.keys(changes).length) {
          await DB.prepare(`UPDATE hyg_items SET ${fields.map((k) => `${k}=?`).join(',')}, updated_by=?, updated_at=? WHERE item_key=?`)
            .bind(...fields.map((k) => next[k]), user.username, nowIso(), row.item_key).run();
          await audit(DB, user.username, 'user', 'update', 'hyg_item', row.item_key, changes);
        }
        return json({ success: true });
      }

      if (path === '/api/hyg/employees' && method === 'GET') {
        return json((await DB.prepare('SELECT emp_id, name, dept, active FROM hyg_employees ORDER BY active DESC, name').all()).results);
      }
      if (path === '/api/hyg/employees' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const name = String(b.name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 100) fail(400, 'กรุณาระบุชื่อ-สกุลพนักงาน');
        if (await DB.prepare('SELECT 1 FROM hyg_employees WHERE name=?').bind(name).first()) fail(409, 'มีชื่อพนักงานนี้แล้ว');
        const dept = blank(b.dept) ? null : String(b.dept).trim().slice(0, 60);
        await DB.prepare('INSERT INTO hyg_employees (name, dept, active, created_by, created_at) VALUES (?,?,1,?,?)').bind(name, dept, user.username, nowIso()).run();
        const row = await DB.prepare('SELECT emp_id, name, dept, active FROM hyg_employees WHERE name=?').bind(name).first();
        await audit(DB, user.username, 'user', 'create', 'hyg_employee', String(row.emp_id), { name, dept });
        return json(row, 201);
      }
      const he = path.match(/^\/api\/hyg\/employees\/(\d+)$/);
      if (he && method === 'PATCH') {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไขรายชื่อพนักงานได้');
        const b = await body();
        const row = await DB.prepare('SELECT * FROM hyg_employees WHERE emp_id=?').bind(he[1]).first();
        if (!row) fail(404, 'ไม่พบพนักงาน');
        const next = { ...row };
        if ('name' in b) {
          next.name = String(b.name || '').trim().replace(/\s+/g, ' ');
          if (next.name.length < 2 || next.name.length > 100) fail(400, 'กรุณาระบุชื่อ-สกุลพนักงาน');
          if (next.name !== row.name && await DB.prepare('SELECT 1 FROM hyg_employees WHERE name=?').bind(next.name).first()) fail(409, 'มีชื่อพนักงานนี้แล้ว');
        }
        if ('dept' in b) next.dept = blank(b.dept) ? null : String(b.dept).trim().slice(0, 60);
        if ('active' in b) next.active = b.active ? 1 : 0;
        const changes = diff(row, next, ['name', 'dept', 'active']);
        if (Object.keys(changes).length) {
          await DB.prepare('UPDATE hyg_employees SET name=?, dept=?, active=? WHERE emp_id=?').bind(next.name, next.dept, next.active, row.emp_id).run();
          await audit(DB, user.username, 'user', 'update', 'hyg_employee', String(row.emp_id), changes);
        }
        return json({ success: true });
      }

      if (path === '/api/hyg/records' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        const d = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) || '') ? sp.get(k) : null);
        if (d('date')) { where.push('inspect_date=?'); p.push(d('date')); }
        if (d('from')) { where.push('inspect_date>=?'); p.push(d('from')); }
        if (d('to')) { where.push('inspect_date<=?'); p.push(d('to')); }
        if (sp.get('result')) { where.push('result=?'); p.push(sp.get('result')); }
        if (sp.get('emp_id')) { where.push('emp_id=?'); p.push(sp.get('emp_id')); }
        const { results } = await DB.prepare(`SELECT * FROM hyg_records WHERE ${where.join(' AND ')} ORDER BY inspect_date DESC, rec_id DESC LIMIT 1000`).bind(...p).all();
        return json(results.map((r) => ({ ...r, results: JSON.parse(r.results), items: JSON.parse(r.items), failed: r.failed ? JSON.parse(r.failed) : [] })));
      }
      if (path === '/api/hyg/records' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT rec_id, result FROM hyg_records WHERE uid=?').bind(uid).first();
        if (done) return json(done);
        const date = String(b.inspect_date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'กรุณาระบุวันที่ตรวจ');
        if (date > today()) fail(400, 'วันที่ตรวจต้องไม่เป็นวันในอนาคต');
        if (!blank(b.inspect_time) && !/^\d{2}:\d{2}$/.test(String(b.inspect_time))) fail(400, 'รูปแบบเวลาไม่ถูกต้อง');
        const emp = await DB.prepare('SELECT * FROM hyg_employees WHERE emp_id=?').bind(parseInt(b.emp_id, 10) || 0).first();
        if (!emp) fail(400, 'กรุณาเลือกพนักงานที่ถูกตรวจ');
        if (!emp.active) fail(409, 'พนักงานคนนี้ถูกปิดการใช้งานแล้ว');
        const { results: items } = await DB.prepare('SELECT item_key, label, critical FROM hyg_items WHERE active=1 ORDER BY sort, item_key').all();
        const results = {}, failed = [];
        for (const it of items) {
          const v = b.results?.[it.item_key];
          if (v !== 'P' && v !== 'F') fail(400, `กรุณาประเมิน "${it.label}"`);
          results[it.item_key] = v;
          if (v === 'F') failed.push({ key: it.item_key, label: it.label, critical: it.critical });
        }
        const result = failed.length ? 'FAIL' : 'PASS';
        let action = null;
        if (failed.length) {
          // A failed check needs what was done about it; a critical item (health, wounds) keeps the person out.
          if (!['CORRECTED', 'EXCLUDED'].includes(b.action)) fail(400, 'กรุณาระบุการแก้ไขสำหรับรายการที่ไม่ผ่าน');
          if (b.action === 'CORRECTED' && failed.some((f) => f.critical)) fail(400, 'รายการสำคัญไม่ผ่าน ต้องไม่อนุญาตให้เข้าพื้นที่ผลิต');
          action = b.action;
        }
        const note = blank(b.note) ? null : String(b.note).trim().slice(0, 500);
        if (action === 'EXCLUDED' && !note) fail(400, 'กรุณาระบุรายละเอียดเมื่อไม่อนุญาตให้เข้าพื้นที่ผลิต');
        for (let attempt = 0; ; attempt++) {
          const day = date.slice(2).replace(/-/g, '');
          const last = await DB.prepare('SELECT rec_id FROM hyg_records WHERE rec_id LIKE ? ORDER BY rec_id DESC LIMIT 1').bind(`PH-${day}-%`).first();
          const recId = `PH-${day}-${String((last ? parseInt(last.rec_id.slice(-4), 10) : 0) + 1).padStart(4, '0')}`;
          try {
            await DB.prepare(`INSERT INTO hyg_records (rec_id,uid,inspect_date,inspect_time,shift,emp_id,emp_name,dept,results,items,result,failed,action,note,inspector,created_by,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(recId, uid, date, nz(b.inspect_time), blank(b.shift) ? null : String(b.shift).trim().slice(0, 20),
              emp.emp_id, emp.name, emp.dept, JSON.stringify(results), JSON.stringify(items), result, failed.length ? JSON.stringify(failed) : null,
              action, note, user.display_name, user.username, nowIso()).run();
          } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await DB.prepare('SELECT rec_id, result FROM hyg_records WHERE uid=?').bind(uid).first();
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'hyg_record', recId, { emp: emp.name, result, failed: failed.map((f) => f.key), action });
          return json({ rec_id: recId, result, failed, action }, 201);
        }
      }

      // ===== PSP QUALITY APP: formulas and raw-material weighing (FM-QC-004) =====
      if (path === '/api/formulas' && method === 'GET') {
        const { results } = await DB.prepare('SELECT * FROM formulas ORDER BY product_code').all();
        return json(results.map((r) => ({ ...r, items: JSON.parse(r.items) })));
      }
      const fm = path.match(/^\/api\/formulas(?:\/([A-Za-z0-9_-]{1,30}))?$/);
      if (fm && (method === 'POST' || (method === 'PATCH' && fm[1]))) {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไขสูตรได้');
        const b = await body();
        const row = fm[1] ? await DB.prepare('SELECT * FROM formulas WHERE product_code=?').bind(fm[1]).first() : null;
        if (method === 'PATCH' && !row) fail(404, 'ไม่พบสูตร');
        const code = row ? row.product_code : String(b.product_code || '').trim().toUpperCase();
        if (!row) {
          if (!/^[A-Z0-9_-]{2,30}$/.test(code)) fail(400, 'รหัสผลิตภัณฑ์ไม่ถูกต้อง');
          if (await DB.prepare('SELECT 1 FROM formulas WHERE product_code=?').bind(code).first()) fail(409, 'มีสูตรของผลิตภัณฑ์นี้แล้ว');
        }
        const next = { ...(row || { status: 'DRAFT', version: 1, tolerance_pct: null }) };
        if ('product_name' in b || !row) { next.product_name = txt(b.product_name, 200); if (!next.product_name) fail(400, 'กรุณาระบุชื่อผลิตภัณฑ์'); }
        if ('items' in b || !row) {
          const list = Array.isArray(b.items) ? b.items : [];
          if (!list.length || list.length > 40) fail(400, 'สูตรต้องมีวัตถุดิบ 1–40 รายการ');
          const seen = new Set();
          next.items = JSON.stringify(list.map((it) => {
            const name = String(it?.name || '').trim().slice(0, 80);
            const target = Number(it?.target);
            if (!name || seen.has(name)) fail(400, `ชื่อวัตถุดิบว่างหรือซ้ำ: ${name || '(ว่าง)'}`);
            if (!(target > 0) || target > 1000) fail(400, `น้ำหนักที่กำหนดของ ${name} ต้องมากกว่า 0 และไม่เกิน 1000 กก.`);
            seen.add(name);
            const o = { name, target: Math.round(target * 1000) / 1000 };
            if (!blank(it.note)) o.note = String(it.note).trim().slice(0, 200);
            return o;
          }));
        }
        if ('tolerance_pct' in b) {
          next.tolerance_pct = blank(b.tolerance_pct) ? null : Number(b.tolerance_pct);
          if (next.tolerance_pct !== null && !(next.tolerance_pct > 0 && next.tolerance_pct <= 50)) fail(400, 'Tolerance ต้องอยู่ระหว่าง 0–50%');
        }
        if ('status' in b) { if (!['DRAFT', 'APPROVED'].includes(b.status)) fail(400, 'สถานะไม่ถูกต้อง'); next.status = b.status; }
        if (next.status === 'APPROVED' && next.tolerance_pct === null) fail(422, 'ต้องกำหนด Tolerance ของการชั่งก่อนอนุมัติสูตร');
        if ('source' in b || !row) next.source = txt(b.source, 300);
        const fields = ['product_name', 'items', 'tolerance_pct', 'status', 'source'];
        if (!row) {
          await DB.prepare('INSERT INTO formulas (product_code,product_name,version,status,tolerance_pct,items,source,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .bind(code, next.product_name, 1, next.status, next.tolerance_pct, next.items, next.source, user.username, nowIso()).run();
          await audit(DB, user.username, 'user', 'create', 'formula', code, { product_name: next.product_name });
          return json({ success: true, product_code: code, version: 1 }, 201);
        }
        const changes = diff(row, next, fields);
        if (!Object.keys(changes).length) return json({ success: true, version: row.version });
        next.version = row.version + (['items', 'tolerance_pct', 'status'].some((k) => k in changes) ? 1 : 0);
        await DB.prepare(`UPDATE formulas SET ${fields.map((k) => `${k}=?`).join(',')}, version=?, updated_by=?, updated_at=? WHERE product_code=?`)
          .bind(...fields.map((k) => next[k]), next.version, user.username, nowIso(), code).run();
        await audit(DB, user.username, 'user', b.status === 'APPROVED' && row.status !== 'APPROVED' ? 'approve' : 'update', 'formula', code, { ...changes, version: { from: row.version, to: next.version } });
        return json({ success: true, version: next.version });
      }

      if (path === '/api/weigh' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (isDate(sp.get('from'))) { where.push('w.prod_date>=?'); p.push(sp.get('from')); }
        if (isDate(sp.get('to'))) { where.push('w.prod_date<=?'); p.push(sp.get('to')); }
        for (const k of ['product_code', 'batch_no', 'wr_id']) if (sp.get(k)) { where.push(`w.${k}=?`); p.push(sp.get(k)); }
        const { results } = await DB.prepare(`SELECT w.*, s.weigher_name, s.signed_at, (s.sig_data IS NOT NULL OR EXISTS (SELECT 1 FROM weigh_signatures g WHERE g.wr_id = w.wr_id)) AS has_sig FROM weigh_records w LEFT JOIN weigh_signs s ON s.wr_id = w.wr_id
          WHERE ${where.join(' AND ')} ORDER BY w.prod_date DESC, w.wr_id DESC LIMIT 500`).bind(...p).all();
        return json(results.map((r) => ({ ...r, lines: JSON.parse(r.lines), deviations: r.deviations ? JSON.parse(r.deviations) : [] })));
      }
      const wsg = path.match(/^\/api\/weigh\/(PD-\d{6}-\d{3})\/signatures?$/);
      if (wsg && method === 'GET') {
        // Every weigher's signature on this record (records saved before per-line weighers keep one, in weigh_signs).
        const { results } = await DB.prepare('SELECT weigher_name, sig_type, sig_data FROM weigh_signatures WHERE wr_id=? ORDER BY signed_at, weigher_name').bind(wsg[1]).all();
        const old = results.length ? null : await DB.prepare('SELECT weigher_name, sig_type, sig_data FROM weigh_signs WHERE wr_id=? AND sig_data IS NOT NULL').bind(wsg[1]).first();
        const list = (old ? [old] : results).map((x) => ({ name: x.weigher_name, data: `data:${x.sig_type};base64,${x.sig_data}` }));
        if (!list.length) fail(404, 'ไม่มีลายเซ็น');
        return json(path.endsWith('/signatures') ? list : { data: list[0].data });
      }
      if (path === '/api/weigh' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        // One saved form may hold several sets; each set is its own batch (own record, own FM-QC-002, own release).
        const savedRecs = async () => (await DB.prepare("SELECT wr_id, batch_no, result FROM weigh_records WHERE uid=? OR uid LIKE ? ORDER BY wr_id").bind(uid, `${uid}-s%`).all()).results;
        const reply = (recs, deviations, status) => json({ wr_id: recs[0].wr_id, result: recs.some((r) => r.result === 'DEVIATION') ? 'DEVIATION' : 'PASS', deviations, records: recs }, status);
        const done = await savedRecs();
        if (done.length) return reply(done, []);
        const f = await DB.prepare('SELECT * FROM formulas WHERE product_code=?').bind(String(b.product_code || '')).first();
        if (!f) fail(400, 'ผลิตภัณฑ์นี้ยังไม่มีสูตรในระบบ ให้ QA เพิ่มสูตรก่อน');
        if (!isDate(b.prod_date) || b.prod_date > today()) fail(400, 'กรุณาระบุวันที่ผลิต (ไม่เป็นวันในอนาคต)');
        const sets = parseInt(b.sets, 10);
        if (!(sets >= 1 && sets <= 12)) fail(400, 'จำนวนชุดต้องเป็น 1–12');
        // Who weighed each line is picked from the employee list (named, not signing); the account that saves is the
        // recorder and signs once. An older app sends one weigher_name for the form and its signature(s): the first signature is used.
        const defaultWeigher = txt(b.weigher_name, 80);
        const rawSig = typeof b.recorder_signature === 'string' ? b.recorder_signature
          : Array.isArray(b.signatures) && typeof b.signatures[0]?.data === 'string' ? b.signatures[0].data
          : typeof b.signature === 'string' ? b.signature : '';
        if (!rawSig.startsWith('data:')) fail(400, 'กรุณาให้ผู้บันทึกลงลายเซ็น');
        const sig = decodePhoto({ content_type: (/^data:([^;,]+)/.exec(rawSig) || [])[1], data: rawSig });
        // Each set gets its own batch number. A form without `batches` (an older app) keeps all sets under batch_no.
        const split = sets > 1 && Array.isArray(b.batches);
        const batches = split ? b.batches.slice(0, sets).map(cleanBatch) : [cleanBatch(b.batch_no)];
        if (split && batches.length !== sets) fail(400, `กรุณาระบุเลขที่ Batch ให้ครบ ${sets} ชุด`);
        if (new Set(batches).size !== batches.length) fail(400, 'เลขที่ Batch ของแต่ละชุดต้องไม่ซ้ำกัน');
        for (const bn of batches) {
          if (await DB.prepare('SELECT wr_id FROM weigh_records WHERE product_code=? AND batch_no=?').bind(f.product_code, bn).first()) fail(409, `Batch ${bn} มีบันทึกการชั่งแล้ว`);
        }
        const items = JSON.parse(f.items);
        const given = Array.isArray(b.lines) ? b.lines.slice(0, 60) : [];
        const tol = f.tolerance_pct;
        const readLine = (l, target, extra) => {
          const name = String(l?.name || '').trim().slice(0, 80);
          const w = (Array.isArray(l?.weights) ? l.weights : []).slice(0, sets).map((v) => (blank(v) ? NaN : Number(v)));
          if (w.length !== sets || w.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) fail(400, `กรอกน้ำหนักของ ${name} ให้ครบ ${sets} ชุด (กก.)`);
          const lot = String(l?.lot || '').trim().slice(0, 60);
          const weigher = txt(l?.weigher, 80) || defaultWeigher;
          if (!weigher) fail(400, `กรุณาเลือกชื่อผู้ชั่งของ ${name}`);
          const line = { name, target, lot, weigher, doc_no: String(l?.doc_no || '').slice(0, 40), code: String(l?.code || '').slice(0, 40), weights: w };
          if (extra) line.extra = true;
          return line;
        };
        const lines = items.map((it) => {
          const l = given.find((x) => String(x?.name || '').trim() === it.name);
          if (!l) fail(400, `ไม่มีรายการ ${it.name} ตามสูตร`);
          return readLine(l, it.target, false);
        });
        for (const l of given.filter((x) => !items.some((it) => it.name === String(x?.name || '').trim()))) lines.push(readLine(l, null, true));
        const used = [...new Set(lines.map((l) => l.weigher))];
        // Deviations of the sets a record holds (`from`..`to`); set numbers restart at 1 within the record.
        const devsOf = (from, to) => {
          const out = [];
          for (const l of lines) {
            if (l.extra) { out.push({ name: l.name, kind: 'EXTRA', text: `${l.name} ไม่อยู่ในสูตร` }); continue; }
            if (tol === null) continue;
            for (let i = from; i < to; i++) {
              const n = l.weights[i], pct = ((n - l.target) / l.target) * 100;
              const set = i - from + 1, label = to - from > 1 ? `ชุดที่ ${set}: ` : '';
              if (Math.abs(pct) > tol) out.push({ name: l.name, kind: 'TOL', set, text: `${l.name} ${label}${n} กก. (กำหนด ${l.target} กก. ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% เกิน ±${tol}%)` });
            }
          }
          return out;
        };
        const parts = split
          ? batches.map((bn, i) => ({ batch: bn, from: i, to: i + 1 }))
          : [{ batch: batches[0], from: 0, to: sets }];
        parts.forEach((pt) => { pt.deviations = devsOf(pt.from, pt.to); pt.result = pt.deviations.length ? 'DEVIATION' : 'PASS'; });
        const note = txt(b.note, 1000);
        // FM-QC-004 (formerly PD_03) Rev.01: out of tolerance or off-formula, production stops until someone with authority assesses it.
        if (parts.some((pt) => pt.result === 'DEVIATION')) {
          need(user, ASSESSORS, 'น้ำหนักนอก Tolerance หรือมีวัตถุดิบนอกสูตร ต้องให้หัวหน้างาน / QA เป็นผู้ประเมินและบันทึก');
          if (!note) fail(400, 'กรุณาบันทึกผลการประเมินของผู้มีอำนาจก่อนนำไปผลิตต่อ');
        }
        for (let attempt = 0; ; attempt++) {
          const first = await dayId(DB, 'weigh_records', 'wr_id', 'PD', b.prod_date);
          const base = parseInt(first.split('-').pop(), 10), stem = first.slice(0, first.lastIndexOf('-') + 1);
          parts.forEach((pt, i) => { pt.wr_id = `${stem}${String(base + i).padStart(3, '0')}`; pt.uid = i ? `${uid}-s${i + 1}` : uid; });
          try {
            await DB.batch([...parts.map((pt) => DB.prepare(`INSERT INTO weigh_records (wr_id,uid,product_code,product_name,prod_date,batch_no,sets,formula_version,formula_status,tolerance_pct,scale_id,lines,deviations,result,note,assessed_by,weigher,created_by,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(pt.wr_id, pt.uid, f.product_code, f.product_name, b.prod_date, pt.batch, pt.to - pt.from, f.version, f.status, tol,
              txt(b.scale_id, 40), JSON.stringify(lines.map((l) => ({ ...l, weights: l.weights.slice(pt.from, pt.to) }))), pt.deviations.length ? JSON.stringify(pt.deviations) : null,
              pt.result, note, pt.result === 'DEVIATION' ? user.display_name : null, user.display_name, user.username, nowIso())),
              ...parts.map((pt) => DB.prepare('INSERT INTO weigh_signs (wr_id,weigher_name,emp_id,sig_type,sig_data,signed_at) VALUES (?,?,?,?,?,?)')
                .bind(pt.wr_id, used.join(', '), null, null, null, nowIso())),
              // the recorder's signature (name = the recorder's display name)
              ...parts.map((pt) => DB.prepare('INSERT INTO weigh_signatures (wr_id,weigher_name,emp_id,sig_type,sig_data,signed_at) VALUES (?,?,?,?,?,?)').bind(pt.wr_id, user.display_name, null, sig.type, sig.b64, nowIso()))]);
          } catch (e) {
            if (/weigh_records\.product_code/.test(e.message)) fail(409, 'Batch นี้มีบันทึกการชั่งแล้ว');
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await savedRecs();
              if (again.length) return reply(again, []);
              continue;
            }
            throw e;
          }
          for (const pt of parts) {
            await audit(DB, user.username, 'user', 'create', 'weigh_record', pt.wr_id, { weighers: used, signed_by: user.display_name, product_code: f.product_code, batch_no: pt.batch, sets: pt.to - pt.from, result: pt.result, lots: lines.map((l) => l.lot), ...(split ? { split_from: uid, set_no: pt.from + 1, of_sets: sets } : {}) });
          }
          return reply(parts.map((pt) => ({ wr_id: pt.wr_id, batch_no: pt.batch, result: pt.result })), parts.flatMap((pt) => pt.deviations), 201);
        }
      }

      // ===== PSP QUALITY APP: production control (FM-QC-002) =====
      if (path === '/api/prodctl' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (isDate(sp.get('from'))) { where.push('prod_date>=?'); p.push(sp.get('from')); }
        if (isDate(sp.get('to'))) { where.push('prod_date<=?'); p.push(sp.get('to')); }
        for (const k of ['product_code', 'batch_no', 'pc_id']) if (sp.get(k)) { where.push(`${k}=?`); p.push(sp.get(k)); }
        const { results } = await DB.prepare(`SELECT * FROM prod_controls WHERE ${where.join(' AND ')} ORDER BY prod_date DESC, pc_id DESC LIMIT 500`).bind(...p).all();
        return json(results.map((r) => ({ ...r, data: JSON.parse(r.data), derived: r.derived ? JSON.parse(r.derived) : [] })));
      }
      if (path === '/api/prodctl' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const { results: cpRows } = await DB.prepare(`SELECT * FROM control_points WHERE cp_id IN (${DERIVED_CPS.map(() => '?').join(',')}) AND status <> 'RETIRED'`).bind(...DERIVED_CPS).all();
        // Writes the control-point records for a saved FM-QC-002; safe to run again (each derived record has its own fixed uid).
        const derive = async (row, d) => {
          const out = [];
          for (const cp of cpRows.map(cpRow)) {
            if (cp.products.length && !cp.products.includes(row.product_code)) continue;
            const dv = deriveValues(cp.cp_id, d);
            if (!dv) continue;
            const r = await saveQcRecord(DB, user, { uid: `${row.uid}-${cp.cp_id}`, cp_id: cp.cp_id, record_date: row.prod_date, record_time: dv.time || null,
              product_code: row.product_code, product_name: row.product_name, batch_no: row.batch_no, values: dv.values, note: `จากแบบฟอร์มควบคุมการผลิต FM-QC-002 ${row.pc_id}` }, dv.na);
            out.push({ cp_id: cp.cp_id, rec_id: r.body.rec_id, result: r.body.result, ncr_id: r.body.ncr_id || null });
          }
          const result = out.some((x) => x.result === 'FAIL') || row.ncr_id ? 'FAIL' : 'PASS';
          await DB.prepare('UPDATE prod_controls SET derived=?, result=? WHERE pc_id=?').bind(JSON.stringify(out), result, row.pc_id).run();
          return { pc_id: row.pc_id, result, derived: out, ncr_id: row.ncr_id || null };
        };
        const done = await DB.prepare('SELECT * FROM prod_controls WHERE uid=?').bind(uid).first();
        if (done) return json(await derive(done, JSON.parse(done.data)));
        if (!isDate(b.prod_date) || b.prod_date > today()) fail(400, 'กรุณาระบุวันที่ผลิต (ไม่เป็นวันในอนาคต)');
        const batch = cleanBatch(b.batch_no);
        const product = String(b.product_code || '');
        if (!/^[A-Za-z0-9_-]{2,30}$/.test(product)) fail(400, 'กรุณาเลือกผลิตภัณฑ์');
        if (await DB.prepare('SELECT 1 FROM prod_controls WHERE product_code=? AND batch_no=?').bind(product, batch).first()) fail(409, 'Batch นี้มีแบบฟอร์มควบคุมการผลิตแล้ว');
        const d = cleanProdData(b);
        if (d.cool.foreign_ok === null) fail(400, 'กรุณาตรวจ "ไม่มีสิ่งปลอมปน" หลังพักเย็น');
        const note = txt(b.note, 1000);
        if (d.cool.foreign_ok === false && !note) fail(400, 'พบสิ่งปลอมปน กรุณาระบุรายละเอียดและสิ่งที่ทำ');
        // Check every derived record before writing anything, so a missing value never leaves half a batch saved.
        for (const cp of cpRows.map(cpRow)) {
          if (cp.products.length && !cp.products.includes(product)) continue;
          const dv = deriveValues(cp.cp_id, d);
          if (dv) evaluate(cp.params, dv.values, dv.na);
        }
        const productName = txt(b.product_name, 200);
        for (let attempt = 0; ; attempt++) {
          const pcId = await dayId(DB, 'prod_controls', 'pc_id', 'Q8', b.prod_date);
          const ncrId = d.cool.foreign_ok === false && AUTO_NCR ? await nextId(DB, 'ncr_records', 'ncr_id', 'NCR') : null;
          const stmts = [];
          if (ncrId) stmts.push(autoNcrStmt(DB, user, ncrId, {
            source_type: 'IN_PROCESS', source_ref: pcId, process_ref: 'PC0009', severity: 'Major', found_date: b.prod_date,
            material_code: product, material_name: productName, product_lot_no: batch, parameter_id: 'FM-QC-002', parameter_name: 'สิ่งปลอมปนหลังพักเย็น',
            critical_limit: 'ไม่มีสิ่งปลอมปน', actual_result: 'พบสิ่งปลอมปน',
            nc_description: `พบสิ่งปลอมปนในผลิตภัณฑ์หลังพักเย็น — แบบฟอร์มควบคุมการผลิต FM-QC-002 ${pcId}\nผลิตภัณฑ์: ${product} ${productName || ''} · Batch ${batch}\n${note}`.slice(0, 2000),
            immediate_action: `กักกัน Batch ${batch} รอ QA ตัดสิน`,
          }));
          stmts.push(DB.prepare(`INSERT INTO prod_controls (pc_id,uid,product_code,product_name,prod_date,batch_no,oil_type,data,derived,result,note,ncr_id,inspector,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,NULL,'PENDING',?,?,?,?,?)`).bind(pcId, uid, product, productName, b.prod_date, batch, txt(b.oil_type, 60), JSON.stringify(d), note, ncrId,
            user.display_name, user.username, nowIso()));
          try { await DB.batch(stmts); } catch (e) {
            if (/prod_controls\.product_code/.test(e.message)) fail(409, 'Batch นี้มีแบบฟอร์มควบคุมการผลิตแล้ว');
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) continue;
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'prod_control', pcId, { product_code: product, batch_no: batch, ncr_id: ncrId });
          if (ncrId) await audit(DB, user.username, 'user', 'create', 'ncr', ncrId, { source: 'FM-QC-002', prod_control: pcId });
          const row = await DB.prepare('SELECT * FROM prod_controls WHERE pc_id=?').bind(pcId).first();
          return json(await derive(row, d), 201);
        }
      }

      // ===== PSP QUALITY APP: frying oil (FM-QC-005) =====
      if (path === '/api/oil' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (isDate(sp.get('from'))) { where.push('check_date>=?'); p.push(sp.get('from')); }
        if (isDate(sp.get('to'))) { where.push('check_date<=?'); p.push(sp.get('to')); }
        const { results } = await DB.prepare(`SELECT * FROM oil_checks WHERE ${where.join(' AND ')} ORDER BY check_date DESC, chk_id DESC LIMIT 1000`).bind(...p).all();
        return json(results.map((r) => ({ ...r, tpm: JSON.parse(r.tpm), temps: r.temps ? JSON.parse(r.temps) : [] })));
      }
      if (path === '/api/oil' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT chk_id, result, ncr_id FROM oil_checks WHERE uid=?').bind(uid).first();
        if (done) return json(done);
        if (!isDate(b.check_date) || b.check_date > today()) fail(400, 'กรุณาระบุวันที่ตรวจ (ไม่เป็นวันในอนาคต)');
        if (!blank(b.check_time) && !isTime(b.check_time)) fail(400, 'รูปแบบเวลาไม่ถูกต้อง');
        if (!['BEFORE', 'DURING', 'AFTER'].includes(b.stage)) fail(400, 'กรุณาเลือกช่วงที่ตรวจ (ก่อน / ระหว่าง / หลังการผลิต)');
        const nums = (list, label, lo, hi) => {
          const out = (Array.isArray(list) ? list : []).filter((v) => !blank(v)).slice(0, 3).map(Number);
          if (out.some((n) => !Number.isFinite(n) || n < lo || n > hi)) fail(400, `${label} ต้องเป็นตัวเลข ${lo}–${hi}`);
          return out;
        };
        const tpm = nums(b.tpm, 'ค่า TPM', 0, 60);
        if (!tpm.length) fail(400, 'กรุณากรอกค่า TPM อย่างน้อย 1 ค่า');
        const temps = nums(b.temps, 'อุณหภูมิน้ำมัน', -10, 300);
        if (!['PASS', 'FAIL', 'NA'].includes(b.temp_result)) fail(400, 'กรุณาเลือกผลอุณหภูมิ (ผ่าน / ไม่ผ่าน / N/A)');
        if (b.temp_result !== 'NA' && !temps.length) fail(400, 'กรุณากรอกอุณหภูมิน้ำมัน หรือเลือก N/A พร้อมเหตุผล');
        const tpmMax = Math.max(...tpm);
        const result = tpmMax >= 25 || b.temp_result === 'FAIL' ? 'FAIL' : tpmMax >= 20 ? 'WATCH' : 'PASS';
        const note = txt(b.note, 500), action = txt(b.action, 500);
        if (b.temp_result === 'NA' && !note) fail(400, 'เลือก N/A ต้องระบุเหตุผลในหมายเหตุ');
        if (result === 'WATCH' && !note) fail(400, 'TPM 20–25% อยู่ในช่วงเฝ้าระวัง กรุณาบันทึกการประเมิน');
        if (result === 'FAIL' && !action) fail(400, 'กรุณาบันทึกสิ่งที่ทำทันที (หยุดใช้ / กักกัน / เปลี่ยนน้ำมัน)');
        const rec = {
          check_date: b.check_date, check_time: nz(b.check_time), stage: b.stage, line: txt(b.line, 100), oil_type: txt(b.oil_type, 60),
          tank: txt(b.tank, 60), tpm: JSON.stringify(tpm), tpm_max: tpmMax, temps: JSON.stringify(temps), temp_result: b.temp_result,
          tpm_meter: txt(b.tpm_meter, 40), thermometer: txt(b.thermometer, 40), result, action, note, inspector: user.display_name,
        };
        const STAGE_TH = { BEFORE: 'ก่อนการผลิต', DURING: 'ระหว่างการผลิต', AFTER: 'หลังการผลิต' };
        for (let attempt = 0; ; attempt++) {
          const chkId = await dayId(DB, 'oil_checks', 'chk_id', 'OIL', rec.check_date);
          const ncrId = result === 'FAIL' && AUTO_NCR ? await nextId(DB, 'ncr_records', 'ncr_id', 'NCR') : null;
          const stmts = [];
          if (ncrId) {
            const why = [tpmMax >= 25 ? `TPM ${tpmMax}% (เกณฑ์ < 25%)` : '', b.temp_result === 'FAIL' ? `อุณหภูมิน้ำมัน ${temps.join(' / ')} °C ไม่ตรง Spec` : ''].filter(Boolean);
            stmts.push(autoNcrStmt(DB, user, ncrId, {
              source_type: 'IN_PROCESS', source_ref: chkId, process_ref: 'PC0006', severity: 'Major',
              found_date: rec.check_date, found_time: rec.check_time, lot_no: rec.tank,
              parameter_id: 'FM-QC-005', parameter_name: 'คุณภาพน้ำมันทอด (TPM) / อุณหภูมิน้ำมัน',
              critical_limit: 'TPM < 25% (ประกาศ สธ.) · อุณหภูมิตาม WI ของผลิตภัณฑ์', actual_result: why.join('\n'),
              nc_description: [`น้ำมันทอดไม่ผ่านเกณฑ์ (FM-QC-005 บันทึก ${chkId} · ${STAGE_TH[b.stage]})`, ...why,
                rec.line ? `ผลิตภัณฑ์/ไลน์: ${rec.line}` : '', rec.oil_type ? `ชนิดน้ำมัน: ${rec.oil_type}` : '', rec.tank ? `ถัง/Lot: ${rec.tank}` : '', note ? `หมายเหตุ: ${note}` : '']
                .filter(Boolean).join('\n').slice(0, 2000),
              immediate_action: `หยุดใช้และกักกันน้ำมัน (HOLD) — ${action}`.slice(0, 1000),
            }));
          }
          const cols = Object.keys(rec);
          stmts.push(DB.prepare(`INSERT INTO oil_checks (chk_id,uid,${cols.join(',')},ncr_id,created_by,created_at) VALUES (?,?,${cols.map(() => '?').join(',')},?,?,?)`)
            .bind(chkId, uid, ...cols.map((k) => rec[k]), ncrId, user.username, nowIso()));
          try { await DB.batch(stmts); } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await DB.prepare('SELECT chk_id, result, ncr_id FROM oil_checks WHERE uid=?').bind(uid).first();
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'oil_check', chkId, { stage: b.stage, tpm_max: tpmMax, result, ncr_id: ncrId });
          if (ncrId) await audit(DB, user.username, 'user', 'create', 'ncr', ncrId, { source_type: 'IN_PROCESS', oil_check: chkId });
          return json({ chk_id: chkId, result, ncr_id: ncrId }, 201);
        }
      }
      const ov = path.match(/^\/api\/oil\/(OIL-\d{6}-\d{3,})\/verify$/);
      if (ov && method === 'POST') {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่ทวนสอบได้');
        const b = await body();
        if (!['APPROVE', 'REJECT'].includes(b.decision)) fail(400, 'กรุณาเลือก APPROVE หรือ REJECT');
        if (b.decision === 'REJECT' && blank(b.note)) fail(400, 'REJECT ต้องระบุเหตุผล');
        const row = await DB.prepare('SELECT chk_id, verified_by FROM oil_checks WHERE chk_id=?').bind(ov[1]).first();
        if (!row) fail(404, 'ไม่พบบันทึก');
        if (row.verified_by) fail(409, 'บันทึกนี้ทวนสอบแล้ว');
        await DB.prepare('UPDATE oil_checks SET verified_by=?, verified_at=?, verify_decision=?, verify_note=? WHERE chk_id=?')
          .bind(user.display_name, nowIso(), b.decision, txt(b.note, 500), row.chk_id).run();
        await audit(DB, user.username, 'user', 'verify', 'oil_check', row.chk_id, { decision: b.decision });
        return json({ success: true });
      }

      // ===== PSP QUALITY APP: refrigerator / freezer temperature (FM-QC-006) =====
      if (path === '/api/cold/units' && method === 'GET') {
        return json((await DB.prepare('SELECT * FROM cold_units ORDER BY active DESC, area, unit_id').all()).results);
      }
      const cu = path.match(/^\/api\/cold\/units(?:\/([A-Za-z0-9_-]{1,30}))?$/);
      if (cu && (method === 'POST' || (method === 'PATCH' && cu[1]))) {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่จัดการทะเบียนตู้ได้');
        const b = await body();
        const row = cu[1] ? await DB.prepare('SELECT * FROM cold_units WHERE unit_id=?').bind(cu[1]).first() : null;
        if (method === 'PATCH' && !row) fail(404, 'ไม่พบตู้');
        const id = method === 'POST' ? String(b.unit_id || '').trim().toUpperCase() : row.unit_id;
        if (method === 'POST') {
          if (!/^[A-Z0-9_-]{2,30}$/.test(id)) fail(400, 'รหัสตู้ (Equipment ID) ใช้ A-Z 0-9 - _ ยาว 2–30 ตัว');
          if (await DB.prepare('SELECT 1 FROM cold_units WHERE unit_id=?').bind(id).first()) fail(409, 'มีรหัสตู้นี้แล้ว');
        }
        const next = { ...(row || { active: 1 }) };
        for (const [k, n] of [['name', 100], ['setting', 40], ['thermometer', 40]]) if (k in b || !row) next[k] = txt(b[k], n);
        if ('area' in b || !row) next.area = b.area;
        if ('unit_type' in b || !row) next.unit_type = b.unit_type;
        if (!['RM', 'WIP', 'FG'].includes(next.area)) fail(400, 'กรุณาเลือกพื้นที่ (RM / WIP / FG)');
        if (!['CHILL', 'FREEZE'].includes(next.unit_type)) fail(400, 'กรุณาเลือกชนิดตู้ (Chill / Freeze)');
        if (blank(next.name)) fail(400, 'กรุณาระบุชื่อ/ตำแหน่งตู้');
        // Limits default to the SOP values for the type; QA may tighten them per product specification.
        const def = next.unit_type === 'CHILL' ? { spec_min: 0, spec_max: 5, escalate_at: 8 } : { spec_min: null, spec_max: -18, escalate_at: -12 };
        for (const k of ['spec_min', 'spec_max', 'escalate_at']) {
          if (k in b) next[k] = blank(b[k]) ? (k === 'spec_min' ? null : def[k]) : Number(b[k]);
          else if (!row || ('unit_type' in b && b.unit_type !== row.unit_type)) next[k] = def[k];
          if (next[k] !== null && !Number.isFinite(next[k])) fail(400, 'ค่าเกณฑ์อุณหภูมิต้องเป็นตัวเลข');
        }
        if (next.spec_min !== null && next.spec_min > next.spec_max) fail(400, 'ค่าต่ำสุดมากกว่าค่าสูงสุด');
        if (next.escalate_at <= next.spec_max) fail(400, 'Escalation Limit ต้องสูงกว่าค่าสูงสุดของเกณฑ์');
        if ('calib_due' in b || !row) { if (!blank(b.calib_due) && !isDate(b.calib_due)) fail(400, 'วันครบกำหนดสอบเทียบไม่ถูกต้อง'); next.calib_due = nz(b.calib_due); }
        if ('active' in b) next.active = b.active ? 1 : 0;
        const fields = ['name', 'area', 'unit_type', 'setting', 'spec_min', 'spec_max', 'escalate_at', 'thermometer', 'calib_due', 'active'];
        if (method === 'POST') {
          await DB.prepare(`INSERT INTO cold_units (unit_id,${fields.join(',')},updated_by,updated_at) VALUES (?,${fields.map(() => '?').join(',')},?,?)`)
            .bind(id, ...fields.map((k) => next[k] ?? null), user.username, nowIso()).run();
          await audit(DB, user.username, 'user', 'create', 'cold_unit', id, { name: next.name, unit_type: next.unit_type });
          return json({ success: true, unit_id: id }, 201);
        }
        const changes = diff(row, next, fields);
        if (Object.keys(changes).length) {
          await DB.prepare(`UPDATE cold_units SET ${fields.map((k) => `${k}=?`).join(',')}, updated_by=?, updated_at=? WHERE unit_id=?`)
            .bind(...fields.map((k) => next[k] ?? null), user.username, nowIso(), id).run();
          await audit(DB, user.username, 'user', 'update', 'cold_unit', id, changes);
        }
        return json({ success: true });
      }
      if (path === '/api/cold/readings' && method === 'GET') {
        const sp = url.searchParams, where = ['1=1'], p = [];
        if (sp.get('unit_id')) { where.push('unit_id=?'); p.push(sp.get('unit_id')); }
        if (isDate(sp.get('from'))) { where.push('read_date>=?'); p.push(sp.get('from')); }
        if (isDate(sp.get('to'))) { where.push('read_date<=?'); p.push(sp.get('to')); }
        const { results } = await DB.prepare(`SELECT * FROM cold_readings WHERE ${where.join(' AND ')} ORDER BY read_date DESC, rd_id DESC LIMIT 2000`).bind(...p).all();
        return json(results.map((r) => ({ ...r, limits: JSON.parse(r.limits), condition: r.condition ? JSON.parse(r.condition) : null, actions: r.actions ? JSON.parse(r.actions) : [] })));
      }
      if (path === '/api/cold/readings' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT rd_id, status, ncr_id FROM cold_readings WHERE uid=?').bind(uid).first();
        if (done) return json(done);
        const unit = await DB.prepare('SELECT * FROM cold_units WHERE unit_id=?').bind(String(b.unit_id || '')).first();
        if (!unit) fail(400, 'กรุณาเลือกตู้');
        if (!unit.active) fail(409, 'ตู้นี้ปิดการใช้งานแล้ว');
        if (!isDate(b.read_date) || b.read_date > today()) fail(400, 'กรุณาระบุวันที่ (ไม่เป็นวันในอนาคต)');
        if (!['08:00', '11:00', '15:00', '17:00', 'RECHECK'].includes(b.slot)) fail(400, 'กรุณาเลือกรอบเวลาที่ตรวจ');
        if (!blank(b.read_time) && !isTime(b.read_time)) fail(400, 'รูปแบบเวลาไม่ถูกต้อง');
        if (b.slot !== 'RECHECK' && await DB.prepare('SELECT 1 FROM cold_readings WHERE unit_id=? AND read_date=? AND slot=?').bind(unit.unit_id, b.read_date, b.slot).first()) {
          fail(409, `ตู้นี้บันทึกรอบ ${b.slot} ของวันนี้แล้ว ถ้าวัดซ้ำให้เลือกรอบ "ตรวจซ้ำ"`);
        }
        if (blank(b.temp) || !Number.isFinite(Number(b.temp))) fail(400, 'กรุณากรอกอุณหภูมิที่อ่านได้');
        const temp = Number(b.temp);
        if (temp < -60 || temp > 60) fail(400, 'อุณหภูมิอยู่นอกช่วงที่เป็นไปได้ (-60 ถึง 60 °C)');
        const status = temp > unit.escalate_at ? 'ESCALATE' : (temp > unit.spec_max || (unit.spec_min !== null && temp < unit.spec_min)) ? 'FAIL' : 'PASS';
        // Condition check of the unit: required with the first reading of the day.
        const CONDITION = ['clean', 'door', 'gasket', 'water', 'ice', 'general'];
        let condition = null;
        if (b.condition && typeof b.condition === 'object') {
          condition = {};
          for (const k of CONDITION) { const v = b.condition[k]; if (v !== 'P' && v !== 'F') fail(400, 'กรุณาตรวจสภาพตู้ให้ครบ 6 ข้อ'); condition[k] = v; }
        }
        if (b.slot === '08:00' && !condition) fail(400, 'รอบ 08:00 ต้องตรวจสภาพตู้ 6 ข้อด้วย');
        const condFail = condition && Object.values(condition).includes('F');
        const ACTIONS = ['RECHECK', 'NOTIFY', 'ENGINEERING', 'HOLD', 'TRANSFER'];
        const actions = (Array.isArray(b.actions) ? b.actions : []).filter((a) => ACTIONS.includes(a));
        const note = txt(b.note, 500), affected = txt(b.affected, 300);
        if (status !== 'PASS' && !actions.length) fail(400, 'อุณหภูมินอกเกณฑ์ กรุณาเลือกการดำเนินการเบื้องต้น');
        if (status === 'ESCALATE' && !actions.includes('NOTIFY')) fail(400, 'เกิน Escalation Limit ต้องแจ้งหัวหน้างาน / QA');
        if ((status !== 'PASS' || condFail) && !note) fail(400, 'กรุณาระบุสาเหตุเบื้องต้นหรือความผิดปกติในหมายเหตุ');
        if (actions.includes('HOLD') && !affected) fail(400, 'กักสินค้า (HOLD) ต้องระบุสินค้า / Lot ที่ได้รับผลกระทบ');
        const calibExpired = unit.calib_due && unit.calib_due < b.read_date ? 1 : 0;
        const limits = { spec_min: unit.spec_min, spec_max: unit.spec_max, escalate_at: unit.escalate_at, unit_type: unit.unit_type };
        const ACT_TH = { RECHECK: 'ตรวจซ้ำ', NOTIFY: 'แจ้งหัวหน้างาน/QA', ENGINEERING: 'แจ้งวิศวกรรม', HOLD: 'กักสินค้า (HOLD)', TRANSFER: 'ย้ายไปที่จัดเก็บที่เหมาะสม' };
        const specTxt = unit.spec_min !== null ? `${unit.spec_min}–${unit.spec_max} °C` : `≤ ${unit.spec_max} °C`;
        for (let attempt = 0; ; attempt++) {
          const rdId = await dayId(DB, 'cold_readings', 'rd_id', 'TMP', b.read_date, 4);
          const ncrId = status === 'ESCALATE' && AUTO_NCR ? await nextId(DB, 'ncr_records', 'ncr_id', 'NCR') : null;
          const stmts = [];
          if (ncrId) {
            stmts.push(autoNcrStmt(DB, user, ncrId, {
              source_type: unit.area === 'WIP' ? 'IN_PROCESS' : 'WAREHOUSE', source_ref: rdId,
              severity: 'Major', found_date: b.read_date, found_time: nz(b.read_time), hold_location: unit.unit_id,
              parameter_id: 'FM-QC-006', parameter_name: `อุณหภูมิ${unit.unit_type === 'CHILL' ? 'ตู้เย็น' : 'ตู้แช่แข็ง'} ${unit.unit_id}`,
              critical_limit: `เกณฑ์ ${specTxt} · Escalation > ${unit.escalate_at} °C`, actual_result: `${temp} °C`,
              material_name: affected, lot_no: affected,
              nc_description: [`Temperature Deviation: ${unit.unit_id} ${unit.name} (${unit.area}) อ่านได้ ${temp} °C เกิน Escalation Limit ${unit.escalate_at} °C — บันทึก ${rdId}`,
                `รอบ ${b.slot}${b.read_time ? ' เวลา ' + b.read_time : ''} · เทอร์โมมิเตอร์ ${unit.thermometer || '-'}${calibExpired ? ' (หมดอายุสอบเทียบ)' : ''}`,
                affected ? `สินค้า/Lot ที่ได้รับผลกระทบ: ${affected}` : '', `สาเหตุเบื้องต้น: ${note}`].filter(Boolean).join('\n').slice(0, 2000),
              immediate_action: actions.map((a) => ACT_TH[a]).join(' · ').slice(0, 1000),
              suggestion: 'QA ประเมิน Time × Temperature Exposure และตัดสินการจัดการสินค้า (RELEASE / TRANSFER / REWORK / DISPOSE)',
            }));
          }
          stmts.push(DB.prepare(`INSERT INTO cold_readings (rd_id,uid,unit_id,read_date,slot,read_time,temp,limits,status,condition,thermometer,calib_expired,actions,affected,note,ncr_id,inspector,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rdId, uid, unit.unit_id, b.read_date, b.slot, nz(b.read_time), temp, JSON.stringify(limits), status,
            condition ? JSON.stringify(condition) : null, unit.thermometer, calibExpired, actions.length ? JSON.stringify(actions) : null, affected, note, ncrId,
            user.display_name, user.username, nowIso()));
          try { await DB.batch(stmts); } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) {
              const again = await DB.prepare('SELECT rd_id, status, ncr_id FROM cold_readings WHERE uid=?').bind(uid).first();
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'cold_reading', rdId, { unit_id: unit.unit_id, temp, status, ncr_id: ncrId });
          if (ncrId) await audit(DB, user.username, 'user', 'create', 'ncr', ncrId, { source: 'FM-QC-006', cold_reading: rdId });
          return json({ rd_id: rdId, status, ncr_id: ncrId, calib_expired: calibExpired }, 201);
        }
      }

      fail(404, `Not found: ${method} ${path}`);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(`[ERR] ${method} ${path}:`, e.message);
      return json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
    }
  },
};

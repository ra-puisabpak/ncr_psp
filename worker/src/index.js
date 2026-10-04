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
const COND_ROLES = new Set(['QA_MANAGER', 'FSTL', 'SUPERVISOR', 'QC']); // who may receive material with conditions

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

async function createUser(DB, { username, display_name, role, password }, by) {
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail(400, 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3–32 ตัว');
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

// ---------- Smart QA: control points ----------
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
function evaluate(params, values) {
  const out = {}, failed = [];
  for (const p of params) {
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

// ---------- router ----------
export default {
  async fetch(req, env) {
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
        return json({ token, expires_at: expires, user: { username, display_name: u.display_name, role: u.role } });
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
        return json({ username: user.username, display_name: user.display_name, role: user.role });
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
        if ('display_name' in b && !blank(b.display_name)) { sets.push('display_name=?'); vals.push(String(b.display_name).trim()); }
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
        if (!sets.length) fail(400, 'ไม่มีข้อมูลให้แก้ไข');
        if (target.role === 'QA_MANAGER' && ((b.role && b.role !== 'QA_MANAGER') || b.active === false || b.active === 0)) {
          const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='QA_MANAGER' AND active=1 AND username<>?").bind(target.username).first();
          if (n === 0) fail(400, 'ต้องมี QA Manager ที่ใช้งานได้อย่างน้อย 1 คน');
        }
        vals.push(target.username);
        const stmts = [DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE username=?`).bind(...vals)];
        if ('password' in b || b.active === false || b.active === 0) stmts.push(DB.prepare('DELETE FROM sessions WHERE username=?').bind(target.username));
        await DB.batch(stmts);
        await audit(DB, user.username, 'user', 'update', 'user', target.username, ch);
        return json({ success: true });
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
        const first = await nextId(DB, 'ncr_records', 'ncr_id', 'NCR');
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
          for (const id of ncIds) await audit(DB, user.username, 'user', 'create', 'ncr', id, { source_type: 'RM_RECEIVING', receiving_doc: docNo });
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
          try { await DB.batch([ncrFromNc(id, String(nc.docNo), nc, prec), ncInsert(id, uid, String(nc.docNo), nc)]); } catch (e) {
            if (attempt < 3 && /UNIQUE|PRIMARY/i.test(e.message)) continue;
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'ncr', id, { source_type: 'RM_RECEIVING', receiving_doc: nc.docNo, fail_type: nc.failType });
          return json({ id }, 201);
        }
      }
      const rn = path.match(/^\/api\/recv-nc\/(NC\d{3,6}|NCR-\d{4}-\d{3,})$/);
      if (rn && method === 'PATCH') {
        need(user, WRITERS);
        const b = await body();
        const row = await DB.prepare('SELECT status, ncr_id, closed_date FROM recv_nc WHERE nc_id=?').bind(rn[1]).first();
        if (!row) fail(404, 'ไม่พบ NC นี้');
        if (rn[1].startsWith('NCR-')) fail(409, 'NC นี้คือ NCR ในระบบ NCR e-Form ให้แก้ไขและปิดในระบบ NCR e-Form');
        const next = { ...row };
        if ('ncrId' in b) {
          if (!blank(b.ncrId) && !/^NCR-\d{4}-\d{3,}$/.test(String(b.ncrId))) fail(400, 'รูปแบบเลข NCR ไม่ถูกต้อง');
          next.ncr_id = nz(b.ncrId);
        }
        if (b.status === 'Closed' && row.status !== 'Closed') { next.status = 'Closed'; next.closed_date = today(); }
        const changes = diff(row, next, ['status', 'ncr_id', 'closed_date']);
        if (Object.keys(changes).length) {
          await DB.prepare('UPDATE recv_nc SET status=?, ncr_id=?, closed_date=?, updated_by=?, updated_at=? WHERE nc_id=?')
            .bind(next.status, next.ncr_id, next.closed_date, user.username, nowIso(), rn[1]).run();
          await audit(DB, user.username, 'user', next.status !== row.status ? 'close' : 'update', 'recv_nc', rn[1], changes);
        }
        return json({ success: true, status: next.status, closedDate: next.closed_date || '', ncrId: next.ncr_id || '' });
      }

      // ===== Smart QA: control point register =====
      if (path === '/api/control-points' && method === 'GET') {
        const { results } = await DB.prepare("SELECT * FROM control_points ORDER BY status='RETIRED', process_ref, cp_id").all();
        return json(results.map(cpRow));
      }
      if (path === '/api/control-points' && method === 'POST') {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่เพิ่มจุดควบคุมได้');
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
        await audit(DB, user.username, 'user', 'create', 'control_point', id, { name: rec.name, cp_type: rec.cp_type });
        return json({ success: true, cp_id: id }, 201);
      }
      const cpm = path.match(/^\/api\/control-points\/([A-Z][A-Z0-9]{1,5}-[A-Z0-9-]{1,20})$/);
      if (cpm && method === 'PATCH') {
        need(user, QA, 'เฉพาะ QA Manager / FSTL เท่านั้นที่แก้ไขจุดควบคุมได้');
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

      // ===== Smart QA: monitoring records =====
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
        return json({ date: day, total, fail: failCount, pass: total - failCount, byCp,
          ncrOpen: ncr?.open || 0, ncrProcessOpen: ncr?.process || 0, recent });
      }
      if (path === '/api/qc' && method === 'POST') {
        need(user, WRITERS);
        const b = await body();
        const uid = recvUid(b.uid);
        const done = await DB.prepare('SELECT rec_id, result, ncr_id FROM qc_records WHERE uid=?').bind(uid).first();
        if (done) return json(done); // the same save arriving twice
        const cp = cpRow(await DB.prepare('SELECT * FROM control_points WHERE cp_id=?').bind(String(b.cp_id || '')).first());
        if (!cp) fail(404, 'ไม่พบจุดควบคุม');
        if (cp.status === 'RETIRED') fail(409, 'จุดควบคุมนี้ยกเลิกการใช้งานแล้ว');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.record_date || ''))) fail(400, 'กรุณาระบุวันที่ตรวจ');
        if (b.record_date > today()) fail(400, 'วันที่ตรวจต้องไม่เป็นวันในอนาคต');
        if (!blank(b.record_time) && !/^\d{2}:\d{2}$/.test(String(b.record_time))) fail(400, 'รูปแบบเวลาไม่ถูกต้อง');
        if (blank(b.batch_no) || String(b.batch_no).length > 60) fail(400, 'กรุณาระบุเลขที่ Batch');
        if (cp.products.length && !cp.products.includes(String(b.product_code || ''))) fail(400, 'ผลิตภัณฑ์นี้ไม่อยู่ในขอบเขตของจุดควบคุม');
        const { values, failed } = evaluate(cp.params, b.values);
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
          const ncrId = failed.length ? (await nextId(DB, 'ncr_records', 'ncr_id', 'NCR')) : null;
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
              if (again) return json(again);
              continue;
            }
            throw e;
          }
          await audit(DB, user.username, 'user', 'create', 'qc_record', recId, { cp_id: cp.cp_id, batch_no: rec.batch_no, result, ncr_id: ncrId });
          if (ncrId) await audit(DB, user.username, 'user', 'create', 'ncr', ncrId, { source_type: cp.cp_type === 'CCP' ? 'CCP' : 'IN_PROCESS', qc_record: recId });
          return json({ rec_id: recId, result, ncr_id: ncrId, failed }, 201);
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

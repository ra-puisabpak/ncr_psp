-- Puisabpak NCR e-Form — database schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('QA_MANAGER','FSTL','QC','SUPERVISOR','VIEWER')),
  pass_hash     TEXT NOT NULL,
  salt          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ncr_records (
  ncr_id            TEXT PRIMARY KEY,
  issue_date        TEXT NOT NULL,
  lot_no            TEXT,
  product_lot_no    TEXT,
  found_date        TEXT,
  found_time        TEXT,
  reported_by       TEXT,
  process_ref       TEXT,
  source_type       TEXT CHECK(source_type IN ('RM_RECEIVING','IN_PROCESS','CCP','FINAL_QC','WAREHOUSE','COMPLAINT','AUDIT','MAINTENANCE','FOOD_DEFENSE','FOOD_FRAUD','OTHER')) DEFAULT 'IN_PROCESS',
  source_ref        TEXT,
  material_code     TEXT,
  material_name     TEXT,
  supplier_id       TEXT,
  supplier_name     TEXT,
  parameter_id      TEXT,
  parameter_name    TEXT,
  critical_limit    TEXT,
  actual_result     TEXT,
  visual_check      TEXT,
  nc_description    TEXT NOT NULL,
  severity          TEXT CHECK(severity IN ('Critical','Major','Minor')) DEFAULT 'Major',
  allergen          TEXT,
  immediate_action  TEXT,
  suggestion        TEXT,
  defect_qty        REAL,
  defect_unit       TEXT,
  hold_location     TEXT,
  shipped_status    TEXT CHECK(shipped_status IN ('NOT_SHIPPED','SHIPPED')) DEFAULT 'NOT_SHIPPED',
  shipped_qty       REAL,
  shipped_customer  TEXT,
  recall_required   INTEGER,
  disposition       TEXT CHECK(disposition IN ('RELEASE','REWORK','SORT','DOWNGRADE','RETURN_SUPPLIER','DESTROY','RECALL') OR disposition IS NULL),
  disposition_reason TEXT,
  dispositioned_by  TEXT,
  dispositioned_at  TEXT,
  root_cause        TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  assignee          TEXT,
  target_date       TEXT,
  reply_date        TEXT,
  supplier_reply_by TEXT,
  supplier_reply_at TEXT,
  verification_result TEXT CHECK(verification_result IN ('Pending','Effective','Not Effective')) DEFAULT 'Pending',
  verification_note TEXT,
  verified_by       TEXT,
  verified_at       TEXT,
  status            TEXT NOT NULL CHECK(status IN ('Open','In Investigation','Pending Verification','Closed','Cancelled')) DEFAULT 'Open',
  status_reason     TEXT,
  closed_date       TEXT,
  closed_by         TEXT,
  days_open         INTEGER,
  related_capa_id   TEXT,
  photo_urls        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        TEXT NOT NULL,
  updated_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ncr_status ON ncr_records(status);
CREATE INDEX IF NOT EXISTS idx_ncr_issue ON ncr_records(issue_date);

CREATE TABLE IF NOT EXISTS capa_actions (
  capa_id       TEXT PRIMARY KEY,
  source        TEXT DEFAULT 'NCR',
  source_ref    TEXT,
  description   TEXT NOT NULL,
  detail        TEXT,
  priority      TEXT CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')) DEFAULT 'MEDIUM',
  severity_label TEXT DEFAULT 'Major',
  responsible_person TEXT,
  target_date   TEXT,
  actual_completion TEXT,
  why1 TEXT, why2 TEXT, why3 TEXT, why4 TEXT, why5 TEXT,
  root_cause_summary TEXT,
  root_cause_analysis TEXT,
  fishbone_man TEXT, fishbone_machine TEXT, fishbone_material TEXT,
  fishbone_method TEXT, fishbone_environment TEXT, fishbone_measurement TEXT,
  containment_action TEXT,
  corrective_action  TEXT,
  preventive_action  TEXT,
  effectiveness_criteria   TEXT,
  effectiveness_check_date TEXT,
  effectiveness_result TEXT CHECK(effectiveness_result IN ('Effective','Not Effective','Partially Effective','Pending') OR effectiveness_result IS NULL),
  verified_by TEXT, verified_date TEXT,
  approved_by TEXT, approved_date TEXT,
  closed_by   TEXT, closed_date   TEXT,
  supplier_reply_by TEXT, supplier_reply_at TEXT,
  status TEXT CHECK(status IN ('Draft','Open','Root Cause Analysis','Action Planning','Implementation','Verification','Effectiveness Check','Closed Effective','Closed Not Effective','Cancelled')) DEFAULT 'Open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_capa_src ON capa_actions(source_ref);

-- Photos attached to an NCR (resized on the phone before upload, stored as base64).
CREATE TABLE IF NOT EXISTS ncr_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  data         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'internal' CHECK(source IN ('internal','supplier')),
  kind         TEXT NOT NULL DEFAULT 'problem' CHECK(kind IN ('problem','correction')),
  removed      INTEGER NOT NULL DEFAULT 0,
  removed_by   TEXT,
  removed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_ncr ON ncr_photos(ncr_id);

-- Reply links sent to a supplier: one NCR or one CAPA each. Only the hash of the token is stored.
CREATE TABLE IF NOT EXISTS supplier_links (
  token_hash  TEXT PRIMARY KEY,
  entity      TEXT NOT NULL CHECK(entity IN ('ncr','capa')),
  entity_id   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sl_entity ON supplier_links(entity, entity_id);

-- Append-only history of every change. The API never updates or deletes rows here.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  actor       TEXT NOT NULL,
  actor_type  TEXT NOT NULL CHECK(actor_type IN ('user','supplier','system')),
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  changes     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- Receiving inspection records (FM-QC-001). `data` is the app's own JSON without the photos.
CREATE TABLE IF NOT EXISTS recv_records (
  doc_no      TEXT PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,
  recv_date   TEXT NOT NULL,
  supplier    TEXT NOT NULL,
  inspector   TEXT NOT NULL,
  result      TEXT NOT NULL CHECK(result IN ('PASS','HOLD','REJECT')),
  data        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recv_date ON recv_records(recv_date);

CREATE TABLE IF NOT EXISTS recv_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no       TEXT NOT NULL,
  mat_idx      INTEGER NOT NULL,
  slot         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  data         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(doc_no, mat_idx, slot)
);

-- NC log of the receiving app. `ncr_id` is the NCR opened for it in the NCR e-Form.
CREATE TABLE IF NOT EXISTS recv_nc (
  nc_id       TEXT PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,
  doc_no      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Closed')),
  ncr_id      TEXT,
  closed_date TEXT,
  data        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recv_nc_doc ON recv_nc(doc_no);

-- Documents handed over for printing: kept for a few minutes, opened by a one-off address (only its hash is stored).
CREATE TABLE IF NOT EXISTS print_docs (
  token_hash TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  chunk      TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token_hash, seq)
);

-- ===== Smart QA: control points and in-process QC records =====
-- Register of HACCP control points. Limits live here, not in code, so the HACCP Team can set them
-- once validated; status DRAFT means the limits are provisional ("รอ validate").
-- params: JSON list of checks, each {key,label,type:'number'|'check',unit?,min?,max?}.
CREATE TABLE IF NOT EXISTS control_points (
  cp_id        TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  process_ref  TEXT,
  hazard       TEXT,
  cp_type      TEXT NOT NULL DEFAULT 'TBD' CHECK(cp_type IN ('CCP','OPRP','PRP','TBD')),
  status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','RETIRED')),
  products     TEXT,
  params       TEXT NOT NULL,
  monitoring   TEXT,
  frequency    TEXT,
  corrective_action TEXT,
  verification TEXT,
  form_code    TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One monitoring record per check. Kept as entered (append-only); the server decides PASS/FAIL
-- against the limits in force (cp_version), and a FAIL opens an NCR in the same write.
CREATE TABLE IF NOT EXISTS qc_records (
  rec_id       TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  cp_id        TEXT NOT NULL,
  cp_version   INTEGER NOT NULL,
  cp_status    TEXT NOT NULL,
  record_date  TEXT NOT NULL,
  record_time  TEXT,
  shift        TEXT,
  product_code TEXT,
  product_name TEXT,
  batch_no     TEXT NOT NULL,
  result       TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  "values"     TEXT NOT NULL,
  failed       TEXT,
  note         TEXT,
  ncr_id       TEXT,
  inspector    TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_date ON qc_records(record_date);
CREATE INDEX IF NOT EXISTS idx_qc_batch ON qc_records(batch_no);
CREATE INDEX IF NOT EXISTS idx_qc_cp ON qc_records(cp_id);

-- Starting register, taken from HACCP CCP/OPRP Decision Tree Rev.01 (น้ำพริก คลอง 9).
-- Every entry is DRAFT: the plan has not approved any CCP yet and the limits still need validation.
INSERT OR IGNORE INTO control_points (cp_id,name,process_ref,hazard,cp_type,status,products,params,monitoring,frequency,corrective_action,verification,created_by,created_at,updated_by,updated_at) VALUES
('CP-HEAT','การให้ความร้อน (ผัด/กวน)','PC0007','B – จุลินทรีย์ก่อโรค','TBD','DRAFT','["FG0001","FG0002","FG0003","FG0005"]',
 '[{"key":"core_temp","label":"อุณหภูมิผลิตภัณฑ์","type":"number","unit":"°C","min":85},{"key":"hold_min","label":"เวลาที่คงอุณหภูมิ","type":"number","unit":"นาที","min":120},{"key":"thermometer","label":"ใช้เทอร์โมมิเตอร์ที่สอบเทียบแล้ว","type":"check"}]',
 'วัดอุณหภูมิและจับเวลาด้วยเทอร์โมมิเตอร์/นาฬิกาที่สอบเทียบแล้ว','ทุก Batch / ตาม WI','หยุดกระบวนการ กักกัน Batch ประเมินตามเกณฑ์ deviation ห้ามปล่อยจนกว่า QA ตัดสิน','สอบเทียบเครื่องมือ + ทบทวนบันทึก + Thermal validation','system',datetime('now'),'system',datetime('now')),
('CP-COOL','การพักให้เย็น','PC0009','B – การเจริญของจุลินทรีย์','TBD','DRAFT',NULL,
 '[{"key":"end_temp","label":"อุณหภูมิเมื่อสิ้นสุดการพัก","type":"number","unit":"°C"},{"key":"cool_min","label":"เวลาที่ใช้พัก","type":"number","unit":"นาที"}]',
 'วัดอุณหภูมิและเวลาตาม Cooling Profile','ทุก Batch','กักกัน Batch และประเมินความเสี่ยง','Cooling profile verification','system',datetime('now'),'system',datetime('now')),
('CP-BONE','การคัดก้างปลา','PC0003','P – ก้างปลา','TBD','DRAFT','["FG0005","FG0008"]',
 '[{"key":"no_bone","label":"ไม่พบก้างเกินเกณฑ์ยอมรับ","type":"check"},{"key":"sample_g","label":"น้ำหนักตัวอย่างที่ตรวจ","type":"number","unit":"กรัม"}]',
 'ตรวจด้วยวิธีที่อนุมัติ','ตาม WI','หยุดและคัดแยกซ้ำ 100% กักกันผลิตภัณฑ์ที่เกี่ยวข้อง','Trend + ประสิทธิผลของวิธีตรวจ','system',datetime('now'),'system',datetime('now')),
('CP-ALLERGEN','Line clearance สารก่อภูมิแพ้ (กุ้ง)','PC0008','C – สารก่อภูมิแพ้','TBD','DRAFT','["FG0002"]',
 '[{"key":"formula","label":"วัตถุดิบตรงตามสูตรที่อนุมัติ","type":"check"},{"key":"label","label":"ฉลากระบุสารก่อภูมิแพ้ถูกต้อง","type":"check"},{"key":"line_clean","label":"ทำความสะอาดไลน์ก่อนเปลี่ยนสินค้าแล้ว","type":"check"}]',
 'ตรวจสูตร ฉลาก และ Line clearance ตาม Checklist','ทุก Batch / ทุกครั้งที่เปลี่ยนสินค้า','หยุดไลน์ กักกันสินค้า แก้ไขฉลากเมื่อ QA อนุมัติเท่านั้น','Line clearance / cleaning verification','system',datetime('now'),'system',datetime('now')),
('CP-VEG','การควบคุมมังสวิรัติ','PC0005','C – ปนเปื้อนวัตถุดิบที่ไม่ใช่มังสวิรัติ','TBD','DRAFT','["FG0003","FG0012"]',
 '[{"key":"approved_list","label":"ใช้เฉพาะวัตถุดิบใน Approved Ingredient List","type":"check"},{"key":"line_clean","label":"Line clearance ก่อนผลิตแล้ว","type":"check"}]',
 'ตรวจวัตถุดิบและ Line clearance ตาม Checklist','ทุก Batch / ทุกครั้งที่เปลี่ยนสินค้า','กักกัน ประเมินความเสี่ยงโดย QA','Vegetarian verification','system',datetime('now'),'system',datetime('now')),
('CP-SEAL','การซีลซอง / ปิดฝา','PC0008','B/P – การปนเปื้อนหลังการให้ความร้อน','TBD','DRAFT',NULL,
 '[{"key":"seal_ok","label":"ซีลสมบูรณ์ ไม่รั่ว / ฝาปิดแน่น","type":"check"},{"key":"position","label":"ช่วงที่ตรวจ (ต้น/กลาง/ท้าย Batch)","type":"text"}]',
 'ตรวจด้วยสายตาและวิธีทดสอบที่ validate แล้ว','ต้น / กลาง / ท้าย Batch','หยุดเครื่อง แยกช่วงผลิตที่เกี่ยวข้อง','Seal/closure verification','system',datetime('now'),'system',datetime('now'));

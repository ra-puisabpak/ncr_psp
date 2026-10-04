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

-- Register from QP-HA-001 HACCP Manual Rev.01 (draft), sheet 7 "CCP-OPRP Control Plan".
-- Every entry is DRAFT: the manual awaits approval and the limits await validation (V-01 to V-12).
-- Limits marked "รอ Validation" are left open; values the manual states (Rev.00) are kept as provisional limits.
-- Group A (heat at CCP-01): FG0001 FG0002 FG0003 FG0005 · Group B (fried, mixed without heat): FG0007 FG0008 FG0009 FG0010.
INSERT OR IGNORE INTO control_points (cp_id,name,process_ref,hazard,cp_type,status,products,params,monitoring,frequency,corrective_action,verification,form_code,created_by,created_at,updated_by,updated_at) VALUES
('CCP-01','ผัดคลุกเคล้าและฆ่าเชื้อ (M01) — กลุ่ม A','PC0007','B – เชื้อก่อโรครอดชีวิตหากอุณหภูมิ/เวลาไม่เพียงพอ','CCP','DRAFT','["FG0001","FG0002","FG0003","FG0005"]',
 '[{"key":"temp_start","label":"อุณหภูมิแกนกลางเมื่อเริ่มนับเวลา (จุดร้อนช้าที่สุด)","type":"number","unit":"°C","min":85},{"key":"temp_min","label":"อุณหภูมิต่ำสุดที่วัดได้ระหว่างคงอุณหภูมิ (ทุก 30 นาที อย่างน้อย 2 จุด)","type":"number","unit":"°C","min":85},{"key":"temp_end","label":"อุณหภูมิแกนกลางเมื่อสิ้นสุด","type":"number","unit":"°C","min":85},{"key":"hold_min","label":"เวลาคงอุณหภูมิ นับเมื่อถึง 85°C","type":"number","unit":"นาที","min":120},{"key":"thermo_ok","label":"เทอร์โมมิเตอร์ผ่านการตรวจด้วยน้ำแข็ง (0°C) วันนี้","type":"check"},{"key":"times","label":"เวลาเริ่ม – สิ้นสุดการคงอุณหภูมิ","type":"text"}]',
 'Probe Thermometer ที่สอบเทียบแล้ว แทงวัดอย่างน้อย 2 จุด ณ จุดร้อนช้าที่สุด และนาฬิกาจับเวลา','ทุก Batch: เมื่อเริ่มนับเวลา ทุก 30 นาที และเมื่อสิ้นสุด (บันทึกสรุป 1 รายการต่อ Batch)',
 'อุณหภูมิต่ำกว่าเกณฑ์: เพิ่มความร้อนและเริ่มนับเวลาใหม่จนครบ 120 นาที หากทำไม่ได้ HOLD ทั้ง Batch ห้ามส่งผ่าน Pass Box แจ้งหัวหน้า QA ตัดสิน (ให้ความร้อนซ้ำหรือทำลาย) หาสาเหตุ เทอร์โมมิเตอร์ไม่ผ่านการตรวจประจำวัน: กักกันทุก Batch นับจากการตรวจครั้งล่าสุดที่ผ่าน',
 'QA ทบทวนและลงนามบันทึกทุกวันก่อนปล่อยสินค้า · ตรวจเทอร์โมมิเตอร์ด้วยน้ำแข็งทุกวัน สอบเทียบภายนอกปีละครั้ง · วิเคราะห์จุลินทรีย์ตามแผน · Validation V-01',NULL,'system',datetime('now'),'system',datetime('now')),
('CCP-02','ทอดและเจียว (M02) — กลุ่ม B (เสนอ)','PC0006','B – เชื้อก่อโรคในหอม กระเทียม พริก รอดชีวิตหากอุณหภูมิน้ำมัน/เวลาไม่พอ','CCP','DRAFT','["FG0007","FG0008","FG0009","FG0010"]',
 '[{"key":"oil_temp","label":"อุณหภูมิน้ำมันต่ำสุดขณะทอด (เกณฑ์รอ Validation V-03)","type":"number","unit":"°C"},{"key":"shallot_min","label":"เวลาเจียวหอม","type":"number","unit":"นาที","min":16},{"key":"garlic_min","label":"เวลาเจียวกระเทียม","type":"number","unit":"นาที","min":8},{"key":"chili_min","label":"เวลาทอดพริก","type":"number","unit":"นาที","min":2},{"key":"thermo_ok","label":"เทอร์โมมิเตอร์วัดน้ำมันผ่านการสอบเทียบ","type":"check"}]',
 'เทอร์โมมิเตอร์วัดน้ำมันที่สอบเทียบแล้ว และนาฬิกาจับเวลา','ทุกครั้งที่ทอด (บันทึกสรุป 1 รายการต่อ Batch)',
 'ไม่ถึงเกณฑ์: ทอดต่อจนครบ หากผสมไปแล้ว HOLD ทั้ง Batch แจ้ง QA ตัดสิน ออก NCR',
 'QA ทบทวนบันทึกทุกวัน · สอบเทียบเทอร์โมมิเตอร์ · วิเคราะห์จุลินทรีย์ตามแผน · Validation V-03, V-12',NULL,'system',datetime('now'),'system',datetime('now')),
('OPRP-01','Allergen Control — จัดเก็บ ลำดับการผลิต/การล้าง และฉลาก',NULL,'A – สารก่อภูมิแพ้ปนเปื้อนข้าม / ฉลากไม่แสดงสารก่อภูมิแพ้ (ขั้นตอน 1-5, 9, 11)','OPRP','DRAFT',NULL,
 '[{"key":"storage","label":"วัตถุดิบ Allergen อยู่ในห้อง Allergen เท่านั้น มีป้ายชี้บ่ง","type":"check"},{"key":"sequence","label":"ผลิตและล้างตามลำดับ (มังสวิรัติ/เจก่อน กลุ่ม Allergen ล้างลำดับสุดท้ายของวัน)","type":"check"},{"key":"clean","label":"หลังเปลี่ยนสูตร ผิวสัมผัสอาหารสะอาดด้วยสายตา","type":"check"},{"key":"label","label":"ฉลากตรงกับสูตรที่บรรจุ และแสดงสารก่อภูมิแพ้ครบตามสูตรที่ใช้จริง","type":"check"},{"key":"changeover","label":"สูตรก่อนหน้า → สูตรที่ผลิต","type":"text"}]',
 'ตรวจเทียบตารางการผลิต ตรวจด้วยสายตา และตรวจฉลากเทียบสูตร','ทุกวัน และทุกครั้งที่เปลี่ยนสูตร',
 'จัดเก็บผิดห้อง: ย้ายทันที ตรวจการปนเปื้อน · ล้างหรือผลิตผิดลำดับ: Deep Cleaning ก่อนผลิตสูตรมังสวิรัติ · ผลิตภัณฑ์ที่ผลิตระหว่างเบี่ยงเบน: HOLD ให้ QA ประเมิน · ฉลากผิด: HOLD ติดฉลากใหม่ หากปล่อยแล้วเข้าขั้นตอนเรียกคืน',
 'QA สุ่มตรวจพื้นที่จัดเก็บ · Swab Test โปรตีนตกค้างหลังเปลี่ยนสูตร · Validation V-09','FM-RA-08','system',datetime('now'),'system',datetime('now')),
('OPRP-02','Foreign Body Control — ใบมีดเครื่องบด/สับ (M05-M09)','PC0004','P – เศษโลหะจากใบมีดสึกหรอหรือแตกหัก (ขั้นตอน 5)','OPRP','DRAFT',NULL,
 '[{"key":"machine","label":"เครื่อง (M05-M09)","type":"text"},{"key":"before_ok","label":"ใบมีดสมบูรณ์ ไม่บิ่น ไม่แตกหัก ก่อนใช้งาน","type":"check"},{"key":"after_ok","label":"ใบมีดสมบูรณ์ ไม่บิ่น ไม่แตกหัก หลังใช้งาน","type":"check"},{"key":"count_ok","label":"จำนวนใบมีดครบตามทะเบียนใบมีด","type":"check"}]',
 'ถอดตรวจใบมีดด้วยสายตา เทียบทะเบียนใบมีด','ก่อนและหลังใช้งานทุกกะ',
 'พบใบมีดบิ่น/หักหลังใช้งาน: HOLD ผลิตภัณฑ์ทุก Batch นับจากการตรวจครั้งล่าสุดที่ผ่าน ค้นหาเศษโลหะให้ครบ เปลี่ยนใบมีดทันที QA ตัดสินการจัดการผลิตภัณฑ์',
 'QA สุ่มตรวจประสิทธิภาพการตรวจใบมีด (ปัจจุบันควบคุมด้วยสายตาเท่านั้น)',NULL,'system',datetime('now'),'system',datetime('now')),
('OPRP-03','วัตถุดิบเสี่ยงสารพิษทนความร้อน — ฮีสตามีน อะฟลาท็อกซิน (เสนอ)','PC0001','C – ฮีสตามีนในปลา อะฟลาท็อกซินในพริกแห้ง ถั่ว เครื่องเทศ (ขั้นตอน 1)','OPRP','DRAFT',NULL,
 '[{"key":"avl","label":"ผู้ขายอยู่ใน AVL","type":"check"},{"key":"coa","label":"มี COA ตามความถี่ที่กำหนด","type":"check"},{"key":"histamine","label":"ฮีสตามีน (วัตถุดิบปลา) ตาม COA — เกณฑ์ตาม SD-QC รอยืนยัน","type":"number","unit":"mg/kg"},{"key":"aflatoxin","label":"อะฟลาท็อกซินทั้งหมด ตาม COA (รอยืนยันกับประกาศ สธ.)","type":"number","unit":"µg/kg","max":20},{"key":"temp","label":"อุณหภูมิรับเข้าปลาแช่เย็น/แช่แข็ง (เกณฑ์รอยืนยัน)","type":"number","unit":"°C"}]',
 'ตรวจ COA เทียบข้อกำหนด วัดอุณหภูมิ ตรวจพินิจตาม WI-QC-001 (ใช้ร่วมกับ FM-QC-001)','ทุกล็อตที่รับเข้า (ใส่เลขล็อตวัตถุดิบในช่อง Batch)',
 'ไม่ผ่านเกณฑ์หรือไม่มี COA: ปฏิเสธการรับ หรือ HOLD รอผลวิเคราะห์ แจ้งผู้ขายแก้ไข (CAR) ทบทวนสถานะผู้ขายใน AVL',
 'ส่งวิเคราะห์ห้องปฏิบัติการภายนอกอย่างน้อยปีละครั้งต่อผู้ขาย · ประเมินผู้ขายประจำปี · Validation V-08','FM-QC-001','system',datetime('now'),'system',datetime('now')),
('OPRP-04','การคัดก้างปลา (เสนอ)','PC0003','P – ก้างปลา (แมคเคอเรล ปลาย่าง) (ขั้นตอน 3)','OPRP','DRAFT','["FG0005","FG0008"]',
 '[{"key":"no_bone","label":"QC สุ่มตรวจซ้ำไม่พบก้างปลาที่เป็นอันตราย (เกณฑ์ขนาด/จำนวนรอ V-07)","type":"check"},{"key":"sample_g","label":"ปริมาณที่สุ่มตรวจ","type":"number","unit":"กรัม"}]',
 'ตรวจพินิจและใช้มือสัมผัสบนถาดสีตัดกับเนื้อปลา แสงสว่างเพียงพอ','ทุก Batch (100% โดยพนักงาน) และ QC สุ่มตรวจซ้ำ',
 'QC สุ่มพบก้าง: คัดซ้ำทั้ง Batch แล้วสุ่มตรวจใหม่ พบซ้ำ: ทบทวนวิธีการและอบรมพนักงาน',
 'QC สุ่มตรวจซ้ำและบันทึก · ทบทวนข้อร้องเรียนเรื่องก้างปลา · Validation V-07',NULL,'system',datetime('now'),'system',datetime('now')),
('OPRP-05','เวลาและอุณหภูมิช่วงผึ่งเย็น บรรจุ และปิดฝา (เสนอ)','PC0009','B – สปอร์ทนความร้อนงอกและเจริญ / การปนเปื้อนซ้ำ (ขั้นตอน 7, 9, 10)','OPRP','DRAFT','["FG0001","FG0002","FG0003","FG0005"]',
 '[{"key":"to_cap_min","label":"เวลาตั้งแต่สิ้นสุด CCP-01 ถึงปิดฝา/ซีลเสร็จ (เกณฑ์รอ V-05)","type":"number","unit":"นาที"},{"key":"fill_temp","label":"อุณหภูมิผลิตภัณฑ์ขณะบรรจุ (ต้องต่ำกว่า 60°C)","type":"number","unit":"°C","max":59.9},{"key":"cap_temp","label":"อุณหภูมิขณะปิดฝา (Rev.00 กำหนด 45°C รอ V-05)","type":"number","unit":"°C"},{"key":"chilled","label":"นำเข้าจัดเก็บแช่เย็น (ระหว่างรอผล V-04, V-11)","type":"check"}]',
 'บันทึกเวลาจากนาฬิกา และวัดอุณหภูมิด้วย Probe Thermometer','ทุก Batch',
 'เกินเวลาที่กำหนด: HOLD ทั้ง Batch แจ้ง QA ตัดสิน (ให้ความร้อนซ้ำที่ CCP-01 หรือทำลาย) หาสาเหตุ',
 'QA ทบทวนบันทึกทุกวัน · วิเคราะห์จุลินทรีย์และ aw ตามแผน · Validation V-04, V-05, V-11',NULL,'system',datetime('now'),'system',datetime('now')),
('OPRP-06','ค่า aw ผลิตภัณฑ์สำเร็จรูป — กลุ่ม B (เสนอ)','PC0012','B – เชื้อก่อโรคและสปอร์เจริญระหว่างเก็บรักษาหาก aw สูง (ขั้นตอน 12B)','OPRP','DRAFT','["FG0007","FG0008","FG0009","FG0010"]',
 '[{"key":"aw","label":"ค่า aw ผลิตภัณฑ์สำเร็จรูป (เสนอ ≤ 0.85 รอกำหนด)","type":"number","max":0.85},{"key":"meter_ok","label":"เครื่องวัด aw ผ่านการสอบเทียบ","type":"check"}]',
 'เครื่องวัด aw ที่สอบเทียบแล้ว (บันทึกคู่กับ QC_10)','ทุก Batch ก่อนปล่อยสินค้า',
 'เกินเกณฑ์: HOLD ทั้ง Batch QA ตัดสิน (ทอดซ้ำ ปรับสูตร หรือทำลาย) ทบทวนเวลาทอดและอัตราส่วนสูตร',
 'QA ทบทวนผลทุก Batch · สอบเทียบเครื่องวัด aw · Validation V-04, V-12','QC_10','system',datetime('now'),'system',datetime('now'));

-- The first register (before QP-HA-001 Rev.01) is retired, but only entries nobody has edited yet.
INSERT INTO audit_log (ts,actor,actor_type,action,entity,entity_id,changes)
 SELECT datetime('now'),'system','system','update','control_point',cp_id,'{"status":{"from":"DRAFT","to":"RETIRED"},"reason":"แทนด้วยทะเบียนตาม QP-HA-001 Rev.01"}'
   FROM control_points WHERE cp_id IN ('CP-HEAT','CP-COOL','CP-BONE','CP-ALLERGEN','CP-VEG','CP-SEAL') AND updated_by='system' AND status='DRAFT';
UPDATE control_points SET status='RETIRED', version=version+1, updated_at=datetime('now')
 WHERE cp_id IN ('CP-HEAT','CP-COOL','CP-BONE','CP-ALLERGEN','CP-VEG','CP-SEAL') AND updated_by='system' AND status='DRAFT';

-- ===== Smart QA: finished-goods release =====
-- Which control points must have a passing record for a batch before QA may release it.
-- Kept apart from control_points so the seeds below never overwrite a choice QA has made.
CREATE TABLE IF NOT EXISTS cp_release (
  cp_id            TEXT PRIMARY KEY,
  release_required INTEGER NOT NULL DEFAULT 0
);
-- Per-batch points in QP-HA-001 sheet 7: CCP-01, CCP-02, OPRP-04, OPRP-05, OPRP-06.
INSERT OR IGNORE INTO cp_release (cp_id, release_required) VALUES
 ('CCP-01',1),('CCP-02',1),('OPRP-01',0),('OPRP-02',0),('OPRP-03',0),('OPRP-04',1),('OPRP-05',1),('OPRP-06',1);

-- QA decision on one finished-goods batch. `gate` is the state of every requirement when the
-- decision was taken; `rm_lots` the raw-material lots used, for tracing forward and back.
CREATE TABLE IF NOT EXISTS fg_releases (
  rel_id       TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL,
  product_name TEXT,
  batch_no     TEXT NOT NULL,
  decision     TEXT NOT NULL CHECK(decision IN ('RELEASE','HOLD','REJECT')),
  qty          REAL,
  unit         TEXT,
  mfg_date     TEXT,
  exp_date     TEXT,
  rm_lots      TEXT,
  checks       TEXT,
  gate         TEXT NOT NULL,
  note         TEXT,
  decided_by   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_batch ON fg_releases(batch_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_once ON fg_releases(product_code, batch_no) WHERE decision = 'RELEASE';

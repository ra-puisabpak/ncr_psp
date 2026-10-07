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

-- ===== PSP QUALITY APP: control points and in-process QC records =====
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

-- Finished-goods pH and aw per batch: data for shelf-life validation and the risk grouping (pH > 4.6, aw > 0.85).
-- Record only until QA sets limits from the shelf-life study; not needed for release.
INSERT OR IGNORE INTO control_points (cp_id,name,process_ref,hazard,cp_type,status,products,params,monitoring,frequency,corrective_action,verification,form_code,created_by,created_at,updated_by,updated_at) VALUES
('VER-01','ค่า pH และ aw ผลิตภัณฑ์สำเร็จรูป (ทวนสอบอายุสินค้า)',NULL,'B – เชื้อก่อโรค ยีสต์ และราเจริญระหว่างเก็บรักษา เมื่อ pH > 4.6 และ aw > 0.85','PRP','DRAFT','["FG0001","FG0002","FG0003","FG0004","FG0005","FG0006","FG0007","FG0008","FG0009","FG0010","FG0011","FG0012","FG0014"]',
 '[{"key":"ph","label":"ค่า pH ผลิตภัณฑ์สำเร็จรูป (บันทึกค่า — เกณฑ์รอผล Shelf life study)","type":"number"},{"key":"aw","label":"ค่า aw ผลิตภัณฑ์สำเร็จรูป (บันทึกค่า — เกณฑ์รอผล Shelf life study)","type":"number"},{"key":"aw_temp","label":"อุณหภูมิตัวอย่างขณะวัด aw","type":"number","unit":"°C"},{"key":"meter_ok","label":"เครื่องวัด pH และ aw ผ่านการสอบเทียบ","type":"check"},{"key":"source","label":"วัดที่ (QC ภายใน หรือชื่อห้องปฏิบัติการ และเลขที่รายงาน)","type":"text"}]',
 'pH meter และเครื่องวัด aw ที่สอบเทียบแล้ว หรือส่งห้องปฏิบัติการภายนอก','ทุก Batch หรือตามแผนสุ่มที่ QA กำหนด',
 'ค่าผิดปกติจากที่เคยวัดของสูตรเดียวกัน: แจ้ง QA ทบทวนสูตร กระบวนการ และอายุสินค้า',
 'QA ทบทวนแนวโน้มรายเดือน · ใช้ประกอบ Shelf life study และการจัดกลุ่มความเสี่ยงในแผน HACCP',NULL,'system',datetime('now'),'system',datetime('now'));

-- The first register (before QP-HA-001 Rev.01) is retired, but only entries nobody has edited yet.
INSERT INTO audit_log (ts,actor,actor_type,action,entity,entity_id,changes)
 SELECT datetime('now'),'system','system','update','control_point',cp_id,'{"status":{"from":"DRAFT","to":"RETIRED"},"reason":"แทนด้วยทะเบียนตาม QP-HA-001 Rev.01"}'
   FROM control_points WHERE cp_id IN ('CP-HEAT','CP-COOL','CP-BONE','CP-ALLERGEN','CP-VEG','CP-SEAL') AND updated_by='system' AND status='DRAFT';
UPDATE control_points SET status='RETIRED', version=version+1, updated_at=datetime('now')
 WHERE cp_id IN ('CP-HEAT','CP-COOL','CP-BONE','CP-ALLERGEN','CP-VEG','CP-SEAL') AND updated_by='system' AND status='DRAFT';

-- ===== PSP QUALITY APP: finished-goods release =====
-- Which control points must have a passing record for a batch before QA may release it.
-- Kept apart from control_points so the seeds below never overwrite a choice QA has made.
CREATE TABLE IF NOT EXISTS cp_release (
  cp_id            TEXT PRIMARY KEY,
  release_required INTEGER NOT NULL DEFAULT 0
);
-- Per-batch points in QP-HA-001 sheet 7: CCP-01, CCP-02, OPRP-04, OPRP-05, OPRP-06.
INSERT OR IGNORE INTO cp_release (cp_id, release_required) VALUES
 ('CCP-01',1),('CCP-02',1),('OPRP-01',0),('OPRP-02',0),('OPRP-03',0),('OPRP-04',1),('OPRP-05',1),('OPRP-06',1);
INSERT OR IGNORE INTO cp_release (cp_id, release_required) VALUES ('VER-01',0);

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

-- ===== PSP QUALITY APP: personal hygiene check before work (GHPs) =====
-- Check items: QA edits the wording; `critical` items, when failed, keep the person out of production.
CREATE TABLE IF NOT EXISTS hyg_items (
  item_key   TEXT PRIMARY KEY,
  sort       INTEGER NOT NULL,
  label      TEXT NOT NULL,
  note       TEXT,
  pass_desc  TEXT,
  fail_desc  TEXT,
  critical   INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- The 12 items of the hygiene check app used before, plus health status (Codex CXC 1-1969, personal hygiene: health status).
INSERT OR IGNORE INTO hyg_items (item_key,sort,label,note,pass_desc,fail_desc,critical,updated_by,updated_at) VALUES
('H01',1,'หมวกคลุมผม / หมวก','คลุมผมมิดชิด สะอาด ไม่มีขุย','คลุมผมมิดชิด · สะอาด · ไม่มีขุย / เส้นผมออกนอกหมวก','ผมออกนอกหมวก · หมวกสกปรก · ไม่สวมหมวก',0,'system',datetime('now')),
('H02',2,'ผ้าปิดจมูก / หน้ากาก','ปิดจมูกและปากมิดชิด สะอาด กระชับ','ปิดจมูกและปากมิดชิด · สะอาด · กระชับพอดี','ไม่สวมหน้ากาก · หน้ากากหย่อน/สกปรก · ปิดไม่มิดชิด',0,'system',datetime('now')),
('H03',3,'ผ้ากันเปื้อน','สะอาด ไม่เปื้อน ไม่มีรอยขาด','สะอาด · ไม่เปื้อน · ไม่มีรอยขาด','ผ้ากันเปื้อนสกปรก / เปื้อน / ขาด / ไม่สวม',0,'system',datetime('now')),
('H04',4,'ถุงมือ','สะอาด ไม่มีรอยขาด เหมาะกับงาน','สะอาด · ไม่มีรอยขาด · เหมาะกับประเภทงาน','ถุงมือสกปรก / ขาด / ไม่เหมาะกับงาน / ไม่สวม',0,'system',datetime('now')),
('H05',5,'รองเท้า / รองเท้าบูท','สะอาด ไม่แตก/หลุด อยู่ในสภาพดี','สะอาด · ไม่แตกหรือหลุด · อยู่ในสภาพพร้อมใช้งาน','รองเท้าสกปรก / แตก / ชำรุด / ไม่สวมรองเท้า',0,'system',datetime('now')),
('H06',6,'ความสะอาดของชุดทำงาน','ไม่มีคราบ เรียบร้อย พร้อมเข้าพื้นที่ผลิต','ชุดสะอาด · ไม่มีคราบ · เรียบร้อยพร้อมเข้าพื้นที่ผลิต','ชุดสกปรก / มีคราบ / ขาด / ไม่เรียบร้อย',0,'system',datetime('now')),
('H07',7,'เล็บมือ','ตัดสั้น สะอาด ไม่ทาสี ไม่มีเล็บปลอม','เล็บตัดสั้น · สะอาด · ไม่ทาสีเล็บ · ไม่มีเล็บปลอม','เล็บยาว / ทาสีเล็บ / ติดเล็บปลอม',0,'system',datetime('now')),
('H08',8,'เครื่องประดับ','ไม่มีแหวน กำไล ต่างหู นาฬิกา','ไม่สวมแหวน · ไม่ใส่กำไล / ต่างหู / นาฬิกา','สวมแหวน / กำไล / ต่างหู / นาฬิกา เข้าพื้นที่ผลิต',0,'system',datetime('now')),
('H09',9,'น้ำหอม','ไม่ใช้น้ำหอม / สเปรย์ฉีดตัวก่อนเข้างาน','ไม่ใช้น้ำหอมหรือสเปรย์ฉีดตัวก่อนเข้าพื้นที่ผลิต','ฉีดน้ำหอม / สเปรย์ก่อนเข้าพื้นที่ผลิต',0,'system',datetime('now')),
('H10',10,'ขนมขบเคี้ยว','ไม่นำขนม อาหาร หรือเครื่องดื่มเข้าพื้นที่ผลิต','ไม่พกขนม / อาหาร / เครื่องดื่มเข้าพื้นที่ผลิต','พกขนม / อาหาร / เครื่องดื่มเข้าพื้นที่ผลิต',0,'system',datetime('now')),
('H11',11,'ของใช้ส่วนตัว','ไม่พกโทรศัพท์ กุญแจ หรือของใช้ส่วนตัวเข้าพื้นที่ผลิต','ไม่พกโทรศัพท์ / กุญแจ / ของใช้ส่วนตัวเข้าพื้นที่','พกโทรศัพท์ / กุญแจ / ของใช้ส่วนตัวเข้าพื้นที่ผลิต',0,'system',datetime('now')),
('H12',12,'การล้างมือ','ล้างมือครบขั้นตอน ใช้น้ำยาฆ่าเชื้อ ก่อนเข้าพื้นที่ผลิต','ล้างมือครบขั้นตอน · ใช้น้ำยาฆ่าเชื้อ','ไม่ล้างมือ / ล้างมือไม่ครบขั้นตอน / ไม่ใช้น้ำยาฆ่าเชื้อ',0,'system',datetime('now')),
('H13',13,'สุขภาพ / บาดแผล','ไม่มีอาการท้องเสีย อาเจียน ไข้ ไอ เจ็บคอ ตัวเหลือง ตาเหลือง หรือแผลเปิด/ติดเชื้อที่มือ แขน หน้า','ไม่มีอาการเจ็บป่วย · แผลเล็กปิดด้วยพลาสเตอร์สีและถุงมือ','มีอาการเจ็บป่วยที่ติดต่อทางอาหาร / แผลเปิดหรือติดเชื้อ',1,'system',datetime('now'));

CREATE TABLE IF NOT EXISTS hyg_employees (
  emp_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  dept       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One check of one person. `items` keeps the wording in force at the time, so an old record reads the same after QA edits the list.
CREATE TABLE IF NOT EXISTS hyg_records (
  rec_id       TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  inspect_date TEXT NOT NULL,
  inspect_time TEXT,
  shift        TEXT,
  emp_id       INTEGER NOT NULL,
  emp_name     TEXT NOT NULL,
  dept         TEXT,
  results      TEXT NOT NULL,
  items        TEXT NOT NULL,
  result       TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  failed       TEXT,
  action       TEXT CHECK(action IN ('CORRECTED','EXCLUDED') OR action IS NULL),
  note         TEXT,
  inspector    TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hyg_date ON hyg_records(inspect_date);
CREATE INDEX IF NOT EXISTS idx_hyg_emp ON hyg_records(emp_id);

-- ===== PSP QUALITY APP: frying oil quality and temperature (FM-QC-07 Rev.02) =====
-- TPM is judged by the server: <20% normal, 20–<25% watch, >=25% not to be used (Ministry of Public Health limit 25%).
-- Oil temperature follows the product WI, so the inspector judges it (PASS / FAIL / NA with a reason).
CREATE TABLE IF NOT EXISTS oil_checks (
  chk_id       TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  check_date   TEXT NOT NULL,
  check_time   TEXT,
  stage        TEXT NOT NULL CHECK(stage IN ('BEFORE','DURING','AFTER')),
  line         TEXT,
  oil_type     TEXT,
  tank         TEXT,
  tpm          TEXT NOT NULL,
  tpm_max      REAL NOT NULL,
  temps        TEXT,
  temp_result  TEXT NOT NULL CHECK(temp_result IN ('PASS','FAIL','NA')),
  tpm_meter    TEXT,
  thermometer  TEXT,
  result       TEXT NOT NULL CHECK(result IN ('PASS','WATCH','FAIL')),
  action       TEXT,
  note         TEXT,
  ncr_id       TEXT,
  inspector    TEXT NOT NULL,
  verified_by  TEXT,
  verified_at  TEXT,
  verify_decision TEXT CHECK(verify_decision IN ('APPROVE','REJECT') OR verify_decision IS NULL),
  verify_note  TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oil_date ON oil_checks(check_date);

-- ===== PSP QUALITY APP: refrigerator and freezer temperature (FM-QC-05 Rev.02) =====
-- Units and their limits. Defaults per SOP-QC-XX: chill 0–5 °C (escalate >8), freeze <= -18 °C (escalate > -12).
CREATE TABLE IF NOT EXISTS cold_units (
  unit_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  area         TEXT NOT NULL CHECK(area IN ('RM','WIP','FG')),
  unit_type    TEXT NOT NULL CHECK(unit_type IN ('CHILL','FREEZE')),
  setting      TEXT,
  spec_min     REAL,
  spec_max     REAL NOT NULL,
  escalate_at  REAL NOT NULL,
  thermometer  TEXT,
  calib_due    TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One reading. status: PASS in spec, FAIL out of spec (recheck), ESCALATE past the escalation limit (NCR opened).
CREATE TABLE IF NOT EXISTS cold_readings (
  rd_id        TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  unit_id      TEXT NOT NULL,
  read_date    TEXT NOT NULL,
  slot         TEXT NOT NULL CHECK(slot IN ('08:00','11:00','15:00','17:00','RECHECK')),
  read_time    TEXT,
  temp         REAL NOT NULL,
  limits       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK(status IN ('PASS','FAIL','ESCALATE')),
  condition    TEXT,
  thermometer  TEXT,
  calib_expired INTEGER NOT NULL DEFAULT 0,
  actions      TEXT,
  affected     TEXT,
  note         TEXT,
  ncr_id       TEXT,
  inspector    TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cold_unit_date ON cold_readings(unit_id, read_date);


-- ===== PSP QUALITY APP: production formulas and raw-material weighing (PD_03 Rev.01) =====
-- Weights per one set, in kg (liquids counted 1 ml = 1 g). DRAFT until QA confirms against the registered formula.
-- tolerance_pct: allowed deviation of each weighed item from its target; NULL = not yet set (weighing only warns).
CREATE TABLE IF NOT EXISTS formulas (
  product_code  TEXT PRIMARY KEY,
  product_name  TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
  tolerance_pct REAL,
  items         TEXT NOT NULL,
  source        TEXT,
  updated_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
-- Starting formulas: the actual weights of the latest PD_03 of each product (summary prepared 04/10/2026).
INSERT OR IGNORE INTO formulas (product_code,product_name,version,status,tolerance_pct,items,source,updated_by,updated_at) VALUES
('FG0001','น้ำพริกปลาร้าพริกสด',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 20.02}, {"name": "กระเทียม", "target": 20.12}, {"name": "พริกขี้หนูสด", "target": 20.08}, {"name": "ปลาร้า", "target": 4.5}, {"name": "พริกแห้งคั่ว", "target": 0.5}, {"name": "น้ำปลา", "target": 1.0}, {"name": "ชูรส", "target": 0.7, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "เกลือ", "target": 1.4}, {"name": "โปแตสเซียม", "target": 0.15, "note": "วัตถุเจือปนอาหาร — ยืนยันชนิด ปริมาณสูงสุดตามประกาศ สธ. และการแสดงบนฉลาก"}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0002','น้ำพริกตาแดงมันกุ้ง',1,'DRAFT',NULL,'[{"name": "หอมแขก", "target": 20.3}, {"name": "กระเทียม", "target": 20.28}, {"name": "พริกแห้งคั่ว", "target": 2.1}, {"name": "กุ้ง", "target": 0.8}, {"name": "น้ำมัน", "target": 3.0}, {"name": "น้ำปลา", "target": 1.7}, {"name": "กะปิ", "target": 0.5}, {"name": "น้ำตาลปี๊บ", "target": 1.4}, {"name": "มะขามเปียก", "target": 1.6}, {"name": "ชูรส", "target": 0.7, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "เกลือ", "target": 0.6}, {"name": "เบนโซเอต", "target": 0.07, "note": "วัตถุเจือปนอาหาร — ยืนยันชนิด ปริมาณสูงสุดตามประกาศ สธ. และการแสดงบนฉลาก"}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0003','น้ำพริกเห็ดหอมมังสวิรัติ',1,'DRAFT',NULL,'[{"name": "หอมแขก", "target": 19.22}, {"name": "กระเทียม", "target": 19.31}, {"name": "พริกแห้งคั่ว", "target": 0.7}, {"name": "เห็ดหอม", "target": 5.0}, {"name": "น้ำมัน", "target": 3.0}, {"name": "ซีอิ๊วขาว", "target": 1.5}, {"name": "แม็กกี้", "target": 0.5}, {"name": "เกลือ", "target": 0.8}, {"name": "ชูรส", "target": 0.9, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "เบนโซเอต", "target": 0.08, "note": "วัตถุเจือปนอาหาร — ยืนยันชนิด ปริมาณสูงสุดตามประกาศ สธ. และการแสดงบนฉลาก"}, {"name": "น้ำตาลปี๊บ", "target": 3.5}, {"name": "มะขามเปียก", "target": 0.55}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0004','น้ำพริกหมูเสวย',1,'DRAFT',NULL,'[{"name": "หอมแขก", "target": 15.3}, {"name": "กระเทียม", "target": 15.1}, {"name": "พริกแห้งคั่ว", "target": 5.8}, {"name": "หมูบด", "target": 46.51}, {"name": "น้ำมัน", "target": 5.0}, {"name": "น้ำปลา", "target": 6.2}, {"name": "น้ำตาลปี๊บ", "target": 1.2}, {"name": "ชูรส", "target": 0.95, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "โปแตสเซียม", "target": 0.09, "note": "วัตถุเจือปนอาหาร — ยืนยันชนิด ปริมาณสูงสุดตามประกาศ สธ. และการแสดงบนฉลาก"}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0005','น้ำพริกปลาย่างพลัส',1,'DRAFT',NULL,'[{"name": "หอมแขก", "target": 30.14}, {"name": "กระเทียม", "target": 30.47}, {"name": "พริกแห้งคั่ว", "target": 6.5}, {"name": "ปลาย่างป่น", "target": 5.0}, {"name": "น้ำมัน", "target": 6.5}, {"name": "น้ำปลา", "target": 4.0}, {"name": "น้ำตาลปี๊บ", "target": 1.7}, {"name": "ชูรส", "target": 0.8, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "เกลือ", "target": 1.0}, {"name": "โปแตสเซียม", "target": 0.09, "note": "วัตถุเจือปนอาหาร — ยืนยันชนิด ปริมาณสูงสุดตามประกาศ สธ. และการแสดงบนฉลาก"}, {"name": "มะขามเปียก", "target": 0.7}]','ใบชั่ง PD_03 วันที่ 25/09/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0006','น้ำปลาหวานแซ่บ',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 13.0}, {"name": "พริกจินดา", "target": 3.5}, {"name": "พริกป่น", "target": 1.0}, {"name": "กุ้งป่น", "target": 6.0}, {"name": "กุ้งใหญ่เปลือก", "target": 2.0}, {"name": "กุ้งใหญ่", "target": 1.0}, {"name": "น้ำปลา", "target": 3.0}, {"name": "น้ำตาลปี๊บ", "target": 24.0}, {"name": "น้ำตาลทราย", "target": 6.0}, {"name": "เกลือ", "target": 0.15}]','ใบชั่ง PD_03 วันที่ 1/10/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0007','พริกผัดน้ำมันมะกอก สูตรออริจินอล',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 55.01}, {"name": "กระเทียม", "target": 20.253}, {"name": "พริกแห้งไม่มีก้าน", "target": 1.2}, {"name": "พริกแห้งมีก้าน", "target": 0.5}, {"name": "เกลือ", "target": 1.0}, {"name": "ชูรส", "target": 0.9, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "น้ำมันปรุง", "target": 14.5}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (3 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0008','น้ำพริกเผ็ดแมคเคอเรล',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 9.07}, {"name": "กระเทียม", "target": 9.085}, {"name": "พริกแห้งไม่มีก้าน", "target": 3.0}, {"name": "พริกแห้งมีก้าน", "target": 2.5}, {"name": "ปลาทูป่น", "target": 6.0}, {"name": "ปลาย่าง", "target": 0.25}, {"name": "ปลาฉลาด", "target": 0.25}, {"name": "พริกแห้งคั่ว", "target": 0.4}, {"name": "เกลือ", "target": 0.9}, {"name": "ชูรส", "target": 0.6, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "น้ำตาลทรายแดง", "target": 0.6}]','ใบชั่ง PD_03 วันที่ 24/09/2026 (2 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0009','พริกผัดน้ำมันมะกอก สูตรเผ็ด',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 55.01}, {"name": "กระเทียม", "target": 20.35}, {"name": "พริกแห้งไม่มีก้าน", "target": 6.0}, {"name": "พริกแห้งมีก้าน", "target": 1.0}, {"name": "เกลือ", "target": 1.6}, {"name": "ชูรส", "target": 1.6, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "น้ำตาลหล่อ", "target": 0.7}, {"name": "น้ำมันปรุง", "target": 16.0}]','ใบชั่ง PD_03 วันที่ 2/10/2026 (2 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now')),
('FG0010','พริกผัดน้ำมันงา',1,'DRAFT',NULL,'[{"name": "หอมแดง", "target": 55.01}, {"name": "กระเทียม", "target": 20.58}, {"name": "พริกแห้ง", "target": 1.2}, {"name": "งาคั่ว", "target": 1.5}, {"name": "เกลือ", "target": 0.7}, {"name": "ชูรส", "target": 0.7, "note": "ยืนยันว่าอยู่ในสูตรที่ขึ้นทะเบียนและฉลาก"}, {"name": "น้ำตาลหล่อ", "target": 0.4}, {"name": "น้ำมันหอมเจียว", "target": 8.0}, {"name": "น้ำมันงา", "target": 6.0}]','ใบชั่ง PD_03 วันที่ 25/09/2026 (1 ชุด เฉลี่ยต่อชุด) — น้ำหนักที่ชั่งจริง ยังไม่ใช่สูตรที่อนุมัติ','system',datetime('now'));

-- Roasted ground chili: a single ingredient, 100% (100 kg per set).
INSERT OR IGNORE INTO formulas (product_code,product_name,version,status,tolerance_pct,items,source,updated_by,updated_at) VALUES
('FG0011','พริกคั่วป่น 100%',1,'DRAFT',NULL,'[{"name": "พริกแห้ง (เด็ดขั้ว)", "target": 100}]','สูตร 100% (QA Manager)','system','2026-10-07T00:00:00Z');

-- One weighing record (PD_03) of one production batch: every line with its raw-material lot and the weight of each set.
CREATE TABLE IF NOT EXISTS weigh_records (
  wr_id          TEXT PRIMARY KEY,
  uid            TEXT NOT NULL UNIQUE,
  product_code   TEXT NOT NULL,
  product_name   TEXT,
  prod_date      TEXT NOT NULL,
  batch_no       TEXT NOT NULL,
  sets           INTEGER NOT NULL,
  formula_version INTEGER,
  formula_status TEXT,
  tolerance_pct  REAL,
  scale_id       TEXT,
  lines          TEXT NOT NULL,
  deviations     TEXT,
  result         TEXT NOT NULL CHECK(result IN ('PASS','DEVIATION')),
  note           TEXT,
  assessed_by    TEXT,
  weigher        TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE(product_code, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_weigh_date ON weigh_records(prod_date);

-- ===== PSP QUALITY APP: production control (QC_08) =====
-- One record per product batch: frying/roasting, grinding, stirring/heating and cooling, as on the paper form.
-- The control-point records (CCP-01, CCP-02, OPRP-05) are derived from it, so nothing is entered twice;
-- `derived` lists them with their result and any NCR.
CREATE TABLE IF NOT EXISTS prod_controls (
  pc_id        TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL,
  product_name TEXT,
  prod_date    TEXT NOT NULL,
  batch_no     TEXT NOT NULL,
  oil_type     TEXT,
  data         TEXT NOT NULL,
  derived      TEXT,
  result       TEXT NOT NULL CHECK(result IN ('PASS','FAIL','PENDING')),
  note         TEXT,
  ncr_id       TEXT,
  inspector    TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(product_code, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_prodctl_date ON prod_controls(prod_date);

-- ===== Central raw-material register (วัตถุดิบ บรรจุภัณฑ์ วัสดุสิ้นเปลือง) =====
-- One list for the receiving app (FM-QC-001), weighing, traceability and NCRs. QA adds and edits it;
-- nothing is deleted (active = 0 takes an item out of the pick lists, old records still show its name).
CREATE TABLE IF NOT EXISTS materials (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('RM','PM','CM')),
  unit        TEXT,
  cat         TEXT,
  min_temp    REAL,
  max_temp    REAL,
  temp_label  TEXT,
  store       TEXT,
  aql_crop    TEXT CHECK(aql_crop IS NULL OR aql_crop IN ('shallot','garlic','chili')),
  ph_min      REAL,
  ph_max      REAL,
  active      INTEGER NOT NULL DEFAULT 1,
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- Starting list: the 122 items the receiving app carried (OPL crops and receiving pH limits included).
INSERT OR IGNORE INTO materials (code,name,type,unit,cat,min_temp,max_temp,temp_label,store,aql_crop,ph_min,ph_max,active,version,created_by,created_at,updated_by,updated_at) VALUES
('RM-001','หอมแขกจีนปอกเปลือก','RM','กิโลกรัม','OPL',1,4,NULL,'แช่เย็น 1-4°C ปิดฝาสนิท','shallot',5.3,5.8,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-002','หอมแขกปอก','RM','กิโลกรัม','OPL',1,4,NULL,'แช่เย็น 1-4°C ปิดฝาสนิท','shallot',5.3,5.8,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-003','หอมแขกพม่าปอกเปลือก','RM','กิโลกรัม','OPL',1,4,NULL,'แช่เย็น 1-4°C ปิดฝาสนิท','shallot',5.3,5.8,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-004','หอมแขกพม่า(กระเทย)','RM','กิโลกรัม','OPL',NULL,NULL,NULL,'ที่แห้งและเย็น อากาศถ่ายเทสะดวก หรือแช่เย็น 1-4°C','shallot',5.3,5.8,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-005','กระเทียมจีนปอกเปลือก','RM','กิโลกรัม','OPL',1,4,NULL,'แช่เย็น 1-4°C ปิดฝาสนิท','garlic',5.3,6.3,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-006','พริกจินดาแดง เด็ดก้าน','RM','กิโลกรัม','OPL',1,4,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นสะสม','chili',NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-007','พริกแห้ง (เด็ดก้าน)','RM','กิโลกรัม','OPL',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น หลีกเลี่ยงความชื้น','chili',NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-008','พริกแห้ง(ติดก้าน)','RM','กิโลกรัม','OPL',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น หลีกเลี่ยงความชื้น','chili',NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-009','หมูบด','RM','กิโลกรัม','Pork',0,4,NULL,'แช่เย็น 0-4°C (ถุงละ 10 kg)',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-010','ปลากระดี่','RM','กิโลกรัม','Meat',-60,-18,'≤ -18°C','แช่แข็ง ≤ -18°C',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-011','ปลาฉลาด 100% ป่น','RM','กิโลกรัม','Fish Powder',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-012','ปลาทูป่น','RM','กิโลกรัม','Fish Powder',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-013','ปลาย่างป่น','RM','กิโลกรัม','Fish Powder',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-014','ปลาร้าโหน่ง','RM','กิโลกรัม','Fermented',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-015','กะปิ (ถุง)','RM','กิโลกรัม','Fermented',NULL,NULL,NULL,'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-016','กุ้งแห้ง','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-017','กุ้งแห้ง (ตัว)','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-018','กุ้งฝอย(สีชมพู)','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-019','กุ้งแห้งจิ๋ว (ตัว)','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-020','กุ้งฝอย (สีส้ม)','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-021','กุ้งติดเปลือก','RM','กิโลกรัม','Dried Shrimp',NULL,NULL,NULL,'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-022','เห็ดหอม B4','RM','กิโลกรัม','Dried Mushroom',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-023','ซอสแม็กกี้ 5,000 ml','RM','แกลลอน','Sauce',NULL,NULL,NULL,'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-024','ซีอิ๊วขาวเห็ดหอม (ขวดแก้ว)','RM','ขวด','Sauce',NULL,NULL,NULL,'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-025','น้ำปลาทิพรส 4,500 ml','RM','แกลลอน','Sauce',NULL,NULL,NULL,'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-026','มะขามเปียก','RM','กิโลกรัม','Tamarind',NULL,NULL,NULL,'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท เพื่อรักษาคุณภาพ',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-027','น้ำปลาร้า','RM','กิโลกรัม','Sauce',NULL,NULL,NULL,'อุณหภูมิห้อง ปิดฝาสนิท ที่แห้งและเย็น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-028','พริกป่น (แพร่)','RM','กิโลกรัม','Chili Powder',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-029','พริกป่น (งามตา พืชผล)','RM','กิโลกรัม','Chili Powder',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-030','เกลือ','RM','ถุง','Seasoning',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-031','เกลือป่น','RM','กิโลกรัม','Seasoning',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-032','ผงชูรส','RM','ถุง','Seasoning',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-033','Monosodium Glutamate','RM','กิโลกรัม','Seasoning',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-034','โซเดี่ยมเบนโซเอต','RM','ถุง','Additive',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-035','โปรแตสเซียม ซอร์เบต 1 กก.','RM','ถุง','Additive',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-036','น้ำมันปาล์มโอลีน (ปี๊ป)','RM','ปี๊บ','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-037','น้ำมันปาล์มมรกต (ปี๊ป)','RM','ปี๊บ','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-038','น้ำมันปาล์มทับทิม','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-039','น้ำมันปาล์มธารทอง (ปี๊ป)','RM','ปี๊บ','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-040','น้ำมันปาล์มโบนัส','RM','ปี๊บ','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-041','น้ำมันรำข้าวคิง (ปี๊ป)','RM','ปี๊บ','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-042','น้ำมันมะกอก','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-043','Promace Olive oil Alianza 5Ltr PET','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-044','โอลีฟ โพเมซ ออยล์ 5L','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-045','น้ำตาลมะพร้าว (ตรากังหัน)','RM','กิโลกรัม','Sugar',NULL,NULL,NULL,'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท ป้องกันการเยิ้มละลาย',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-046','น้ำตาลมะพร้าว (ไก่เขียว)','RM','กิโลกรัม','Sugar',NULL,NULL,NULL,'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท ป้องกันการเยิ้มละลาย',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-047','น้ําตาลทรายแดง (วังขนาย)','RM','ถุง','Sugar',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-048','น้ำตาลทรายขาว','RM','กิโลกรัม','Sugar',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-049','น้ำตาลหล่อฮังก๊วย','RM','ถุง','Sugar',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-050','งาขาว','RM','กิโลกรัม','Sesame',NULL,NULL,NULL,'ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด (หรือแช่เย็น 1-4°C เพื่อป้องกันกลิ่นหืน)',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-051','น้ำมันงาคั่ว 2.50 ลิตร','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('RM-052','น้ำมันงา ตรามังกรคู่ 3 ล.','RM','แกลลอน','Oil',NULL,NULL,NULL,'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท',NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-001','กระปุก PET Can TCK230R307 (กระปุกกลม)','PM','ลัง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-002','EOE 07 V2 (ฝาอลูมิเนียม 210ml)','PM','ชิ้น','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-003','PE Cover 307 Clear & Spoon','PM','ชิ้น','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-004','กระปุก Clear PET Can LAZ60R202 (504 pcs/carton)','PM','ลัง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-005','POE 202 SILVER (150 pcs/pack)','PM','ชิ้น','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-006','PE Cover 202 Black P02 (100 pcs/pack)','PM','ชิ้น','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-007','PE Cover 202 Clear P02 (100 pcs/pack)','PM','ชิ้น','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-010','สติกเกอร์ ตาแดงมันกุ้ง 210g (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-011','สติกเกอร์ ปลาย่าง 210g (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-012','สติกเกอร์ ปลาร้า (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-013','สติกเกอร์ พริกคั่วป่น (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-014','สติกเกอร์ หมูเสวย (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-015','สติกเกอร์ เห็ดหอม (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-016','สติกเกอร์ แมคเคอเรล (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-017','สติกเกอร์ มะกอก สูตรออริจินอล (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-018','สติกเกอร์ มะกอก สูตรเผ็ด (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-019','สติกเกอร์ น้ำปลาหวาน (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-020','สติกเกอร์ น้ำมันงา (โรล)','PM','โรล','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-021','สติกเกอร์ มะกอก (แผ่น)','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-022','สติกเกอร์ น้ำมันงา (แผ่น)','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-023','สติกเกอร์ น้ำปลาหวาน (แผ่น)','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-024','สติกเกอร์ แมคเคอเรล (แผ่น)','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-025','สติกเกอร์ มะกอก สูตรออริจินอล 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-026','สติกเกอร์ มะกอก สูตรเผ็ด 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-027','สติกเกอร์ ปลาย่าง 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-028','สติกเกอร์ เห็ดหอม 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-029','สติกเกอร์ น้ำมันงา 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-030','สติกเกอร์ หมูเสวย 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-031','สติกเกอร์ ปลาร้า 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-032','สติกเกอร์ ตาแดงมันกุ้ง 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-033','สติกเกอร์ แมคเคอเรล 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-034','สติกเกอร์ พริกคั่วป่น 60 G','PM','ดวง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-035','กล่องพัสดุ 1 กระปุก (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-036','กล่องพัสดุ 2 กระปุก (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-037','กล่องพัสดุ 4 กระปุก (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-038','แผ่น Lock กระปุก1 (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-039','แผ่น Lock กระปุก2 (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-040','แผ่น Lock กระปุก4 (เจริญชัย)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-041','กล่องพัสดุ 2D (ใบ)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-042','กล่องพัสดุ D (ใบ)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-043','กล่อง C+8 (ใบ)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-044','กล่อง C (ใบ)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-045','กล่องพัสดุ G (ใบ)','PM','ใบ','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('PKG-046','ซองแมคคาเรล 50g','PM','ซอง','Packaging',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-001','ปตท 48 กก.','CM','ถัง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-002','ถุงมือ (ยาง)','CM','กล่อง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-003','แมส','CM','กล่อง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-004','หมวกตัวหนอน','CM','แพ็ค','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-005','กระดาษเช็ดปาก (24ห่อ/เเพ็ค)','CM','ห่อ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-006','กระดาษอเนกประสงค์ (6ห่อ/เเพ็ค)','CM','ห่อ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-007','กระดาษชำระ','CM','ห่อ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-008','ถ้วยกระดาษ 4 ออนซ์ *80','CM','แพ็ค','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-009','ผงฟู 1 กก.','CM','ถุง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-010','โปร ผงซักฝอก 2.4 กก','CM','ถุง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-011','สบู่เหลว ล้างมือ','CM','แกลลอน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-012','น้ำยาล้างจาน','CM','ถุง','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-013','สก็อตไบร์ท','CM','ชิ้น','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-014','ถุงร้อน 20x30 นิ้ว 1 กก.','CM','ห่อ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-015','ถุงเย็น 16x24 นิ้ว 1 กก.','CM','ห่อ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-016','ถุงร้อน 24x36 นิ้ว','CM','แพ็ค','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-017','ถุงซิปใส 7x10 นิ้ว 0.5 กก','CM','แพ็ค','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-018','ถุงขยะเเบบม้วน 18*20 (3ม้วน/เเพ็ค)','CM','ม้วน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-019','ถุงขยะดำหนา 28x36 นิ้ว','CM','แพ็ค','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-020','หมวกคลุมผม-บ่า','CM','ใบ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-021','กระดาษถ่ายเอกสาร A4','CM','รีม','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-022','ลังโปร่ง (น้ำเงิน)','CM','ใบ','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-023','เอโร่ ฆ่าเชื้อโรคอเนกประสงค์ 1.2 ล','CM','แกลลอน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-024','เทปใสใหญ่ (72ม้วน/ลัง)','CM','ม้วน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-025','ลาเบล 100x150x350','CM','ม้วน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now')),
('SUP-026','บับเบิ้ล ไซส์ XL','CM','ม้วน','Consumable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,'system',datetime('now'),'system',datetime('now'));

-- ===== Finished-product inspection (FM-QC-008, formerly QC_10: บันทึกการตรวจสอบผลิตภัณฑ์สุดท้าย) =====
-- Pack sizes: the jar weight (jar + aluminium lid + plastic lid + sticker) deducted from the gross weight.
CREATE TABLE IF NOT EXISTS pack_sizes (
  pack_key     TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  label_net_g  REAL NOT NULL,
  tare_g       REAL NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pack_sizes (pack_key,label,label_net_g,tare_g,sort) VALUES
 ('J210','กระปุกใหญ่ 210 g (กระปุก + ฝาอลู + ฝาพลาสติก + สติ๊กเกอร์ 40 g)',210,40,1),
 ('J60','กระปุกเล็ก 60 g (กระปุก + ฝา + สติ๊กเกอร์ 15 g)',60,15,2),
 ('J160','กระปุก 160 g (กระปุก + ฝา + สติ๊กเกอร์ 40 g)',160,40,3);
-- One row per product batch checked. Net weight = gross - jar weight of the pack size chosen; the server judges.
CREATE TABLE IF NOT EXISTS fg_checks (
  fc_id        TEXT PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  check_date   TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT,
  batch_no     TEXT NOT NULL,
  pack_key     TEXT NOT NULL,
  pack_label   TEXT NOT NULL,
  label_net_g  REAL NOT NULL,
  tare_g       REAL NOT NULL,
  gross        TEXT NOT NULL,
  net          TEXT NOT NULL,
  sensory      TEXT NOT NULL,
  aw           REAL,
  aw_temp      REAL,
  ph           REAL,
  pack         TEXT NOT NULL,
  store_temp   REAL,
  store_area   TEXT,
  result       TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  failed       TEXT,
  note         TEXT,
  inspector    TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fg_checks_date ON fg_checks(check_date);
CREATE INDEX IF NOT EXISTS idx_fg_checks_batch ON fg_checks(product_code, batch_no);
-- A jar whose net weight is under the label is weighed again; the re-check decides the result.
CREATE TABLE IF NOT EXISTS fg_check_rechecks (
  fc_id      TEXT NOT NULL,
  jar        INTEGER NOT NULL,
  gross      REAL NOT NULL,
  net        REAL NOT NULL,
  PRIMARY KEY (fc_id, jar)
);
-- The finished-product form is FM-QC-008 (was QC_10).
UPDATE control_points SET form_code='FM-QC-008', monitoring=replace(monitoring,'QC_10','FM-QC-008') WHERE cp_id='OPRP-06' AND form_code='QC_10';

-- FM-QC-004: who weighed (an employee picked from the list) and their signature; `weigher` on the record is who entered it (QC).
CREATE TABLE IF NOT EXISTS weigh_signs (
  wr_id         TEXT PRIMARY KEY,
  weigher_name  TEXT NOT NULL,
  emp_id        INTEGER,
  sig_type      TEXT,
  sig_data      TEXT,
  signed_at     TEXT NOT NULL
);
-- One signature per weigher per record (weighers are named on each line).
CREATE TABLE IF NOT EXISTS weigh_signatures (
  wr_id         TEXT NOT NULL,
  weigher_name  TEXT NOT NULL,
  emp_id        INTEGER,
  sig_type      TEXT NOT NULL,
  sig_data      TEXT NOT NULL,
  signed_at     TEXT NOT NULL,
  PRIMARY KEY (wr_id, weigher_name)
);

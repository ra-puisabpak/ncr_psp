// Master data for Puisabpak. Starter lists — edit to match the factory's own registers.
// Material, supplier and parameter fields accept free text; these lists only offer suggestions.
// Raw materials, packaging and consumables come from the factory stock master list (2 Oct 2026).

// Process steps (draft, generic chilli-paste flow — confirm against the HACCP flow diagram).
export const PROCESSES = [
  { code: 'PC0001', label: 'การรับวัตถุดิบและบรรจุภัณฑ์' },
  { code: 'PC0002', label: 'การจัดเก็บวัตถุดิบ' },
  { code: 'PC0003', label: 'การล้างและคัดแยก' },
  { code: 'PC0004', label: 'การเตรียมวัตถุดิบ (หั่น บด สับ สไลด์)' },
  { code: 'PC0005', label: 'การชั่งส่วนผสม' },
  { code: 'PC0006', label: 'การทอด เจียว คั่ว' },
  { code: 'PC0007', label: 'การผัดและกวน (ให้ความร้อน)' },
  { code: 'PC0008', label: 'การบรรจุและปิดฝา' },
  { code: 'PC0009', label: 'การพักให้เย็น' },
  { code: 'PC0010', label: 'การติดฉลากและพิมพ์วันที่' },
  { code: 'PC0011', label: 'การตรวจจับโลหะ' },
  { code: 'PC0012', label: 'การบรรจุกล่องและจัดเก็บสินค้า' },
  { code: 'PC0013', label: 'การขนส่ง' },
]

// Check parameters (draft).
export const PARAMETERS = [
  { code: 'PR0001', label: 'ผลตรวจรับวัตถุดิบ / COA' },
  { code: 'PR0002', label: 'อุณหภูมิห้องหรือตู้เก็บวัตถุดิบ' },
  { code: 'PR0003', label: 'อุณหภูมิใจกลางขณะให้ความร้อน' },
  { code: 'PR0004', label: 'น้ำหนักบรรจุ' },
  { code: 'PR0005', label: 'การปิดผนึกฝา' },
  { code: 'PR0006', label: 'ฉลากและวันหมดอายุ' },
  { code: 'PR0007', label: 'การตรวจจับโลหะ' },
  { code: 'PR0008', label: 'สิ่งแปลกปลอม' },
]

// Approved suppliers — add from the approved supplier list.
export const SUPPLIERS = []

// Raw materials, with stock unit and storage condition (from the stock master list: ข้อมูลวัตถุดิบ_Stock).
export const RAW_MATERIALS = [
  { code: 'RM-001', label: 'หอมแขกจีนปอกเปลือก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดฝาสนิท' },
  { code: 'RM-002', label: 'หอมแขกปอก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดฝาสนิท' },
  { code: 'RM-003', label: 'หอมแขกพม่าปอกเปลือก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดฝาสนิท' },
  { code: 'RM-004', label: 'หอมแขกพม่า(กระเทย)', unit: 'กิโลกรัม', storage: 'ที่แห้งและเย็น อากาศถ่ายเทสะดวก หรือแช่เย็น 1-4°C' },
  { code: 'RM-005', label: 'กระเทียมจีนปอกเปลือก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดฝาสนิท' },
  { code: 'RM-006', label: 'พริกจินดาแดง เด็ดก้าน', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นสะสม' },
  { code: 'RM-007', label: 'พริกแห้ง (เด็ดก้าน)', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น หลีกเลี่ยงความชื้น' },
  { code: 'RM-008', label: 'พริกแห้ง(ติดก้าน)', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น หลีกเลี่ยงความชื้น' },
  { code: 'RM-009', label: 'หมูบด', unit: 'กิโลกรัม', storage: 'แช่แข็ง ≤ -18°C' },
  { code: 'RM-010', label: 'ปลากระดี่', unit: 'กิโลกรัม', storage: 'แช่แข็ง ≤ -18°C' },
  { code: 'RM-011', label: 'ปลาฉลาด 100% ป่น', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-012', label: 'ปลาทูป่น', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-013', label: 'ปลาย่างป่น', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-014', label: 'ปลาร้าโหน่ง', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดฝาสนิท' },
  { code: 'RM-015', label: 'กะปิ (ถุง)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท' },
  { code: 'RM-016', label: 'กุ้งแห้ง', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-017', label: 'กุ้งแห้ง (ตัว)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-018', label: 'กุ้งฝอย(สีชมพู)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-019', label: 'กุ้งแห้งจิ๋ว (ตัว)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-020', label: 'กุ้งฝอย (สีส้ม)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-021', label: 'กุ้งติดเปลือก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C ปิดสนิท ป้องกันความชื้นและเชื้อรา' },
  { code: 'RM-022', label: 'เห็ดหอม B4', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-023', label: 'ซอสแม็กกี้ 5,000 ml', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-024', label: 'ซีอิ๊วขาวเห็ดหอม (ขวดแก้ว)', unit: 'ขวด', storage: 'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-025', label: 'น้ำปลาทิพรส 4,500 ml', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-026', label: 'มะขามเปียก', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท เพื่อรักษาคุณภาพ' },
  { code: 'RM-027', label: 'น้ำปลาร้า', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ปิดฝาสนิท ที่แห้งและเย็น' },
  { code: 'RM-028', label: 'พริกป่น (แพร่)', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-029', label: 'พริกป่น (งามตา พืชผล)', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-030', label: 'เกลือ', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-031', label: 'เกลือป่น', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-032', label: 'ผงชูรส', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-033', label: 'Monosodium Glutamate', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-034', label: 'โซเดียมเบนโซเอต', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด' },
  { code: 'RM-035', label: 'โปรแตสเซียม ซอร์เบต 1 กก.', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด' },
  { code: 'RM-036', label: 'น้ำมันปาล์มโอลีน (ปี๊บ)', unit: 'ปี๊บ', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-037', label: 'น้ำมันปาล์มมรกต (ปี๊บ)', unit: 'ปี๊บ', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-038', label: 'น้ำมันปาล์มทับทิม', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-039', label: 'น้ำมันปาล์มธารทอง (ปี๊บ)', unit: 'ปี๊บ', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-040', label: 'น้ำมันปาล์มโบนัส', unit: 'ปี๊บ', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-041', label: 'น้ำมันรำข้าวคิง (ปี๊บ)', unit: 'ปี๊บ', storage: 'อุณหภูมิห้อง (20-30°C) ปิดฝาสนิท พ้นแสงแดดและความร้อน' },
  { code: 'RM-042', label: 'น้ำมันมะกอก', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท' },
  { code: 'RM-043', label: 'Promace Olive oil Alianza 5Ltr PET', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท' },
  { code: 'RM-044', label: 'โอลีฟ โพเมซ ออยล์ 5L', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท' },
  { code: 'RM-045', label: 'น้ำตาลมะพร้าว (ตรากังหัน)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท ป้องกันการเยิ้มละลาย' },
  { code: 'RM-046', label: 'น้ำตาลมะพร้าว (ไก่เขียว)', unit: 'กิโลกรัม', storage: 'แช่เย็น 1-4°C หรือที่แห้งและเย็น ปิดสนิท ป้องกันการเยิ้มละลาย' },
  { code: 'RM-047', label: 'น้ำตาลทรายแดง (วังขนาย)', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-048', label: 'น้ำตาลทรายขาว', unit: 'กิโลกรัม', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-049', label: 'น้ำตาลหล่อฮังก๊วย', unit: 'ถุง', storage: 'อุณหภูมิห้อง ที่แห้ง ปิดสนิท หลีกเลี่ยงความชื้น' },
  { code: 'RM-050', label: 'งาขาว', unit: 'กิโลกรัม', storage: 'ที่แห้งและเย็น ปิดสนิท พ้นแสงแดด (หรือแช่เย็น 1-4°C เพื่อป้องกันกลิ่นหืน)' },
  { code: 'RM-051', label: 'น้ำมันงาคั่ว 2.50 ลิตร', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท' },
  { code: 'RM-052', label: 'น้ำมันงา ตรามังกรคู่ 3 ล.', unit: 'แกลลอน', storage: 'อุณหภูมิห้อง ที่แห้งและเย็น พ้นแสงแดดและความร้อน ปิดฝาสนิท' },
]

// Packaging (stock master list, sheet Package).
export const PACKAGING = [
  { code: 'PKG-001', label: 'กระปุก PET Can TCK230R307 (กระปุกกลม)', unit: 'ลัง' },
  { code: 'PKG-002', label: 'EOE 07 V2 (ฝาอลูมิเนียม 210ml)', unit: 'ชิ้น' },
  { code: 'PKG-003', label: 'PE Cover 307 Clear & Spoon', unit: 'ชิ้น' },
  { code: 'PKG-004', label: 'กระปุก Clear PET Can LAZ60R202 (504 pcs/carton)', unit: 'ลัง' },
  { code: 'PKG-005', label: 'POE 202 SILVER (150 pcs/pack)', unit: 'ชิ้น' },
  { code: 'PKG-006', label: 'PE Cover 202 Black P02 (100 pcs/pack)', unit: 'ชิ้น' },
  { code: 'PKG-007', label: 'PE Cover 202 Clear P02 (100 pcs/pack)', unit: 'ชิ้น' },
  { code: 'PKG-010', label: 'สติกเกอร์ ตาแดงมันกุ้ง 210g (โรล)', unit: 'โรล' },
  { code: 'PKG-011', label: 'สติกเกอร์ ปลาย่าง 210g (โรล)', unit: 'โรล' },
  { code: 'PKG-012', label: 'สติกเกอร์ ปลาร้า (โรล)', unit: 'โรล' },
  { code: 'PKG-013', label: 'สติกเกอร์ พริกคั่วป่น (โรล)', unit: 'โรล' },
  { code: 'PKG-014', label: 'สติกเกอร์ หมูเสวย (โรล)', unit: 'โรล' },
  { code: 'PKG-015', label: 'สติกเกอร์ เห็ดหอม (โรล)', unit: 'โรล' },
  { code: 'PKG-016', label: 'สติกเกอร์ แมคเคอเรล (โรล)', unit: 'โรล' },
  { code: 'PKG-017', label: 'สติกเกอร์ มะกอก สูตรออริจินอล (โรล)', unit: 'โรล' },
  { code: 'PKG-018', label: 'สติกเกอร์ มะกอก สูตรเผ็ด (โรล)', unit: 'โรล' },
  { code: 'PKG-019', label: 'สติกเกอร์ น้ำปลาหวาน (โรล)', unit: 'โรล' },
  { code: 'PKG-020', label: 'สติกเกอร์ น้ำมันงา (โรล)', unit: 'โรล' },
  { code: 'PKG-021', label: 'สติกเกอร์ มะกอก (แผ่น)', unit: 'ดวง' },
  { code: 'PKG-022', label: 'สติกเกอร์ น้ำมันงา (แผ่น)', unit: 'ดวง' },
  { code: 'PKG-023', label: 'สติกเกอร์ น้ำปลาหวาน (แผ่น)', unit: 'ดวง' },
  { code: 'PKG-024', label: 'สติกเกอร์ แมคเคอเรล (แผ่น)', unit: 'ดวง' },
  { code: 'PKG-025', label: 'สติกเกอร์ มะกอก สูตรออริจินอล 60 G', unit: 'ดวง' },
  { code: 'PKG-026', label: 'สติกเกอร์ มะกอก สูตรเผ็ด 60 G', unit: 'ดวง' },
  { code: 'PKG-027', label: 'สติกเกอร์ ปลาย่าง 60 G', unit: 'ดวง' },
  { code: 'PKG-028', label: 'สติกเกอร์ เห็ดหอม 60 G', unit: 'ดวง' },
  { code: 'PKG-029', label: 'สติกเกอร์ น้ำมันงา 60 G', unit: 'ดวง' },
  { code: 'PKG-030', label: 'สติกเกอร์ หมูเสวย 60 G', unit: 'ดวง' },
  { code: 'PKG-031', label: 'สติกเกอร์ ปลาร้า 60 G', unit: 'ดวง' },
  { code: 'PKG-032', label: 'สติกเกอร์ ตาแดงมันกุ้ง 60 G', unit: 'ดวง' },
  { code: 'PKG-033', label: 'สติกเกอร์ แมคเคอเรล 60 G', unit: 'ดวง' },
  { code: 'PKG-034', label: 'สติกเกอร์ พริกคั่วป่น 60 G', unit: 'ดวง' },
  { code: 'PKG-035', label: 'กล่องพัสดุ 1 กระปุก (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-036', label: 'กล่องพัสดุ 2 กระปุก (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-037', label: 'กล่องพัสดุ 4 กระปุก (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-038', label: 'แผ่น Lock กระปุก1 (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-039', label: 'แผ่น Lock กระปุก2 (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-040', label: 'แผ่น Lock กระปุก4 (เจริญชัย)', unit: 'ใบ' },
  { code: 'PKG-041', label: 'กล่องพัสดุ 2D (ใบ)', unit: 'ใบ' },
  { code: 'PKG-042', label: 'กล่องพัสดุ D (ใบ)', unit: 'ใบ' },
  { code: 'PKG-043', label: 'กล่อง C+8 (ใบ)', unit: 'ใบ' },
  { code: 'PKG-044', label: 'กล่อง C (ใบ)', unit: 'ใบ' },
  { code: 'PKG-045', label: 'กล่องพัสดุ G (ใบ)', unit: 'ใบ' },
  { code: 'PKG-046', label: 'ซองแมคคาเรล 50g', unit: 'ซอง' },
]

// Consumables (stock master list, sheet Consumable).
export const CONSUMABLES = [
  { code: 'SUP-001', label: 'ปตท 48 กก.', unit: 'ถัง' },
  { code: 'SUP-002', label: 'ถุงมือ (ยาง)', unit: 'กล่อง' },
  { code: 'SUP-003', label: 'แมส', unit: 'กล่อง' },
  { code: 'SUP-004', label: 'หมวกตัวหนอน', unit: 'แพ็ค' },
  { code: 'SUP-005', label: 'กระดาษเช็ดปาก (24ห่อ/เเพ็ค)', unit: 'ห่อ' },
  { code: 'SUP-006', label: 'กระดาษอเนกประสงค์ (6ห่อ/เเพ็ค)', unit: 'ห่อ' },
  { code: 'SUP-007', label: 'กระดาษชำระ', unit: 'ห่อ' },
  { code: 'SUP-008', label: 'ถ้วยกระดาษ 4 ออนซ์ *80', unit: 'แพ็ค' },
  { code: 'SUP-009', label: 'ผงฟู 1 กก.', unit: 'ถุง' },
  { code: 'SUP-010', label: 'โปร ผงซักฝอก 2.4 กก', unit: 'ถุง' },
  { code: 'SUP-011', label: 'สบู่เหลว ล้างมือ', unit: 'แกลลอน' },
  { code: 'SUP-012', label: 'น้ำยาล้างจาน', unit: 'ถุง' },
  { code: 'SUP-013', label: 'สก็อตไบร์ท', unit: 'ชิ้น' },
  { code: 'SUP-014', label: 'ถุงร้อน 20x30 นิ้ว 1 กก.', unit: 'ห่อ' },
  { code: 'SUP-015', label: 'ถุงเย็น 16x24 นิ้ว 1 กก.', unit: 'ห่อ' },
  { code: 'SUP-016', label: 'ถุงร้อน 24x36 นิ้ว', unit: 'แพ็ค' },
  { code: 'SUP-017', label: 'ถุงซิปใส 7x10 นิ้ว 0.5 กก', unit: 'แพ็ค' },
  { code: 'SUP-018', label: 'ถุงขยะเเบบม้วน 18*20 (3ม้วน/เเพ็ค)', unit: 'ม้วน' },
  { code: 'SUP-019', label: 'ถุงขยะดำหนา 28x36 นิ้ว', unit: 'แพ็ค' },
  { code: 'SUP-020', label: 'หมวกคลุมผม-บ่า', unit: 'ใบ' },
  { code: 'SUP-021', label: 'กระดาษถ่ายเอกสาร A4', unit: 'รีม' },
  { code: 'SUP-022', label: 'ลังโปร่ง (น้ำเงิน)', unit: 'ใบ' },
  { code: 'SUP-023', label: 'เอโร่ ฆ่าเชื้อโรคอเนกประสงค์ 1.2 ล', unit: 'แกลลอน' },
  { code: 'SUP-024', label: 'เทปใสใหญ่ (72ม้วน/ลัง)', unit: 'ม้วน' },
  { code: 'SUP-025', label: 'ลาเบล 100x150x350', unit: 'ม้วน' },
  { code: 'SUP-026', label: 'บับเบิ้ล ไซส์ XL', unit: 'ม้วน' },
]

// Finished products, numbered by the last digits of the food serial number (เลขสารบบอาหาร).
export const PRODUCTS = [
  { code: 'FG0001', label: 'น้ำพริกปลาร้าพริกสด' },
  { code: 'FG0002', label: 'น้ำพริกตาแดงมันกุ้ง' },
  { code: 'FG0003', label: 'น้ำพริกเห็ดหอมมังสวิรัติ' },
  { code: 'FG0004', label: 'น้ำพริกหมูเสวย' },
  { code: 'FG0005', label: 'น้ำพริกปลาย่างพลัส' },
  { code: 'FG0006', label: 'น้ำปลาหวานแซ่บ' },
  { code: 'FG0007', label: 'พริกผัดน้ำมันมะกอก สูตรออริจินัล' },
  { code: 'FG0008', label: 'น้ำพริกเผ็ดแมคเคอเรล' },
  { code: 'FG0009', label: 'พริกผัดน้ำมันมะกอก สูตรเผ็ด' },
  { code: 'FG0010', label: 'พริกผัดน้ำมันงา' },
  { code: 'FG0011', label: 'พริกคั่วป่น 100%' },
  { code: 'FG0012', label: 'น้ำพริกเห็ดหอม (สูตรเจ)' },
  { code: 'FG0014', label: 'พริกน้ำมันธัญพืช (Olive Nut Crunch)' },
]

// Everything an NCR can be raised against, in one searchable list.
const withGroup = (arr, group) => arr.map((x) => ({ ...x, group }))
export const MATERIALS = [
  ...withGroup(RAW_MATERIALS, 'วัตถุดิบ'),
  ...withGroup(PACKAGING, 'บรรจุภัณฑ์'),
  ...withGroup(PRODUCTS, 'ผลิตภัณฑ์'),
  ...withGroup(CONSUMABLES, 'วัสดุสิ้นเปลือง'),
]

export const ALLERGENS = ['ปลา', 'กุ้ง/สัตว์น้ำมีเปลือก', 'งา', 'ถั่วเหลือง', 'ถั่วลิสง', 'กลูเตน', 'นม', 'ไข่']

export const SOURCE_OPTIONS = [
  { value: 'RM_RECEIVING', label: 'รับวัตถุดิบ' },
  { value: 'IN_PROCESS', label: 'ระหว่างผลิต' },
  { value: 'CCP', label: 'CCP เบี่ยงเบน' },
  { value: 'FINAL_QC', label: 'สินค้าสำเร็จรูป' },
  { value: 'WAREHOUSE', label: 'คลังสินค้า' },
  { value: 'COMPLAINT', label: 'ข้อร้องเรียน' },
  { value: 'AUDIT', label: 'ตรวจติดตาม' },
  { value: 'MAINTENANCE', label: 'ซ่อมบำรุง' },
  { value: 'FOOD_DEFENSE', label: 'Food Defense' },
  { value: 'FOOD_FRAUD', label: 'Food Fraud' },
  { value: 'OTHER', label: 'อื่นๆ' },
]
export const SOURCE_TH = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]))

export const DISPOSITION_OPTIONS = [
  { value: 'RELEASE', label: 'ปล่อยตามสภาพ' },
  { value: 'REWORK', label: 'ทำซ้ำ / แปรรูปใหม่' },
  { value: 'SORT', label: 'คัดแยก' },
  { value: 'DOWNGRADE', label: 'ลดเกรด' },
  { value: 'RETURN_SUPPLIER', label: 'คืนผู้ขาย' },
  { value: 'DESTROY', label: 'ทำลาย' },
  { value: 'RECALL', label: 'เรียกคืน' },
]
export const DISPOSITION_TH = Object.fromEntries(DISPOSITION_OPTIONS.map((o) => [o.value, o.label]))

export const byCode = (arr) => Object.fromEntries(arr.map((x) => [x.code, x.label]))
export const codeOf = (arr, label) => (arr.find((x) => x.label === label) || {}).code || ''

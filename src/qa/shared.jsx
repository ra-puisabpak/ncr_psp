// Shared bits of the PSP QUALITY APP pages: labels, limits and the client-side preview of a check.
// The server makes the real PASS/FAIL decision; this only colours the form while it is filled in.

export const CP_TYPE_TH = { CCP: 'CCP', OPRP: 'OPRP', PRP: 'PRP', TBD: 'รอตัดสิน' }
export const CP_TYPE_CLS = {
  CCP: 'bg-red-100 text-red-700', OPRP: 'bg-orange-100 text-orange-700',
  PRP: 'bg-blue-100 text-blue-700', TBD: 'bg-gray-100 text-gray-600',
}
export const CP_STATUS_TH = { DRAFT: 'รอ validate', APPROVED: 'อนุมัติแล้ว', RETIRED: 'ยกเลิกใช้' }
export const CP_STATUS_CLS = {
  DRAFT: 'bg-amber-100 text-amber-800', APPROVED: 'bg-green-100 text-green-700', RETIRED: 'bg-gray-200 text-gray-500',
}
export const SHIFTS = ['เช้า', 'บ่าย', 'ดึก']

// Bangkok calendar date and clock, whatever the device's time zone.
export const bkkNow = () => new Date(Date.now() + 7 * 3600e3).toISOString()
export const bkkToday = () => bkkNow().slice(0, 10)
export const bkkTime = () => bkkNow().slice(11, 16)
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)

const has = (v) => v !== undefined && v !== null && v !== ''

export function limitText(p) {
  const u = p.unit ? ` ${p.unit}` : ''
  if (has(p.min) && has(p.max)) return `${p.min}–${p.max}${u}`
  if (has(p.min)) return `≥ ${p.min}${u}`
  if (has(p.max)) return `≤ ${p.max}${u}`
  return p.type === 'check' ? 'ต้องเป็น "ใช่"' : 'บันทึกค่า (ยังไม่กำหนดเกณฑ์)'
}

// 'pass' | 'fail' | null (not answered yet, or nothing to judge against)
export function judge(p, v) {
  if (p.type === 'check') return v === true ? 'pass' : v === false ? 'fail' : null
  if (p.type !== 'number' || !has(v) || !Number.isFinite(Number(v))) return null
  const n = Number(v)
  if ((has(p.min) && n < p.min) || (has(p.max) && n > p.max)) return 'fail'
  return has(p.min) || has(p.max) ? 'pass' : null
}

export const Badge = ({ cls, children }) => (
  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>
)
export const ResultBadge = ({ result }) => (
  <Badge cls={result === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{result === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'}</Badge>
)

export const monthOf = (iso) => iso.slice(0, 7)
export const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days: last }
}
export const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
export const thaiMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return `${TH_MONTHS_FULL[m - 1]} ${y + 543}` }
export const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

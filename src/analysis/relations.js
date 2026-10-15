import { mean } from './insights'

// Joins the forms of one batch (product_code + batch_no): FM-QC-002 production control and FM-QC-004 weighing on the input side,
// FM-QC-008 aw / pH on the result side. Correlation is judged WITHIN each product (values minus that product's own mean),
// because different recipes have different aw / pH and would otherwise swamp every real effect.
const clamp = (v) => (v == null || Number.isNaN(v) ? null : Number(v))
const mins = (a, b) => { if (!a || !b) return null; const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d < 0) d += 1440; return d }
const fryLoss = (s) => (s && s.done && s.w_before > 0 && s.w_after != null ? ((s.w_before - s.w_after) / s.w_before) * 100 : null)
const fryTemp = (d) => { const t = ['garlic', 'shallot', 'chili'].map((k) => d.fry?.[k]).filter((s) => s && s.done && s.temp != null).map((s) => s.temp); return t.length ? Math.min(...t) : null }

export const FEATURES = [
  { key: 'heat_temp', label: 'อุณหภูมิผัด/กวน', unit: '°C', get: (d) => clamp(d.heat?.temp), form: 'FM-QC-002' },
  { key: 'heat_min', label: 'เวลาผัด/กวน', unit: 'นาที', get: (d) => clamp(d.heat?.min), form: 'FM-QC-002' },
  { key: 'ccp1_hold', label: 'เวลาคงที่ ≥85 °C (CCP-01)', unit: 'นาที', get: (d) => (d.ccp1 ? mins(d.ccp1.reach_time, d.ccp1.end_time) : null), form: 'FM-QC-002' },
  { key: 'fry_temp', label: 'อุณหภูมิน้ำมันทอด/เจียว (ต่ำสุด)', unit: '°C', get: fryTemp, form: 'FM-QC-002' },
  { key: 'garlic_loss', label: 'น้ำหนักที่หายหลังเจียวกระเทียม', unit: '%', get: (d) => fryLoss(d.fry?.garlic), form: 'FM-QC-002' },
  { key: 'shallot_loss', label: 'น้ำหนักที่หายหลังเจียวหอม', unit: '%', get: (d) => fryLoss(d.fry?.shallot), form: 'FM-QC-002' },
  { key: 'chili_loss', label: 'น้ำหนักที่หายหลังคั่ว/ทอดพริก', unit: '%', get: (d) => fryLoss(d.fry?.chili), form: 'FM-QC-002' },
  { key: 'cool_min', label: 'เวลาพักให้เย็น', unit: 'นาที', get: (d) => clamp(d.cool?.min), form: 'FM-QC-002' },
  { key: 'fill_temp', label: 'อุณหภูมิขณะบรรจุ', unit: '°C', get: (d) => clamp(d.cool?.fill_temp), form: 'FM-QC-002' },
  { key: 'to_cap', label: 'เวลาจนปิดฝา', unit: 'นาที', get: (d) => clamp(d.cool?.to_cap_min), form: 'FM-QC-002' },
  { key: 'cap_temp', label: 'อุณหภูมิขณะปิดฝา', unit: '°C', get: (d) => clamp(d.cool?.cap_temp), form: 'FM-QC-002' },
]

export function buildBatches({ prodctl, weigh, awph }) {
  const key = (p, b) => `${p}|${b}`
  const map = new Map()
  const get = (p, b, name) => { const k = key(p, b); if (!map.has(k)) map.set(k, { product_code: p, batch_no: b, name, date: null, f: {}, dev: null, aw: null, ph: null }); return map.get(k) }
  for (const r of prodctl) {
    const b = get(r.product_code, r.batch_no, r.product_name); b.date = r.prod_date
    for (const ft of FEATURES) b.f[ft.key] = ft.get(r.data || {})
  }
  for (const w of weigh) {
    const b = get(w.product_code, w.batch_no, w.product_name); b.date = b.date || w.prod_date
    b.dev = (b.dev || 0) + (w.deviations || []).filter((d) => d.kind === 'TOL').length
  }
  const acc = new Map()
  for (const r of awph) {
    const b = get(r.product_code, r.batch_no, r.product_name); b.date = b.date || r.check_date
    const a = acc.get(b) || { aw: [], ph: [] }
    if (r.aw != null) a.aw.push(Number(r.aw)); if (r.ph != null) a.ph.push(Number(r.ph)); acc.set(b, a)
  }
  for (const [b, a] of acc) { b.aw = mean(a.aw); b.ph = mean(a.ph) }
  return [...map.values()].filter((b) => b.aw != null || b.ph != null || Object.values(b.f).some((v) => v != null)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

// Pearson r of x and y after removing each product's own mean. Needs >= 3 batches per product to count that product.
export function withinCorr(batches, xOf, yKey) {
  const groups = new Map()
  for (const b of batches) { const x = xOf(b), y = b[yKey]; if (x == null || y == null) continue; (groups.get(b.product_code) || groups.set(b.product_code, []).get(b.product_code)).push({ x, y, b }) }
  const pts = []
  for (const g of groups.values()) {
    if (g.length < 3) continue
    const mx = mean(g.map((p) => p.x)), my = mean(g.map((p) => p.y))
    for (const p of g) pts.push({ dx: p.x - mx, dy: p.y - my, b: p.b, x: p.x, y: p.y })
  }
  const n = pts.length
  if (n < 4) return { n, r: null, pts }
  const sxx = pts.reduce((s, p) => s + p.dx * p.dx, 0), syy = pts.reduce((s, p) => s + p.dy * p.dy, 0), sxy = pts.reduce((s, p) => s + p.dx * p.dy, 0)
  return { n, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null, flat: !(sxx > 0 && syy > 0), pts, products: groups.size }
}

// How strong a link is allowed to sound given how few batches there are.
export function strength(r, n, flat) {
  if (r == null && flat) return { tag: 'ค่าเท่ากันทุก Batch', tone: 'text-gray-400' }
  if (r == null) return { tag: 'ข้อมูลไม่พอ', tone: 'text-gray-400' }
  const a = Math.abs(r)
  if (n < 8) return { tag: a >= 0.6 ? 'มีแนวโน้ม (ข้อมูลน้อย)' : 'ข้อมูลน้อย', tone: 'text-gray-500' }
  if (a >= 0.6) return { tag: 'สัมพันธ์ชัด', tone: 'text-red-700 font-semibold' }
  if (a >= 0.4) return { tag: 'สัมพันธ์ปานกลาง', tone: 'text-amber-700 font-semibold' }
  return { tag: 'แทบไม่สัมพันธ์', tone: 'text-gray-500' }
}

export function relationTable(batches, yKey) {
  return FEATURES.map((ft) => ({ ft, ...withinCorr(batches, (b) => b.f[ft.key], yKey) }))
    .concat([{ ft: { key: 'dev', label: 'จำนวนรายการชั่งเกิน Tolerance', unit: 'รายการ', form: 'FM-QC-004' }, ...withinCorr(batches, (b) => b.dev, yKey) }])
    .filter((x) => x.n > 0)
    .sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0))
}

// The batches whose aw / pH sat furthest above their own product's average, and how their process differed that day.
export function topOutliers(batches, yKey, count = 3) {
  const by = new Map()
  for (const b of batches) if (b[yKey] != null) (by.get(b.product_code) || by.set(b.product_code, []).get(b.product_code)).push(b)
  const out = []
  for (const g of by.values()) {
    if (g.length < 3) continue
    const m = mean(g.map((b) => b[yKey]))
    for (const b of g) {
      const diffs = FEATURES.map((ft) => { const vs = g.map((x) => x.f[ft.key]).filter((v) => v != null); const v = b.f[ft.key]; if (v == null || vs.length < 3) return null; const mm = mean(vs); const sd = Math.sqrt(vs.reduce((s, x) => s + (x - mm) ** 2, 0) / (vs.length - 1)); return sd > 0 ? { ft, v, mean: mm, z: (v - mm) / sd } : null }).filter(Boolean).sort((a, c) => Math.abs(c.z) - Math.abs(a.z)).slice(0, 2)
      out.push({ b, delta: b[yKey] - m, avg: m, diffs })
    }
  }
  return out.sort((a, c) => c.delta - a.delta).slice(0, count)
}

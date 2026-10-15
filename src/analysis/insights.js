// Plain statistics behind the analysis page: no network, no AI. The same summary is what the AI step receives.
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
export const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) }
const dayMs = (iso, hm = '12:00') => Date.parse(`${iso}T${/^\d\d:\d\d$/.test(hm || '') ? hm : '12:00'}:00Z`)

// Cold storage: one series per unit.
export function coldSeries(units, readings) {
  return units.map((u) => {
    const rs = readings.filter((r) => r.unit_id === u.unit_id)
    const pts = rs.map((r) => ({ t: dayMs(r.read_date, r.read_time || r.slot), y: Number(r.temp), bad: r.status !== 'PASS', tip: `${r.read_date.slice(8)}/${r.read_date.slice(5, 7)} ${r.read_time || r.slot}${r.cause ? ` · ${r.cause}` : ''}` }))
    const out = rs.filter((r) => r.status !== 'PASS')
    const temps = rs.map((r) => Number(r.temp))
    return { unit: u, points: pts, n: rs.length, out: out.length, avg: mean(temps), sd: sd(temps), max: temps.length ? Math.max(...temps) : null, band: [u.spec_min ?? Math.min(...temps, u.spec_max), u.spec_max] }
  })
}

// Frying oil: every temperature reading against 150-180 C; TPM trend.
export function oilSeries(checks, min = 150, max = 180) {
  const tp = [], tpm = []
  for (const c of checks) {
    const t = dayMs(c.check_date, c.check_time)
    for (const v of c.temps || []) tp.push({ t, y: Number(v), bad: v < min || v > max, tip: `${c.check_date.slice(8)}/${c.check_date.slice(5, 7)} ${c.check_time || ''} ${c.line || ''}`.trim() })
    if (c.tpm_max != null) tpm.push({ t, y: Number(c.tpm_max), bad: c.tpm_max >= 25, tip: `${c.check_date.slice(8)}/${c.check_date.slice(5, 7)} ${c.line || ''}`.trim() })
  }
  return { temp: tp, tpm, outTemp: tp.filter((p) => p.bad).length, outTpm: tpm.filter((p) => p.bad).length, min, max }
}

// aw / pH per product, with the change between the first and second half of the period.
export function awphByProduct(rows) {
  const by = new Map()
  for (const r of rows) {
    if (r.aw == null && r.ph == null) continue
    const g = by.get(r.product_code) || { code: r.product_code, name: r.product_name || r.product_code, rows: [] }
    g.rows.push(r); by.set(r.product_code, g)
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code)).map((g) => {
    g.rows.sort((a, b) => a.check_date.localeCompare(b.check_date))
    const one = (key) => {
      const vs = g.rows.filter((r) => r[key] != null)
      const v = vs.map((r) => Number(r[key]))
      const h = Math.floor(v.length / 2)
      return { n: v.length, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, avg: mean(v), shift: v.length >= 4 ? mean(v.slice(h)) - mean(v.slice(0, h)) : null,
        points: vs.map((r) => ({ t: dayMs(r.check_date), y: Number(r[key]), tip: `${r.check_date.slice(8)}/${r.check_date.slice(5, 7)} ${r.batch_no || ''}`.trim() })) }
    }
    return { code: g.code, name: g.name, aw: one('aw'), ph: one('ph') }
  })
}

// Observations a QA manager would want first, in Thai. Facts only: no limit is invented for aw / pH.
export function observations({ cold, oil, products }) {
  const out = []
  for (const c of cold) {
    if (!c.n) continue
    const pct = (c.out / c.n) * 100
    if (c.out) out.push({ level: pct >= 10 ? 'high' : 'mid', text: `${c.unit.name}: นอกเกณฑ์ ${c.out}/${c.n} ครั้ง (${pct.toFixed(0)}%) ค่าสูงสุด ${c.max.toFixed(1)} °C เกณฑ์ ≤ ${c.unit.spec_max} °C` })
    else out.push({ level: 'ok', text: `${c.unit.name}: อยู่ในเกณฑ์ครบทั้ง ${c.n} ครั้ง (เฉลี่ย ${c.avg.toFixed(1)} °C)` })
  }
  if (oil.temp.length) {
    if (oil.outTemp) out.push({ level: 'high', text: `น้ำมันทอด: อุณหภูมินอกช่วง ${oil.min}–${oil.max} °C จำนวน ${oil.outTemp}/${oil.temp.length} ค่า (ต่ำสุด ${Math.min(...oil.temp.map((p) => p.y))} °C)` })
    else out.push({ level: 'ok', text: `น้ำมันทอด: อุณหภูมิ ${oil.temp.length} ค่า อยู่ในช่วง ${oil.min}–${oil.max} °C ทั้งหมด` })
  }
  if (oil.tpm.length) {
    const hi = oil.tpm.filter((p) => p.y >= 20).length
    if (hi) out.push({ level: oil.outTpm ? 'high' : 'mid', text: `TPM: มี ${hi} ครั้งที่ ≥ 20% (${oil.outTpm} ครั้งถึงเกณฑ์ 25%) ค่าสูงสุด ${Math.max(...oil.tpm.map((p) => p.y))}%` })
  }
  for (const p of products) {
    for (const [k, label, dp, thr] of [['aw', 'aw', 3, 0.02], ['ph', 'pH', 2, 0.15]]) {
      const s = p[k]
      if (s.shift != null && Math.abs(s.shift) >= thr) out.push({ level: 'mid', text: `${p.name}: ${label} ครึ่งหลังของช่วง${s.shift > 0 ? 'สูงขึ้น' : 'ต่ำลง'} ${Math.abs(s.shift).toFixed(dp)} จากครึ่งแรก (เฉลี่ย ${s.avg.toFixed(dp)}, ช่วง ${s.min.toFixed(dp)}–${s.max.toFixed(dp)})` })
    }
  }
  return out
}

// The compact text sent to the AI: aggregates only, no names of people, no photos.
export function summaryForAI({ from, to, cold, oil, products, notes, relations }) {
  return {
    period: { from, to },
    cold_storage: cold.filter((c) => c.n).map((c) => ({ unit: c.unit.name, area: c.unit.area, readings: c.n, out_of_spec: c.out, avg: c.avg && +c.avg.toFixed(2), sd: c.sd && +c.sd.toFixed(2), max: c.max, spec_max: c.unit.spec_max })),
    frying_oil: { temp_readings: oil.temp.length, temp_out_of_range: oil.outTemp, range: [oil.min, oil.max], min_temp: oil.temp.length ? Math.min(...oil.temp.map((p) => p.y)) : null, tpm_checks: oil.tpm.length, tpm_ge_20: oil.tpm.filter((p) => p.y >= 20).length, tpm_max: oil.tpm.length ? Math.max(...oil.tpm.map((p) => p.y)) : null },
    finished_product_aw_ph: products.map((p) => ({ product: p.name, aw: { n: p.aw.n, min: p.aw.min, avg: p.aw.avg && +p.aw.avg.toFixed(3), max: p.aw.max, shift: p.aw.shift && +p.aw.shift.toFixed(3) }, ph: { n: p.ph.n, min: p.ph.min, avg: p.ph.avg && +p.ph.avg.toFixed(2), max: p.ph.max, shift: p.ph.shift && +p.ph.shift.toFixed(2) } })),
    batch_relations: relations || null,
    auto_observations: notes,
  }
}

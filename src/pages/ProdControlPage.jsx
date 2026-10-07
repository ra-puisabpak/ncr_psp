import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Printer, Flame, CheckCircle2, XCircle, Plus } from 'lucide-react'
import Layout from '../components/Layout'
import { prodctlApi, weighApi, qaApi } from '../api/d1Api'
import { useAuth, canWrite } from '../auth'
import { PRODUCTS } from '../data/masterData'
import { Badge, ResultBadge, bkkToday, newUid } from '../qa/shared'
import { FORMS } from '../config'

const input = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const STEPS = [['garlic', 'กระเทียม'], ['shallot', 'หอม'], ['chili', 'พริก / เห็ด / หมูบด']]
const blankFry = () => Object.fromEntries(STEPS.map(([k]) => [k, { done: false, kind: 'พริก', w_before: '', w_after: '', temp: '', min: '' }]))
const blankForm = () => ({ fry: blankFry(), fry_thermo_ok: null, grind: { count: '', w_after: '' }, heat: { temp: '', min: '' },
  ccp1: { reach_time: '', end_time: '', readings: ['', '', '', '', ''], thermo_ok: null }, cool: { min: '', fill_temp: '', cap_temp: '', foreign_ok: null } })
const mins = (a, b) => { if (!a || !b) return null; const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - h1 * 60 - m1; if (d < 0) d += 1440; return d }

function YesNo({ value, onChange, yes = 'ใช่', no = 'ไม่ใช่' }) {
  return (
    <div className="flex gap-1.5">
      {[[true, yes, 'bg-green-600'], [false, no, 'bg-red-600']].map(([v, t, on]) => (
        <button type="button" key={t} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${value === v ? `${on} text-white border-transparent` : 'bg-white text-gray-600 border-gray-300'}`}>{t}</button>
      ))}
    </div>
  )
}
const Num = ({ value, onChange, placeholder, bad }) => (
  <input type="number" inputMode="decimal" step="any" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    className={`${input} ${bad ? 'border-red-400 bg-red-50' : ''}`} />
)

export default function ProdControlPage() {
  const { user } = useAuth()
  const [date, setDate] = useState(bkkToday())
  const [weighed, setWeighed] = useState([])
  const [cps, setCps] = useState([])
  const [rows, setRows] = useState([])
  const [product, setProduct] = useState('')
  const [batch, setBatch] = useState('')
  const [oil, setOil] = useState('')
  const [f, setF] = useState(blankForm)
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  const loadDay = () => {
    weighApi.list({ from: date, to: date }).then(setWeighed).catch(() => {})
    prodctlApi.list({ from: date, to: date }).then(setRows).catch(() => {})
  }
  useEffect(() => { qaApi.controlPoints().then(setCps).catch(() => {}) }, [])
  useEffect(() => { loadDay() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const applies = (id) => { const c = cps.find((x) => x.cp_id === id && x.status !== 'RETIRED'); return !!c && (!c.products.length || c.products.includes(product)) }
  const cpOf = (id) => cps.find((x) => x.cp_id === id)
  const groupA = product && applies('CCP-01')
  const groupB = product && applies('CCP-02')
  const packCp = product && applies('OPRP-05') // packing / capping checks follow OPRP-05 itself, whichever products QA has put under it
  const recorded = new Set(rows.map((r) => `${r.product_code}|${r.batch_no}`))
  const open = weighed.filter((w) => !recorded.has(`${w.product_code}|${w.batch_no}`))
  const setFry = (k, field, v) => setF((x) => ({ ...x, fry: { ...x.fry, [k]: { ...x.fry[k], [field]: v } } }))
  const setSec = (sec, field, v) => setF((x) => ({ ...x, [sec]: { ...x[sec], [field]: v } }))
  const setReading = (i, v) => setF((x) => ({ ...x, ccp1: { ...x.ccp1, readings: x.ccp1.readings.map((r, j) => (j === i ? v : r)) } }))
  const pickWeighed = (key) => {
    const w = weighed.find((x) => `${x.product_code}|${x.batch_no}` === key)
    if (w) { setProduct(w.product_code); setBatch(w.batch_no) }
  }
  // Live preview against the register limits; the server judges when saving.
  const lim = (cp, key) => cpOf(cp)?.params.find((p) => p.key === key) || {}
  const below = (v, cp, key) => v !== '' && v != null && lim(cp, key).min !== undefined && Number(v) < lim(cp, key).min
  const above = (v, cp, key) => v !== '' && v != null && lim(cp, key).max !== undefined && Number(v) > lim(cp, key).max
  const hold = mins(f.ccp1.reach_time, f.ccp1.end_time)
  const readings = f.ccp1.readings.filter((v) => v !== '').map(Number)
  const preview = useMemo(() => {
    const out = []
    if (groupA) {
      if (readings.some((v) => v < (lim('CCP-01', 'temp_min').min ?? 85))) out.push(`CCP-01: อุณหภูมิต่ำกว่า ${lim('CCP-01', 'temp_min').min ?? 85}°C`)
      if (hold !== null && hold < (lim('CCP-01', 'hold_min').min ?? 120)) out.push(`CCP-01: คงอุณหภูมิ ${hold} นาที (เกณฑ์ ≥ ${lim('CCP-01', 'hold_min').min ?? 120})`)
    }
    if (f.cool.fill_temp !== '' && Number(f.cool.fill_temp) >= 60) out.push(`OPRP-05: บรรจุที่ ${f.cool.fill_temp}°C (ต้องต่ำกว่า 60°C)`)
    if (f.cool.cap_temp !== '' && Number(f.cool.cap_temp) >= 60) out.push(`OPRP-05: ปิดฝาที่ ${f.cool.cap_temp}°C (ต้องต่ำกว่า 60°C)`)
    if (groupB) {
      if (f.fry.garlic.done && below(f.fry.garlic.min, 'CCP-02', 'garlic_min')) out.push(`CCP-02: เจียวกระเทียม ${f.fry.garlic.min} นาที (เกณฑ์ ≥ ${lim('CCP-02', 'garlic_min').min})`)
      if (f.fry.shallot.done && below(f.fry.shallot.min, 'CCP-02', 'shallot_min')) out.push(`CCP-02: เจียวหอม ${f.fry.shallot.min} นาที (เกณฑ์ ≥ ${lim('CCP-02', 'shallot_min').min})`)
      if (f.fry.chili.done && f.fry.chili.kind === 'พริก' && below(f.fry.chili.min, 'CCP-02', 'chili_min')) out.push(`CCP-02: ทอดพริก ${f.fry.chili.min} นาที (เกณฑ์ ≥ ${lim('CCP-02', 'chili_min').min})`)
    }
    if (f.cool.foreign_ok === false) out.push('พบสิ่งปลอมปน')
    return out
  }, [f, groupA, groupB, packCp, cps]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await prodctlApi.save({ uid, product_code: product, product_name: PRODUCTS.find((p) => p.code === product)?.label || '', prod_date: date, batch_no: batch, oil_type: oil,
        ...f, ccp1: groupA ? f.ccp1 : null, fry_thermo_ok: groupB ? f.fry_thermo_ok : null,
        note })
      setSaved(res); setUid(newUid()); setF(blankForm()); setNote(''); setProduct(''); setBatch('')
      loadDay(); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Flame className="w-5 h-5 text-orange-600" />แบบฟอร์มควบคุมการผลิต</h1>
          <div className="text-xs text-gray-500">{FORMS.PRODCTL.code} · ต่อ Batch · ระบบสร้างบันทึก CCP-01 / CCP-02 / OPRP-05 ให้จากค่าที่กรอก</div>
        </div>
        <Link to={`/qa/prodctl/report?date=${date}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />รายงาน A4</Link>
      </div>

      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm border ${saved.result === 'PASS' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <div className="font-semibold flex items-center gap-2">{saved.result === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}<span className="flex-1">บันทึก {saved.pc_id} — {saved.result === 'PASS' ? 'ผ่านทุกจุดควบคุม' : 'มีจุดไม่ผ่าน · กักกัน Batch รอ QA ตัดสิน'}</span></div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {saved.derived.map((d) => (
              <span key={d.cp_id} className="text-xs">{d.cp_id} <ResultBadge result={d.result} />{d.ncr_id && <> <Link to={`/ncr/${d.ncr_id}`} className="underline font-semibold">{d.ncr_id}</Link></>}</span>
            ))}
            {saved.ncr_id && <span className="text-xs">สิ่งปลอมปน <Link to={`/ncr/${saved.ncr_id}`} className="underline font-semibold">{saved.ncr_id}</Link></span>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">วันที่ผลิต<input type="date" max={bkkToday()} value={date} onChange={(e) => { setDate(e.target.value || bkkToday()); setProduct(''); setBatch('') }} className={input} /></label>
          <label className="text-xs text-gray-600">ชนิดน้ำมัน<input value={oil} onChange={(e) => setOil(e.target.value)} placeholder="เช่น น้ำมันรำข้าว" className={input} /></label>
        </div>
        {open.length > 0 && (
          <label className="text-xs text-gray-600 block">Batch ที่ชั่งวัตถุดิบแล้ว ({FORMS.WEIGH.code}) วันนี้
            <select value={product && batch ? `${product}|${batch}` : ''} onChange={(e) => pickWeighed(e.target.value)} className={input}>
              <option value="">-- เลือก หรือกรอกเองด้านล่าง --</option>
              {open.map((w) => <option key={w.wr_id} value={`${w.product_code}|${w.batch_no}`}>{w.product_name} · {w.batch_no}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-600 col-span-2">ผลิตภัณฑ์ *
            <select value={product} onChange={(e) => setProduct(e.target.value)} className={input}>
              <option value="">-- เลือกผลิตภัณฑ์ --</option>{PRODUCTS.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Lot / Batch *<input value={batch} onChange={(e) => setBatch(e.target.value)} className={input} /></label>
        </div>
        {product && (
          <div className="flex flex-wrap gap-1.5">
            {groupA && <Badge cls="bg-red-100 text-red-700">กลุ่ม A · CCP-01 ผัดฆ่าเชื้อ + OPRP-05</Badge>}
            {groupB && <Badge cls="bg-orange-100 text-orange-700">กลุ่ม B · CCP-02 ทอด/เจียว</Badge>}
            {!groupA && !groupB && <Badge cls="bg-gray-100 text-gray-600">ยังไม่อยู่ในแผน HACCP — บันทึกค่าได้ ไม่มีการตัดสิน CCP</Badge>}
          </div>
        )}
      </div>

      {product && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-sm font-bold text-gray-700">กระทะคั่ว / ทอด / เจียว</h2>
            {STEPS.map(([k, label]) => (
              <div key={k} className={`border rounded-lg p-2.5 ${f.fry[k].done ? 'border-orange-200 bg-orange-50/40' : 'border-gray-200'}`}>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 cursor-pointer">
                  <input type="checkbox" checked={f.fry[k].done} onChange={(e) => setFry(k, 'done', e.target.checked)} className="w-4 h-4 accent-orange-600" />{label}
                  {!f.fry[k].done && <span className="text-xs font-normal text-gray-400">(ไม่มีขั้นตอนนี้)</span>}
                </label>
                {f.fry[k].done && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
                    {k === 'chili' && <label className="text-[11px] text-gray-600">ชนิด<select value={f.fry.chili.kind} onChange={(e) => setFry('chili', 'kind', e.target.value)} className={input}>{['พริก', 'เห็ด', 'หมูบด'].map((x) => <option key={x}>{x}</option>)}</select></label>}
                    <label className="text-[11px] text-gray-600">น้ำหนักก่อน (กก.)<Num value={f.fry[k].w_before} onChange={(v) => setFry(k, 'w_before', v)} /></label>
                    <label className="text-[11px] text-gray-600">น้ำหนักหลัง (กก.)<Num value={f.fry[k].w_after} onChange={(v) => setFry(k, 'w_after', v)} /></label>
                    <label className="text-[11px] text-gray-600">อุณหภูมิ (°C) *<Num value={f.fry[k].temp} onChange={(v) => setFry(k, 'temp', v)} /></label>
                    <label className="text-[11px] text-gray-600">เวลาคั่ว/ทอด (นาที) *
                      <Num value={f.fry[k].min} onChange={(v) => setFry(k, 'min', v)} bad={groupB && (k !== 'chili' || f.fry.chili.kind === 'พริก') && below(f.fry[k].min, 'CCP-02', `${k}_min`)} />
                    </label>
                  </div>
                )}
              </div>
            ))}
            {groupB && (
              <div className="flex items-center justify-between gap-2 text-sm"><span>เทอร์โมมิเตอร์วัดน้ำมันผ่านการสอบเทียบ *</span><YesNo value={f.fry_thermo_ok} onChange={(v) => setF((x) => ({ ...x, fry_thermo_ok: v }))} /></div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-2">
            <h2 className="text-sm font-bold text-gray-700">บด (วัด Batch แรกของผลิตภัณฑ์)</h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-gray-600">จำนวนครั้งที่บด<Num value={f.grind.count} onChange={(v) => setSec('grind', 'count', v)} /></label>
              <label className="text-[11px] text-gray-600">น้ำหนักหลังบด (กก.)<Num value={f.grind.w_after} onChange={(v) => setSec('grind', 'w_after', v)} /></label>
            </div>
          </div>

          {groupA ? (
            <div className="bg-white rounded-xl shadow p-4 space-y-2 border-2 border-red-200">
              <h2 className="text-sm font-bold text-red-800">ผัด/กวน ฆ่าเชื้อ — CCP-01 (M01)</h2>
              <div className="text-[11px] text-gray-600">แทง Probe ณ จุดร้อนช้าที่สุด อย่างน้อย 2 จุด · บันทึกเมื่อเริ่มนับเวลา ทุก 30 นาที และเมื่อสิ้นสุด · เกณฑ์ ≥ {lim('CCP-01', 'temp_min').min ?? 85}°C นาน ≥ {lim('CCP-01', 'hold_min').min ?? 120} นาที</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-600">เวลาที่ถึง 85°C (เริ่มนับ) *<input type="time" value={f.ccp1.reach_time} onChange={(e) => setSec('ccp1', 'reach_time', e.target.value)} className={input} /></label>
                <label className="text-[11px] text-gray-600">เวลาสิ้นสุด *<input type="time" value={f.ccp1.end_time} onChange={(e) => setSec('ccp1', 'end_time', e.target.value)} className={input} /></label>
              </div>
              {hold !== null && <div className={`text-xs font-semibold ${hold < (lim('CCP-01', 'hold_min').min ?? 120) ? 'text-red-700' : 'text-green-700'}`}>คงอุณหภูมิ {hold} นาที</div>}
              <div className="text-[11px] text-gray-600">อุณหภูมิแกนกลาง (°C) ตามลำดับเวลา — ค่าแรก = เริ่มนับ, ค่าสุดท้าย = สิ้นสุด *</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {f.ccp1.readings.map((v, i) => <Num key={i} value={v} onChange={(x) => setReading(i, x)} placeholder={i === 0 ? 'เริ่ม' : `+${i * 30} นาที`} bad={v !== '' && Number(v) < (lim('CCP-01', 'temp_min').min ?? 85)} />)}
                {f.ccp1.readings.length < 12 && <button type="button" onClick={() => setF((x) => ({ ...x, ccp1: { ...x.ccp1, readings: [...x.ccp1.readings, ''] } }))} className="text-xs text-teal-700 border border-dashed border-teal-300 rounded-lg flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" />เพิ่มค่า</button>}
              </div>
              <div className="flex items-center justify-between gap-2 text-sm"><span>เทอร์โมมิเตอร์ผ่านการตรวจด้วยน้ำแข็ง (0°C) วันนี้ *</span><YesNo value={f.ccp1.thermo_ok} onChange={(v) => setSec('ccp1', 'thermo_ok', v)} /></div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow p-4 space-y-2">
              <h2 className="text-sm font-bold text-gray-700">ผัด / คลุกเคล้าผสม</h2>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-600">อุณหภูมิ (°C)<Num value={f.heat.temp} onChange={(v) => setSec('heat', 'temp', v)} /></label>
                <label className="text-[11px] text-gray-600">เวลา (นาที)<Num value={f.heat.min} onChange={(v) => setSec('heat', 'min', v)} /></label>
              </div>
            </div>
          )}

          <div className={`bg-white rounded-xl shadow p-4 space-y-2 ${packCp ? 'border-2 border-amber-200' : ''}`}>
            <h2 className="text-sm font-bold text-gray-700">พักให้เย็น / บรรจุ / ปิดฝา{packCp ? ' — OPRP-05' : ''}</h2>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-gray-600">เวลาพักให้เย็น (นาที) *<Num value={f.cool.min} onChange={(v) => setSec('cool', 'min', v)} /></label>
              <label className="text-[11px] text-gray-600">อุณหภูมิขณะบรรจุ (°C) *<Num value={f.cool.fill_temp} onChange={(v) => setSec('cool', 'fill_temp', v)} bad={Number(f.cool.fill_temp) >= 60 && f.cool.fill_temp !== ''} /></label>
              <label className="text-[11px] text-gray-600">อุณหภูมิขณะปิดฝา (°C) *<Num value={f.cool.cap_temp} onChange={(v) => setSec('cool', 'cap_temp', v)} bad={Number(f.cool.cap_temp) >= 60 && f.cool.cap_temp !== ''} /></label>
            </div>
            <div className="text-[11px] text-gray-500">อุณหภูมิขณะบรรจุและขณะปิดฝาต้องต่ำกว่า 60 °C</div>
            <div className="flex items-center justify-between gap-2 text-sm"><span>ไม่มีสิ่งปลอมปน *</span><YesNo value={f.cool.foreign_ok} onChange={(v) => setSec('cool', 'foreign_ok', v)} yes="ไม่พบ" no="พบ" /></div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            {preview.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
                <div className="font-semibold">จะไม่ผ่านเมื่อบันทึก — {user?.auto_ncr ? 'ระบบจะเปิด NCR และกักกัน Batch' : 'แจ้งหัวหน้างาน/QA และกักกัน Batch (ช่วงทดลอง ยังไม่เปิด NCR อัตโนมัติ)'}</div>
                <ul className="list-disc ml-4">{preview.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            <label className="text-xs text-gray-600 block">หมายเหตุ{f.cool.foreign_ok === false ? ' * (สิ่งที่พบและสิ่งที่ทำ)' : ''}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input} /></label>
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
            {canWrite(user) ? (
              <button onClick={save} disabled={saving || !batch.trim()} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
                <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            ) : <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}
            <div className="text-xs text-gray-500">ผู้บันทึก: <b>{user?.display_name}</b></div>
          </div>
        </div>
      )}

      <h2 className="text-sm font-bold text-gray-700 mt-6 mb-2">บันทึกของวันที่ {date}</h2>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {rows.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มี</div>}
        {rows.map((r) => (
          <div key={r.pc_id} className="p-3 text-sm">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-800">{r.product_name || r.product_code} · Batch {r.batch_no}</div>
                <div className="text-[11px] text-gray-500">{r.pc_id} · {r.inspector}</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {r.derived.map((d) => <span key={d.cp_id} className="text-[11px]">{d.cp_id} <ResultBadge result={d.result} />{d.ncr_id && <> <Link to={`/ncr/${d.ncr_id}`} className="underline text-red-700">{d.ncr_id}</Link></>}</span>)}
                  {r.ncr_id && <span className="text-[11px]">สิ่งปลอมปน <Link to={`/ncr/${r.ncr_id}`} className="underline text-red-700">{r.ncr_id}</Link></span>}
                </div>
              </div>
              <Badge cls={r.result === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{r.result === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}

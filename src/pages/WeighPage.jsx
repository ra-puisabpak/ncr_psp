import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Printer, Scale, BookOpen, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import Layout from '../components/Layout'
import { formulaApi, weighApi, qaApi, hygApi } from '../api/d1Api'
import SignaturePad from '../components/SignaturePad'
import { useAuth, canWrite } from '../auth'
import { useMaterials } from '../data/materials'
import { Badge, bkkToday, addDays, newUid } from '../qa/shared'
import { FORMULA_STATUS } from './FormulasPage'
import { FORMS } from '../config'

const input = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const ASSESS = ['QA_MANAGER', 'FSTL', 'SUPERVISOR']
const kg = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })
// The batch number k sets after `base`: B261007-01 → B261007-02; without a trailing number, base-2.
const nextBatch = (base, k) => { const m = /^(.*?)(\d+)$/.exec(base.trim()); return m ? m[1] + String(Number(m[2]) + k).padStart(m[2].length, '0') : `${base.trim()}-${k + 1}` }

export default function WeighPage() {
  const { user } = useAuth()
  const { matLabel: MAT_LABEL } = useMaterials()
  const [formulas, setFormulas] = useState([])
  const [lots, setLots] = useState([])
  const [code, setCode] = useState('')
  const [head, setHead] = useState({ prod_date: bkkToday(), batch_no: '', sets: 1, scale_id: '' })
  const [lines, setLines] = useState([])
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [recent, setRecent] = useState([])
  const [extra, setExtra] = useState([]) // batch numbers of sets 2..N
  // Who weighed (an employee from the list) signs; the logged-in account records.
  const [employees, setEmployees] = useState([])
  const [weigherId, setWeigherId] = useState('')
  const [signature, setSignature] = useState(null)
  const [sigKey, setSigKey] = useState(0)

  const loadRecent = () => weighApi.list({ from: addDays(bkkToday(), -14) }).then(setRecent).catch(() => {})
  useEffect(() => {
    formulaApi.list().then(setFormulas).catch((e) => setError(e.message))
    qaApi.recvLots(180).then(setLots).catch(() => {})
    hygApi.employees().then((l) => setEmployees(l.filter((e) => e.active))).catch(() => {})
    loadRecent()
  }, [])
  const f = formulas.find((x) => x.product_code === code)
  const sets = Math.min(12, Math.max(1, parseInt(head.sets, 10) || 1))
  // Each set is produced and released as its own batch, so each gets its own number.
  useEffect(() => { setExtra(head.batch_no.trim() ? Array.from({ length: sets - 1 }, (_, k) => nextBatch(head.batch_no, k + 1)) : Array(sets - 1).fill('')) }, [head.batch_no, sets])
  const batches = [head.batch_no, ...extra]

  const choose = (c) => {
    setCode(c); setSaved(null); setError(null)
    const fx = formulas.find((x) => x.product_code === c)
    setLines(fx ? fx.items.map((i) => ({ name: i.name, target: i.target, note: i.note, lot: '', doc_no: '', code: '', weights: [] })) : [])
    const day = head.prod_date.slice(2).replace(/-/g, '')
    const n = recent.filter((r) => r.prod_date === head.prod_date && r.product_code === c).length + 1
    setHead((h) => ({ ...h, batch_no: `B${day}-${String(n).padStart(2, '0')}` }))
  }
  const setL = (i, k, v) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const setW = (i, s, v) => setLines((l) => l.map((x, j) => { if (j !== i) return x; const w = [...x.weights]; w[s] = v; return { ...x, weights: w } }))
  const pickLot = (i, value) => {
    const m = lots.find((o) => `${o.lot} · ${MAT_LABEL[o.code] || o.code} · ${o.doc_no}` === value)
    setLines((l) => l.map((x, j) => (j === i ? (m ? { ...x, lot: m.lot, doc_no: m.doc_no, code: m.code } : { ...x, lot: value, doc_no: '', code: '' }) : x)))
  }
  // Live check against the tolerance; the server decides when saving.
  const devs = useMemo(() => {
    if (!f) return []
    const out = []
    lines.forEach((l) => {
      if (l.extra) { if (l.name) out.push(`${l.name} ไม่อยู่ในสูตร`); return }
      if (f.tolerance_pct === null) return
      l.weights.slice(0, sets).forEach((v, s) => {
        if (v === '' || v == null) return
        const pct = ((Number(v) - l.target) / l.target) * 100
        if (Math.abs(pct) > f.tolerance_pct) out.push(`${l.name} ชุดที่ ${s + 1}: ${v} กก. (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`)
      })
    })
    return out
  }, [lines, f, sets])
  const offTarget = (l, v) => {
    if (v === '' || v == null || l.extra || !l.target) return null
    const pct = ((Number(v) - l.target) / l.target) * 100
    if (f?.tolerance_pct != null) return Math.abs(pct) > f.tolerance_pct ? 'bad' : 'ok'
    return Math.abs(pct) > 0.5 ? 'warn' : 'ok'
  }
  const complete = f && lines.every((l) => l.name && Array.from({ length: sets }, (_, s) => l.weights[s]).every((v) => v !== '' && v != null))
  const canAssess = ASSESS.includes(user?.role)

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const emp = employees.find((e) => String(e.emp_id) === weigherId)
      const res = await weighApi.save({ uid, product_code: code, ...head, sets, note, weigher_name: emp?.name || '', emp_id: emp?.emp_id, signature, ...(sets > 1 ? { batches: batches.map((x) => x.trim()) } : {}),
        lines: lines.map((l) => ({ name: l.name, lot: l.lot, doc_no: l.doc_no, code: l.code, weights: Array.from({ length: sets }, (_, s) => l.weights[s]) })) })
      setSaved(res); setUid(newUid()); setCode(''); setLines([]); setNote(''); setSigKey((k) => k + 1)
      loadRecent(); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Scale className="w-5 h-5 text-violet-600" />บันทึกการชั่งวัตถุดิบ</h1>
          <div className="text-xs text-gray-500">{FORMS.WEIGH.code} Rev.{FORMS.WEIGH.rev} · ทุก Batch · เลือก LOT จากใบตรวจรับเพื่อการสอบย้อนกลับ</div>
        </div>
        <div className="flex gap-2">
          <Link to={`/qa/weigh/day?date=${bkkToday()}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />สรุปรายวัน</Link>
          <Link to="/qa/formulas" className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><BookOpen className="w-4 h-4" />สูตรการผลิต</Link>
        </div>
      </div>

      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm font-semibold flex items-center gap-2 ${saved.result === 'PASS' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
          {saved.result === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          <span className="flex-1">บันทึกแล้ว{(saved.records || []).length > 1 ? ` ${saved.records.length} Batch` : ''}{saved.result === 'DEVIATION' ? ' — มีรายการนอกเกณฑ์ (ประเมินแล้ว)' : ''}
            {(saved.records || [{ wr_id: saved.wr_id }]).map((x) => (
              <span key={x.wr_id} className="block font-normal">{x.wr_id}{x.batch_no ? ` · Batch ${x.batch_no}` : ''} · <Link to={`/qa/weigh/${x.wr_id}/print`} className="underline">พิมพ์ {FORMS.WEIGH.code}</Link></span>
            ))}
          </span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-3 mb-4">
        <label className="text-xs text-gray-600 block">ผลิตภัณฑ์ *
          <select value={code} onChange={(e) => choose(e.target.value)} className={input}>
            <option value="">-- เลือกผลิตภัณฑ์ --</option>
            {formulas.map((x) => <option key={x.product_code} value={x.product_code}>{x.product_code} · {x.product_name}</option>)}
          </select>
        </label>
        {f && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Badge cls={FORMULA_STATUS[f.status][1]}>สูตร v{f.version} · {FORMULA_STATUS[f.status][0]}</Badge>
              <Badge cls={f.tolerance_pct === null ? 'bg-gray-100 text-gray-500' : 'bg-sky-100 text-sky-800'}>{f.tolerance_pct === null ? 'ยังไม่กำหนด Tolerance (แจ้งเตือนอย่างเดียว)' : `Tolerance ±${f.tolerance_pct}%`}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">วันที่ผลิต<input type="date" max={bkkToday()} value={head.prod_date} onChange={(e) => setHead((h) => ({ ...h, prod_date: e.target.value || bkkToday() }))} className={input} /></label>
              <label className="text-xs text-gray-600">{sets > 1 ? 'เลขที่ Batch ชุดที่ 1 *' : 'เลขที่ Batch *'}<input value={head.batch_no} maxLength={60} onChange={(e) => setHead((h) => ({ ...h, batch_no: e.target.value }))} className={input} /></label>
              <label className="text-xs text-gray-600">จำนวนชุด (1–12)<input type="number" min="1" max="12" value={head.sets} onChange={(e) => setHead((h) => ({ ...h, sets: e.target.value }))} className={input} /></label>
              <label className="text-xs text-gray-600">รหัสเครื่องชั่ง<input value={head.scale_id} onChange={(e) => setHead((h) => ({ ...h, scale_id: e.target.value }))} placeholder="เช่น MDB009" className={input} /></label>
            </div>
            {sets > 1 && (
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-2.5">
                <div className="text-xs text-violet-900 mb-1.5">ผลิต {sets} ชุด = {sets} Batch แยกกัน (แต่ละชุดมีบันทึกการชั่ง แบบฟอร์มควบคุมการผลิต และการปล่อยสินค้าของตัวเอง)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {extra.map((x, k) => (
                    <label key={k} className="text-xs text-gray-600">Batch ชุดที่ {k + 2} *<input value={x} maxLength={60} onChange={(e) => setExtra((l) => l.map((y, j) => (j === k ? e.target.value : y)))} className={input} /></label>
                  ))}
                </div>
                {new Set(batches.map((x) => x.trim())).size !== batches.length && <div className="text-xs text-red-700 mt-1">เลขที่ Batch ของแต่ละชุดต้องไม่ซ้ำกัน</div>}
              </div>
            )}
            <datalist id="recv-lots">{lots.map((o) => <option key={`${o.doc_no}-${o.lot}-${o.code}`} value={`${o.lot} · ${MAT_LABEL[o.code] || o.code} · ${o.doc_no}`} />)}</datalist>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className={`border rounded-lg p-2.5 ${l.extra ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                  <div className="flex items-start gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      {l.extra ? <input value={l.name} onChange={(e) => setL(i, 'name', e.target.value)} placeholder="ชื่อวัตถุดิบนอกสูตร" className={input} />
                        : <div className="text-sm font-semibold text-gray-800">{i + 1}. {l.name} <span className="font-normal text-gray-500">· กำหนด {kg(l.target)} กก./ชุด</span></div>}
                      {l.note && <div className="text-[11px] text-red-700">{l.note}</div>}
                    </div>
                    {l.extra && <button type="button" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  <input list="recv-lots" value={l.lot && l.doc_no ? `${l.lot} · ${MAT_LABEL[l.code] || l.code} · ${l.doc_no}` : l.lot} onChange={(e) => pickLot(i, e.target.value)} placeholder="LOT วัตถุดิบ (ถ้ามี — พิมพ์เพื่อค้นจากใบตรวจรับ)" className={`${input} mb-1.5`} />
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {Array.from({ length: sets }, (_, s) => {
                      const st = offTarget(l, l.weights[s])
                      return <input key={s} type="number" inputMode="decimal" step="0.001" min="0" value={l.weights[s] ?? ''} placeholder={sets > 1 ? `ชุด ${s + 1} · ${batches[s] || ''}` : `ชุดที่ ${s + 1}`} onChange={(e) => setW(i, s, e.target.value)}
                        className={`${input} ${st === 'bad' ? 'border-red-400 bg-red-50' : st === 'warn' ? 'border-amber-300 bg-amber-50' : st === 'ok' ? 'border-green-300 bg-green-50' : ''}`} />
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setLines((l) => [...l, { name: '', target: null, extra: true, lot: '', doc_no: '', code: '', weights: [] }])} className="text-xs text-amber-700 font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" />เพิ่มวัตถุดิบนอกสูตร (ต้องให้หัวหน้างาน/QA ประเมิน)</button>
            {devs.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
                <div className="font-semibold mb-0.5">หยุดก่อนนำไปผลิต — ต้องให้หัวหน้างาน / QA ประเมินและบันทึก</div>
                <ul className="list-disc ml-4">{devs.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            )}
            <label className="text-xs text-gray-600 block">หมายเหตุ{devs.length ? ' / ผลการประเมิน *' : ''}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input} /></label>
            <div className="grid sm:grid-cols-2 gap-3 border border-gray-200 rounded-lg p-2.5">
              <div className="space-y-2">
                <label className="text-xs text-gray-600 block">ผู้ชั่ง *<select value={weigherId} onChange={(e) => setWeigherId(e.target.value)} className={input}>
                  <option value="">-- เลือกชื่อผู้ชั่ง --</option>
                  {employees.map((e) => <option key={e.emp_id} value={e.emp_id}>{e.name}{e.dept ? ` · ${e.dept}` : ''}</option>)}
                </select></label>
                {employees.length === 0 && <div className="text-[11px] text-amber-700">ยังไม่มีรายชื่อพนักงาน — QA เพิ่มได้ที่ สุขลักษณะส่วนบุคคล → หัวข้อ / พนักงาน</div>}
                <div className="text-xs text-gray-500">ผู้บันทึก (QC): <b>{user?.display_name}</b></div>
              </div>
              <div><div className="text-xs text-gray-600 mb-1">ลายเซ็นผู้ชั่ง *</div><SignaturePad onChange={setSignature} resetKey={sigKey} /></div>
            </div>
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
            {canWrite(user) ? (
              <button onClick={save} disabled={saving || !complete || !weigherId || !signature || batches.some((x) => !x.trim()) || new Set(batches.map((x) => x.trim())).size !== batches.length || (devs.length > 0 && (!canAssess || !note.trim()))}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
                <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : devs.length && !canAssess ? 'ต้องให้หัวหน้างาน / QA บันทึก' : 'บันทึก'}
              </button>
            ) : <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}

          </>
        )}
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">บันทึกการชั่ง 14 วันล่าสุด</h2>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {recent.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มี</div>}
        {recent.map((r) => (
          <Link key={r.wr_id} to={`/qa/weigh/${r.wr_id}/print`} className="block p-3 text-sm hover:bg-gray-50">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-800">{r.product_name} · Batch {r.batch_no}</div>
                <div className="text-[11px] text-gray-500">{r.wr_id} · {r.prod_date} · {r.sets} ชุด · {r.lines.length} รายการ · ผู้ชั่ง {r.weigher_name || r.weigher}{r.weigher_name ? ` · บันทึกโดย ${r.weigher}` : ''}</div>
              </div>
              <Badge cls={r.result === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}>{r.result === 'PASS' ? 'ตามสูตร' : 'นอกเกณฑ์ (ประเมินแล้ว)'}</Badge>
            </div>
          </Link>
        ))}
      </div>
    </Layout>
  )
}

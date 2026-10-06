import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Search, CheckCircle2, XCircle, AlertTriangle, CircleDashed, ShieldCheck, Plus, Trash2, PackageCheck, PauseCircle, Ban,
} from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi, weighApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { PRODUCTS, MATERIALS, byCode } from '../data/masterData'
import { Badge, CP_TYPE_CLS, CP_TYPE_TH, bkkToday, addDays } from '../qa/shared'
import { FORMS } from '../config'

const MAT_LABEL = byCode(MATERIALS)
const PRODUCT_LABEL = byCode(PRODUCTS)
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `rel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

const STATE = {
  PASS: { label: 'ผ่าน', cls: 'bg-green-100 text-green-700', icon: CheckCircle2, color: 'text-green-600' },
  CONCESSION: { label: 'ผ่านโดย NCR ตัดสินปล่อย', cls: 'bg-amber-100 text-amber-800', icon: AlertTriangle, color: 'text-amber-600' },
  FAIL: { label: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-700', icon: XCircle, color: 'text-red-600' },
  MISSING: { label: 'ยังไม่มีบันทึก', cls: 'bg-gray-100 text-gray-600', icon: CircleDashed, color: 'text-gray-400' },
}
export const DECISION = {
  RELEASE: { label: 'ปล่อยสินค้า', cls: 'bg-green-100 text-green-700' },
  HOLD: { label: 'กักไว้', cls: 'bg-amber-100 text-amber-800' },
  REJECT: { label: 'ไม่ปล่อย', cls: 'bg-red-100 text-red-700' },
}
const CHECKS = [
  ['label_ok', 'ฉลาก วันผลิต วันหมดอายุ และเลขล็อตถูกต้องตรงสูตร'],
  ['pack_ok', 'บรรจุภัณฑ์ ฝา และรอยซีลสมบูรณ์'],
  ['spec_ok', 'ผลตรวจผลิตภัณฑ์สำเร็จรูปเป็นไปตาม Specification (QC_10)'],
]

function Gate({ gate }) {
  const released = (gate.history || []).find((r) => r.decision === 'RELEASE')
  const ok = gate.releasable || released
  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-3">
      <div className={`rounded-lg p-3 text-sm font-semibold flex items-center gap-2 ${ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
        {ok ? <ShieldCheck className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
        {released ? `Batch นี้ปล่อยแล้ว (${released.rel_id})` : gate.releasable ? 'บันทึกครบและผ่าน พร้อมให้ QA ตัดสินปล่อย' : 'ยังปล่อยไม่ได้'}
      </div>
      {!ok && (
        <ul className="text-xs text-red-700 list-disc ml-5 space-y-0.5">{gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">จุดควบคุมที่ต้องผ่านก่อนปล่อย</div>
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {gate.requirements.length === 0 && <div className="p-3 text-xs text-gray-400">ไม่มี</div>}
          {gate.requirements.map((q) => {
            const s = STATE[q.state]
            return (
              <div key={q.cp_id} className="p-2.5 flex items-center gap-2 text-sm">
                <s.icon className={`w-5 h-5 shrink-0 ${s.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-800 truncate">{q.cp_id} · {q.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {q.rec_id ? <>{q.rec_id} · {q.record_date} {q.record_time || ''}</> : 'ยังไม่มีบันทึกสำหรับ Batch นี้'}
                    {q.ncr_id && <> · <Link to={`/ncr/${q.ncr_id}`} className="text-red-700 underline">{q.ncr_id}</Link></>}
                  </div>
                </div>
                <Badge cls={CP_TYPE_CLS[q.cp_type]}>{CP_TYPE_TH[q.cp_type]}</Badge>
                <Badge cls={s.cls}>{s.label}</Badge>
              </div>
            )
          })}
        </div>
      </div>
      {gate.ncrs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">NCR ของ Batch นี้</div>
          <div className="flex flex-wrap gap-1.5">
            {gate.ncrs.map((n) => (
              <Link key={n.ncr_id} to={`/ncr/${n.ncr_id}`} className={`text-xs px-2 py-1 rounded-lg border ${['Closed', 'Cancelled'].includes(n.status) ? 'border-gray-200 text-gray-600' : 'border-red-300 text-red-700 bg-red-50'}`}>
                {n.ncr_id} · {n.status}{n.disposition ? ` · ${n.disposition}` : ''}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LotPicker({ lots, setLots }) {
  const [options, setOptions] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => { qaApi.recvLots(180).then(setOptions).catch(() => setOptions([])) }, [])
  const chosen = new Set(lots.map((l) => l.lot))
  const found = q.length < 2 ? [] : options.filter((o) => !chosen.has(o.lot) &&
    `${o.lot} ${o.code} ${MAT_LABEL[o.code] || ''} ${o.supplier}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
  const add = (l) => { setLots([...lots, l]); setQ('') }
  return (
    <div>
      <div className="text-xs text-gray-600 mb-1">ล็อตวัตถุดิบที่ใช้ (ถ้ามี · ค้นจากใบตรวจรับ FM-QC-001 ย้อนหลัง 180 วัน หรือพิมพ์เพิ่มเอง)</div>
      <div className="space-y-1.5 mb-2">
        {lots.map((l, i) => (
          <div key={`${l.lot}-${i}`} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{l.lot}</span> · {l.name || MAT_LABEL[l.code] || l.code || '-'}
              {l.doc_no && <span className="text-[11px] text-gray-500"> · {l.doc_no}</span>}
            </div>
            <button type="button" onClick={() => setLots(lots.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์เลขล็อต รหัส หรือชื่อวัตถุดิบ" className={input} />
        <button type="button" disabled={!q.trim()} onClick={() => add({ code: '', name: '', lot: q.trim(), doc_no: '' })}
          className="shrink-0 flex items-center gap-1 text-sm px-3 rounded-lg bg-gray-100 disabled:opacity-40"><Plus className="w-4 h-4" />เพิ่มเอง</button>
      </div>
      {found.length > 0 && (
        <div className="border border-gray-200 rounded-lg mt-1 divide-y divide-gray-100 bg-white shadow-sm">
          {found.map((o) => (
            <button type="button" key={`${o.doc_no}-${o.lot}-${o.code}`} onClick={() => add({ code: o.code, name: MAT_LABEL[o.code] || '', lot: o.lot, doc_no: o.doc_no })}
              className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50">
              <span className="font-semibold">{o.lot}</span> · {MAT_LABEL[o.code] || o.code}
              <div className="text-[11px] text-gray-500">{o.doc_no} · รับ {o.recv_date} · {o.supplier}{o.exp ? ` · หมดอายุ ${o.exp}` : ''}{o.result && o.result !== 'PASS' ? ` · ${o.result}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DecisionForm({ gate, onSaved }) {
  const [f, setF] = useState({ qty: '', unit: 'กระปุก', mfg_date: bkkToday(), exp_date: '', note: '' })
  const [lots, setLots] = useState([])
  const [weighed, setWeighed] = useState(null)
  // The lots this batch weighed fill the list, so traceability needs no retyping.
  useEffect(() => {
    weighApi.list({ product_code: gate.product_code, batch_no: gate.batch_no }).then((l) => {
      const w = l[0]; setWeighed(w || false)
      if (w) {
        setLots(w.lines.map((x) => ({ code: x.code || '', name: x.name, lot: x.lot, doc_no: x.doc_no || '' })))
        setF((v) => ({ ...v, mfg_date: w.prod_date }))
      }
    }).catch(() => setWeighed(false))
  }, [gate.product_code, gate.batch_no])
  const [checks, setChecks] = useState({})
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const decide = async (decision) => {
    setSaving(true); setError(null)
    try {
      const res = await qaApi.saveRelease({ uid, product_code: gate.product_code, product_name: PRODUCT_LABEL[gate.product_code] || '', batch_no: gate.batch_no,
        decision, ...f, rm_lots: lots, checks })
      setUid(newUid()); onSaved(res)
    } catch (e) { setError({ message: e.message, reasons: e.data?.reasons || [] }) }
    finally { setSaving(false) }
  }
  const allChecked = CHECKS.every(([k]) => checks[k])
  const ready = gate.releasable && allChecked && f.mfg_date && f.exp_date

  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-4">
      <h2 className="text-sm font-bold text-gray-700">การตัดสินของ QA</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="text-xs text-gray-600">จำนวน<input type="number" min="0" step="any" value={f.qty} onChange={set('qty')} className={input} /></label>
        <label className="text-xs text-gray-600">หน่วย<input value={f.unit} onChange={set('unit')} className={input} /></label>
        <label className="text-xs text-gray-600">วันผลิต *<input type="date" value={f.mfg_date} onChange={set('mfg_date')} className={input} /></label>
        <label className="text-xs text-gray-600">วันหมดอายุ *<input type="date" value={f.exp_date} min={f.mfg_date} onChange={set('exp_date')} className={input} /></label>
      </div>
      {weighed && <div className="text-[11px] text-green-700">ดึงล็อตวัตถุดิบ {weighed.lines.length} รายการจากบันทึกการชั่ง {weighed.wr_id} แล้ว</div>}
      {weighed === false && <div className="text-[11px] text-amber-700">ไม่พบบันทึกการชั่ง ({FORMS.WEIGH.code}) ของ Batch นี้ — ระบุล็อตเอง</div>}
      <LotPicker lots={lots} setLots={setLots} />
      <div className="space-y-2">
        {CHECKS.map(([k, label]) => (
          <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-teal-600" />
            {label}
          </label>
        ))}
      </div>
      <label className="text-xs text-gray-600 block">หมายเหตุ / เหตุผล (ต้องระบุเมื่อกักหรือไม่ปล่อย)
        <textarea rows={2} value={f.note} onChange={set('note')} className={input} />
      </label>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          {error.message}
          {error.reasons.length > 0 && <ul className="list-disc ml-5 mt-1 text-xs">{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button disabled={saving || !ready} onClick={() => decide('RELEASE')} title={ready ? '' : 'ต้องผ่านทุกเงื่อนไข ยืนยันการตรวจครบ และระบุวันผลิตกับวันหมดอายุ'}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
          <PackageCheck className="w-4 h-4" />ปล่อยสินค้า
        </button>
        <button disabled={saving} onClick={() => decide('HOLD')} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
          <PauseCircle className="w-4 h-4" />กักไว้
        </button>
        <button disabled={saving} onClick={() => decide('REJECT')} className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
          <Ban className="w-4 h-4" />ไม่ปล่อย
        </button>
      </div>
      <div className="text-[11px] text-gray-500">ระบบตรวจเงื่อนไขซ้ำที่หลังบ้านทุกครั้ง และเก็บสถานะของทุกจุดควบคุม ณ เวลาตัดสินไว้กับบันทึก</div>
    </div>
  )
}

export function ReleaseRow({ r }) {
  return (
    <div className="p-3 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-800">{r.product_name || r.product_code} · Batch {r.batch_no}</div>
          <div className="text-[11px] text-gray-500">
            {r.rel_id} · {String(r.created_at).slice(0, 16).replace('T', ' ')} · {r.decided_by}
            {r.qty != null && ` · ${r.qty} ${r.unit || ''}`}{r.exp_date && ` · หมดอายุ ${r.exp_date}`}
          </div>
          {r.rm_lots.length > 0 && <div className="text-[11px] text-gray-600 mt-0.5">ล็อตวัตถุดิบ: {r.rm_lots.map((l) => l.lot).join(', ')}</div>}
          {r.note && <div className="text-[11px] text-gray-600">หมายเหตุ: {r.note}</div>}
        </div>
        <Badge cls={DECISION[r.decision].cls}>{DECISION[r.decision].label}</Badge>
      </div>
    </div>
  )
}

export default function FGReleasePage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [product, setProduct] = useState(params.get('product') || '')
  const [batch, setBatch] = useState(params.get('batch') || '')
  const [gate, setGate] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(null)
  const [recent, setRecent] = useState([])

  const loadRecent = () => qaApi.releases({ from: addDays(bkkToday(), -30) }).then(setRecent).catch(() => {})
  useEffect(() => { loadRecent() }, [])

  const check = async (e, keepSaved = false) => {
    e?.preventDefault()
    if (!product || !batch.trim()) return
    setLoading(true); setError(null)
    if (!keepSaved) setSaved(null)
    try { setGate(await qaApi.releaseCheck(product, batch.trim())) } catch (err) { setError(err.message); setGate(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (product && batch) check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const history = useMemo(() => gate?.history || [], [gate])

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <h1 className="text-lg font-bold text-gray-800 mb-1">FG Release — ตรวจปล่อยสินค้าสำเร็จรูป</h1>
      <div className="text-xs text-gray-500 mb-3">ปล่อยได้เมื่อจุดควบคุมที่กำหนดของ Batch ผ่านครบ และไม่มี NCR ค้าง · ตัดสินได้เฉพาะ QA Manager / FSTL</div>

      <form onSubmit={check} className="bg-white rounded-xl shadow p-4 mb-4 grid sm:grid-cols-[1fr_200px_auto] gap-3 items-end">
        <label className="text-xs text-gray-600">ผลิตภัณฑ์
          <select value={product} onChange={(e) => { setProduct(e.target.value); setGate(null) }} className={input}>
            <option value="">-- เลือกผลิตภัณฑ์ --</option>
            {PRODUCTS.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">เลขที่ Batch
          <input value={batch} onChange={(e) => { setBatch(e.target.value); setGate(null) }} maxLength={60} placeholder="เช่น B261004-01" className={input} />
        </label>
        <button disabled={!product || !batch.trim() || loading} className="flex items-center justify-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
          <Search className="w-4 h-4" />{loading ? 'กำลังตรวจ…' : 'ตรวจสอบ'}
        </button>
      </form>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}
      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm font-semibold ${DECISION[saved.decision].cls}`}>
          บันทึก {saved.rel_id} แล้ว — {DECISION[saved.decision].label}
        </div>
      )}

      {gate && (
        <div className="space-y-4 mb-6">
          <Gate gate={gate} />
          {history.length > 0 && (
            <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
              <div className="p-3 text-xs font-semibold text-gray-600">ประวัติการตัดสินของ Batch นี้</div>
              {history.map((r) => <ReleaseRow key={r.rel_id} r={r} />)}
            </div>
          )}
          {isQA(user) && !history.some((r) => r.decision === 'RELEASE') && (
            <DecisionForm key={`${gate.product_code}|${gate.batch_no}`} gate={gate}
              onSaved={(res) => { setSaved(res); loadRecent(); check(null, true) }} />
          )}
        </div>
      )}

      <h2 className="text-sm font-bold text-gray-700 mb-2">การตัดสิน 30 วันล่าสุด</h2>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {recent.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มี</div>}
        {recent.map((r) => <ReleaseRow key={r.rel_id} r={r} />)}
      </div>
    </Layout>
  )
}

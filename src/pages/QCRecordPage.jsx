import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Save, Info } from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi } from '../api/d1Api'
import { useAuth, canWrite } from '../auth'
import { PRODUCTS, PROCESSES, byCode } from '../data/masterData'
import {
  CP_TYPE_TH, CP_TYPE_CLS, CP_STATUS_TH, CP_STATUS_CLS, SHIFTS, Badge, limitText, judge, bkkToday, bkkTime,
} from '../qa/shared'

const PROCESS_LABEL = byCode(PROCESSES)
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `qc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'

export default function QCRecordPage() {
  const { cpId } = useParams()
  const { user } = useAuth()
  const [cp, setCp] = useState(null)
  const [error, setError] = useState(null)
  const [head, setHead] = useState({ record_date: bkkToday(), record_time: bkkTime(), shift: '', product_code: '', batch_no: '' })
  const [values, setValues] = useState({})
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    qaApi.controlPoints()
      .then((list) => { const c = list.find((x) => x.cp_id === cpId); if (c) setCp(c); else setError('ไม่พบจุดควบคุมนี้') })
      .catch((e) => setError(e.message))
  }, [cpId])

  const products = useMemo(() => (cp?.products?.length ? PRODUCTS.filter((p) => cp.products.includes(p.code)) : PRODUCTS), [cp])
  const verdicts = cp ? cp.params.map((p) => judge(p, values[p.key])) : []
  const anyFail = verdicts.includes('fail')
  const writable = canWrite(user) && cp && cp.status !== 'RETIRED'

  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }))
  const setV = (k, v) => setValues((s) => ({ ...s, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setSaving(true)
    try {
      const product = PRODUCTS.find((p) => p.code === head.product_code)
      const res = await qaApi.saveRecord({ uid, cp_id: cp.cp_id, ...head, product_name: product?.label || '', values, note })
      setSaved(res)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  // Next check of the same batch: keep the batch details, clear the readings, new record identity.
  const next = () => { setSaved(null); setValues({}); setNote(''); setUid(newUid()); setHead((h) => ({ ...h, record_time: bkkTime() })) }

  if (!cp) {
    return <Layout><div className="text-sm text-gray-500 p-6 text-center">{error || 'กำลังโหลด…'}</div></Layout>
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />Smart QA</Link>
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs font-mono text-gray-500">{cp.cp_id} · v{cp.version}</span>
          <Badge cls={CP_TYPE_CLS[cp.cp_type]}>{CP_TYPE_TH[cp.cp_type]}</Badge>
          <Badge cls={CP_STATUS_CLS[cp.status]}>{CP_STATUS_TH[cp.status]}</Badge>
        </div>
        <h1 className="text-lg font-bold text-gray-800">{cp.name}</h1>
        <div className="text-xs text-gray-500 mt-0.5">
          {cp.process_ref && <>ขั้นตอน {cp.process_ref} {PROCESS_LABEL[cp.process_ref] || ''} · </>}อันตราย: {cp.hazard || '-'}
        </div>
        <div className="text-xs text-gray-600 mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
          <div><span className="text-gray-400">วิธีเฝ้าระวัง:</span> {cp.monitoring || '-'}</div>
          <div><span className="text-gray-400">ความถี่:</span> {cp.frequency || '-'}</div>
        </div>
        {cp.status === 'DRAFT' && (
          <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            เกณฑ์ของจุดควบคุมนี้ยังเป็นฉบับร่าง รอ HACCP Team validate ระบบยังบันทึกและเปิด NCR ให้เมื่อค่าไม่ผ่านเกณฑ์ร่าง
          </div>
        )}
      </div>

      {saved && (
        <div className={`rounded-xl p-4 mb-4 border ${saved.result === 'PASS' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className={`flex items-center gap-2 font-bold ${saved.result === 'PASS' ? 'text-green-700' : 'text-red-700'}`}>
            {saved.result === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            บันทึก {saved.rec_id} แล้ว — {saved.result === 'PASS' ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์'}
          </div>
          {saved.ncr_id && (
            <div className="text-sm text-red-800 mt-2">
              ระบบเปิด <Link to={`/ncr/${saved.ncr_id}`} className="font-bold underline">{saved.ncr_id}</Link> และกำหนดให้กักกัน Batch {head.batch_no} รอ QA ตัดสิน
              <ul className="list-disc ml-5 mt-1 text-xs">
                {(saved.failed || []).map((f) => <li key={f.key}>{f.label}: {f.value} (เกณฑ์ {f.limit})</li>)}
              </ul>
            </div>
          )}
          <button onClick={next} className="mt-3 bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-gray-50">บันทึกรายการถัดไป</button>
        </div>
      )}

      {!saved && (
        <form onSubmit={submit} className="bg-white rounded-xl shadow p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-xs text-gray-600">วันที่ตรวจ *
              <input type="date" required max={bkkToday()} value={head.record_date} onChange={setH('record_date')} className={input} />
            </label>
            <label className="text-xs text-gray-600">เวลา
              <input type="time" value={head.record_time} onChange={setH('record_time')} className={input} />
            </label>
            <label className="text-xs text-gray-600">กะ
              <select value={head.shift} onChange={setH('shift')} className={input}>
                <option value="">-</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">เลขที่ Batch *
              <input required maxLength={60} value={head.batch_no} onChange={setH('batch_no')} placeholder="เช่น B261004-01" className={input} />
            </label>
          </div>
          <label className="text-xs text-gray-600 block">ผลิตภัณฑ์{cp.products?.length ? ' *' : ''}
            <select required={!!cp.products?.length} value={head.product_code} onChange={setH('product_code')} className={input}>
              <option value="">-- เลือกผลิตภัณฑ์ --</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
            </select>
          </label>

          <div className="space-y-3">
            {cp.params.map((p, i) => {
              const v = verdicts[i]
              const ring = v === 'fail' ? 'border-red-400 bg-red-50' : v === 'pass' ? 'border-green-400 bg-green-50' : 'border-gray-200'
              return (
                <div key={p.key} className={`border rounded-lg p-3 ${ring}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-sm font-semibold text-gray-800">{p.label}{p.type !== 'text' && ' *'}</div>
                    <div className="text-[11px] text-gray-500 whitespace-nowrap">เกณฑ์: {limitText(p)}</div>
                  </div>
                  {p.type === 'number' && (
                    <div className="flex items-center gap-2">
                      <input type="number" inputMode="decimal" step="any" required value={values[p.key] ?? ''}
                        onChange={(e) => setV(p.key, e.target.value)} className={`${input} max-w-[180px]`} />
                      <span className="text-sm text-gray-500">{p.unit}</span>
                    </div>
                  )}
                  {p.type === 'check' && (
                    <div className="flex gap-2">
                      {[[true, 'ใช่', 'bg-green-600'], [false, 'ไม่ใช่', 'bg-red-600']].map(([val, label, on]) => (
                        <button type="button" key={label} onClick={() => setV(p.key, val)}
                          className={`flex-1 sm:flex-none sm:w-28 py-2 rounded-lg text-sm font-semibold border transition ${values[p.key] === val ? `${on} text-white border-transparent` : 'bg-white text-gray-600 border-gray-300'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {p.type === 'text' && (
                    <input maxLength={200} value={values[p.key] ?? ''} onChange={(e) => setV(p.key, e.target.value)} className={input} />
                  )}
                  {v === 'fail' && <div className="text-xs text-red-700 font-semibold mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />ไม่ผ่านเกณฑ์</div>}
                </div>
              )
            })}
          </div>

          <label className="text-xs text-gray-600 block">หมายเหตุ
            <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          </label>
          <div className="text-xs text-gray-500">ผู้ตรวจ: <b>{user?.display_name}</b> (บันทึกจากบัญชีที่เข้าสู่ระบบ)</div>

          {anyFail && (
            <div className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg p-2.5">
              มีรายการไม่ผ่านเกณฑ์ เมื่อบันทึก ระบบจะเปิด NCR และกำหนดให้กักกัน Batch นี้ทันที
              {cp.corrective_action && <div className="mt-1"><b>การแก้ไขตามแผน:</b> {cp.corrective_action}</div>}
            </div>
          )}
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
          {writable ? (
            <button disabled={saving} className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold ${anyFail ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'} disabled:opacity-50`}>
              <Save className="w-4 h-4" />{saving ? 'กำลังบันทึก…' : anyFail ? 'บันทึกและเปิด NCR' : 'บันทึก'}
            </button>
          ) : (
            <div className="text-sm text-gray-500">{cp.status === 'RETIRED' ? 'จุดควบคุมนี้ยกเลิกการใช้งานแล้ว' : 'บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้'}</div>
          )}
        </form>
      )}
    </Layout>
  )
}

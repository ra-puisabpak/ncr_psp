import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, UserPlus, Printer, Settings, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import Layout from '../components/Layout'
import { hygApi } from '../api/d1Api'
import { useAuth, canWrite } from '../auth'
import { SHIFTS, bkkToday, bkkTime } from '../qa/shared'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `hyg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
export const ACTION_TH = { CORRECTED: 'แก้ไขทันทีและตรวจซ้ำผ่าน', EXCLUDED: 'ไม่อนุญาตให้เข้าพื้นที่ผลิต' }

export default function HygienePage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [emps, setEmps] = useState([])
  const [today, setToday] = useState([])
  const [head, setHead] = useState({ inspect_date: bkkToday(), shift: '' })
  const [empId, setEmpId] = useState('')
  const [empQuery, setEmpQuery] = useState('')
  const [newEmp, setNewEmp] = useState({ name: '', dept: '' })
  const [answers, setAnswers] = useState({})
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [last, setLast] = useState(null)

  const loadToday = () => hygApi.records({ date: head.inspect_date }).then(setToday).catch(() => {})
  useEffect(() => {
    hygApi.items().then((list) => setItems(list.filter((i) => i.active))).catch((e) => setError(e.message))
    hygApi.employees().then(setEmps).catch(() => {})
  }, [])
  useEffect(() => { loadToday() }, [head.inspect_date]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = emps.filter((e) => e.active)
  const checkedToday = new Set(today.map((r) => r.emp_id))
  const shown = active.filter((e) => !empQuery || `${e.name} ${e.dept || ''}`.toLowerCase().includes(empQuery.toLowerCase()))
  const done = items.filter((i) => answers[i.item_key]).length
  const failed = items.filter((i) => answers[i.item_key] === 'F')
  const critical = failed.some((i) => i.critical)
  useEffect(() => { if (critical) setAction('EXCLUDED') }, [critical])
  const writable = canWrite(user)

  const addEmp = async () => {
    setError(null)
    try {
      const e = await hygApi.addEmployee(newEmp)
      setEmps((l) => [...l, e]); setEmpId(String(e.emp_id)); setNewEmp({ name: '', dept: '' }); setEmpQuery('')
    } catch (err) { setError(err.message) }
  }
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await hygApi.save({ uid, ...head, inspect_time: bkkTime(), emp_id: empId, results: answers, action: failed.length ? action : null, note })
      const emp = emps.find((e) => String(e.emp_id) === String(empId))
      setLast({ ...res, name: emp?.name })
      // next person: keep date and shift, clear the rest
      setAnswers({}); setAction(''); setNote(''); setEmpId(''); setEmpQuery(''); setUid(newUid())
      loadToday()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const summary = useMemo(() => ({ total: today.length, fail: today.filter((r) => r.result === 'FAIL').length }), [today])

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ตรวจสุขลักษณะส่วนบุคคลก่อนเข้างาน</h1>
          <div className="text-xs text-gray-500">GHPs · ตรวจทุกคนก่อนเข้าพื้นที่ผลิต · วันนี้ตรวจแล้ว {summary.total} คน ไม่ผ่าน {summary.fail} คน</div>
        </div>
        <div className="flex gap-2">
          <Link to={`/qa/hygiene/report?date=${head.inspect_date}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />รายงาน A4</Link>
          <Link to="/qa/hygiene/setup" className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Settings className="w-4 h-4" />หัวข้อ / พนักงาน</Link>
        </div>
      </div>

      {last && (
        <div className={`rounded-xl p-3 mb-4 text-sm border ${last.result === 'PASS' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <div className="font-semibold flex items-center gap-2">
            {last.result === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {last.rec_id} · {last.name} — {last.result === 'PASS' ? 'ผ่าน' : `ไม่ผ่าน (${ACTION_TH[last.action]})`}
          </div>
          {last.action === 'EXCLUDED' && <div className="text-xs mt-1">ห้ามเข้าพื้นที่ผลิตจนกว่าจะแก้ไขเรียบร้อยและตรวจซ้ำผ่าน</div>}
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">วันที่ตรวจ
            <input type="date" max={bkkToday()} value={head.inspect_date} onChange={(e) => setHead((h) => ({ ...h, inspect_date: e.target.value || bkkToday() }))} className={input} />
          </label>
          <label className="text-xs text-gray-600">กะ
            <select value={head.shift} onChange={(e) => setHead((h) => ({ ...h, shift: e.target.value }))} className={input}>
              <option value="">-</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">พนักงานที่ถูกตรวจ *</div>
          <input value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} placeholder="ค้นหาชื่อหรือแผนก" className={`${input} mb-1.5`} />
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className={input} size={Math.min(6, Math.max(2, shown.length + 1))}>
            <option value="" disabled>-- เลือกพนักงาน ({shown.length}) --</option>
            {shown.map((e) => <option key={e.emp_id} value={e.emp_id}>{checkedToday.has(e.emp_id) ? '✓ ' : ''}{e.name}{e.dept ? ` · ${e.dept}` : ''}</option>)}
          </select>
          {writable && (
            <div className="flex gap-2 mt-2">
              <input value={newEmp.name} onChange={(e) => setNewEmp((n) => ({ ...n, name: e.target.value }))} placeholder="เพิ่มพนักงานใหม่ (ชื่อ-สกุล)" className={input} />
              <input value={newEmp.dept} onChange={(e) => setNewEmp((n) => ({ ...n, dept: e.target.value }))} placeholder="แผนก" className={`${input} max-w-[110px]`} />
              <button type="button" disabled={newEmp.name.trim().length < 2} onClick={addEmp} className="shrink-0 flex items-center gap-1 px-3 rounded-lg bg-blue-800 text-white text-sm disabled:opacity-40"><UserPlus className="w-4 h-4" /></button>
            </div>
          )}
          <div className="text-[11px] text-gray-400 mt-1">✓ = ตรวจแล้ววันนี้</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold text-gray-700">หัวข้อการตรวจ</div>
          <div className="text-xs text-gray-500">ประเมินแล้ว {done} / {items.length}</div>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3"><div className="h-full bg-teal-500 transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
        <div className="divide-y divide-gray-100">
          {items.map((it, i) => {
            const v = answers[it.item_key]
            return (
              <div key={it.item_key} className="py-3">
                <div className="flex gap-2 mb-2">
                  <div className={`w-6 h-6 shrink-0 rounded-md text-xs font-bold flex items-center justify-center ${it.critical ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-800'}`}>{i + 1}</div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{it.label}{it.critical ? <span className="ml-1.5 text-[10px] font-bold text-red-600 align-middle">ข้อสำคัญ</span> : null}</div>
                    {it.note && <div className="text-xs text-gray-500">{it.note}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[['P', '✓ ผ่าน', 'bg-green-600', it.pass_desc], ['F', '✗ ไม่ผ่าน', 'bg-red-600', it.fail_desc]].map(([val, label, on, desc]) => (
                    <button type="button" key={val} onClick={() => setAnswers((a) => ({ ...a, [it.item_key]: val }))}
                      className={`rounded-lg border-2 px-2 py-2 text-left transition ${v === val ? `${on} border-transparent text-white` : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                      <div className="text-sm font-bold text-center">{label}</div>
                      {desc && <div className={`text-[10.5px] leading-snug mt-0.5 text-center ${v === val ? 'text-white/90' : 'text-gray-500'}`}>{desc}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 space-y-2">
          <div className="text-sm font-bold text-red-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />ไม่ผ่าน {failed.length} ข้อ: {failed.map((f) => f.label).join(', ')}</div>
          <div className="text-xs text-red-700">การแก้ไข *</div>
          {Object.entries(ACTION_TH).map(([k, label]) => (
            <label key={k} className={`flex items-center gap-2 text-sm ${k === 'CORRECTED' && critical ? 'opacity-40' : 'cursor-pointer'}`}>
              <input type="radio" name="action" value={k} checked={action === k} disabled={k === 'CORRECTED' && critical} onChange={() => setAction(k)} className="accent-red-600" />
              {label}
            </label>
          ))}
          {critical && <div className="text-[11px] text-red-700">มีข้อสำคัญไม่ผ่าน (สุขภาพ / บาดแผล) ต้องไม่อนุญาตให้เข้าพื้นที่ผลิต และแจ้งหัวหน้างาน</div>}
        </div>
      )}
      <label className="text-xs text-gray-600 block mb-4">หมายเหตุ{action === 'EXCLUDED' ? ' * (อาการ / สิ่งที่ทำ เช่น ส่งพบแพทย์ ย้ายไปงานนอกพื้นที่ผลิต)' : ''}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </label>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">{error}</div>}
      {writable ? (
        <button onClick={save} disabled={saving || !empId || done < items.length || (failed.length && !action)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
          <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก และตรวจคนต่อไป'}
        </button>
      ) : <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}
      <div className="text-xs text-gray-500 mt-2">ผู้ตรวจ: <b>{user?.display_name}</b> (บันทึกจากบัญชีที่เข้าสู่ระบบ)</div>
    </Layout>
  )
}

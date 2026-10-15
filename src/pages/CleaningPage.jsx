import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, X, Save, Printer, CheckCircle2, Settings, Plus } from 'lucide-react'
import Layout from '../components/Layout'
import { cleanApi } from '../api/d1Api'
import { useAuth, canWrite, isQA } from '../auth'
import { FORMS } from '../config'
import { bkkToday, bkkTime, monthOf } from '../qa/shared'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `cl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
const thaiDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// FM-QC-009: one record per day. Every area is judged clean (ผ่าน) or not (ไม่ผ่าน, cleaned straight away).
export default function CleaningPage() {
  const { user } = useAuth()
  const [areas, setAreas] = useState([])
  const [date, setDate] = useState(bkkToday())
  const [existing, setExisting] = useState(null)
  const [answers, setAnswers] = useState({})
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [setup, setSetup] = useState(false)
  const [newArea, setNewArea] = useState('')
  const [allAreas, setAllAreas] = useState([])

  const loadAreas = () => cleanApi.areas().then((l) => { setAllAreas(l); setAreas(l.filter((a) => a.active)) }).catch((e) => setError(e.message))
  useEffect(() => { loadAreas() }, [])
  const loadDay = () => cleanApi.records({ from: date, to: date }).then((l) => setExisting(l[0] || null)).catch(() => setExisting(null))
  useEffect(() => { setExisting(undefined); setSaved(null); loadDay() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const judged = areas.filter((a) => answers[a.area_key]).length
  const failed = areas.filter((a) => answers[a.area_key] === 'F')
  const complete = areas.length > 0 && judged === areas.length
  const set = (k, v) => setAnswers((o) => ({ ...o, [k]: v }))

  const submit = async () => {
    setError(null); setSaving(true)
    try {
      const res = await cleanApi.save({ uid, check_date: date, check_time: bkkTime(), results: answers, action, note })
      setSaved(res); setAnswers({}); setAction(''); setNote(''); setUid(newUid()); loadDay()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  const voidIt = async () => {
    const reason = window.prompt('เหตุผลที่ยกเลิกบันทึกนี้ (เช่น บันทึกผิดวัน)')
    if (!reason?.trim()) return
    try { await cleanApi.void(existing.rec_id, reason.trim()); setSaved(null); loadDay() } catch (e) { setError(e.message) }
  }
  const addArea = async () => { if (!newArea.trim()) return; try { await cleanApi.addArea({ label: newArea.trim() }); setNewArea(''); loadAreas() } catch (e) { setError(e.message) } }
  const toggleArea = async (a) => { try { await cleanApi.updateArea(a.area_key, { active: !a.active }); loadAreas() } catch (e) { setError(e.message) } }

  const writable = canWrite(user)
  const recFailed = useMemo(() => existing?.failed || [], [existing])

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ทำความสะอาดบริเวณและอาคารผลิตอาหาร</h1>
          <div className="text-xs text-gray-500">{FORMS.CLEAN.code} Rev.{FORMS.CLEAN.rev} · ตรวจเช็คทุกเช้าก่อนเริ่มงาน · ผ่าน ✓ / ไม่ผ่าน ✗ แล้วแจ้งทำความสะอาดทันที</div>
        </div>
        <Link to={`/qa/clean/report?month=${monthOf(date)}`} className="flex items-center gap-1.5 bg-white border border-gray-300 text-sm font-semibold px-3 py-1.5 rounded-lg"><Printer className="w-4 h-4" />รายงานรายเดือน</Link>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mt-3 space-y-3">
        <label className="text-xs text-gray-600 block max-w-[220px]">วันที่ตรวจ
          <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className={input} />
        </label>

        {saved && (
          <div className={`rounded-lg p-3 text-sm font-semibold flex items-center gap-2 ${saved.result === 'PASS' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            <CheckCircle2 className="w-5 h-5" />บันทึก {saved.rec_id} แล้ว — {saved.result === 'PASS' ? 'สะอาดทุกบริเวณ' : `ไม่ผ่าน ${saved.failed.length} บริเวณ`}
          </div>
        )}
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}

        {existing === undefined && <div className="text-sm text-gray-400 py-4 text-center">กำลังโหลด…</div>}
        {existing && (
          <div className="space-y-2">
            <div className={`rounded-lg p-3 text-sm border ${existing.result === 'PASS' ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
              <div className="font-semibold">วันที่ {thaiDay(date)} บันทึกแล้ว ({existing.rec_id}) · {existing.result === 'PASS' ? 'สะอาดทุกบริเวณ' : `ไม่ผ่าน ${recFailed.length} บริเวณ`}</div>
              <div className="text-xs mt-0.5">โดย {existing.inspector}{existing.check_time ? ` · ${existing.check_time}` : ''}</div>
              {existing.action && <div className="text-xs mt-1">ทำทันที: {existing.action}</div>}
            </div>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {existing.areas.map((a) => (
                <div key={a.area_key} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{a.label}</span>
                  {existing.results[a.area_key] === 'P' ? <span className="text-green-700 font-semibold flex items-center gap-1"><Check className="w-4 h-4" />ผ่าน</span> : <span className="text-red-700 font-semibold flex items-center gap-1"><X className="w-4 h-4" />ไม่ผ่าน</span>}
                </div>
              ))}
            </div>
            {user?.role === 'QA_MANAGER' && <button onClick={voidIt} className="text-xs text-red-700 underline">ยกเลิกบันทึกนี้ (บันทึกผิด)</button>}
          </div>
        )}

        {existing === null && writable && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">ประเมินแต่ละบริเวณ <span className="text-xs font-normal text-gray-500">({judged}/{areas.length})</span></div>
              <button type="button" onClick={() => setAnswers(Object.fromEntries(areas.map((a) => [a.area_key, 'P'])))} className="text-xs font-semibold text-teal-700 border border-teal-300 bg-teal-50 rounded-lg px-3 py-1.5">ผ่านทุกบริเวณ</button>
            </div>
            <div className="space-y-2">
              {areas.map((a, i) => (
                <div key={a.area_key} className="border border-gray-200 rounded-lg p-2.5">
                  <div className="text-sm font-semibold text-gray-800 mb-1.5">{i + 1}. {a.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => set(a.area_key, 'P')} className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-sm font-semibold ${answers[a.area_key] === 'P' ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}><Check className="w-4 h-4" />ผ่าน</button>
                    <button type="button" onClick={() => set(a.area_key, 'F')} className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-sm font-semibold ${answers[a.area_key] === 'F' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}><X className="w-4 h-4" />ไม่ผ่าน</button>
                  </div>
                </div>
              ))}
            </div>
            {failed.length > 0 && (
              <label className="text-xs text-gray-600 block">ไม่ผ่าน: {failed.map((f) => f.label).join(', ')} — ทำความสะอาดอะไรทันที *
                <textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} className={input} placeholder="เช่น แจ้งแม่บ้านทำความสะอาดห้องน้ำทันที ตรวจซ้ำแล้วสะอาด" />
              </label>
            )}
            <label className="text-xs text-gray-600 block">หมายเหตุ
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
            </label>
            <div className="text-xs text-gray-500">ผู้บันทึก: <b>{user?.display_name}</b></div>
            <button onClick={submit} disabled={saving || !complete || (failed.length > 0 && !action.trim())} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
              <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        )}
        {existing === null && !writable && <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}
      </div>

      {isQA(user) && (
        <div className="mt-4">
          <button onClick={() => setSetup((v) => !v)} className="text-xs text-gray-600 flex items-center gap-1"><Settings className="w-3.5 h-3.5" />จัดการรายการบริเวณ (QA)</button>
          {setup && (
            <div className="bg-white rounded-xl shadow p-3 mt-2 space-y-1.5">
              {allAreas.map((a) => (
                <div key={a.area_key} className="flex items-center justify-between text-sm">
                  <span className={a.active ? '' : 'text-gray-400 line-through'}>{a.label}</span>
                  <button onClick={() => toggleArea(a)} className="text-xs text-blue-700 underline">{a.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="เพิ่มบริเวณใหม่" className={input} />
                <button onClick={addArea} className="shrink-0 flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 rounded-lg"><Plus className="w-4 h-4" />เพิ่ม</button>
              </div>
              <div className="text-[11px] text-gray-500">บริเวณที่เพิ่มต้องประเมินทุกวันนับจากนี้ บันทึกเก่ายังแสดงตามรายการในวันนั้น</div>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}

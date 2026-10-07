import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Printer, Settings, Thermometer, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import Layout from '../components/Layout'
import { coldApi } from '../api/d1Api'
import { useAuth, canWrite, isQA } from '../auth'
import { Badge, bkkToday, bkkTime, monthOf, newUid } from '../qa/shared'
import { FORMS } from '../config'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
export const SLOTS = ['08:00', '11:00', '15:00', '17:00']
export const COLD_STATUS = {
  PASS: { label: 'ผ่าน', cls: 'bg-green-100 text-green-700', cell: 'bg-green-50 text-green-800' },
  FAIL: { label: 'นอกเกณฑ์', cls: 'bg-amber-100 text-amber-800', cell: 'bg-amber-100 text-amber-900' },
  ESCALATE: { label: 'เกิน Escalation', cls: 'bg-red-100 text-red-700', cell: 'bg-red-100 text-red-800' },
}
export const CONDITION = [['clean', 'ความสะอาดภายในตู้'], ['door', 'ประตู / การปิดสนิท'], ['gasket', 'ขอบยาง / ซีล'], ['water', 'น้ำหยด / น้ำขัง'], ['ice', 'น้ำแข็งเกาะผิดปกติ'], ['general', 'สภาพทั่วไป']]
export const ACTIONS = [['RECHECK', 'ตรวจซ้ำ'], ['NOTIFY', 'แจ้งหัวหน้างาน / QA'], ['ENGINEERING', 'แจ้งวิศวกรรม'], ['HOLD', 'กักสินค้า (HOLD)'], ['TRANSFER', 'ย้ายไปที่จัดเก็บที่เหมาะสม']]
export const COLD_CAUSES = { DOOR_LOAD: 'เปิดตู้นำสินค้าเข้า/ออก', HOT_PRODUCT: 'นำสินค้าที่ยังร้อนเข้าแช่', DOOR_OPEN: 'เปิดประตูค้าง', FAULT: 'ตู้ขัดข้อง / อุณหภูมิไม่คงที่', OTHER: 'อื่นๆ' }
const NEEDS_NOTE = ['FAULT', 'OTHER']
export const AREA_TH = { RM: 'วัตถุดิบ (RM)', WIP: 'ระหว่างผลิต (WIP)', FG: 'สินค้าสำเร็จรูป (FG)' }
export const specText = (u) => (u.spec_min !== null && u.spec_min !== undefined ? `${u.spec_min} ถึง ${u.spec_max} °C` : `≤ ${u.spec_max} °C`)
const judge = (u, t) => {
  if (!u || t === '' || !Number.isFinite(Number(t))) return null
  const n = Number(t)
  return n > u.escalate_at ? 'ESCALATE' : (n > u.spec_max || (u.spec_min !== null && n < u.spec_min)) ? 'FAIL' : 'PASS'
}
// The first scheduled slot of the day not yet recorded, else a recheck.
const nextSlot = (done) => SLOTS.find((s) => !done.has(s)) || 'RECHECK'

export default function ColdPage() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [today, setToday] = useState([])
  const [unitId, setUnitId] = useState('')
  const [date, setDate] = useState(bkkToday())
  const [slot, setSlot] = useState('08:00')
  const [temp, setTemp] = useState('')
  const [cond, setCond] = useState({})
  const [actions, setActions] = useState([])
  const [affected, setAffected] = useState('')
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [cause, setCause] = useState('')
  const [alerts, setAlerts] = useState(null)

  const loadDay = () => coldApi.readings({ from: date, to: date }).then(setToday).catch(() => {})
  useEffect(() => { coldApi.units().then((l) => setUnits(l.filter((u) => u.active))).catch((e) => setError(e.message)) }, [])
  useEffect(() => { loadDay() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadAlerts = () => coldApi.alerts(date).then(setAlerts).catch(() => {})
  useEffect(() => { loadAlerts(); const t = setInterval(loadAlerts, 30000); return () => clearInterval(t) }, [date]) // eslint-disable-line react-hooks/exhaustive-deps
  const oosOf = (id) => alerts?.units?.find((x) => x.unit_id === id)
  const setService = async (u, on) => {
    const reason = on ? window.prompt(`ตั้ง ${u.unit_id} เป็นรอซ่อม / ห้ามเก็บสินค้า\nระบุเหตุผล:`) : null
    if (on && (!reason || !reason.trim())) return
    if (!on && !window.confirm(`เปิดใช้ ${u.unit_id} อีกครั้ง? (ซ่อมเสร็จและวัดอุณหภูมิได้ตามเกณฑ์แล้ว)`)) return
    try { await coldApi.setService(u.unit_id, { out_of_service: on, reason: reason?.trim() }); await loadAlerts() } catch (e) { setError(e.message) }
  }

  const unit = units.find((u) => u.unit_id === unitId)
  const doneFor = (id) => new Set(today.filter((r) => r.unit_id === id).map((r) => r.slot))
  const pick = (id) => { setCause(''); setUnitId(id); setSlot(nextSlot(doneFor(id))); setSaved(null); setError(null) }
  const status = judge(unit, temp)
  const unitOos = !!oosOf(unitId)?.out_of_service
  const needCause = status && status !== 'PASS' && !unitOos
  const condFail = Object.values(cond).includes('F')
  const needCond = slot === '08:00'
  const calibExpired = unit?.calib_due && unit.calib_due < date
  const grid = useMemo(() => {
    const m = {}
    for (const r of today) { (m[r.unit_id] ||= {}); const prev = m[r.unit_id][r.slot]; if (!prev || r.rd_id > prev.rd_id) m[r.unit_id][r.slot] = r }
    return m
  }, [today])

  const toggleAction = (k) => setActions((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await coldApi.save({ uid, unit_id: unitId, read_date: date, slot, read_time: bkkTime(), temp, condition: Object.keys(cond).length ? cond : null, cause: needCause ? cause : undefined, actions, affected, note })
      setSaved({ ...res, unit: unit.name, temp }); setUid(newUid())
      setTemp(''); setCond({}); setActions([]); setAffected(''); setNote(''); setCause('')
      loadAlerts()
      await loadDay(); setSlot('RECHECK'); setUnitId('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Thermometer className="w-5 h-5 text-sky-600" />อุณหภูมิตู้เย็น / ตู้แช่แข็ง</h1>
          <div className="text-xs text-gray-500">{FORMS.COLD.code} Rev.{FORMS.COLD.rev} · ตรวจ 08:00 · 11:00 · 15:00 · 17:00</div>
        </div>
        <div className="flex gap-2">
          <Link to={`/qa/cold/report?month=${monthOf(date)}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />รายงาน A4</Link>
          <Link to="/qa/cold/units" className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Settings className="w-4 h-4" />ทะเบียนตู้</Link>
        </div>
      </div>

      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm font-semibold flex items-center gap-2 ${COLD_STATUS[saved.status].cls}`}>
          {saved.status === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : saved.status === 'FAIL' ? <AlertTriangle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          <span className="flex-1">{saved.rd_id} · {saved.unit} {saved.temp} °C — {COLD_STATUS[saved.status].label}
          {saved.ncr_id && <> · เปิด <Link to={`/ncr/${saved.ncr_id}`} className="underline whitespace-nowrap">{saved.ncr_id}</Link></>}
          {saved.calib_expired ? <span className="text-red-700"> · เทอร์โมมิเตอร์หมดอายุสอบเทียบ</span> : null}
          {saved.recheck_after ? <span> · วัดซ้ำหลัง {new Date(saved.recheck_after).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} น.</span> : null}</span>
        </div>
      )}

      {alerts?.alerts?.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {alerts.alerts.map((a, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${a.level === 'red' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div><b>{a.unit_id}</b> · {a.text}</div>
            </div>
          ))}
          <div className="text-[11px] text-gray-500">เปิดตู้หรือเปิดค้าง ให้วัดซ้ำ (รอบ "ตรวจซ้ำ") หลังเหตุหมดไป {alerts.recheck_min} นาที ถ้าอยู่ในเกณฑ์ ระบบถือว่าปิดเรื่อง</div>
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-700">สถานะวันที่</h2>
        <input type="date" max={bkkToday()} value={date} onChange={(e) => { setDate(e.target.value || bkkToday()); setUnitId('') }} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto mb-4">
        {units.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีตู้ในทะเบียน — QA เพิ่มได้ที่ "ทะเบียนตู้"</div>}
        {units.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500"><th className="text-left p-2">ตู้</th>{SLOTS.map((s) => <th key={s} className="p-2">{s}</th>)}<th /></tr></thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.unit_id} className={`border-t border-gray-100 ${unitId === u.unit_id ? 'bg-teal-50' : ''}`}>
                  <td className="p-2"><div className="font-semibold text-gray-800">{u.unit_id}{oosOf(u.unit_id)?.out_of_service && <span className="ml-1.5 text-[10px] font-semibold bg-red-100 text-red-700 rounded px-1.5 py-0.5">รอซ่อม · ห้ามเก็บสินค้า</span>}</div><div className="text-[11px] text-gray-500">{u.name} · {specText(u)}</div></td>
                  {SLOTS.map((s) => {
                    const r = grid[u.unit_id]?.[s]
                    return <td key={s} className="p-1 text-center"><span className={`inline-block min-w-[44px] rounded-md px-1 py-1 text-xs font-semibold ${r ? COLD_STATUS[r.status].cell : 'bg-gray-50 text-gray-300'}`}>{r ? r.temp : '–'}</span></td>
                  })}
                  <td className="p-2 text-right whitespace-nowrap">
                    {canWrite(user) && <button onClick={() => pick(u.unit_id)} className="text-xs font-semibold bg-teal-600 text-white rounded-lg px-2.5 py-1">บันทึก</button>}
                    {isQA(user) && !oosOf(u.unit_id)?.out_of_service && <button onClick={() => setService(u, true)} className="ml-1 text-[11px] border border-gray-300 text-gray-600 rounded-lg px-2 py-1">รอซ่อม</button>}
                    {user?.role === 'QA_MANAGER' && oosOf(u.unit_id)?.out_of_service && <button onClick={() => setService(u, false)} className="ml-1 text-[11px] border border-green-300 bg-green-50 text-green-700 rounded-lg px-2 py-1">เปิดใช้อีกครั้ง</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {unit && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-bold text-gray-800">{unit.unit_id} · {unit.name}</div>
            <Badge cls="bg-sky-100 text-sky-800">{unit.unit_type === 'CHILL' ? 'Chill' : 'Freeze'}</Badge>
            <Badge cls="bg-gray-100 text-gray-600">{AREA_TH[unit.area]}</Badge>
          </div>
          <div className="text-xs text-gray-600">เกณฑ์ {specText(unit)} · Escalation &gt; {unit.escalate_at} °C · เทอร์โมมิเตอร์ {unit.thermometer || '-'}{unit.calib_due ? ` (สอบเทียบถึง ${unit.calib_due})` : ''}</div>
          {calibExpired && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">เทอร์โมมิเตอร์หมดอายุสอบเทียบ — ห้ามใช้โดยไม่ผ่านการประเมินและอนุมัติ ระบบจะบันทึกสถานะนี้ไว้กับค่าที่อ่าน</div>}
          <div>
            <div className="text-xs text-gray-600 mb-1">รอบเวลา</div>
            <div className="grid grid-cols-5 gap-1.5">
              {[...SLOTS, 'RECHECK'].map((s) => {
                const taken = s !== 'RECHECK' && doneFor(unit.unit_id).has(s)
                return <button type="button" key={s} disabled={taken} onClick={() => setSlot(s)}
                  className={`py-2 rounded-lg text-xs font-semibold border ${slot === s ? 'bg-teal-600 text-white border-teal-600' : taken ? 'bg-gray-100 text-gray-300 border-gray-200' : 'bg-white text-gray-600 border-gray-300'}`}>{s === 'RECHECK' ? 'ตรวจซ้ำ' : s}</button>
              })}
            </div>
          </div>
          <label className="text-xs text-gray-600 block">อุณหภูมิที่อ่านได้ (°C) *
            <input type="number" inputMode="decimal" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)}
              className={`${input} text-lg font-bold ${status ? COLD_STATUS[status].cell : ''}`} />
          </label>
          {status && <div className={`rounded-lg p-2 text-sm font-semibold ${COLD_STATUS[status].cls}`}>{COLD_STATUS[status].label}{status === 'ESCALATE' ? (user?.auto_ncr ? ' — ต้องแจ้งหัวหน้างาน/QA ระบบจะเปิด NCR เมื่อบันทึก' : ' — ต้องแจ้งหัวหน้างาน/QA') : status === 'FAIL' ? ' — ตรวจซ้ำและหาสาเหตุ' : ''}</div>}

          {(needCond || Object.keys(cond).length > 0) && (
            <div>
              <div className="text-xs text-gray-600 mb-1">ตรวจสภาพตู้{needCond ? ' * (รอบแรกของวัน)' : ''}</div>
              <div className="space-y-1.5">
                {CONDITION.map(([k, label]) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <div className="flex-1">{label}</div>
                    {[['P', 'ผ่าน', 'bg-green-600'], ['F', 'ไม่ผ่าน', 'bg-red-600']].map(([v, t, on]) => (
                      <button type="button" key={v} onClick={() => setCond((c) => ({ ...c, [k]: v }))}
                        className={`w-16 py-1 rounded-lg text-xs font-semibold border ${cond[k] === v ? `${on} text-white border-transparent` : 'bg-white text-gray-600 border-gray-300'}`}>{t}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!needCond && !Object.keys(cond).length && <button type="button" onClick={() => setCond(Object.fromEntries(CONDITION.map(([k]) => [k, 'P'])))} className="text-xs text-teal-700 underline">+ ตรวจสภาพตู้ด้วย</button>}

          {needCause && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-sky-900">สาเหตุที่อุณหภูมิเกิน *</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COLD_CAUSES).map(([k, label]) => (
                  <button type="button" key={k} onClick={() => setCause(k)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${cause === k ? 'bg-sky-700 text-white border-sky-700' : 'bg-white text-gray-700 border-gray-300'}`}>{label}</button>
                ))}
              </div>
              {cause && cause !== 'FAULT' && <div className="text-[11px] text-sky-800">วัดซ้ำหลัง {alerts?.recheck_min || 30} นาที (เลือกรอบ "ตรวจซ้ำ") ถ้ากลับมาในเกณฑ์ ถือว่าปิดเรื่อง</div>}
              {cause === 'HOT_PRODUCT' && <div className="text-[11px] text-red-700 font-semibold">แจ้งฝ่ายผลิต: สินค้าต้องพักให้เย็นก่อนเข้าแช่</div>}
              {cause === 'FAULT' && <div className="text-[11px] text-red-700 font-semibold">ระบบแจ้งหัวหน้างาน/QA และวิศวกรรมให้อัตโนมัติ — ระบุอาการในหมายเหตุ</div>}
            </div>
          )}
          {status && status !== 'PASS' && !unitOos && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-amber-900">การดำเนินการเบื้องต้น *</div>
              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.map(([k, label]) => (
                  <button type="button" key={k} onClick={() => toggleAction(k)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${actions.includes(k) ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-700 border-gray-300'}`}>{label}</button>
                ))}
              </div>
              {actions.includes('HOLD') && <input value={affected} onChange={(e) => setAffected(e.target.value)} placeholder="สินค้า / วัตถุดิบ และ Lot ที่ได้รับผลกระทบ *" className={input} />}
            </div>
          )}
          <label className="text-xs text-gray-600 block">หมายเหตุ{(needCause && NEEDS_NOTE.includes(cause)) || condFail ? ' *' : ''}
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น Defrost, อาการของตู้ (ต้องระบุเมื่อเลือก ตู้ขัดข้อง / อื่นๆ)" className={input} />
          </label>
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
          <button onClick={save} disabled={saving || temp === '' || (needCause && !cause) || (needCause && NEEDS_NOTE.includes(cause) && !note.trim())} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
            <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <div className="text-xs text-gray-500">ผู้ตรวจ: <b>{user?.display_name}</b> (บันทึกจากบัญชีที่เข้าสู่ระบบ)</div>
        </div>
      )}
    </Layout>
  )
}

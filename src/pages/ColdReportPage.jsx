import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { coldApi } from '../api/d1Api'
import { FORMS } from '../config'
import ReviewSig, { RecorderSig } from '../components/ReviewSig'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday, monthOf, monthRange, thaiMonth } from '../qa/shared'
import { SLOTS, CONDITION, ACTIONS, AREA_TH, specText, COLD_CAUSES } from './ColdPage'

const td = 'border border-black px-1 py-[1px]'
const ACT_TH = Object.fromEntries(ACTIONS)
const ST = { PASS: 'P', FAIL: 'F', ESCALATE: 'F!' }

function UnitSheet({ unit, rows, month, first }) {
  const { days } = monthRange(month)
  const byDay = {}
  for (const r of rows) { (byDay[r.read_date] ||= []).push(r) }
  const scheduled = rows.filter((r) => r.slot !== 'RECHECK')
  const deviations = rows.filter((r) => r.status !== 'PASS' || (r.condition && Object.values(r.condition).includes('F')))
  // Days to count for completeness: the whole month, or up to today in the current month.
  const lastDay = month === monthOf(bkkToday()) ? Number(bkkToday().slice(8)) : days
  const pass = scheduled.filter((r) => r.status === 'PASS').length
  return (
    <A4Sheet landscape={false} margin={8} className={`text-[10px] ${first ? '' : 'page-break'}`}>
      <FormHeader form={FORMS.COLD} title="บันทึกการตรวจสอบอุณหภูมิตู้เย็นและตู้แช่แข็ง" en="Refrigerator & Freezer Temperature Record" type="รายเดือน" />
      <table className="w-full border-collapse my-1.5">
        <tbody>
          <tr><td className={td}><b>Equipment ID:</b> {unit.unit_id} — {unit.name}</td><td className={td}><b>Area:</b> {AREA_TH[unit.area]}</td></tr>
          <tr><td className={td}><b>Type:</b> {unit.unit_type === 'CHILL' ? 'Chill' : 'Freeze'} · เกณฑ์ {specText(unit)} · Escalation &gt; {unit.escalate_at} °C</td><td className={td}><b>Setting:</b> {unit.setting || '-'}</td></tr>
          <tr><td className={td}><b>Thermometer ID:</b> {unit.thermometer || '-'}</td><td className={td}><b>Calibration Due:</b> {unit.calib_due || '-'}</td></tr>
          <tr><td className={td}><b>Month / Year:</b> {thaiMonth(month)}</td><td className={td}><b>บันทึกครบ:</b> {scheduled.length}/{lastDay * 4} รอบ · ผ่าน {scheduled.length ? Math.round((pass / scheduled.length) * 100) : 0}%</td></tr>
        </tbody>
      </table>
      <table className="w-full border-collapse text-center">
        <thead className="bg-[#0f2744] text-white"><tr><th className={td}>Date</th>{SLOTS.map((s) => <th key={s} className={td}>{s}</th>)}<th className={td}>Status</th><th className={td}>Operator</th><th className={`${td} text-left`}>Remark / Deviation No.</th></tr></thead>
        <tbody>
          {Array.from({ length: days }, (_, i) => {
            const d = `${month}-${String(i + 1).padStart(2, '0')}`
            const list = byDay[d] || []
            const at = (s) => list.filter((r) => r.slot === s).sort((a, b) => (a.rd_id < b.rd_id ? 1 : -1))[0]
            const rechecks = list.filter((r) => r.slot === 'RECHECK')
            const any = list.length > 0
            const bad = list.some((r) => r.status !== 'PASS')
            const remarks = list.filter((r) => r.note || r.cause || r.ncr_id || r.calib_expired).map((r) => `${r.slot === 'RECHECK' ? 'ตรวจซ้ำ ' + (r.read_time || '') + ' ' + r.temp + '°C' : r.slot}: ${[r.cause ? `[${COLD_CAUSES[r.cause] || r.cause}]` : '', r.note, r.ncr_id, r.calib_expired ? 'เทอร์โมมิเตอร์หมดอายุ' : ''].filter(Boolean).join(' ')}`)
            return (
              <tr key={d}>
                <td className={td}>{i + 1}</td>
                {SLOTS.map((s) => { const r = at(s); return <td key={s} className={`${td} ${r && r.status !== 'PASS' ? 'font-bold text-red-700' : ''}`}>{r ? r.temp : ''}</td> })}
                <td className={td}>{any ? (bad ? '☒ F' : '☒ P') : ''}{rechecks.length ? ` (+${rechecks.length})` : ''}</td>
                <td className={`${td} whitespace-nowrap`}>{[...new Set(list.map((r) => r.inspector))].join(', ')}</td>
                <td className={`${td} text-left`}>{remarks.join(' · ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3 mt-2 avoid-break">
        <div>
          <b>Equipment Condition Check (จำนวนครั้งที่ไม่ผ่าน)</b>
          <table className="w-full border-collapse mt-0.5"><tbody>
            {CONDITION.map(([k, label]) => {
              const checked = rows.filter((r) => r.condition), f = checked.filter((r) => r.condition[k] === 'F').length
              return <tr key={k}><td className={td}>{label}</td><td className={`${td} text-center w-20 ${f ? 'text-red-700 font-bold' : ''}`}>{checked.length ? (f ? `ไม่ผ่าน ${f}` : 'ผ่าน') : '-'}</td></tr>
            })}
          </tbody></table>
        </div>
        <div>
          <b>Deviation / Escalation</b>
          <table className="w-full border-collapse mt-0.5"><tbody>
            {deviations.length === 0 && <tr><td className={td}>ไม่มี</td></tr>}
            {deviations.slice(0, 8).map((r) => (
              <tr key={r.rd_id}><td className={td}>{r.read_date.slice(8)}/{r.read_date.slice(5, 7)} {r.slot === 'RECHECK' ? 'ตรวจซ้ำ' : r.slot} · {r.temp}°C · {ST[r.status]}{r.ncr_id ? ` · ${r.ncr_id}` : ''}{r.actions.length ? ` · ${r.actions.map((a) => ACT_TH[a]).join(', ')}` : ''}{r.affected ? ` · ${r.affected}` : ''}</td></tr>
            ))}
            {deviations.length > 8 && <tr><td className={td}>และอีก {deviations.length - 8} รายการ (ดูในระบบ)</td></tr>}
          </tbody></table>
        </div>
      </div>
      <div className="mt-1 text-[9.5px]">P = ผ่าน · F = นอกเกณฑ์ · F! = เกิน Escalation Limit (เปิด NCR) · ค่าตัวหนาสีแดง = นอกเกณฑ์ · กรณี OOS ปฏิบัติตาม SOP-QC-XX และ Temperature Deviation / Product Disposition</div>
      <div className="mt-6 flex justify-around text-center avoid-break">
        {['ผู้บันทึก (QC)', 'ผู้ทบทวน (QC Supervisor)'].map((s, i) => <div key={s}>{i === 1 ? <ReviewSig /> : <RecorderSig names={(rows || []).map((r) => r.inspector)} />}<div className="border-t border-dotted border-black w-52 mx-auto mb-1" />{s}<br />วันที่ ................</div>)}
      </div>
    </A4Sheet>
  )
}

// Cold storage record: one A4 sheet per unit for the month.
export default function ColdReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || monthOf(bkkToday())
  const only = params.get('unit') || ''
  const [units, setUnits] = useState([])
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { coldApi.units().then(setUnits).catch((e) => setError(e.message)) }, [])
  useEffect(() => { setRows(null); coldApi.readings(monthRange(month)).then(setRows).catch((e) => setError(e.message)) }, [month])

  const shown = units.filter((u) => (only ? u.unit_id === only : u.active || (rows || []).some((r) => r.unit_id === u.unit_id)))
  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 portrait; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/cold')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <div className="flex gap-2">
          <input type="month" value={month} max={monthOf(bkkToday())} onChange={(e) => e.target.value && setParams({ month: e.target.value, ...(only ? { unit: only } : {}) })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
          <select value={only} onChange={(e) => setParams({ month, ...(e.target.value ? { unit: e.target.value } : {}) })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm">
            <option value="">ทุกตู้</option>{units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit_id}</option>)}
          </select>
        </div>
        <button onClick={() => window.print()} disabled={!rows || !shown.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && !shown.length && <div className="no-print text-center text-gray-500 py-16">ยังไม่มีตู้ในทะเบียน</div>}
      {rows && shown.map((u, i) => <UnitSheet key={u.unit_id} first={i === 0} unit={u} month={month} rows={rows.filter((r) => r.unit_id === u.unit_id)} />)}
    </div>
  )
}

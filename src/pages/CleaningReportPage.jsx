import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import A4Sheet from '../components/A4Sheet'
import { FormHeader, FormInfo } from '../components/FormHeader'
import { cleanApi, reportSigApi, userSigApi } from '../api/d1Api'
import { FORMS } from '../config'
import { bkkToday, monthOf, monthRange, thaiMonth } from '../qa/shared'

const td = 'border border-black text-center p-0'
const sigImg = { maxHeight: 22, maxWidth: '100%', objectFit: 'contain', display: 'block', margin: '0 auto' }

// FM-QC-009 for one month, laid out like the paper form: areas down, days 1-31 across, a signature row per day for the recorder and the acknowledging QA Manager.
export default function CleaningReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || monthOf(bkkToday())
  const { days } = monthRange(month)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [userSigs, setUserSigs] = useState([])
  const [reviewer, setReviewer] = useState(null)
  useEffect(() => { setRows(null); cleanApi.records(monthRange(month)).then(setRows).catch((e) => setError(e.message)) }, [month])
  useEffect(() => { userSigApi.list().then((l) => setUserSigs(l || [])).catch(() => {}); reportSigApi.get().then((s) => setReviewer(s?.data || null)).catch(() => {}) }, [])

  const byDay = Object.fromEntries((rows || []).map((r) => [parseInt(r.check_date.slice(8), 10), r]))
  // Rows: the areas in force during the month, in list order (an area added or retired mid-month keeps its own days).
  const areas = []
  for (const r of [...(rows || [])].reverse()) for (const a of r.areas) if (!areas.some((x) => x.area_key === a.area_key)) areas.push(a)
  const sigOf = (name) => userSigs.find((x) => x.name === name)?.data
  const dayNums = Array.from({ length: 31 }, (_, i) => i + 1)
  const remarks = (rows || []).filter((r) => r.result === 'FAIL' || r.note).sort((a, b) => a.check_date.localeCompare(b.check_date))
  const done = Object.keys(byDay).length

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/clean')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="month" value={month} max={monthOf(bkkToday())} onChange={(e) => e.target.value && setParams({ month: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกของเดือน{thaiMonth(month)}</div>}
      {rows && rows.length > 0 && (
        <A4Sheet landscape={true} margin={8} className="text-[10px]">
          <FormHeader form={FORMS.CLEAN} title="บันทึกการทำความสะอาดบริเวณ และอาคารผลิตอาหาร" en="Premises & Production Building Cleaning Record" dept="Quality Control (QC)" type="รายเดือน" />
          <FormInfo items={[['ประจำเดือน', thaiMonth(month)], ['บันทึกแล้ว', `${done} วัน`], ['ตรวจเช็ค', 'ทุกเช้าก่อนเริ่มงาน']]} />
          <table className="w-full border-collapse table-fixed">
            <colgroup><col style={{ width: '38mm' }} />{dayNums.map((d) => <col key={d} />)}<col style={{ width: '30mm' }} /></colgroup>
            <thead className="bg-[#0f2744] text-white">
              <tr><th className="border border-black" rowSpan={2}>บริเวณ / อาคารผลิต</th><th className="border border-black" colSpan={31}>วันที่</th><th className="border border-black" rowSpan={2}>หมายเหตุ</th></tr>
              <tr>{dayNums.map((d) => <th key={d} className={`border border-black text-[8.5px] font-normal ${d > days ? 'opacity-30' : ''}`}>{d}</th>)}</tr>
            </thead>
            <tbody>
              {areas.map((a, ai) => (
                <tr key={a.area_key} style={{ height: '6.6mm' }}>
                  <td className="border border-black px-1 text-left">{a.label}</td>
                  {dayNums.map((d) => {
                    const r = byDay[d], v = r?.results[a.area_key]
                    return <td key={d} className={`${td} ${d > days ? 'bg-gray-200' : ''} ${v === 'F' ? 'text-red-700 font-bold' : ''}`}>{v === 'P' ? '✓' : v === 'F' ? '✗' : ''}</td>
                  })}
                  {ai === 0 && <td className="border border-black align-top px-1 text-[8.5px] text-left" rowSpan={areas.length}>
                    {remarks.map((r) => <div key={r.rec_id}>{r.check_date.slice(8)}/{r.check_date.slice(5, 7)}: {[...(r.failed.map((f) => f.label)), r.action, r.note].filter(Boolean).join(' · ')}</div>)}
                  </td>}
                </tr>
              ))}
              <tr style={{ height: '11mm' }}>
                <td className="border border-black px-1 text-left font-semibold">ผู้บันทึก <span className="font-normal">(เจ้าหน้าที่ฝ่ายควบคุมคุณภาพ)</span></td>
                {dayNums.map((d) => { const r = byDay[d], s = r && sigOf(r.inspector); return <td key={d} className={`${td} ${d > days ? 'bg-gray-200' : ''}`}>{s ? <img src={s} alt="" style={sigImg} /> : r ? <span className="text-[7px]">{r.inspector.split(' ')[0]}</span> : ''}</td> })}
                <td className="border border-black" />
              </tr>
              <tr style={{ height: '11mm' }}>
                <td className="border border-black px-1 text-left font-semibold">ผู้รับทราบ <span className="font-normal">(หัวหน้าฝ่ายควบคุมคุณภาพ)</span></td>
                {dayNums.map((d) => <td key={d} className={`${td} ${d > days ? 'bg-gray-200' : ''}`}>{byDay[d] && reviewer ? <img src={reviewer} alt="" style={sigImg} /> : ''}</td>)}
                <td className="border border-black" />
              </tr>
            </tbody>
          </table>
          <div className="mt-1.5 font-semibold">หมายเหตุ <span className="font-normal">ผ่านบันทึก ✓ หากไม่ผ่านบันทึก ✗ และแจ้งให้มีการทำความสะอาดทันที</span></div>
        </A4Sheet>
      )}
    </div>
  )
}

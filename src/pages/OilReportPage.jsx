import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { oilApi } from '../api/d1Api'
import { FORMS } from '../config'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday, monthOf, monthRange, thaiMonth } from '../qa/shared'
import { STAGE_TH, OIL_RESULT } from './OilPage'

const td = 'border border-black px-1 py-0.5'
const RES_TXT = { PASS: 'ผ่าน', FAIL: 'ไม่ผ่าน', NA: 'N/A' }

// The frying-oil record for one month on A4 landscape: every check in date order, with verification and actions.
export default function OilReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || monthOf(bkkToday())
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { setRows(null); oilApi.list(monthRange(month)).then((r) => setRows([...r].reverse())).catch((e) => setError(e.message)) }, [month])

  const lines = [...new Set((rows || []).map((r) => r.line).filter(Boolean))]
  const meters = [...new Set((rows || []).map((r) => r.tpm_meter).filter(Boolean))]
  const thermos = [...new Set((rows || []).map((r) => r.thermometer).filter(Boolean))]
  const count = (k) => (rows || []).filter((r) => r.result === k).length

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/oil')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="month" value={month} max={monthOf(bkkToday())} onChange={(e) => e.target.value && setParams({ month: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกของเดือน{thaiMonth(month)}</div>}
      {rows && rows.length > 0 && (
        <A4Sheet landscape={true} margin={8} className="text-[10.5px]">
          <FormHeader form={FORMS.OIL} title="บันทึกการตรวจสอบคุณภาพน้ำมันทอดและอุณหภูมิ" en="Frying Oil Quality & Temperature Record" type="รายเดือน" />
          <FormInfo items={[['เดือน / ปี', thaiMonth(month)], ['ผลิตภัณฑ์ / ไลน์', lines.join(', ') || '-'], ['เครื่องวัด TPM', meters.join(', ') || '-'], ['เครื่องวัดอุณหภูมิ', thermos.join(', ') || '-']]} />
          <table className="w-full border-collapse">
            <thead className="bg-[#0f2744] text-white text-center">
              <tr>
                <th className={td} rowSpan={2}>วันที่ / เวลา</th><th className={td} rowSpan={2}>ช่วง</th>
                <th className={td} colSpan={3}>TPM (%)</th><th className={td} colSpan={3}>อุณหภูมิ (°C)</th>
                <th className={td} rowSpan={2}>ผลอุณหภูมิ</th><th className={td} rowSpan={2}>ผล TPM</th>
                <th className={td} rowSpan={2}>Lot / ถัง</th><th className={td} rowSpan={2}>ผู้ตรวจ</th>
                <th className={td} rowSpan={2}>ผู้ทวนสอบ / ผล</th><th className={td} rowSpan={2}>สิ่งที่ทำทันที / หมายเหตุ / NCR</th>
              </tr>
              <tr>{[1, 2, 3, 1, 2, 3].map((n, i) => <th key={i} className={`${td} w-7`}>{n}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chk_id} className="avoid-break">
                  <td className={`${td} whitespace-nowrap`}>{r.check_date.slice(8)}/{r.check_date.slice(5, 7)} {r.check_time || ''}</td>
                  <td className={td}>{STAGE_TH[r.stage]}</td>
                  {[0, 1, 2].map((i) => <td key={`t${i}`} className={`${td} text-center ${r.tpm[i] >= 25 ? 'text-red-700 font-bold' : ''}`}>{r.tpm[i] ?? ''}</td>)}
                  {[0, 1, 2].map((i) => <td key={`c${i}`} className={`${td} text-center`}>{r.temps[i] ?? ''}</td>)}
                  <td className={`${td} text-center`}>{RES_TXT[r.temp_result]}</td>
                  <td className={`${td} text-center font-bold`}>{OIL_RESULT[r.result].label}</td>
                  <td className={td}>{r.tank || ''}</td>
                  <td className={td}>{r.inspector}</td>
                  <td className={td}>{r.verified_by ? `${r.verified_by} · ${r.verify_decision}` : ''}</td>
                  <td className={td}>{[r.action, r.note, r.ncr_id].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1.5 avoid-break">
            <b>สรุป:</b> ตรวจ {rows.length} ครั้ง · ปกติ {count('PASS')} · เฝ้าระวัง {count('WATCH')} · ห้ามใช้/ไม่ผ่าน {count('FAIL')} · ทวนสอบแล้ว {rows.filter((r) => r.verified_by).length}
            <div className="mt-1"><b>เกณฑ์:</b> TPM ไม่เกิน 25% ตามประกาศ สธ. · ภายในบริษัท &lt; 20% ปกติ, 20–&lt;25% เฝ้าระวัง/ประเมิน, ≥ 25% ห้ามใช้ต่อและกักกัน · อุณหภูมิน้ำมันตาม Spec/WI ของผลิตภัณฑ์ ไม่ตรงถือเป็น Deviation</div>
          </div>
          <div className="mt-8 flex justify-around text-center avoid-break">
            {['ผู้ตรวจ', 'ผู้ทวนสอบ (QA/QC)', 'หัวหน้างาน'].map((s) => <div key={s}><div className="border-t border-dotted border-black w-48 mx-auto mb-1" />{s}<br />วันที่ ................</div>)}
          </div>
        </A4Sheet>
      )}
    </div>
  )
}

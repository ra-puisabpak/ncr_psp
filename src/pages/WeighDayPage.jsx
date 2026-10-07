import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { weighApi } from '../api/d1Api'
import { COMPANY_NAME, FORMS } from '../config'
import { bkkToday } from '../qa/shared'
import { thaiDate, kg } from './WeighPrintPage'

const td = 'border border-black px-1.5 py-0.5'
const total = (r) => r.lines.reduce((a, l) => a + l.weights.reduce((x, w) => x + (Number(w) || 0), 0), 0)

// Every raw-material weighing of one production day: one row per batch, grouped by product, with day totals.
export default function WeighDayPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || bkkToday()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { setRows(null); weighApi.list({ from: date, to: date }).then((l) => setRows([...l].sort((a, b) => a.product_code.localeCompare(b.product_code) || a.wr_id.localeCompare(b.wr_id)))).catch((e) => setError(e.message)) }, [date])
  const products = [...new Set((rows || []).map((r) => r.product_code))]
  const dev = (rows || []).filter((r) => r.result === 'DEVIATION').length

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/weigh')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกการชั่งวันที่ {thaiDate(date)}</div>}
      {rows && rows.length > 0 && (
        <div className="print-area bg-white mx-auto my-4 shadow p-[8mm] text-black w-[297mm] max-w-full print:w-auto print:m-0 print:p-0 print:shadow-none text-[11px]" style={{ fontFamily: "'Sarabun', sans-serif" }}>
          <div className="flex justify-between items-start border-b-2 border-black pb-1 mb-2">
            <div><b className="text-[13px]">{COMPANY_NAME}</b><div className="text-[14px] font-bold">สรุปการชั่งวัตถุดิบประจำวัน</div></div>
            <div className="text-right">อ้างอิง {FORMS.WEIGH.code} Rev.{FORMS.WEIGH.rev}<br />วันที่ผลิต {thaiDate(date)}</div>
          </div>
          <div className="flex flex-wrap gap-x-8 mb-2">
            <div><b>ผลิตภัณฑ์:</b> {products.length}</div>
            <div><b>Batch:</b> {rows.length}</div>
            <div><b>น้ำหนักวัตถุดิบรวม:</b> {kg(rows.reduce((a, r) => a + total(r), 0))} กก.</div>
            <div><b>นอกเกณฑ์ (ประเมินแล้ว):</b> {dev}</div>
          </div>
          <table className="w-full border-collapse">
            <thead className="bg-violet-50 text-center">
              <tr><th className={td}>ผลิตภัณฑ์</th><th className={td}>Batch No.</th><th className={td}>เลขที่บันทึก</th><th className={td}>ชุด</th><th className={td}>รายการ</th>
                <th className={td}>น้ำหนักรวม (กก.)</th><th className={td}>ผู้บันทึก</th><th className={td}>ผล</th><th className={td}>นอกเกณฑ์ / หมายเหตุ</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.wr_id} className="avoid-break">
                  {(i === 0 || rows[i - 1].product_code !== r.product_code) && (
                    <td className={`${td} align-top`} rowSpan={rows.filter((x) => x.product_code === r.product_code).length}>
                      <Link to={`/qa/weigh/${r.wr_id}/print`} className="hover:underline print:no-underline">{r.product_name}</Link><br /><span className="text-[9px] text-gray-600">{r.product_code}</span>
                    </td>
                  )}
                  <td className={`${td} text-center font-semibold`}>{r.batch_no}</td>
                  <td className={`${td} text-center`}>{r.wr_id}</td>
                  <td className={`${td} text-center`}>{r.sets}</td>
                  <td className={`${td} text-center`}>{r.lines.length}</td>
                  <td className={`${td} text-right`}>{kg(total(r))}</td>
                  <td className={td}>{r.weigher}</td>
                  <td className={`${td} text-center ${r.result === 'PASS' ? '' : 'font-bold text-amber-800'}`}>{r.result === 'PASS' ? 'ตามสูตร' : 'นอกเกณฑ์'}</td>
                  <td className={td}>{[...(r.deviations || []).map((d) => d.text), r.note].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-10 flex justify-end text-center avoid-break">
            <div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายผลิต / QA)</div>
          </div>
        </div>
      )}
    </div>
  )
}

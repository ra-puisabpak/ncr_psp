import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { hygApi } from '../api/d1Api'
import { LOGO_URL, COMPANY_NAME, FORMS } from '../config'
import { bkkToday } from '../qa/shared'
import { ACTION_TH } from './HygienePage'

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const thaiDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]} ${y + 543}` }

// The day's personal hygiene checks on one A4 sheet. Item columns follow the wording stored with each record.
export default function HygieneReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || bkkToday()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setRows(null)
    hygApi.records({ date }).then((r) => setRows([...r].reverse())).catch((e) => setError(e.message))
  }, [date])

  // Columns: every item that appears in the day's records, in order.
  const cols = []
  for (const r of rows || []) for (const it of r.items) if (!cols.some((c) => c.item_key === it.item_key)) cols.push(it)
  const inspectors = [...new Set((rows || []).map((r) => r.inspector))]
  const fails = (rows || []).filter((r) => r.result === 'FAIL')

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/hygiene')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold">
          <Printer className="w-4 h-4" />พิมพ์ A4
        </button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกการตรวจของวันที่ {thaiDate(date)}</div>}

      {rows && rows.length > 0 && (
        <div className="print-area bg-white mx-auto my-4 shadow p-[10mm] text-black w-[210mm] max-w-full print:w-auto print:m-0 print:p-0 print:shadow-none" style={{ fontFamily: "'Sarabun', sans-serif" }}>
          <div className="flex justify-between items-start border-b-2 border-black pb-1.5 text-[12px]">
            <div><img src={LOGO_URL} alt="" className="float-left mr-2 h-10 w-10 object-contain" /><b className="text-[14px]">{COMPANY_NAME}</b><br />ฝ่ายประกันคุณภาพ (QA)</div>
            <div className="text-right">รหัสแบบฟอร์ม: {FORMS.HYGIENE.code} Rev.{FORMS.HYGIENE.rev}<br />GHPs / GMP 420</div>
          </div>
          <h1 className="text-center text-[17px] font-bold mt-3">แบบบันทึกการตรวจสุขลักษณะส่วนบุคคลก่อนเข้าปฏิบัติงาน</h1>
          <div className="text-center text-[12px] text-gray-700 mb-2">Personal Hygiene Inspection Record</div>
          <div className="flex justify-between text-[12.5px] mb-2">
            <div><b>วันที่ตรวจ:</b> {thaiDate(date)}</div>
            <div><b>ผู้ตรวจ:</b> {inspectors.join(', ')}</div>
            <div><b>จำนวน:</b> {rows.length} คน</div>
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-blue-50">
                <th className="border border-black px-1 py-1 w-7">ที่</th>
                <th className="border border-black px-1 py-1 text-left">ชื่อ-สกุล</th>
                <th className="border border-black px-1 py-1">เวลา</th>
                {cols.map((c, i) => <th key={c.item_key} className="border border-black px-0.5 py-1 w-6">{i + 1}</th>)}
                <th className="border border-black px-1 py-1">ผล</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.rec_id}>
                  <td className="border border-black text-center">{idx + 1}</td>
                  <td className="border border-black px-1 whitespace-nowrap">{r.emp_name}{r.dept ? <span className="text-gray-600"> ({r.dept})</span> : null}</td>
                  <td className="border border-black text-center">{r.inspect_time || ''}</td>
                  {cols.map((c) => {
                    const v = r.results[c.item_key]
                    return <td key={c.item_key} className={`border border-black text-center font-bold ${v === 'F' ? 'text-red-700' : 'text-green-700'}`}>{v === 'P' ? '✓' : v === 'F' ? '✗' : '-'}</td>
                  })}
                  <td className={`border border-black text-center font-bold ${r.result === 'FAIL' ? 'text-red-700' : 'text-green-700'}`}>{r.result === 'FAIL' ? 'ไม่ผ่าน' : 'ผ่าน'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] grid grid-cols-2 gap-x-4">
            {cols.map((c, i) => <div key={c.item_key}>{i + 1}. {c.label}{c.critical ? ' (ข้อสำคัญ)' : ''}</div>)}
          </div>
          {fails.length > 0 && (
            <div className="mt-3 avoid-break">
              <div className="text-[12px] font-bold">รายการไม่ผ่านและการแก้ไข</div>
              <table className="w-full border-collapse text-[11px] mt-1">
                <thead><tr className="bg-red-50"><th className="border border-black px-1 text-left">ชื่อ-สกุล</th><th className="border border-black px-1 text-left">ข้อที่ไม่ผ่าน</th><th className="border border-black px-1 text-left">การแก้ไข</th></tr></thead>
                <tbody>
                  {fails.map((r) => (
                    <tr key={r.rec_id}>
                      <td className="border border-black px-1">{r.emp_name}</td>
                      <td className="border border-black px-1">{r.failed.map((f) => f.label).join(', ')}</td>
                      <td className="border border-black px-1">{ACTION_TH[r.action] || '-'}{r.note ? ` — ${r.note}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-[12px]"><b>สรุปผล:</b> ผ่าน {rows.length - fails.length} คน / ไม่ผ่าน {fails.length} คน · ✓ = ผ่าน, ✗ = ไม่ผ่าน · พนักงานที่ไม่ผ่านห้ามเข้าพื้นที่ผลิตจนกว่าจะแก้ไขเรียบร้อย</div>
          <div className="mt-10 flex justify-around text-center text-[12px] avoid-break">
            <div><div className="border-t border-dotted border-black w-52 mx-auto mb-1" />ผู้ตรวจ ({inspectors.join(', ')})<br />วันที่ {thaiDate(date)}</div>
            <div><div className="border-t border-dotted border-black w-52 mx-auto mb-1" />ผู้ทวนสอบ (QA)<br />วันที่ ......................</div>
          </div>
          <div className="mt-4 text-[10px] text-gray-500">พิมพ์จากระบบ QA eForm · เลขที่บันทึก {rows[0].rec_id} ถึง {rows[rows.length - 1].rec_id}</div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { weighApi } from '../api/d1Api'
import { COMPANY_NAME, FORMS } from '../config'

const td = 'border border-black px-1 py-0.5'
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const thai = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}` }
const kg = (n) => (n == null ? '' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 }))

// The weighing record for one batch, laid out like the paper form: one row per raw material, sets 1–12 across.
export default function WeighPrintPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [r, setR] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { weighApi.list({ wr_id: id }).then((l) => (l[0] ? setR(l[0]) : setError('ไม่พบบันทึก'))).catch((e) => setError(e.message)) }, [id])
  const cols = Math.max(12, r?.sets || 0)
  const devKeys = new Set((r?.deviations || []).filter((d) => d.kind === 'TOL').map((d) => `${d.name}#${d.set}`))

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/weigh')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <div className="text-sm">{r ? `${r.wr_id} · ${r.product_name}` : FORMS.WEIGH.code}</div>
        <button onClick={() => window.print()} disabled={!r} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {r && (
        <div className="print-area bg-white mx-auto my-4 shadow p-[8mm] text-black w-[297mm] max-w-full print:w-auto print:m-0 print:p-0 print:shadow-none text-[11px]" style={{ fontFamily: "'Sarabun', sans-serif" }}>
          <table className="w-full border-collapse mb-2">
            <tbody>
              <tr>
                <td className={`${td} w-[60%]`} rowSpan={3}><b className="text-[13px]">{COMPANY_NAME}</b><br />ประเภทเอกสาร: เอกสารในหน่วยผลิต<br /><b>ชื่อเอกสาร: บันทึกการชั่งวัตถุดิบ</b></td>
                <td className={td}>รหัสเอกสาร: {FORMS.WEIGH.code}</td>
              </tr>
              <tr><td className={td}>แก้ไขครั้งที่: {FORMS.WEIGH.rev}</td></tr>
              <tr><td className={td}>เลขที่บันทึก: {r.wr_id}</td></tr>
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-8 mb-1.5">
            <div><b>ชื่อผลิตภัณฑ์:</b> {r.product_name} ({r.product_code})</div>
            <div><b>วันที่ผลิต:</b> {thai(r.prod_date)}</div>
            <div><b>Batch:</b> {r.batch_no}</div>
            <div><b>เครื่องชั่ง:</b> {r.scale_id || '-'}</div>
            <div><b>สูตร:</b> v{r.formula_version} {r.formula_status === 'APPROVED' ? '(อนุมัติ)' : '(รอยืนยัน)'} · Tolerance {r.tolerance_pct == null ? 'ยังไม่กำหนด' : `±${r.tolerance_pct}%`}</div>
          </div>
          <table className="w-full border-collapse text-center">
            <thead className="bg-violet-50">
              <tr>
                <th className={td} rowSpan={2}>ลำดับ</th><th className={td} rowSpan={2}>รายการวัตถุดิบ</th><th className={td} rowSpan={2}>น้ำหนักที่กำหนด (กก./ชุด)</th>
                <th className={td} rowSpan={2}>วันที่รับเข้า / รหัส LOT</th><th className={td} rowSpan={2}>ผู้ชั่ง</th><th className={td} colSpan={cols}>น้ำหนักวัตถุดิบ (กก.)</th>
              </tr>
              <tr>{Array.from({ length: cols }, (_, i) => <th key={i} className={`${td} w-[5%]`}>ชุดที่ {i + 1}</th>)}</tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} text-left`}>{l.name}{l.extra ? ' (นอกสูตร)' : ''}</td>
                  <td className={td}>{kg(l.target)}</td>
                  <td className={`${td} text-left`}>{l.lot}{l.doc_no ? <span className="text-[9px] text-gray-600"><br />{l.doc_no}</span> : null}</td>
                  <td className={td}>{r.weigher}</td>
                  {Array.from({ length: cols }, (_, s) => <td key={s} className={`${td} ${devKeys.has(`${l.name}#${s + 1}`) ? 'font-bold text-red-700' : ''}`}>{kg(l.weights[s])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {(r.deviations.length > 0 || r.note) && (
            <div className="mt-2 avoid-break">
              {r.deviations.length > 0 && <div><b>นอกเกณฑ์ / นอกสูตร:</b> {r.deviations.map((d) => d.text).join(' · ')}</div>}
              {r.note && <div><b>{r.result === 'DEVIATION' ? `ผลการประเมิน (${r.assessed_by})` : 'หมายเหตุ'}:</b> {r.note}</div>}
            </div>
          )}
          <div className="mt-10 flex justify-around text-center avoid-break">
            <div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้บันทึก ({r.weigher})<br />(เจ้าหน้าที่ฝ่ายผลิต)</div>
            <div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายผลิต)</div>
          </div>
        </div>
      )}
    </div>
  )
}

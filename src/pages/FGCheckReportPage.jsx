import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { fgCheckApi } from '../api/d1Api'
import { FORMS } from '../config'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday } from '../qa/shared'
import { FG_SENSORY, FG_PACK } from './FGCheckPage'

const td = 'border border-black px-1 py-0.5'
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const thai = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}` }
const mark = (v) => (v ? '✓' : '✗')

// FM-QC-008 for one day on A4 landscape, laid out like the paper form.
export default function FGCheckReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || bkkToday()
  const [rows, setRows] = useState(null)
  const [sizes, setSizes] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => { setRows(null); fgCheckApi.list({ from: date, to: date }).then((r) => setRows([...r].reverse())).catch((e) => setError(e.message)) }, [date])
  useEffect(() => { fgCheckApi.packSizes().then(setSizes).catch(() => {}) }, [])
  const cols = Math.max(2, ...(rows || []).map((r) => r.gross.length))

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/fgcheck')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกวันที่ {thai(date)}</div>}
      {rows && rows.length > 0 && (
        <A4Sheet landscape={true} margin={8} className="text-[10px]">
          <FormHeader form={FORMS.FG_CHECK} title={FORMS.FG_CHECK.name} en="Finished Product Inspection Report" type="รายวัน" />
          <div className="flex flex-wrap gap-x-8 mb-1.5">
            <div><b>วันที่ตรวจสอบ:</b> {thai(date)}</div>
            <div><b>น้ำหนักกระปุกที่หัก:</b> {sizes.map((s) => `ขนาด ${s.label_net_g} g หัก ${s.tare_g} g`).join(' · ')} (รวมฝาและสติ๊กเกอร์)</div>
          </div>
          <table className="w-full border-collapse text-center">
            <thead className="bg-[#0f2744] text-white">
              <tr>
                <th className={td} rowSpan={3}>ชื่อผลิตภัณฑ์</th><th className={td} rowSpan={3}>เลขล็อต</th><th className={td} rowSpan={3}>น้ำหนักสุทธิ<br />บนบรรจุภัณฑ์ (g)</th>
                <th className={td} colSpan={7}>การตรวจสอบคุณภาพผลิตภัณฑ์</th>
                <th className={td} colSpan={cols + 4}>การตรวจสอบบรรจุภัณฑ์ / ความปลอดภัย</th>
                <th className={td} rowSpan={3}>ผล<br />(Pass/Fail)</th>
              </tr>
              <tr>
                {FG_SENSORY.map(([k, l]) => <th key={k} className={td} rowSpan={2}>{l}</th>)}
                <th className={td} colSpan={2}>aw</th><th className={td} rowSpan={2}>pH</th>
                <th className={td} colSpan={cols}>น้ำหนักที่ชั่ง (g)<br /><span className="font-normal text-[9px]">รวม = ทั้งกระปุก · สุทธิ = เนื้อน้ำพริก</span></th>
                {FG_PACK.map(([k, l]) => <th key={k} className={td} rowSpan={2}>{l}</th>)}
                <th className={td} rowSpan={2}>อุณหภูมิที่จัดเก็บ (°C)</th>
              </tr>
              <tr>
                <th className={td}>aw</th><th className={td}>temp</th>
                {Array.from({ length: cols }, (_, i) => <th key={i} className={td}>ตัว {i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fc_id} className="avoid-break">
                  <td className={`${td} text-left`}>{r.product_name || r.product_code}</td>
                  <td className={td}>{r.batch_no}</td>
                  <td className={td}>{r.label_net_g}</td>
                  {FG_SENSORY.map(([k]) => <td key={k} className={`${td} ${r.sensory[k] ? '' : 'text-red-700 font-bold'}`}>{mark(r.sensory[k])}</td>)}
                  <td className={td}>{r.aw ?? '-'}</td><td className={td}>{r.aw_temp ?? '-'}</td><td className={td}>{r.ph ?? '-'}</td>
                  {Array.from({ length: cols }, (_, i) => (
                    <td key={i} className={`${td} ${(r.recheck?.[i] ? r.recheck[i].net : r.net[i]) < r.label_net_g ? 'text-red-700 font-bold' : ''}`}>{r.gross[i] != null ? <><span className="text-[8.5px] text-gray-600">รวม {r.gross[i]}</span><br /><b>สุทธิ {r.net[i]}</b>{r.recheck?.[i] && <><br /><span className="text-[8.5px]">ชั่งซ้ำ: รวม {r.recheck[i].gross} → <b>สุทธิ {r.recheck[i].net}</b></span></>}</> : ''}</td>
                  ))}
                  {FG_PACK.map(([k]) => <td key={k} className={`${td} ${r.pack[k] ? '' : 'text-red-700 font-bold'}`}>{mark(r.pack[k])}</td>)}
                  <td className={td}>{r.store_area === 'CHILL' ? 'Chill ' : ''}{r.store_temp ?? ''}</td>
                  <td className={`${td} font-bold`}>{r.result === 'PASS' ? 'P' : 'F'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((r) => r.failed.length || r.note) && (
            <div className="mt-1.5 avoid-break">
              <b>ไม่ผ่าน / หมายเหตุ:</b> {rows.filter((r) => r.failed.length || r.note).map((r) => `${r.product_name || r.product_code} ${r.batch_no}: ${[...r.failed, r.note].filter(Boolean).join(', ')}`).join(' · ')}
            </div>
          )}
          <div className="mt-1 text-[9px] text-gray-700">วิธีอ่าน: "รวม" = ชั่งทั้งกระปุก (กระปุก + ฝา + สติ๊กเกอร์ + น้ำพริก) · "สุทธิ" = น้ำพริกอย่างเดียว (รวม − น้ำหนักกระปุก) · เกณฑ์: สุทธิต้องไม่ต่ำกว่าน้ำหนักบนฉลาก ถ้าต่ำกว่าให้ชั่งซ้ำ และใช้ผลชั่งซ้ำตัดสิน · ✓ = ผ่าน ✗ = ไม่ผ่าน</div>
          <div className="mt-8 flex justify-around text-center avoid-break">
            <div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้บันทึก ({[...new Set(rows.map((r) => r.inspector))].join(', ')})<br />(เจ้าหน้าที่ฝ่ายควบคุมคุณภาพ)</div>
            <div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายควบคุมคุณภาพ)</div>
          </div>
        </A4Sheet>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import A4Sheet from '../components/A4Sheet'
import { FormHeader, FormInfo } from '../components/FormHeader'
import ReviewSig, { RecorderSig } from '../components/ReviewSig'
import { formulaApi } from '../api/d1Api'
import { useAuth } from '../auth'
import { thaiDate, kg } from './WeighPrintPage'

const td = 'border border-black px-1 py-0.5'
const th = `${td} bg-[#0f2744] text-white`
const FORM = { code: 'PD_03', rev: '01' }
const ST = { DRAFT: 'รอยืนยัน', APPROVED: 'อนุมัติแล้ว' }
const pct = (v, t) => (t > 0 ? ((v / t) * 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
const total = (f) => f.items.reduce((a, i) => a + Number(i.target || 0), 0)
const today = () => new Date().toISOString().slice(0, 10)

// Summary of every production formula: an index page, then one A4 page per formula (raw material, kg per set, % of the set).
export default function FormulaSummaryPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const allowed = user?.role === 'QA_MANAGER'
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { if (allowed) formulaApi.list().then(setList).catch((e) => setError(e.message)) }, [allowed])
  const foot = (
    <div className="mt-8 grid grid-cols-2 gap-6 text-center avoid-break">
      <div><div className="h-14 flex items-end justify-center"><RecorderSig names={[]} /></div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้จัดทำ (QC)</div>
      <div><div className="h-14 flex items-end justify-center"><ReviewSig /></div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้ทวนสอบ / อนุมัติ (QA Manager)</div>
    </div>
  )
  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex items-center justify-between gap-2 shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/formulas')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <div className="text-sm">สรุปสูตรการผลิต · {list ? `${list.length} สูตร` : ''}</div>
        <button onClick={() => window.print()} disabled={!list} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {!allowed && <div className="no-print max-w-lg mx-auto mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">สรุปสูตรการผลิตเปิดได้เฉพาะ QA Manager</div>}
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {list && (
        <>
          <A4Sheet landscape={false} margin={8} className="text-[11px]">
            <FormHeader form={FORM} title="สรุปสูตรการผลิตทั้งหมด" en="Production Formula Summary" dept="Production QC" type="สรุปสูตร" />
            <FormInfo items={[['จำนวนสูตร', `${list.length} สูตร`], ['วันที่พิมพ์', thaiDate(today())], ['หน่วย', 'กก. ต่อ 1 ชุด (ของเหลว 1 มล. = 1 ก.)']]} />
            <table className="w-full border-collapse text-center">
              <thead><tr><th className={th}>ลำดับ</th><th className={th}>รหัส</th><th className={th}>ชื่อผลิตภัณฑ์</th><th className={th}>จำนวนรายการ</th><th className={th}>รวม (กก./ชุด)</th><th className={th}>Tolerance</th><th className={th}>สถานะ</th></tr></thead>
              <tbody>
                {list.map((f, i) => (
                  <tr key={f.product_code}>
                    <td className={td}>{i + 1}</td><td className={td}>{f.product_code}</td><td className={`${td} text-left`}>{f.product_name}</td>
                    <td className={td}>{f.items.length}</td><td className={td}>{kg(total(f))}</td>
                    <td className={td}>{f.tolerance_pct != null ? `±${f.tolerance_pct}%` : '-'}</td><td className={td}>{ST[f.status] || f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {foot}
          </A4Sheet>
          {list.map((f) => {
            const t = total(f)
            return (
              <A4Sheet key={f.product_code} landscape={false} margin={8} className="a4-break text-[11px]">
                <FormHeader form={FORM} title="สูตรการผลิต" en="Production Formula" dept="Production QC" type="รายผลิตภัณฑ์" />
                <FormInfo items={[['ผลิตภัณฑ์', `${f.product_name} (${f.product_code})`], ['Version', f.version], ['สถานะ', ST[f.status] || f.status], ['Tolerance', f.tolerance_pct != null ? `±${f.tolerance_pct}%` : 'ยังไม่กำหนด'], f.source && ['ที่มา', f.source]]} />
                <table className="w-full border-collapse text-center">
                  <thead><tr><th className={th} style={{ width: '10mm' }}>ลำดับ</th><th className={th}>วัตถุดิบ</th><th className={th} style={{ width: '30mm' }}>น้ำหนัก (กก./ชุด)</th><th className={th} style={{ width: '22mm' }}>สัดส่วน (%)</th><th className={th} style={{ width: '48mm' }}>หมายเหตุ</th></tr></thead>
                  <tbody>
                    {f.items.map((it, i) => (
                      <tr key={i}><td className={td}>{i + 1}</td><td className={`${td} text-left`}>{it.name}</td><td className={td}>{kg(it.target)}</td><td className={td}>{pct(it.target, t)}</td><td className={`${td} text-left text-[9.5px]`}>{it.note || ''}</td></tr>
                    ))}
                    <tr className="font-bold bg-gray-100"><td className={td} colSpan={2}>รวมต่อ 1 ชุด</td><td className={td}>{kg(t)}</td><td className={td}>100.00</td><td className={td} /></tr>
                  </tbody>
                </table>
                {foot}
              </A4Sheet>
            )
          })}
        </>
      )}
    </div>
  )
}

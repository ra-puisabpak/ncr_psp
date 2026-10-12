import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import Nw from '../components/Nw'
import ReviewSig, { RecorderSig } from '../components/ReviewSig'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { fgCheckApi } from '../api/d1Api'
import { FORMS } from '../config'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday } from '../qa/shared'
import { useAuth } from '../auth'

const td = 'border border-black px-1 py-0.5'
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const thai = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}` }
const short = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`
const stat = (vals, dp) => (vals.length ? { n: vals.length, min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length, dp } : null)
const f = (v, dp) => (v == null ? '-' : Number(v).toFixed(dp))
const monthStart = (d) => `${d.slice(0, 8)}01`

// aw and pH of the finished-product checks, summarised per product: how many readings, lowest / average / highest, then every reading.
export default function FGAwPhReportPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const allowed = user?.role === 'QA_MANAGER'
  const [params, setParams] = useSearchParams()
  const to = params.get('to') || bkkToday()
  const from = params.get('from') || monthStart(to)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { if (!allowed) return; setRows(null); setError(null); fgCheckApi.awph({ from, to }).then(setRows).catch((e) => setError(e.message)) }, [from, to, allowed])

  const measured = (rows || []).filter((r) => r.aw != null || r.ph != null)
  const byProduct = []
  for (const r of [...measured].sort((a, b) => (a.product_code || '').localeCompare(b.product_code || '') || a.check_date.localeCompare(b.check_date) || a.fc_id.localeCompare(b.fc_id))) {
    let g = byProduct.find((x) => x.code === r.product_code)
    if (!g) { g = { code: r.product_code, name: r.product_name || r.product_code, rows: [] }; byProduct.push(g) }
    g.rows.push(r)
  }
  const awN = measured.filter((r) => r.aw != null).length
  const phN = measured.filter((r) => r.ph != null).length
  const setRange = (k, v) => v && setParams({ from, to, [k]: v })

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 portrait; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/fgcheck')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} max={to} onChange={(e) => setRange('from', e.target.value)} className="text-gray-800 rounded-lg px-2 py-1.5" />
          <span>ถึง</span>
          <input type="date" value={to} min={from} max={bkkToday()} onChange={(e) => setRange('to', e.target.value)} className="text-gray-800 rounded-lg px-2 py-1.5" />
        </div>
        <button onClick={() => window.print()} disabled={!byProduct.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {!allowed && <div className="no-print max-w-lg mx-auto mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">รายงานสรุป aw / pH เปิดได้เฉพาะ QA Manager</div>}
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && !byProduct.length && <div className="no-print text-center text-gray-500 py-16">ไม่มีการวัด aw / pH ระหว่าง {thai(from)} – {thai(to)}</div>}
      {byProduct.length > 0 && (
        <A4Sheet landscape={false} margin={8} className="text-[10.5px]">
          <FormHeader form={FORMS.FG_CHECK} title="สรุปค่า aw และ pH รายผลิตภัณฑ์" en="Water Activity & pH Summary by Product" type="สรุป" />
          <FormInfo items={[['ช่วงวันที่ตรวจ', `${thai(from)} – ${thai(to)}`]]} />
          <FormStats items={[[byProduct.length, 'ผลิตภัณฑ์'], [awN, 'ครั้งที่วัด aw'], [phN, 'ครั้งที่วัด pH']]} />
          <div className="font-bold text-[11.5px] text-[#0f2744] mb-0.5">1. สรุปรายผลิตภัณฑ์</div>
          <table className="w-full border-collapse text-center mb-3">
            <thead className="bg-[#0f2744] text-white">
              <tr><th className={td} rowSpan={2}>ผลิตภัณฑ์</th><th className={td} colSpan={4}>aw</th><th className={td} colSpan={4}>pH</th></tr>
              <tr>{['ครั้ง', 'ต่ำสุด', 'สูงสุด', 'เฉลี่ย', 'ครั้ง', 'ต่ำสุด', 'สูงสุด', 'เฉลี่ย'].map((h, i) => <th key={i} className={td}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {byProduct.map((g) => {
                const aw = stat(g.rows.filter((r) => r.aw != null).map((r) => Number(r.aw)), 3)
                const ph = stat(g.rows.filter((r) => r.ph != null).map((r) => Number(r.ph)), 2)
                return (
                  <tr key={g.code} className="avoid-break">
                    <td className={`${td} text-left`}><Nw>{g.name}</Nw> <span className="text-[9px] text-gray-600">({g.code})</span></td>
                    <td className={td}>{aw?.n ?? 0}</td><td className={td}>{f(aw?.min, 3)}</td><td className={td}>{f(aw?.max, 3)}</td><td className={td}>{f(aw?.avg, 3)}</td>
                    <td className={td}>{ph?.n ?? 0}</td><td className={td}>{f(ph?.min, 2)}</td><td className={td}>{f(ph?.max, 2)}</td><td className={td}>{f(ph?.avg, 2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="font-bold text-[11.5px] text-[#0f2744] mb-0.5">2. ค่าที่วัดได้ทุกครั้ง แยกตามผลิตภัณฑ์</div>
          {byProduct.map((g) => (
            <div key={g.code} className="avoid-break mb-2">
              <div className="bg-[#e9eef4] border border-black border-b-0 px-2 py-0.5 font-semibold"><Nw>{g.name}</Nw> <span className="font-normal text-[9px] text-gray-600">({g.code})</span></div>
              <table className="w-full border-collapse text-center">
                <thead className="bg-[#f4f6f8]"><tr>{['วันที่', 'เลขล็อต', 'ขนาด (g)', 'aw', 'อุณหภูมิวัด aw (°C)', 'pH', 'อุณหภูมิวัด pH (°C)', 'ผู้ตรวจ'].map((h) => <th key={h} className={td}>{h}</th>)}</tr></thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.fc_id}>
                      <td className={td}>{short(r.check_date)}</td><td className={td}>{r.batch_no}</td><td className={td}>{r.label_net_g}</td>
                      <td className={td}>{r.aw ?? '-'}</td><td className={td}>{r.aw_temp ?? '-'}</td><td className={td}>{r.ph ?? '-'}</td><td className={td}>{r.ph_temp ?? '-'}</td><td className={td}>{r.inspector}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="mt-1 text-[9px] text-gray-700">หมายเหตุ: นับเฉพาะรายการตรวจที่มีการวัดค่า (รายการที่ไม่วัด aw / pH ไม่ถูกนับ) · ยังไม่ได้กำหนดเกณฑ์ aw / pH ในระบบ จึงแสดงเฉพาะค่าสถิติ ไม่ตัดสินผ่าน/ไม่ผ่าน</div>
          <div className="mt-6 flex justify-around text-center avoid-break">
            <div><RecorderSig names={measured.map((r) => r.inspector)} /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้จัดทำ ({[...new Set(measured.map((r) => r.inspector))].join(', ')})<br />(เจ้าหน้าที่ฝ่ายควบคุมคุณภาพ)</div>
            <div><ReviewSig /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายควบคุมคุณภาพ)</div>
          </div>
        </A4Sheet>
      )}
    </div>
  )
}

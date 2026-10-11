import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import Nw from '../components/Nw'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { prodctlApi, oilApi, qaApi } from '../api/d1Api'
import { FORMS } from '../config'
import ReviewSig, { RecorderSig } from '../components/ReviewSig'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday } from '../qa/shared'

const td = 'border border-black px-0.5 py-0.5'
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const thai = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}` }
const v = (x) => (x === null || x === undefined || x === '' ? '' : x)
const STAGE = { BEFORE: 'ก่อนผลิต', DURING: 'ระหว่าง', AFTER: 'หลังผลิต' }

// The production control record for one day on A4 landscape, in the column order of the paper form.
export default function ProdControlReportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || bkkToday()
  const [rows, setRows] = useState(null)
  const [oil, setOil] = useState([])
  const [error, setError] = useState(null)
  const [cps, setCps] = useState([])
  useEffect(() => { qaApi.controlPoints().then(setCps).catch(() => {}) }, [])
  useEffect(() => {
    setRows(null)
    prodctlApi.list({ from: date, to: date }).then((r) => setRows([...r].reverse())).catch((e) => setError(e.message))
    oilApi.list({ from: date, to: date }).then((r) => setOil([...r].reverse())).catch(() => setOil([]))
  }, [date])
  const oils = [...new Set((rows || []).map((r) => r.oil_type).filter(Boolean))]
  const fry = (s) => (s && s.done ? [v(s.w_before), v(s.w_after), v(s.temp), v(s.min)] : ['', '', '', ''])
  const bad = (r, cp) => r.derived.find((d) => d.cp_id === cp)?.result === 'FAIL'
  // A frying time is marked only when that step itself is under the CCP-02 limit in the register.
  const ccp2 = cps.find((c) => c.cp_id === 'CCP-02')
  const shortFry = (r, step) => {
    if (!bad(r, 'CCP-02')) return false
    const s = r.data.fry[step]; const lim = ccp2?.params.find((p) => p.key === `${step}_min`)?.min
    return !!s?.done && lim !== undefined && (step !== 'chili' || s.kind === 'พริก') && Number(s.min) < lim
  }

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 7mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/prodctl')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกของวันที่ {thai(date)}</div>}
      {rows && rows.length > 0 && (
        <A4Sheet landscape={true} margin={7} className="text-[9.5px]">
          <FormHeader form={FORMS.PRODCTL} title="แบบฟอร์มควบคุมการผลิต" en="Production Control Record" type="รายวัน" />
          <div className="flex flex-wrap gap-x-6 mb-1 text-[10.5px]">
            <div><b>วันที่ผลิต:</b> {thai(date)}</div>
            <div><b>ชนิดน้ำมัน:</b> {oils.join(', ') || '-'}</div>
            <div><b>ค่า Polar ({FORMS.OIL.code}):</b> {oil.length ? oil.map((o) => `${o.check_time || STAGE[o.stage]} ${o.tpm_max}%`).join(' · ') : 'ไม่มีบันทึก'}</div>
            <div className="text-[9px]">Good Polar &lt; 20% · Risk 20–24% · Reject ≥ 25%</div>
          </div>
          <table className="w-full border-collapse text-center">
            <thead className="bg-[#0f2744] text-white">
              <tr>
                <th className={td} rowSpan={3}>Product name</th><th className={td} rowSpan={3}>Lot No.</th>
                <th className={td} colSpan={12}>กระทะคั่ว / ทอด / เจียว</th>
                <th className={td} colSpan={2} rowSpan={2}>บด</th><th className={td} colSpan={2} rowSpan={2}>ผัด / กวนผสม</th><th className={td} colSpan={4} rowSpan={2}>พักให้เย็น / บรรจุ / ปิดฝา</th>
                <th className={td} rowSpan={3}>ผล / NCR</th><th className={td} rowSpan={3}>หมายเหตุ<br /><span className="font-normal text-[9px]">(กรณีค่าไม่ผ่าน)</span></th>
              </tr>
              <tr>{['กระเทียม', 'หอม', 'พริก / เห็ด / หมูบด'].map((x) => <th key={x} className={td} colSpan={4}>{x}</th>)}</tr>
              <tr>
                {[0, 1, 2].flatMap((i) => ['ก่อน (กก.)', 'หลัง (กก.)', 'อุณหภูมิ', 'เวลา (นาที)'].map((h) => <th key={`${i}${h}`} className={`${td} font-normal`}>{h}</th>))}
                <th className={`${td} font-normal`}>ครั้ง</th><th className={`${td} font-normal`}>น้ำหนักหลัง</th>
                <th className={`${td} font-normal`}>อุณหภูมิ</th><th className={`${td} font-normal`}>เวลา</th>
                <th className={`${td} font-normal`}>เวลาพัก (นาที)</th><th className={`${td} font-normal`}>บรรจุ (°C)</th><th className={`${td} font-normal`}>ปิดฝา (°C)</th><th className={`${td} font-normal`}>ไม่มีสิ่งปลอมปน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.data, c1 = d.ccp1
                const heatT = c1 ? `${Math.min(...c1.readings)}–${Math.max(...c1.readings)}` : v(d.heat.temp)
                const heatM = c1 ? `${c1.reach_time}–${c1.end_time}` : v(d.heat.min)
                // What failed, in words, then what the QC wrote about it.
                const why = [
                  Number(d.cool.fill_temp) >= 60 && `บรรจุ ${d.cool.fill_temp}°C ≥ 60`,
                  Number(d.cool.cap_temp) >= 60 && `ปิดฝา ${d.cool.cap_temp}°C ≥ 60`,
                  d.cool.foreign_ok === false && 'พบสิ่งปลอมปน',
                ].filter(Boolean)
                return (
                  <tr key={r.pc_id} className="avoid-break">
                    <td className={`${td} text-left`}><Nw>{r.product_name || r.product_code}</Nw>{d.fry.chili.done ? <span className="text-gray-600"> ({d.fry.chili.kind})</span> : null}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.batch_no}</td>
                    {[...fry(d.fry.garlic), ...fry(d.fry.shallot), ...fry(d.fry.chili)].map((x, i) => <td key={i} className={`${td} ${i % 4 === 3 && shortFry(r, ['garlic', 'shallot', 'chili'][Math.floor(i / 4)]) ? 'text-red-700 font-bold' : ''}`}>{x}</td>)}
                    <td className={td}>{v(d.grind.count)}</td><td className={td}>{v(d.grind.w_after)}</td>
                    <td className={`${td} ${bad(r, 'CCP-01') ? 'text-red-700 font-bold' : ''}`}>{heatT}</td><td className={`${td} ${bad(r, 'CCP-01') ? 'text-red-700 font-bold' : ''}`}>{heatM}</td>
                    <td className={td}>{v(d.cool.min)}</td>
                    <td className={`${td} ${bad(r, 'OPRP-05') ? 'text-red-700 font-bold' : ''}`}>{v(d.cool.fill_temp)}</td>
                    <td className={`${td} ${bad(r, 'OPRP-05') ? 'text-red-700 font-bold' : ''}`}>{v(d.cool.cap_temp)}</td>
                    <td className={`${td} ${d.cool.foreign_ok === false ? 'text-red-700 font-bold' : ''}`}>{d.cool.foreign_ok === true ? '✓' : d.cool.foreign_ok === false ? '✗' : ''}</td>
                    <td className={`${td} text-left whitespace-nowrap`}>{[...r.derived.map((x) => `${x.cp_id} ${x.result === 'PASS' ? '✓' : '✗'}${x.ncr_id ? ' ' + x.ncr_id : ''}`), r.ncr_id].filter(Boolean).join(' · ')}</td>
                    <td className={`${td} text-left min-w-[28mm]`}>{why.length > 0 && <span className="text-red-700 font-semibold">{why.join(' · ')}{r.note ? ' — ' : ''}</span>}{r.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[9px]">ตัวหนาสีแดง = ไม่ผ่านเกณฑ์ (อุณหภูมิบรรจุและปิดฝาต้องต่ำกว่า 60°C) · ช่องหมายเหตุระบุสาเหตุและสิ่งที่ทำเมื่อค่าไม่ผ่าน</div>
          <div className="mt-8 flex justify-around text-center avoid-break text-[10.5px]">
            <div><RecorderSig names={rows.map((r) => r.inspector)} /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้บันทึก ({[...new Set(rows.map((r) => r.inspector))].join(', ')})<br />(เจ้าหน้าที่ฝ่ายควบคุมคุณภาพ)</div>
            <div><ReviewSig /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายควบคุมคุณภาพ)</div>
          </div>
        </A4Sheet>
      )}
    </div>
  )
}

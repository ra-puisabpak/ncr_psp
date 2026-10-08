import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { weighApi } from '../api/d1Api'
import { FORMS } from '../config'
import { FormHeader } from '../components/FormHeader'
import { bkkToday } from '../qa/shared'
import { thaiDate, kg } from './WeighPrintPage'

const td = 'border border-black px-1 py-[1px]'
const uniq = (a) => [...new Set(a.filter(Boolean))]

// One product (formula) of the day, laid out like the per-product form: info line, a row per raw material, a column per batch, own signature.
function ProductBlock({ recs, sigs }) {
  const first = recs[0]
  const cols = recs.flatMap((r) => Array.from({ length: r.sets }, (_, s) => ({ r, s, head: r.sets > 1 ? `${r.batch_no} ชุด ${s + 1}` : r.batch_no })))
  const names = uniq(recs.flatMap((r) => r.lines.map((l) => l.name)))
  const lineOf = (r, name) => r.lines.find((l) => l.name === name)
  const weigherOf = (r, l) => l?.weigher || r.weigher_name || r.weigher
  const devKey = new Set(recs.flatMap((r) => (r.deviations || []).filter((d) => d.kind === 'TOL').map((d) => `${r.wr_id}|${d.name}#${d.set}`)))
  const notes = recs.filter((r) => (r.deviations || []).length || r.note)
  const recorder = uniq(recs.map((r) => r.weigher)).join(', ')
  return (
    <div className="avoid-break" style={{ marginBottom: 14 }}>
      <div className="flex flex-wrap gap-x-8 mb-1">
        <div><b>ชื่อผลิตภัณฑ์:</b> {first.product_name} ({first.product_code})</div>
        <div><b>วันที่ผลิต:</b> {thaiDate(first.prod_date)}</div>
        <div><b>Batch:</b> {recs.map((r) => r.batch_no).join(', ')}</div>
        <div><b>เครื่องชั่ง:</b> {uniq(recs.map((r) => r.scale_id)).join(', ') || '-'}</div>
      </div>
      <table className="w-full border-collapse text-center table-fixed">
        <colgroup><col style={{ width: '9mm' }} /><col /><col style={{ width: '24mm' }} /><col style={{ width: '24mm' }} />{cols.map((_, i) => <col key={i} style={{ width: cols.length > 4 ? `${Math.floor(64 / cols.length)}mm` : '22mm' }} />)}</colgroup>
        <thead className="bg-[#0f2744] text-white">
          <tr><th className={td} rowSpan={2}>ลำดับ</th><th className={td} rowSpan={2}>รายการวัตถุดิบ</th><th className={td} rowSpan={2}>น้ำหนักที่กำหนด (กก./ชุด)</th><th className={td} rowSpan={2}>ผู้ชั่ง</th><th className={td} colSpan={cols.length}>น้ำหนักวัตถุดิบ (กก.)</th></tr>
          <tr>{cols.map((c, i) => <th key={i} className={td}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {names.map((name, i) => {
            const ls = recs.map((r) => lineOf(r, name)).filter(Boolean)
            return (
              <tr key={name}>
                <td className={td}>{i + 1}</td>
                <td className={`${td} text-left`}>{name}{ls.some((l) => l.extra) ? ' (นอกสูตร)' : ''}</td>
                <td className={td}>{kg(ls.find((l) => l.target != null)?.target)}</td>
                <td className={td}>{uniq(recs.filter((r) => lineOf(r, name)).map((r) => weigherOf(r, lineOf(r, name)))).join(', ')}</td>
                {cols.map((c, ci) => {
                  const l = lineOf(c.r, name)
                  return <td key={ci} className={`${td} ${devKey.has(`${c.r.wr_id}|${name}#${c.s + 1}`) ? 'font-bold text-red-700' : ''}`}>{l ? kg(l.weights[c.s]) : ''}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {notes.length > 0 && (
        <div className="mt-1 text-[9.5px]">
          {notes.map((r) => <div key={r.wr_id}><b>Batch {r.batch_no}:</b> {[...(r.deviations || []).map((d) => d.text), r.note ? `${r.result === 'DEVIATION' ? `ผลการประเมิน (${r.assessed_by})` : 'หมายเหตุ'}: ${r.note}` : ''].filter(Boolean).join(' · ')}</div>)}
        </div>
      )}
      <div className="mt-2 flex justify-end text-center">
        <div><div className="h-10 flex items-end justify-center">{sigs[recorder] && <img src={sigs[recorder]} alt="" className="max-h-10 max-w-56" />}</div><div className="border-t border-dotted border-black w-56 mx-auto mb-0.5" />ผู้บันทึก ({recorder})<br />(QC)</div>
      </div>
    </div>
  )
}

// Every raw-material weighing of one production day in one report: a block per product, two or three to an A4 page.
export default function WeighDayPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || bkkToday()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [sigs, setSigs] = useState({})
  useEffect(() => {
    setRows(null)
    weighApi.list({ from: date, to: date }).then(async (l) => {
      const sorted = [...l].sort((a, b) => a.product_code.localeCompare(b.product_code) || a.wr_id.localeCompare(b.wr_id))
      setRows(sorted)
      const got = await Promise.all(sorted.filter((r) => r.has_sig).map((r) => weighApi.signatures(r.wr_id).catch(() => [])))
      const map = {}
      got.flat().forEach((x) => { if (!map[x.name]) map[x.name] = x.data })
      setSigs(map)
    }).catch((e) => setError(e.message))
  }, [date])
  const products = uniq((rows || []).map((r) => r.product_code))
  
  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 portrait; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex flex-wrap items-center gap-3 justify-between shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/weigh')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <input type="date" value={date} max={bkkToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="text-gray-800 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={() => window.print()} disabled={!rows?.length} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {rows && rows.length === 0 && <div className="no-print text-center text-gray-500 py-16">ไม่มีบันทึกการชั่งวันที่ {thaiDate(date)}</div>}
      {rows && rows.length > 0 && (
        <A4Sheet landscape={false} margin={8} className="text-[10.5px]">
          <FormHeader form={FORMS.WEIGH} title="บันทึกการชั่งวัตถุดิบ" en="Raw Material Weighing Record" dept="Production QC" type="รายวัน" />
          {products.map((p) => <ProductBlock key={p} recs={rows.filter((r) => r.product_code === p)} sigs={sigs} />)}
        </A4Sheet>
      )}
    </div>
  )
}

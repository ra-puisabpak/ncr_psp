import { useEffect, useState } from 'react'
import A4Sheet from '../components/A4Sheet'
import Nw from '../components/Nw'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { weighApi } from '../api/d1Api'
import { FORMS } from '../config'
import { FormHeader, FormInfo, FormStats } from '../components/FormHeader'
import { bkkToday } from '../qa/shared'
import { thaiDate, kg } from './WeighPrintPage'

const td = 'border border-black px-1 py-[1px]'
const total = (r) => r.lines.reduce((a, l) => a + l.weights.reduce((x, w) => x + (Number(w) || 0), 0), 0)
const uniq = (a) => [...new Set(a.filter(Boolean))]

// One product (formula) of the day: a row per raw material, a column per batch weighed, with the batch results underneath.
function ProductBlock({ recs, no }) {
  const first = recs[0]
  const cols = recs.flatMap((r) => Array.from({ length: r.sets }, (_, s) => ({ r, s, head: r.sets > 1 ? `${r.batch_no} ชุด ${s + 1}` : r.batch_no })))
  const names = uniq(recs.flatMap((r) => r.lines.map((l) => l.name)))
  const lineOf = (r, name) => r.lines.find((l) => l.name === name)
  const devKey = new Set(recs.flatMap((r) => (r.deviations || []).filter((d) => d.kind === 'TOL').map((d) => `${r.wr_id}|${d.name}#${d.set}`)))
  const notes = recs.filter((r) => (r.deviations || []).length || r.note)
  return (
    <div className="avoid-break" style={{ marginBottom: 10 }}>
      <div className="flex justify-between items-end bg-[#e9eef4] border border-black border-b-0 px-2 py-0.5">
        <div><b className="text-[12px]">{no}. <Nw>{first.product_name}</Nw></b> <span className="text-[9px] text-gray-600">({first.product_code})</span></div>
        <div className="text-[10px]">{recs.length} Batch · รวม <b>{kg(recs.reduce((a, r) => a + total(r), 0))}</b> กก.</div>
      </div>
      <table className="w-full border-collapse text-center table-fixed">
        <colgroup><col style={{ width: '8mm' }} /><col /><col style={{ width: '22mm' }} />{cols.map((_, i) => <col key={i} style={{ width: cols.length > 5 ? `${Math.floor(78 / cols.length)}mm` : '17mm' }} />)}</colgroup>
        <thead className="bg-[#0f2744] text-white">
          <tr><th className={td}>ลำดับ</th><th className={td}>รายการวัตถุดิบ</th><th className={td}>กำหนด (กก./ชุด)</th>{cols.map((c, i) => <th key={i} className={td}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {names.map((name, i) => {
            const ls = recs.map((r) => lineOf(r, name)).filter(Boolean)
            return (
              <tr key={name}>
                <td className={td}>{i + 1}</td>
                <td className={`${td} text-left`}>{name}{ls.some((l) => l.extra) ? ' (นอกสูตร)' : ''}</td>
                <td className={td}>{kg(ls.find((l) => l.target != null)?.target)}</td>
                {cols.map((c, ci) => {
                  const l = lineOf(c.r, name)
                  return <td key={ci} className={`${td} ${devKey.has(`${c.r.wr_id}|${name}#${c.s + 1}`) ? 'font-bold text-red-700' : ''}`}>{l ? kg(l.weights[c.s]) : ''}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-[9.5px] mt-0.5">
        {recs.map((r) => (
          <div key={r.wr_id}><b>{r.batch_no}</b> · {r.wr_id} · <span className={r.result === 'PASS' ? '' : 'font-bold text-amber-800'}>{r.result === 'PASS' ? 'ตามสูตร' : 'นอกเกณฑ์ (ประเมินแล้ว)'}</span>
            {notes.includes(r) && <> — {[...(r.deviations || []).map((d) => d.text), r.note ? `${r.result === 'DEVIATION' ? `ผลการประเมิน (${r.assessed_by})` : 'หมายเหตุ'}: ${r.note}` : ''].filter(Boolean).join(' · ')}</>}</div>
        ))}
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
  const dev = (rows || []).filter((r) => r.result === 'DEVIATION').length
  const recorders = uniq((rows || []).map((r) => r.weigher))

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
          <FormHeader form={FORMS.WEIGH} title="บันทึกการชั่งวัตถุดิบประจำวัน" en="Daily Raw Material Weighing Record" dept="Production QC" type="รายวัน" />
          <FormInfo items={[['วันที่ผลิต', thaiDate(date)]]} />
          <FormStats items={[[products.length, 'ผลิตภัณฑ์ (สูตร)'], [rows.length, 'Batch'], [kg(rows.reduce((a, r) => a + total(r), 0)), 'น้ำหนักวัตถุดิบรวม (กก.)'], [dev, 'นอกเกณฑ์ (ประเมินแล้ว)', dev ? '#b45309' : undefined]]} />
          {products.map((p, i) => <ProductBlock key={p} no={i + 1} recs={rows.filter((r) => r.product_code === p)} />)}
          <div className="mt-6 flex justify-end text-center avoid-break">
            <div><div className="h-12 flex items-end justify-center">{recorders.length === 1 && sigs[recorders[0]] && <img src={sigs[recorders[0]]} alt="" className="max-h-12 max-w-56" />}</div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้บันทึก ({recorders.join(', ')})<br />(QC)</div>
          </div>
        </A4Sheet>
      )}
    </div>
  )
}

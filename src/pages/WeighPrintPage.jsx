import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { weighApi } from '../api/d1Api'
import { COMPANY_NAME, FORMS } from '../config'

const td = 'border border-black px-1 py-0.5'
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const thaiDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}` }
export const kg = (n) => (n == null ? '' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 }))
const uniq = (a) => [...new Set(a.filter(Boolean))]

// The weighing record of one product on one production day, laid out like the paper form: one row per raw material,
// one column per batch weighed that day (Batch No. as the heading), so a product made in several batches prints on one page.
export default function WeighPrintPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recs, setRecs] = useState(null)
  const [error, setError] = useState(null)
  const [sigs, setSigs] = useState({})
  useEffect(() => {
    weighApi.list({ wr_id: id }).then(async (l) => {
      const r = l[0]
      if (!r) { setError('ไม่พบบันทึก'); return }
      const day = await weighApi.list({ product_code: r.product_code, from: r.prod_date, to: r.prod_date })
      const sorted = [...day].sort((a, b) => a.wr_id.localeCompare(b.wr_id))
      setRecs(sorted)
      // One signature per weigher: the first of their records that has one.
      // Every weigher's signature; the first one found for a name is shown.
      const got = await Promise.all(sorted.filter((r) => r.has_sig).map((r) => weighApi.signatures(r.wr_id).catch(() => [])))
      const map = {}
      got.flat().forEach((x) => { if (!map[x.name]) map[x.name] = x.data })
      setSigs(map)
    }).catch((e) => setError(e.message))
  }, [id])
  // A line names its weigher; records from before per-line weighers name one for the whole record.
  const lineWeigher = (r, l) => l?.weigher || r.weigher_name || r.weigher
  const allWeighers = uniq((recs || []).flatMap((r) => r.lines.map((l) => lineWeigher(r, l))))

  // One column per set: a one-set record is headed by its Batch No.; a record of several sets (older forms) by Batch No. + set.
  const cols = (recs || []).flatMap((r) => Array.from({ length: r.sets }, (_, s) => ({ r, s, head: r.sets > 1 ? `${r.batch_no} ชุด ${s + 1}` : r.batch_no })))
  const width = Math.max(6, cols.length)
  const first = recs?.[0]
  // Rows: every raw material named in any of the day's records, in formula order.
  const names = uniq((recs || []).flatMap((r) => r.lines.map((l) => l.name)))
  const lineOf = (r, name) => r.lines.find((l) => l.name === name)
  const devKey = new Set((recs || []).flatMap((r) => (r.deviations || []).filter((d) => d.kind === 'TOL').map((d) => `${r.wr_id}|${d.name}#${d.set}`)))

  return (
    <div className="min-h-screen bg-gray-200 print:min-h-0 print:bg-white">
      <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
      <div className="no-print bg-blue-900 text-white px-4 py-3 flex items-center justify-between gap-2 shadow-lg sticky top-0 z-50">
        <button onClick={() => navigate('/qa/weigh')} className="flex items-center gap-2 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowLeft className="w-4 h-4" />กลับ</button>
        <div className="text-sm text-center">{first ? `${first.product_name} · ${thaiDate(first.prod_date)} · ${recs.length} Batch` : FORMS.WEIGH.code}</div>
        <div className="flex gap-2">
          {first && <Link to={`/qa/weigh/day?date=${first.prod_date}`} className="hidden sm:block hover:bg-blue-800 px-3 py-2 rounded-lg text-sm">สรุปรายวัน</Link>}
          <button onClick={() => window.print()} disabled={!recs} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"><Printer className="w-4 h-4" />พิมพ์ A4</button>
        </div>
      </div>
      {error && <div className="no-print max-w-lg mx-auto mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}
      {first && (
        <div className="print-area bg-white mx-auto my-4 shadow p-[8mm] text-black w-[297mm] max-w-full print:w-auto print:m-0 print:p-0 print:shadow-none text-[11px]" style={{ fontFamily: "'Sarabun', sans-serif" }}>
          <table className="w-full border-collapse mb-2">
            <tbody>
              <tr>
                <td className={`${td} w-[60%]`} rowSpan={3}><b className="text-[13px]">{COMPANY_NAME}</b><br />ประเภทเอกสาร: เอกสารในหน่วยผลิต<br /><b>ชื่อเอกสาร: บันทึกการชั่งวัตถุดิบ</b></td>
                <td className={td}>รหัสเอกสาร: {FORMS.WEIGH.code}</td>
              </tr>
              <tr><td className={td}>แก้ไขครั้งที่: {FORMS.WEIGH.rev}</td></tr>
              <tr><td className={td}>เลขที่บันทึก: {recs.map((r) => r.wr_id).join(', ')}</td></tr>
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-8 mb-1.5">
            <div><b>ชื่อผลิตภัณฑ์:</b> {first.product_name} ({first.product_code})</div>
            <div><b>วันที่ผลิต:</b> {thaiDate(first.prod_date)}</div>
            <div><b>Batch:</b> {recs.map((r) => r.batch_no).join(', ')}</div>
            <div><b>เครื่องชั่ง:</b> {uniq(recs.map((r) => r.scale_id)).join(', ') || '-'}</div>
            <div><b>สูตร:</b> v{first.formula_version} {first.formula_status === 'APPROVED' ? '(อนุมัติ)' : '(รอยืนยัน)'} · Tolerance {first.tolerance_pct == null ? 'ยังไม่กำหนด' : `±${first.tolerance_pct}%`}</div>
          </div>
          <table className="w-full border-collapse text-center">
            <thead className="bg-violet-50">
              <tr>
                <th className={td} rowSpan={2}>ลำดับ</th><th className={td} rowSpan={2}>รายการวัตถุดิบ</th><th className={td} rowSpan={2}>น้ำหนักที่กำหนด (กก./ชุด)</th>
                <th className={td} rowSpan={2}>วันที่รับเข้า / รหัส LOT</th><th className={td} rowSpan={2}>ผู้ชั่ง</th><th className={td} colSpan={width}>น้ำหนักวัตถุดิบ (กก.)</th>
              </tr>
              <tr>{Array.from({ length: width }, (_, i) => <th key={i} className={`${td} w-[5%]`}>{cols[i] ? cols[i].head : 'Batch No.'}</th>)}</tr>
            </thead>
            <tbody>
              {names.map((name, i) => {
                const ls = recs.map((r) => lineOf(r, name)).filter(Boolean)
                return (
                  <tr key={name}>
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} text-left`}>{name}{ls.some((l) => l.extra) ? ' (นอกสูตร)' : ''}</td>
                    <td className={td}>{kg(ls.find((l) => l.target != null)?.target)}</td>
                    <td className={`${td} text-left`}>{uniq(ls.map((l) => l.lot)).join(', ')}</td>
                    <td className={td}>{uniq(recs.filter((r) => lineOf(r, name)).map((r) => lineWeigher(r, lineOf(r, name)))).join(', ')}</td>
                    {Array.from({ length: width }, (_, c) => {
                      const col = cols[c]
                      const l = col && lineOf(col.r, name)
                      return <td key={c} className={`${td} ${col && devKey.has(`${col.r.wr_id}|${name}#${col.s + 1}`) ? 'font-bold text-red-700' : ''}`}>{l ? kg(l.weights[col.s]) : ''}</td>
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {recs.some((r) => r.deviations.length || r.note) && (
            <div className="mt-2 avoid-break">
              {recs.filter((r) => r.deviations.length || r.note).map((r) => (
                <div key={r.wr_id}><b>Batch {r.batch_no}:</b> {[...r.deviations.map((d) => d.text), r.note ? `${r.result === 'DEVIATION' ? `ผลการประเมิน (${r.assessed_by})` : 'หมายเหตุ'}: ${r.note}` : ''].filter(Boolean).join(' · ')}</div>
              ))}
            </div>
          )}
          <div className="mt-10 flex justify-around text-center avoid-break">
            {allWeighers.map((n) => (
              <div key={n}><div className="h-14 flex items-end justify-center">{sigs[n] && <img src={sigs[n]} alt="" className="max-h-14 max-w-56" />}</div><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้ชั่ง ({n})</div>
            ))}
            <div><div className="h-14" /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้บันทึก ({uniq(recs.map((r) => r.weigher)).join(', ')})<br />(QC)</div>
            <div><div className="h-14" /><div className="border-t border-dotted border-black w-56 mx-auto mb-1" />ผู้รับทราบ<br />(หัวหน้าฝ่ายผลิต)</div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Save, X, Plus, Trash2, History } from 'lucide-react'
import Layout from '../components/Layout'
import AuditTrail from '../components/AuditTrail'
import { formulaApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { Badge } from '../qa/shared'

const input = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
export const FORMULA_STATUS = { DRAFT: ['รอยืนยัน', 'bg-amber-100 text-amber-800'], APPROVED: ['อนุมัติแล้ว', 'bg-green-100 text-green-700'] }
const kg = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })

function Editor({ f, onCancel, onSaved }) {
  const [items, setItems] = useState(f.items.map((i) => ({ ...i, note: i.note || '' })))
  const [tol, setTol] = useState(f.tolerance_pct ?? '')
  const [status, setStatus] = useState(f.status)
  const [source, setSource] = useState(f.source || '')
  const [error, setError] = useState(null)
  const setI = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const save = async () => {
    setError(null)
    try { await formulaApi.update(f.product_code, { items, tolerance_pct: tol, status, source }); onSaved() } catch (e) { setError(e.message) }
  }
  const total = items.reduce((a, i) => a + (Number(i.target) || 0), 0)
  return (
    <div className="p-3 bg-teal-50 space-y-2">
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <input value={it.name} onChange={(e) => setI(i, 'name', e.target.value)} placeholder="วัตถุดิบ" className={`${input} col-span-4`} />
            <input type="number" step="0.001" min="0" value={it.target} onChange={(e) => setI(i, 'target', e.target.value)} className={`${input} col-span-2`} />
            <input value={it.note} onChange={(e) => setI(i, 'note', e.target.value)} placeholder="หมายเหตุ" className={`${input} col-span-5`} />
            <button type="button" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="col-span-1 justify-self-center text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setItems((l) => [...l, { name: '', target: '', note: '' }])} className="text-xs text-teal-700 font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" />เพิ่มวัตถุดิบ</button>
      <div className="text-xs text-gray-600">รวมต่อชุด {kg(total)} กก.</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs text-gray-600">Tolerance ±%<input type="number" step="0.1" min="0" value={tol} onChange={(e) => setTol(e.target.value)} placeholder="ยังไม่กำหนด" className={input} /></label>
        <label className="text-xs text-gray-600">สถานะ<select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>{Object.entries(FORMULA_STATUS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="text-xs text-gray-600 col-span-2">ที่มา / อ้างอิงสูตรที่ขึ้นทะเบียน<input value={source} onChange={(e) => setSource(e.target.value)} className={input} /></label>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Save className="w-4 h-4" />บันทึก</button>
        <button onClick={onCancel} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
      </div>
    </div>
  )
}

export default function FormulasPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [list, setList] = useState([])
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { formulaApi.list().then(setList).catch((e) => setError(e.message)) }, [refresh])
  const done = () => { setEditing(null); setRefresh((n) => n + 1) }

  return (
    <Layout>
      <Link to="/qa/weigh" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />บันทึกการชั่งวัตถุดิบ</Link>
      <h1 className="text-lg font-bold text-gray-800">สูตรการผลิต (น้ำหนักต่อ 1 ชุด)</h1>
      <div className="text-xs text-gray-500 mb-3">ตั้งต้นจากน้ำหนักที่ชั่งจริงในใบชั่ง PD_03 รอบล่าสุด (สรุป 04/10/2569) · QA ยืนยันกับสูตรที่ขึ้นทะเบียน กำหนด Tolerance แล้วอนุมัติ · หน่วยกิโลกรัม ของเหลว 1 มล. = 1 กรัม</div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {list.map((f) => {
          const [st, cls] = FORMULA_STATUS[f.status]
          const total = f.items.reduce((a, i) => a + i.target, 0)
          return (
            <div key={f.product_code}>
              <div className="p-3 flex items-start gap-2">
                <button onClick={() => setOpen(open === f.product_code ? null : f.product_code)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-mono text-gray-500">{f.product_code} · v{f.version}</span>
                    <Badge cls={cls}>{st}</Badge>
                    <Badge cls={f.tolerance_pct === null ? 'bg-gray-100 text-gray-500' : 'bg-sky-100 text-sky-800'}>{f.tolerance_pct === null ? 'ยังไม่กำหนด Tolerance' : `Tolerance ±${f.tolerance_pct}%`}</Badge>
                    {f.items.some((i) => i.note) && <Badge cls="bg-red-50 text-red-700">มีรายการต้องยืนยัน</Badge>}
                  </div>
                  <div className="font-semibold text-gray-800">{f.product_name}</div>
                  <div className="text-[11px] text-gray-500">{f.items.length} รายการ · รวม {kg(total)} กก./ชุด</div>
                </button>
                {qa && !editing && <button onClick={() => { setEditing(f.product_code); setOpen(f.product_code) }} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-4 h-4" /></button>}
                {qa && <button onClick={() => setHistory(history === f.product_code ? null : f.product_code)} className="p-1 text-gray-400 hover:text-blue-700"><History className="w-4 h-4" /></button>}
              </div>
              {editing === f.product_code ? <Editor f={f} onCancel={() => setEditing(null)} onSaved={done} /> : open === f.product_code && (
                <div className="px-3 pb-3">
                  <table className="w-full text-xs">
                    <tbody>
                      {f.items.map((i) => (
                        <tr key={i.name} className="border-t border-gray-100">
                          <td className="py-1 text-gray-700">{i.name}{i.note && <div className="text-[10.5px] text-red-700">{i.note}</div>}</td>
                          <td className="py-1 text-right tabular-nums">{kg(i.target)} กก.</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {f.source && <div className="text-[11px] text-gray-500 mt-1">ที่มา: {f.source}</div>}
                </div>
              )}
              {history === f.product_code && <div className="px-3 pb-3"><AuditTrail entityId={f.product_code} refreshKey={refresh} /></div>}
            </div>
          )
        })}
      </div>
    </Layout>
  )
}

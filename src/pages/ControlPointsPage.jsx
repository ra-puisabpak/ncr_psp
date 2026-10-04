import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Trash2, Save, X, History } from 'lucide-react'
import Layout from '../components/Layout'
import AuditTrail from '../components/AuditTrail'
import { qaApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { PRODUCTS, PROCESSES, byCode } from '../data/masterData'
import { CP_TYPE_TH, CP_TYPE_CLS, CP_STATUS_TH, CP_STATUS_CLS, Badge, limitText } from '../qa/shared'

const PROCESS_LABEL = byCode(PROCESSES)
const PRODUCT_LABEL = byCode(PRODUCTS)
const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const TEXT_FIELDS = [
  ['hazard', 'อันตราย'], ['monitoring', 'วิธีเฝ้าระวัง'], ['frequency', 'ความถี่'],
  ['corrective_action', 'การแก้ไขเมื่อเบี่ยงเบน'], ['verification', 'การทวนสอบ'], ['form_code', 'รหัสแบบฟอร์ม'],
]
const PARAM_TYPE_TH = { number: 'ตัวเลข', check: 'ใช่ / ไม่ใช่', text: 'ข้อความ' }
const blankCp = () => ({ cp_id: 'CP-', name: '', cp_type: 'TBD', status: 'DRAFT', process_ref: '', products: [], params: [{ key: '', label: '', type: 'number', unit: '', min: '', max: '' }] })

function Editor({ value, isNew, onCancel, onSaved }) {
  const [cp, setCp] = useState(() => ({
    ...value,
    params: value.params.map((p) => ({ unit: '', min: '', max: '', ...p })),
  }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setCp((c) => ({ ...c, [k]: v }))
  const setP = (i, k, v) => setCp((c) => ({ ...c, params: c.params.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }))
  const toggleProduct = (code) => set('products', cp.products.includes(code) ? cp.products.filter((x) => x !== code) : [...cp.products, code])

  const save = async () => {
    setError(null); setSaving(true)
    const params = cp.params.map((p) => {
      const o = { key: p.key.trim(), label: p.label.trim(), type: p.type }
      if (p.type === 'number') Object.assign(o, { unit: p.unit, min: p.min === '' ? undefined : p.min, max: p.max === '' ? undefined : p.max })
      return o
    })
    const body = { name: cp.name, cp_type: cp.cp_type, process_ref: cp.process_ref || null, products: cp.products, params,
      ...Object.fromEntries(TEXT_FIELDS.map(([k]) => [k, cp[k] || null])) }
    try {
      if (isNew) await qaApi.createControlPoint({ ...body, cp_id: cp.cp_id })
      else await qaApi.updateControlPoint(cp.cp_id, { ...body, status: cp.status })
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-3 border-2 border-teal-300">
      <div className="grid sm:grid-cols-4 gap-3">
        <label className="text-xs text-gray-600">รหัส
          <input value={cp.cp_id} disabled={!isNew} onChange={(e) => set('cp_id', e.target.value.toUpperCase())} className={`${input} font-mono`} />
        </label>
        <label className="text-xs text-gray-600 sm:col-span-3">ชื่อจุดควบคุม *
          <input value={cp.name} onChange={(e) => set('name', e.target.value)} className={input} />
        </label>
        <label className="text-xs text-gray-600">ประเภท
          <select value={cp.cp_type} onChange={(e) => set('cp_type', e.target.value)} className={input}>
            {Object.entries(CP_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {!isNew && (
          <label className="text-xs text-gray-600">สถานะ
            <select value={cp.status} onChange={(e) => set('status', e.target.value)} className={input}>
              {Object.entries(CP_STATUS_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        <label className={`text-xs text-gray-600 ${isNew ? 'sm:col-span-3' : 'sm:col-span-2'}`}>ขั้นตอนการผลิต
          <select value={cp.process_ref || ''} onChange={(e) => set('process_ref', e.target.value)} className={input}>
            <option value="">-</option>{PROCESSES.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
          </select>
        </label>
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">ผลิตภัณฑ์ที่ใช้ (ไม่เลือก = ทุกผลิตภัณฑ์)</div>
        <div className="flex flex-wrap gap-1.5">
          {PRODUCTS.map((p) => (
            <button type="button" key={p.code} onClick={() => toggleProduct(p.code)}
              className={`text-xs px-2 py-1 rounded-full border ${cp.products.includes(p.code) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-300'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">รายการตรวจและเกณฑ์</div>
        <div className="space-y-2">
          {cp.params.map((p, i) => (
            <div key={i} className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 items-center bg-gray-50 rounded-lg p-2">
              <input placeholder="รหัส a-z_" value={p.key} onChange={(e) => setP(i, 'key', e.target.value.toLowerCase())} className={`${input} col-span-2 font-mono`} />
              <input placeholder="ชื่อรายการ" value={p.label} onChange={(e) => setP(i, 'label', e.target.value)} className={`${input} col-span-4`} />
              <select value={p.type} onChange={(e) => setP(i, 'type', e.target.value)} className={`${input} col-span-2`}>
                {Object.entries(PARAM_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {p.type === 'number' ? (
                <>
                  <input placeholder="หน่วย" value={p.unit} onChange={(e) => setP(i, 'unit', e.target.value)} className={`${input} col-span-1`} />
                  <input placeholder="ต่ำสุด" type="number" step="any" value={p.min} onChange={(e) => setP(i, 'min', e.target.value)} className={`${input} col-span-1`} />
                  <input placeholder="สูงสุด" type="number" step="any" value={p.max} onChange={(e) => setP(i, 'max', e.target.value)} className={`${input} col-span-1`} />
                </>
              ) : <div className="col-span-3 text-[11px] text-gray-400">{p.type === 'check' ? 'ผ่านเมื่อตอบ "ใช่"' : 'บันทึกอย่างเดียว'}</div>}
              <button type="button" title="ลบรายการ" onClick={() => set('params', cp.params.filter((_, j) => j !== i))} className="col-span-1 justify-self-center text-gray-400 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set('params', [...cp.params, { key: '', label: '', type: 'check', unit: '', min: '', max: '' }])}
          className="mt-2 text-xs text-teal-700 font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" />เพิ่มรายการตรวจ</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {TEXT_FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-gray-600">{label}
            <textarea rows={k === 'form_code' || k === 'frequency' ? 1 : 2} value={cp[k] || ''} onChange={(e) => set(k, e.target.value)} className={input} />
          </label>
        ))}
      </div>

      <div className="text-[11px] text-gray-500">การเปลี่ยนเกณฑ์ ผลิตภัณฑ์ ประเภท หรือสถานะ จะขึ้นเวอร์ชันใหม่ บันทึกเดิมยังอ้างเวอร์ชันที่ใช้ตอนตรวจ และทุกการแก้ไขเก็บในประวัติ</div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button onClick={onCancel} className="flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
      </div>
    </div>
  )
}

export default function ControlPointsPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [points, setPoints] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // cp_id, or 'new'
  const [history, setHistory] = useState(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => { qaApi.controlPoints().then(setPoints).catch((e) => setError(e.message)) }, [refresh])
  const saved = () => { setEditing(null); setRefresh((n) => n + 1) }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />Smart QA</Link>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ทะเบียนจุดควบคุม</h1>
          <div className="text-xs text-gray-500">ตั้งต้นจาก HACCP CCP/OPRP Decision Tree Rev.01 · แก้ไขได้เฉพาะ QA Manager / FSTL</div>
        </div>
        {qa && !editing && (
          <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">
            <Plus className="w-4 h-4" />เพิ่มจุดควบคุม
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      <div className="space-y-3">
        {editing === 'new' && <Editor value={blankCp()} isNew onCancel={() => setEditing(null)} onSaved={saved} />}
        {points.map((c) => (editing === c.cp_id ? (
          <Editor key={c.cp_id} value={c} onCancel={() => setEditing(null)} onSaved={saved} />
        ) : (
          <div key={c.cp_id} className={`bg-white rounded-xl shadow p-4 ${c.status === 'RETIRED' ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-mono text-gray-500">{c.cp_id} · v{c.version}</span>
                  <Badge cls={CP_TYPE_CLS[c.cp_type]}>{CP_TYPE_TH[c.cp_type]}</Badge>
                  <Badge cls={CP_STATUS_CLS[c.status]}>{CP_STATUS_TH[c.status]}</Badge>
                </div>
                <div className="font-semibold text-gray-800 mt-0.5">{c.name}</div>
                <div className="text-xs text-gray-500">
                  {c.process_ref ? `${c.process_ref} ${PROCESS_LABEL[c.process_ref] || ''} · ` : ''}อันตราย: {c.hazard || '-'}
                </div>
              </div>
              {qa && !editing && (
                <button onClick={() => setEditing(c.cp_id)} title="แก้ไข" className="p-1.5 text-gray-400 hover:text-teal-700"><Pencil className="w-4 h-4" /></button>
              )}
              {qa && (
                <button onClick={() => setHistory(history === c.cp_id ? null : c.cp_id)} title="ประวัติการแก้ไข" className="p-1.5 text-gray-400 hover:text-blue-700"><History className="w-4 h-4" /></button>
              )}
            </div>
            <table className="w-full text-xs mt-2">
              <tbody>
                {c.params.map((p) => (
                  <tr key={p.key} className="border-t border-gray-100">
                    <td className="py-1 text-gray-700">{p.label}</td>
                    <td className={`py-1 text-right ${p.type === 'number' && p.min === undefined && p.max === undefined ? 'text-amber-700' : 'text-gray-600'}`}>{limitText(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[11px] text-gray-500 mt-2 space-y-0.5">
              <div><b>ผลิตภัณฑ์:</b> {c.products.length ? c.products.map((x) => PRODUCT_LABEL[x] || x).join(', ') : 'ทุกผลิตภัณฑ์'}</div>
              <div><b>เฝ้าระวัง:</b> {c.monitoring || '-'} · <b>ความถี่:</b> {c.frequency || '-'}</div>
              <div><b>การแก้ไข:</b> {c.corrective_action || '-'}</div>
              <div><b>ทวนสอบ:</b> {c.verification || '-'}</div>
              <div>แก้ไขล่าสุดโดย {c.updated_by} · {String(c.updated_at).slice(0, 16).replace('T', ' ')}</div>
            </div>
            {history === c.cp_id && <AuditTrail entityId={c.cp_id} refreshKey={refresh} />}
          </div>
        )))}
      </div>
    </Layout>
  )
}

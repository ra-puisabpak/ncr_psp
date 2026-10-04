import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Save, X, Plus, History } from 'lucide-react'
import Layout from '../components/Layout'
import AuditTrail from '../components/AuditTrail'
import { hygApi } from '../api/d1Api'
import { useAuth, isQA, canWrite } from '../auth'

const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'

function ItemEditor({ value, onCancel, onSave }) {
  const [it, setIt] = useState(value)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setIt((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value }))
  const save = async () => { setError(null); try { await onSave(it) } catch (e) { setError(e.message) } }
  return (
    <div className="p-3 space-y-2 bg-teal-50">
      <input value={it.label || ''} onChange={set('label')} placeholder="หัวข้อการตรวจ *" className={input} />
      <input value={it.note || ''} onChange={set('note')} placeholder="เกณฑ์โดยย่อ" className={input} />
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={it.pass_desc || ''} onChange={set('pass_desc')} placeholder="ลักษณะที่ผ่าน" className={input} />
        <input value={it.fail_desc || ''} onChange={set('fail_desc')} placeholder="ลักษณะที่ไม่ผ่าน" className={input} />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!it.critical} onChange={set('critical')} className="accent-red-600" />ข้อสำคัญ (ไม่ผ่านแล้วห้ามเข้าพื้นที่ผลิต)</label>
        {'active' in it && <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!it.active} onChange={set('active')} className="accent-teal-600" />ใช้งาน</label>}
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Save className="w-4 h-4" />บันทึก</button>
        <button onClick={onCancel} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
      </div>
    </div>
  )
}

export default function HygieneSetupPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [items, setItems] = useState([])
  const [emps, setEmps] = useState([])
  const [editing, setEditing] = useState(null)
  const [history, setHistory] = useState(null)
  const [newEmp, setNewEmp] = useState({ name: '', dept: '' })
  const [error, setError] = useState(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    hygApi.items().then(setItems).catch((e) => setError(e.message))
    hygApi.employees().then(setEmps).catch((e) => setError(e.message))
  }, [refresh])
  const reload = () => { setEditing(null); setRefresh((n) => n + 1) }

  const saveItem = async (it) => {
    if (it.item_key) await hygApi.updateItem(it.item_key, it)
    else await hygApi.createItem(it)
    reload()
  }
  const addEmp = async () => {
    setError(null)
    try { await hygApi.addEmployee(newEmp); setNewEmp({ name: '', dept: '' }); reload() } catch (e) { setError(e.message) }
  }
  const toggleEmp = async (e) => {
    setError(null)
    try { await hygApi.updateEmployee(e.emp_id, { active: !e.active }); reload() } catch (err) { setError(err.message) }
  }

  return (
    <Layout>
      <Link to="/qa/hygiene" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />ตรวจสุขลักษณะส่วนบุคคล</Link>
      <h1 className="text-lg font-bold text-gray-800 mb-1">หัวข้อการตรวจและรายชื่อพนักงาน</h1>
      <div className="text-xs text-gray-500 mb-3">แก้ไขหัวข้อและปิดรายชื่อพนักงานได้เฉพาะ QA Manager / FSTL · บันทึกเก่ายังแสดงข้อความหัวข้อตามที่ใช้ตอนตรวจ</div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-700">หัวข้อการตรวจ</h2>
        {qa && !editing && <button onClick={() => setEditing('new')} className="text-xs text-teal-700 font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" />เพิ่มหัวข้อ</button>}
      </div>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100 mb-6">
        {editing === 'new' && <ItemEditor value={{ label: '', note: '', pass_desc: '', fail_desc: '', critical: 0 }} onCancel={() => setEditing(null)} onSave={saveItem} />}
        {items.map((it) => (editing === it.item_key ? (
          <ItemEditor key={it.item_key} value={it} onCancel={() => setEditing(null)} onSave={saveItem} />
        ) : (
          <div key={it.item_key} className={`p-3 ${it.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-2">
              <span className="text-xs font-mono text-gray-400 mt-0.5">{it.item_key}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-800">{it.label}
                  {it.critical ? <span className="ml-1.5 text-[10px] font-bold text-red-600">ข้อสำคัญ</span> : null}
                  {!it.active && <span className="ml-1.5 text-[10px] text-gray-500">(ไม่ใช้งาน)</span>}
                </div>
                {it.note && <div className="text-xs text-gray-500">{it.note}</div>}
              </div>
              {qa && !editing && <button onClick={() => setEditing(it.item_key)} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-4 h-4" /></button>}
              {qa && <button onClick={() => setHistory(history === it.item_key ? null : it.item_key)} className="p-1 text-gray-400 hover:text-blue-700"><History className="w-4 h-4" /></button>}
            </div>
            {history === it.item_key && <AuditTrail entityId={it.item_key} refreshKey={refresh} />}
          </div>
        )))}
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">รายชื่อพนักงาน ({emps.filter((e) => e.active).length} คนที่ใช้งาน)</h2>
      {canWrite(user) && (
        <div className="flex gap-2 mb-2">
          <input value={newEmp.name} onChange={(e) => setNewEmp((n) => ({ ...n, name: e.target.value }))} placeholder="ชื่อ-สกุล" className={input} />
          <input value={newEmp.dept} onChange={(e) => setNewEmp((n) => ({ ...n, dept: e.target.value }))} placeholder="แผนก" className={`${input} max-w-[140px]`} />
          <button disabled={newEmp.name.trim().length < 2} onClick={addEmp} className="shrink-0 flex items-center gap-1 bg-teal-600 text-white text-sm px-3 rounded-lg disabled:opacity-40"><Plus className="w-4 h-4" />เพิ่ม</button>
        </div>
      )}
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {emps.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีรายชื่อ</div>}
        {emps.map((e) => (
          <div key={e.emp_id} className={`p-2.5 flex items-center gap-2 text-sm ${e.active ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-1">{e.name}{e.dept ? <span className="text-xs text-gray-500"> · {e.dept}</span> : null}</div>
            {qa && <button onClick={() => toggleEmp(e)} className="text-xs border border-gray-300 rounded-lg px-2 py-1">{e.active ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}</button>}
          </div>
        ))}
      </div>
    </Layout>
  )
}

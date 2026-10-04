import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Save, X, History } from 'lucide-react'
import Layout from '../components/Layout'
import AuditTrail from '../components/AuditTrail'
import { coldApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { Badge, bkkToday } from '../qa/shared'
import { AREA_TH, specText } from './ColdPage'

const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const blankUnit = { unit_id: '', name: '', area: 'RM', unit_type: 'CHILL', setting: '', spec_min: '', spec_max: '', escalate_at: '', thermometer: '', calib_due: '' }

function Editor({ value, isNew, onCancel, onSaved }) {
  const [u, setU] = useState({ ...blankUnit, ...value, spec_min: value.spec_min ?? '', spec_max: value.spec_max ?? '', escalate_at: value.escalate_at ?? '', calib_due: value.calib_due || '' })
  const [error, setError] = useState(null)
  const set = (k) => (e) => setU((x) => ({ ...x, [k]: e.target.value }))
  const changeType = (e) => setU((x) => ({ ...x, unit_type: e.target.value, spec_min: '', spec_max: '', escalate_at: '' }))
  const save = async () => {
    setError(null)
    const body = { ...u }
    // Leave limits empty to take the SOP defaults for the type.
    for (const k of ['spec_max', 'escalate_at']) if (body[k] === '') delete body[k]
    if (body.spec_min === '' && (isNew || u.unit_type !== value.unit_type)) delete body.spec_min
    try {
      if (isNew) await coldApi.createUnit(body)
      else { delete body.unit_id; await coldApi.updateUnit(u.unit_id, body) }
      onSaved()
    } catch (e) { setError(e.message) }
  }
  return (
    <div className="p-3 bg-teal-50 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs text-gray-600">Equipment ID *<input value={u.unit_id} disabled={!isNew} onChange={(e) => setU((x) => ({ ...x, unit_id: e.target.value.toUpperCase() }))} placeholder="เช่น CH-01" className={`${input} font-mono`} /></label>
        <label className="text-xs text-gray-600 col-span-1 sm:col-span-3">ชื่อ / ตำแหน่ง *<input value={u.name} onChange={set('name')} className={input} /></label>
        <label className="text-xs text-gray-600">พื้นที่<select value={u.area} onChange={set('area')} className={input}>{Object.entries(AREA_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-gray-600">ชนิด<select value={u.unit_type} onChange={changeType} className={input}><option value="CHILL">Chill / ตู้เย็น</option><option value="FREEZE">Freeze / ตู้แช่แข็ง</option></select></label>
        <label className="text-xs text-gray-600">Setting<input value={u.setting || ''} onChange={set('setting')} placeholder="เช่น 3 °C" className={input} /></label>
        <label className="text-xs text-gray-600">เทอร์โมมิเตอร์<input value={u.thermometer || ''} onChange={set('thermometer')} className={input} /></label>
        <label className="text-xs text-gray-600">เกณฑ์ต่ำสุด (°C)<input type="number" step="0.1" value={u.spec_min} onChange={set('spec_min')} placeholder={u.unit_type === 'CHILL' ? '0' : 'ไม่กำหนด'} className={input} /></label>
        <label className="text-xs text-gray-600">เกณฑ์สูงสุด (°C)<input type="number" step="0.1" value={u.spec_max} onChange={set('spec_max')} placeholder={u.unit_type === 'CHILL' ? '5' : '-18'} className={input} /></label>
        <label className="text-xs text-gray-600">Escalation &gt; (°C)<input type="number" step="0.1" value={u.escalate_at} onChange={set('escalate_at')} placeholder={u.unit_type === 'CHILL' ? '8' : '-12'} className={input} /></label>
        <label className="text-xs text-gray-600">สอบเทียบถึง<input type="date" value={u.calib_due} onChange={set('calib_due')} className={input} /></label>
      </div>
      <div className="text-[11px] text-gray-500">เว้นเกณฑ์ว่างไว้ = ใช้ค่าตาม SOP (Chill 0–5 °C, Escalation &gt; 8 · Freeze ≤ −18 °C, Escalation &gt; −12) ให้ยึด Product/Storage Specification หากเข้มงวดกว่า</div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Save className="w-4 h-4" />บันทึก</button>
        <button onClick={onCancel} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
      </div>
    </div>
  )
}

export default function ColdUnitsPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [units, setUnits] = useState([])
  const [editing, setEditing] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { coldApi.units().then(setUnits).catch((e) => setError(e.message)) }, [refresh])
  const done = () => { setEditing(null); setRefresh((n) => n + 1) }
  const toggle = async (u) => { try { await coldApi.updateUnit(u.unit_id, { active: !u.active }); done() } catch (e) { setError(e.message) } }

  return (
    <Layout>
      <Link to="/qa/cold" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />อุณหภูมิตู้เย็น / ตู้แช่แข็ง</Link>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ทะเบียนตู้เย็น / ตู้แช่แข็ง</h1>
          <div className="text-xs text-gray-500">แก้ไขได้เฉพาะ QA Manager / FSTL · การแก้ไขเก็บในประวัติ</div>
        </div>
        {qa && !editing && <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4" />เพิ่มตู้</button>}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {editing === 'new' && <Editor value={blankUnit} isNew onCancel={() => setEditing(null)} onSaved={done} />}
        {units.length === 0 && editing !== 'new' && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีตู้</div>}
        {units.map((u) => (editing === u.unit_id ? <Editor key={u.unit_id} value={u} onCancel={() => setEditing(null)} onSaved={done} /> : (
          <div key={u.unit_id} className={`p-3 ${u.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-semibold text-gray-800">{u.unit_id}</span>
                  <Badge cls="bg-sky-100 text-sky-800">{u.unit_type === 'CHILL' ? 'Chill' : 'Freeze'}</Badge>
                  <Badge cls="bg-gray-100 text-gray-600">{AREA_TH[u.area]}</Badge>
                  {u.calib_due && u.calib_due < bkkToday() && <Badge cls="bg-red-100 text-red-700">เทอร์โมมิเตอร์หมดอายุสอบเทียบ</Badge>}
                  {!u.active && <Badge cls="bg-gray-200 text-gray-500">ปิดใช้งาน</Badge>}
                </div>
                <div className="text-sm text-gray-700">{u.name}</div>
                <div className="text-[11px] text-gray-500">เกณฑ์ {specText(u)} · Escalation &gt; {u.escalate_at} °C · Setting {u.setting || '-'} · เทอร์โมมิเตอร์ {u.thermometer || '-'}{u.calib_due ? ` (สอบเทียบถึง ${u.calib_due})` : ''}</div>
              </div>
              {qa && !editing && <button onClick={() => setEditing(u.unit_id)} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-4 h-4" /></button>}
              {qa && <button onClick={() => setHistory(history === u.unit_id ? null : u.unit_id)} className="p-1 text-gray-400 hover:text-blue-700"><History className="w-4 h-4" /></button>}
              {qa && <button onClick={() => toggle(u)} className="text-xs border border-gray-300 rounded-lg px-2 py-1">{u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}
            </div>
            {history === u.unit_id && <AuditTrail entityId={u.unit_id} refreshKey={refresh} />}
          </div>
        )))}
      </div>
    </Layout>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Save, X } from 'lucide-react'
import Layout from '../components/Layout'
import { supplierListApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { Badge } from '../qa/shared'

const KIND = { COMPANY: ['บริษัท / ผู้ผลิต', 'bg-gray-100 text-gray-700'], RETAIL: ['ห้างค้าปลีก', 'bg-orange-100 text-orange-800'], MARKET: ['ตลาดสด', 'bg-green-100 text-green-800'] }
const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'

// Central list of suppliers offered in the receiving app (Makro first, then the fresh market).
export default function SuppliersPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [list, setList] = useState([])
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const load = () => supplierListApi.list().then(setList).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const save = async () => {
    setError(null)
    try { await supplierListApi.create({ name: form.name, kind: form.kind, sort: form.sort === '' ? 100 : Number(form.sort) }); setForm(null); await load() } catch (e) { setError(e.message) }
  }
  const patch = async (s, body) => { try { await supplierListApi.update({ name: s.name, ...body }); await load() } catch (e) { setError(e.message) } }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ทะเบียน Supplier กลาง</h1>
          <div className="text-xs text-gray-500">ขึ้นเป็นตัวเลือกในช่อง Supplier ของแอปรับวัตถุดิบ · เลขลำดับน้อยอยู่บนสุด · ไม่ลบ ใช้ "ปิดใช้งาน" แทน · ชื่อที่พนักงานพิมพ์เองยังใช้ได้</div>
        </div>
        {qa && !form && <button onClick={() => setForm({ name: '', kind: 'COMPANY', sort: '' })} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4" />เพิ่ม Supplier</button>}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-3">{error}</div>}
      {form && (
        <div className="bg-teal-50 rounded-xl p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="text-xs text-gray-600 col-span-2">ชื่อ *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} /></label>
            <label className="text-xs text-gray-600">ประเภท<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
            <label className="text-xs text-gray-600">ลำดับ<input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} placeholder="100" className={input} /></label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name.trim()} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"><Save className="w-4 h-4" />บันทึก</button>
            <button onClick={() => setForm(null)} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {list.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีรายการ</div>}
        {list.map((s) => (
          <div key={s.name} className={`p-3 flex items-center gap-2 ${s.active ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-gray-800">{s.name}</div>
              <div className="flex gap-1.5 mt-0.5"><Badge cls={KIND[s.kind][1]}>{KIND[s.kind][0]}</Badge><span className="text-[11px] text-gray-400">ลำดับ {s.sort}</span></div>
            </div>
            {qa && <button onClick={() => patch(s, { active: !s.active })} className="text-xs border border-gray-300 rounded-lg px-2 py-1 whitespace-nowrap">{s.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}
          </div>
        ))}
      </div>
    </Layout>
  )
}

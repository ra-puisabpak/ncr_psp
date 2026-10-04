import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, RefreshCw, Search } from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi } from '../api/d1Api'
import { ResultBadge, bkkToday, addDays } from '../qa/shared'

const input = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm'
const show = (v) => (v === true ? 'ใช่' : v === false ? 'ไม่ใช่' : v ?? '')

export default function QCRecordsPage() {
  const [params] = useSearchParams()
  const [filter, setFilter] = useState({ from: addDays(bkkToday(), -6), to: bkkToday(), cp_id: '', result: params.get('result') || '', q: '' })
  const [rows, setRows] = useState([])
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const query = Object.fromEntries(Object.entries(filter).filter(([, v]) => v))
      const [r, cps] = await Promise.all([qaApi.records({ ...query, limit: 500 }), points.length ? points : qaApi.controlPoints()])
      setRows(r); setPoints(cps)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filter.from, filter.to, filter.cp_id, filter.result]) // eslint-disable-line react-hooks/exhaustive-deps

  const cpById = Object.fromEntries(points.map((c) => [c.cp_id, c]))
  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }))

  const exportCsv = () => {
    const head = ['เลขที่บันทึก', 'วันที่', 'เวลา', 'กะ', 'จุดควบคุม', 'ชื่อจุดควบคุม', 'เวอร์ชันเกณฑ์', 'สถานะเกณฑ์', 'รหัสผลิตภัณฑ์', 'ผลิตภัณฑ์', 'Batch', 'ค่าที่บันทึก', 'ผล', 'รายการไม่ผ่าน', 'NCR', 'ผู้ตรวจ', 'หมายเหตุ']
    const lines = rows.map((r) => {
      const cp = cpById[r.cp_id]
      const labels = Object.fromEntries((cp?.params || []).map((p) => [p.key, p.label]))
      return [r.rec_id, r.record_date, r.record_time, r.shift, r.cp_id, cp?.name, r.cp_version, r.cp_status, r.product_code, r.product_name, r.batch_no,
        Object.entries(r.values).map(([k, v]) => `${labels[k] || k}=${show(v)}`).join('; '), r.result,
        r.failed.map((f) => `${f.label}: ${f.value} (เกณฑ์ ${f.limit})`).join('; '), r.ncr_id, r.inspector, r.note]
    })
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `QC-records_${filter.from}_${filter.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pageActions = (
    <button onClick={load} title="รีเฟรช" className="p-2 hover:bg-white/20 rounded-lg transition text-white">
      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  )

  return (
    <Layout pageActions={pageActions}>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <h1 className="text-lg font-bold text-gray-800 mb-3">ประวัติบันทึกตรวจ</h1>

      <div className="bg-white rounded-xl shadow p-3 mb-4 flex flex-wrap gap-2 items-end">
        <label className="text-xs text-gray-600 flex flex-col">ตั้งแต่<input type="date" value={filter.from} max={filter.to} onChange={set('from')} className={input} /></label>
        <label className="text-xs text-gray-600 flex flex-col">ถึง<input type="date" value={filter.to} max={bkkToday()} onChange={set('to')} className={input} /></label>
        <label className="text-xs text-gray-600 flex flex-col">จุดควบคุม
          <select value={filter.cp_id} onChange={set('cp_id')} className={input}>
            <option value="">ทั้งหมด</option>{points.map((c) => <option key={c.cp_id} value={c.cp_id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 flex flex-col">ผล
          <select value={filter.result} onChange={set('result')} className={input}>
            <option value="">ทั้งหมด</option><option value="PASS">ผ่าน</option><option value="FAIL">ไม่ผ่าน</option>
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); load() }} className="flex items-end gap-1 flex-1 min-w-[180px]">
          <label className="text-xs text-gray-600 flex flex-col flex-1">ค้นหา Batch / เลขที่ / NCR
            <input value={filter.q} onChange={set('q')} className={input} />
          </label>
          <button className="p-2 bg-gray-100 rounded-lg"><Search className="w-4 h-4" /></button>
        </form>
        <button onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40">
          <Download className="w-4 h-4" />CSV
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      <div className="text-xs text-gray-500 mb-2">{rows.length} รายการ{rows.length === 500 ? ' (แสดงสูงสุด 500 รายการ ให้ช่วงวันที่แคบลง)' : ''}</div>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {!loading && rows.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ไม่พบบันทึก</div>}
        {rows.map((r) => {
          const cp = cpById[r.cp_id]
          const labels = Object.fromEntries((cp?.params || []).map((p) => [p.key, p]))
          return (
            <div key={r.rec_id} className="p-3 text-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-800">{cp?.name || r.cp_id} · Batch {r.batch_no}</div>
                  <div className="text-[11px] text-gray-500">
                    {r.rec_id} · {r.record_date} {r.record_time || ''}{r.shift ? ` · กะ${r.shift}` : ''} · {r.product_name || '-'} · ผู้ตรวจ {r.inspector} · เกณฑ์ v{r.cp_version}{r.cp_status === 'DRAFT' ? ' (ร่าง)' : ''}
                  </div>
                </div>
                {r.ncr_id && <Link to={`/ncr/${r.ncr_id}`} className="text-[11px] font-semibold text-red-700 underline whitespace-nowrap">{r.ncr_id}</Link>}
                <ResultBadge result={r.result} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-600">
                {Object.entries(r.values).map(([k, v]) => {
                  const bad = r.failed.some((f) => f.key === k)
                  return <span key={k} className={bad ? 'text-red-700 font-semibold' : ''}>{labels[k]?.label || k}: {show(v)}{labels[k]?.unit ? ` ${labels[k].unit}` : ''}</span>
                })}
              </div>
              {r.note && <div className="text-xs text-gray-500 mt-0.5">หมายเหตุ: {r.note}</div>}
            </div>
          )
        })}
      </div>
    </Layout>
  )
}

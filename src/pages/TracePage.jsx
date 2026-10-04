import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Search, PackageOpen, Boxes, ClipboardCheck, FileText, Scale } from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi } from '../api/d1Api'
import { MATERIALS, byCode } from '../data/masterData'
import { ResultBadge } from '../qa/shared'
import { ReleaseRow } from './FGReleasePage'

const MAT_LABEL = byCode(MATERIALS)

function Section({ icon: Icon, title, count, children }) {
  return (
    <div className="bg-white rounded-xl shadow">
      <div className="p-3 border-b border-gray-100 flex items-center gap-2 text-sm font-bold text-gray-700">
        <Icon className="w-4 h-4 text-teal-600" />{title}<span className="text-xs font-normal text-gray-400">({count})</span>
      </div>
      <div className="divide-y divide-gray-100">{count ? children : <div className="p-3 text-xs text-gray-400">ไม่พบ</div>}</div>
    </div>
  )
}

export default function TracePage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [res, setRes] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const search = async (e) => {
    e?.preventDefault()
    const term = q.trim()
    if (term.length < 2) return
    setLoading(true); setError(null); setParams({ q: term }, { replace: true })
    try { setRes(await qaApi.trace(term)) } catch (err) { setError(err.message); setRes(null) }
    finally { setLoading(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <h1 className="text-lg font-bold text-gray-800 mb-1">สอบย้อนกลับ (Traceability)</h1>
      <div className="text-xs text-gray-500 mb-3">ค้นด้วยเลขล็อตวัตถุดิบหรือเลข Batch สินค้า: รับเข้าเมื่อไร ใช้ใน Batch ไหน ผลตรวจ และ NCR ที่เกี่ยวข้อง สำหรับการเรียกคืนและการซ้อมสอบย้อนกลับ</div>

      <form onSubmit={search} className="bg-white rounded-xl shadow p-3 mb-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="เลขล็อตวัตถุดิบ หรือ เลข Batch" autoFocus
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <button disabled={q.trim().length < 2 || loading} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-40">
          <Search className="w-4 h-4" />{loading ? 'กำลังค้น…' : 'ค้นหา'}
        </button>
      </form>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      {res && (
        <div className="space-y-4">
          <Section icon={PackageOpen} title="รับเข้า (FM-QC-001)" count={res.received.length}>
            {res.received.map((m, i) => (
              <div key={`${m.doc_no}-${m.lot}-${i}`} className="p-3 text-sm flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-800">ล็อต {m.lot} · {MAT_LABEL[m.code] || m.code || '-'}</div>
                  <div className="text-[11px] text-gray-500">{m.doc_no} · รับ {m.recv_date} · {m.supplier}{m.qty != null && m.qty !== '' ? ` · ${m.qty} ${m.unit}` : ''}{m.exp ? ` · หมดอายุ ${m.exp}` : ''}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.result === 'PASS' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{m.result}</span>
              </div>
            ))}
          </Section>
          <Section icon={Scale} title="ใช้ในการผลิต (บันทึกการชั่ง PD_03)" count={(res.weighings || []).length}>
            {(res.weighings || []).map((w) => (
              <Link key={w.wr_id} to={`/qa/weigh/${w.wr_id}/print`} className="block p-3 text-sm hover:bg-gray-50">
                <div className="font-semibold text-gray-800">{w.product_name} · Batch {w.batch_no}</div>
                <div className="text-[11px] text-gray-500">{w.wr_id} · ผลิต {w.prod_date} · {w.sets} ชุด{w.result === 'DEVIATION' ? ' · นอกเกณฑ์ (ประเมินแล้ว)' : ''}</div>
                <div className="text-[11px] text-gray-600">{w.lots.filter((l) => l.lot.toLowerCase().includes(res.q.toLowerCase()) || w.batch_no.toLowerCase().includes(res.q.toLowerCase())).map((l) => `${l.name} ${l.lot} (${l.kg} กก.)`).join(' · ')}</div>
              </Link>
            ))}
          </Section>
          <Section icon={Boxes} title="Batch สินค้าและการตัดสินปล่อย" count={res.releases.length}>
            {res.releases.map((r) => (
              <Link key={r.rel_id} to={`/qa/release?product=${r.product_code}&batch=${encodeURIComponent(r.batch_no)}`} className="block hover:bg-gray-50">
                <ReleaseRow r={r} />
              </Link>
            ))}
          </Section>
          <Section icon={ClipboardCheck} title="บันทึกตรวจของ Batch" count={res.qc.length}>
            {res.qc.map((x) => (
              <div key={x.rec_id} className="p-3 text-sm flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-800">{x.cp_id} · Batch {x.batch_no}</div>
                  <div className="text-[11px] text-gray-500">{x.rec_id} · {x.record_date} · {x.product_name || x.product_code || '-'}</div>
                </div>
                {x.ncr_id && <Link to={`/ncr/${x.ncr_id}`} className="text-[11px] font-semibold text-red-700 underline">{x.ncr_id}</Link>}
                <ResultBadge result={x.result} />
              </div>
            ))}
          </Section>
          <Section icon={FileText} title="NCR ที่เกี่ยวข้อง" count={res.ncrs.length}>
            {res.ncrs.map((n) => (
              <Link key={n.ncr_id} to={`/ncr/${n.ncr_id}`} className="block p-3 text-sm hover:bg-gray-50">
                <div className="font-medium text-gray-800">{n.ncr_id} · {n.status} · {n.severity}{n.disposition ? ` · ${n.disposition}` : ''}</div>
                <div className="text-[11px] text-gray-500 truncate">{n.issue_date} · ล็อต {n.lot_no || n.product_lot_no || '-'} · {n.nc_description}</div>
              </Link>
            ))}
          </Section>
        </div>
      )}
    </Layout>
  )
}

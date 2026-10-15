import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Sparkles, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import Layout from '../components/Layout'
import TrendChart from '../analysis/TrendChart'
import { coldSeries, oilSeries, awphByProduct, observations, summaryForAI } from '../analysis/insights'
import ScatterChart from '../analysis/ScatterChart'
import { buildBatches, relationTable, topOutliers, strength } from '../analysis/relations'
import { coldApi, oilApi, fgCheckApi, prodctlApi, weighApi, analyzeApi } from '../api/d1Api'
import { useAuth } from '../auth'
import { bkkToday, addDays } from '../qa/shared'

const VARS = {
  '--viz-surface': '#ffffff', '--viz-text': '#0b0b0b', '--viz-muted': '#6b6a66', '--viz-grid': '#e4e3df', '--viz-band': 'rgba(42,120,214,0.09)',
  '--viz-s1': '#2a78d6', '--viz-bad': '#c62828',
}
const LEVEL = {
  high: ['border-red-300 bg-red-50 text-red-900', AlertTriangle, 'text-red-600'],
  mid: ['border-amber-300 bg-amber-50 text-amber-900', Info, 'text-amber-600'],
  ok: ['border-green-200 bg-green-50 text-green-900', CheckCircle2, 'text-green-600'],
}
const Card = ({ title, sub, children }) => (
  <section className="bg-white rounded-xl shadow p-4 mb-4">
    <h2 className="font-bold text-gray-800">{title}</h2>
    {sub && <div className="text-xs text-gray-500 mb-2">{sub}</div>}
    {children}
  </section>
)
const f = (v, dp) => (v == null ? '-' : Number(v).toFixed(dp))

export default function AnalysisPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'QA_MANAGER'
  const [params, setParams] = useSearchParams()
  const to = params.get('to') || bkkToday()
  const from = params.get('from') || addDays(to, -29)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [yKey, setYKey] = useState('aw')
  const [pick, setPick] = useState(null)
  const [ai, setAi] = useState({ busy: false, text: null, error: null })
  useEffect(() => {
    if (!allowed) return
    setData(null); setError(null); setAi({ busy: false, text: null, error: null })
    Promise.all([coldApi.units(), coldApi.readings({ from, to }), oilApi.list({ from, to }), fgCheckApi.awph({ from, to }), prodctlApi.list({ from, to }), weighApi.list({ from, to })])
      .then(([units, readings, oil, awph, prodctl, weigh]) => setData({ units, readings, oil, awph, prodctl, weigh }))
      .catch((e) => setError(e.message))
  }, [from, to, allowed])

  const m = useMemo(() => {
    if (!data) return null
    const cold = coldSeries(data.units.filter((u) => u.active !== 0), data.readings)
    const oil = oilSeries(data.oil)
    const products = awphByProduct(data.awph)
    const batches = buildBatches({ prodctl: data.prodctl, weigh: data.weigh, awph: data.awph })
    const rel = { aw: relationTable(batches, 'aw'), ph: relationTable(batches, 'ph') }
    const notes = observations({ cold, oil, products })
    for (const [k, label] of [['aw', 'aw'], ['ph', 'pH']]) { const t = rel[k].find((x) => x.r != null && x.n >= 8 && Math.abs(x.r) >= 0.4); if (t) notes.push({ level: 'mid', text: `ความสัมพันธ์ข้ามแบบฟอร์ม: ${label} ${t.r > 0 ? 'สูงขึ้น' : 'ต่ำลง'}เมื่อ "${t.ft.label}" เพิ่มขึ้น (r = ${t.r.toFixed(2)}, ${t.n} Batch) — ดูส่วนความสัมพันธ์ด้านล่าง ไม่ใช่ข้อสรุปว่าเป็นสาเหตุ` }) }
    const relations = { joined_batches: batches.filter((b) => b.aw != null || b.ph != null).length, aw: rel.aw.slice(0, 6).map((x) => ({ factor: x.ft.label, form: x.ft.form, n: x.n, r: x.r && +x.r.toFixed(2) })), ph: rel.ph.slice(0, 6).map((x) => ({ factor: x.ft.label, form: x.ft.form, n: x.n, r: x.r && +x.r.toFixed(2) })), highest_aw_batches: topOutliers(batches, 'aw').map((o) => ({ product: o.b.name, batch: o.b.batch_no, aw: +o.b.aw.toFixed(3), above_product_avg: +o.delta.toFixed(3), unusual_process: o.diffs.map((d) => `${d.ft.label} ${d.v.toFixed(1)} (เฉลี่ย ${d.mean.toFixed(1)})`) })) }
    return { cold, oil, products, notes, batches, rel, relations }
  }, [data])

  const runAi = async () => {
    setAi({ busy: true, text: null, error: null })
    try { const r = await analyzeApi.run(summaryForAI({ from, to, ...m })); setAi({ busy: false, text: r.text, error: null }) } catch (e) { setAi({ busy: false, text: null, error: e.message }) }
  }
  const setRange = (days) => setParams({ from: addDays(bkkToday(), -(days - 1)), to: bkkToday() })

  if (!allowed) return <Layout><div className="max-w-lg mx-auto mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">หน้าวิเคราะห์ข้อมูลเปิดได้เฉพาะ QA Manager</div></Layout>
  return (
    <Layout>
      <div style={VARS}>
        <Link to="/dashboard" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />แดชบอร์ด</Link>
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div><h1 className="text-lg font-bold text-gray-800">วิเคราะห์ข้อมูลคุณภาพ</h1><div className="text-xs text-gray-500">แนวโน้ม {from} ถึง {to} · ตู้เย็น/ตู้แช่แข็ง · น้ำมันทอด · aw/pH สินค้าสำเร็จรูป</div></div>
          <div className="flex gap-1.5 text-sm">
            {[7, 30, 90].map((d) => <button key={d} onClick={() => setRange(d)} className={`px-3 py-1.5 rounded-lg border ${from === addDays(bkkToday(), -(d - 1)) && to === bkkToday() ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-300'}`}>{d} วัน</button>)}
          </div>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}
        {!m && !error && <div className="text-sm text-gray-500 py-8 text-center">กำลังโหลดข้อมูล…</div>}
        {m && (
          <>
            <Card title="ข้อสังเกตอัตโนมัติ" sub="คำนวณจากข้อมูลที่บันทึกไว้ ไม่ใช่ AI และไม่มีการตั้งเกณฑ์เอง (aw/pH ดูเฉพาะการเปลี่ยนแปลง)">
              {m.notes.length === 0 && <div className="text-sm text-gray-500">ยังไม่มีข้อมูลเพียงพอในช่วงนี้</div>}
              <ul className="space-y-1.5">
                {[...m.notes].sort((a, b) => ['high', 'mid', 'ok'].indexOf(a.level) - ['high', 'mid', 'ok'].indexOf(b.level)).map((n, i) => {
                  const [cls, Icon, ic] = LEVEL[n.level]
                  return <li key={i} className={`flex gap-2 items-start border rounded-lg px-3 py-2 text-sm ${cls}`}><Icon className={`w-4 h-4 mt-0.5 shrink-0 ${ic}`} /><span>{n.text}</span></li>
                })}
              </ul>
            </Card>


            <Card title="ความสัมพันธ์ข้ามแบบฟอร์ม: การผลิต → ผลวิเคราะห์" sub={`เชื่อมข้อมูลตาม Batch: ควบคุมการผลิต (FM-QC-002) และการชั่ง (FM-QC-004) กับ aw/pH (FM-QC-008) · เชื่อมได้ ${m.batches.filter((b) => b[yKey] != null && Object.values(b.f).some((v) => v != null)).length} Batch ที่มีทั้งสองฝั่ง`}>
              <div className="flex gap-1.5 text-sm mb-2">
                {[['aw', 'aw'], ['ph', 'pH']].map(([k, l]) => <button key={k} onClick={() => { setYKey(k); setPick(null) }} className={`px-3 py-1 rounded-lg border ${yKey === k ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-300'}`}>ผล {l}</button>)}
              </div>
              <div className="text-[11px] text-gray-500 mb-2">เปรียบเทียบภายในผลิตภัณฑ์เดียวกันเท่านั้น (หักค่าเฉลี่ยของแต่ละผลิตภัณฑ์ออกก่อน) · r = −1…+1 · ความสัมพันธ์ไม่ได้แปลว่าเป็นสาเหตุ ต้องมีหลาย Batch จึงเชื่อถือได้</div>
              {m.rel[yKey].length === 0 && <div className="text-xs text-gray-400 py-3">ยังไม่มี Batch ที่เชื่อมได้ครบ — แต่ละผลิตภัณฑ์ต้องมีอย่างน้อย 3 Batch ที่บันทึกทั้งการควบคุมการผลิตและ aw/pH</div>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {m.rel[yKey].map((x) => {
                      const st = strength(x.r, x.n, x.flat)
                      return (
                        <tr key={x.ft.key} onClick={() => x.r != null && setPick(x.ft.key)} className={`border-t border-gray-100 ${x.r != null ? 'cursor-pointer hover:bg-blue-50' : ''} ${pick === x.ft.key ? 'bg-blue-50' : ''}`}>
                          <td className="py-1.5 pr-2">{x.ft.label}<div className="text-[10px] text-gray-400">{x.ft.form}</div></td>
                          <td className="px-2 text-xs text-gray-500 whitespace-nowrap">{x.n} Batch</td>
                          <td className="px-2 w-40"><div className="relative h-3 bg-gray-100 rounded"><div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-400" />{x.r != null && <div className="absolute top-0.5 bottom-0.5 rounded" style={{ background: 'var(--viz-s1)', left: x.r >= 0 ? '50%' : `${50 + x.r * 50}%`, width: `${Math.abs(x.r) * 50}%` }} />}</div></td>
                          <td className="px-2 tabular-nums whitespace-nowrap">{x.r == null ? '-' : (x.r > 0 ? '+' : '') + x.r.toFixed(2)}</td>
                          <td className={`pl-2 text-xs whitespace-nowrap ${st.tone}`}>{st.tag}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {pick && (() => { const x = m.rel[yKey].find((r) => r.ft.key === pick); return x ? <div className="mt-3 max-w-md"><div className="text-sm font-semibold mb-1">{x.ft.label} เทียบกับ {yKey === 'aw' ? 'aw' : 'pH'} <span className="font-normal text-gray-500 text-xs">({x.n} Batch · {x.products} ผลิตภัณฑ์)</span></div><ScatterChart pts={x.pts} xLabel={`${x.ft.label} (${x.ft.unit})`} yLabel={yKey === 'aw' ? 'aw' : 'pH'} dpY={yKey === 'aw' ? 3 : 2} /></div> : null })()}
              {yKey === 'aw' && m.relations.highest_aw_batches.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-semibold mb-1">Batch ที่ aw สูงกว่าค่าเฉลี่ยของผลิตภัณฑ์มากที่สุด และสิ่งที่ผิดไปจากปกติในการผลิต</div>
                  <ul className="space-y-1 text-sm">
                    {m.relations.highest_aw_batches.map((o, i) => <li key={i} className="border border-gray-200 rounded-lg px-3 py-1.5"><b>{o.product}</b> · Batch {o.batch} · aw {o.aw.toFixed(3)} (+{o.above_product_avg.toFixed(3)} จากค่าเฉลี่ย){o.unusual_process.length ? <div className="text-xs text-gray-600">ในการผลิตต่างจากปกติ: {o.unusual_process.join(' · ')}</div> : <div className="text-xs text-gray-400">ไม่พบความต่างชัดเจนในข้อมูลการผลิต</div>}</li>)}
                  </ul>
                </div>
              )}
            </Card>

            <Card title="ให้ AI วิเคราะห์" sub="ส่งเฉพาะตัวเลขสรุป (ไม่มีชื่อคน ไม่มีรูป) ให้ Claude อ่านแล้วสรุปเป็นภาษาไทย พร้อมข้อเสนอแนะ">
              <button onClick={runAi} disabled={ai.busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg"><Sparkles className="w-4 h-4" />{ai.busy ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ช่วงนี้ด้วย AI'}</button>
              {ai.error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{ai.error}</div>}
              {ai.text && <div className="mt-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-violet-50 border border-violet-200 rounded-lg p-3">{ai.text}<div className="text-[11px] text-gray-500 mt-2">สรุปโดย AI จากข้อมูลข้างต้น ควรตรวจกับบันทึกจริงก่อนตัดสินใจ</div></div>}
            </Card>

            <Card title="อุณหภูมิตู้เย็น / ตู้แช่แข็ง (FM-QC-006)" sub="แถบสีฟ้า = ช่วงที่กำหนด · ▲ = นอกเกณฑ์">
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                {m.cold.filter((c) => c.n).map((c) => (
                  <div key={c.unit.unit_id}>
                    <div className="flex justify-between text-sm"><b>{c.unit.name}</b><span className="text-gray-500 text-xs">{c.n} ครั้ง · เฉลี่ย {f(c.avg, 1)} °C · นอกเกณฑ์ {c.out}</span></div>
                    <TrendChart points={c.points} band={c.band} unit=" °C" label={`อุณหภูมิ ${c.unit.name}`} />
                  </div>
                ))}
                {!m.cold.some((c) => c.n) && <div className="text-xs text-gray-400">ไม่มีข้อมูลในช่วงนี้</div>}
              </div>
            </Card>

            <Card title="น้ำมันทอด (FM-QC-005)" sub={`อุณหภูมิน้ำมัน เกณฑ์ ${m.oil.min}–${m.oil.max} °C และค่า TPM (%) ต่อการตรวจ`}>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                <div><div className="text-sm font-semibold mb-1">อุณหภูมิ ({m.oil.temp.length} ค่า · นอกช่วง {m.oil.outTemp})</div><TrendChart points={m.oil.temp} band={[m.oil.min, m.oil.max]} unit=" °C" dp={0} label="อุณหภูมิน้ำมัน" /></div>
                <div><div className="text-sm font-semibold mb-1">TPM สูงสุดต่อครั้ง ({m.oil.tpm.length} ครั้ง)</div><TrendChart points={m.oil.tpm} band={[0, 20]} unit="%" dp={1} label="TPM" /></div>
              </div>
            </Card>

            <Card title="aw / pH รายผลิตภัณฑ์ (FM-QC-008)" sub="ต่ำสุด · เฉลี่ย · สูงสุด และแนวโน้มรายครั้ง (ไม่ได้ตั้งเกณฑ์ผ่าน/ไม่ผ่าน)">
              {m.products.length === 0 && <div className="text-xs text-gray-400">ไม่มีข้อมูลในช่วงนี้</div>}
              <div className="space-y-4">
                {m.products.map((p) => (
                  <div key={p.code}>
                    <div className="text-sm font-semibold">{p.name} <span className="text-xs text-gray-500 font-normal">{p.code}</span></div>
                    <div className="grid md:grid-cols-2 gap-x-6">
                      {[['aw', 'aw', 3], ['ph', 'pH', 2]].map(([k, label, dp]) => (
                        <div key={k}>
                          <div className="text-xs text-gray-500">{label}: {p[k].n} ครั้ง · ต่ำสุด {f(p[k].min, dp)} · เฉลี่ย {f(p[k].avg, dp)} · สูงสุด {f(p[k].max, dp)}</div>
                          <TrendChart points={p[k].points} dp={dp} height={110} label={`${label} ${p.name}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  )
}

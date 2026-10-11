import { useEffect, useState } from 'react'
import { reportSigApi, userSigApi } from '../api/d1Api'

// Only a signature that was found is kept; "none yet" or a failed call is asked again on the next report, so a signature set after the page was opened shows up.
let cached = null
const load = () => cached || reportSigApi.get().then((s) => { if (s?.data) cached = Promise.resolve(s); return s }).catch(() => null)

// The reviewer's (QA Manager's) signature, stamped automatically above the review / acknowledge line of a printed summary.
// Renders an empty space of the same height when none is set, so the line looks the same as a blank form.
export default function ReviewSig({ h = 40 }) {
  const [sig, setSig] = useState(null)
  useEffect(() => { let stop = false; load().then((s) => { if (!stop) setSig(s) }); return () => { stop = true } }, [])
  return <div className="flex items-end justify-center" style={{ height: h }}>{sig?.data && <img src={sig.data} alt="" style={{ maxHeight: h, maxWidth: 190, objectFit: 'contain' }} />}</div>
}

// The QC officers' own signatures, stamped above the "recorded by" line. `names` are the display names of whoever recorded the report
// (an officer with no signature on file simply leaves the space empty).
let userSigs = null
const loadUsers = () => userSigs || userSigApi.list().then((l) => { if (l?.length) userSigs = Promise.resolve(l); return l || [] }).catch(() => [])
export function RecorderSig({ names = [], h = 40 }) {
  const [list, setList] = useState([])
  useEffect(() => { let stop = false; loadUsers().then((l) => { if (!stop) setList(l) }); return () => { stop = true } }, [])
  const shown = [...new Set(names)].map((n) => list.find((x) => x.name === n)).filter(Boolean)
  return <div className="flex items-end justify-center gap-2" style={{ height: h }}>{shown.map((s) => <img key={s.name} src={s.data} alt="" style={{ maxHeight: h, maxWidth: shown.length > 1 ? 90 : 150, objectFit: 'contain' }} />)}</div>
}

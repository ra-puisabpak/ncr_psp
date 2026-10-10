import { useEffect, useState } from 'react'
import { reportSigApi } from '../api/d1Api'

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

// Text that may wrap only at its spaces: each space-separated word stays whole (a batch number or a name is never cut in two).
// Done with markup, not by inserting characters, so Thai vowels and tone marks are untouched.
export default function Nw({ children }) {
  const words = String(children ?? '').split(' ')
  return words.map((w, i) => (
    <span key={i}>{i > 0 && ' '}<span style={{ whiteSpace: 'nowrap' }}>{w}</span></span>
  ))
}

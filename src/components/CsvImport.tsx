import { useRef, useState } from 'react'
import { errorText } from '../lib/format'
import { writeCsv } from '../lib/csv'

interface Parsed { rows: Record<string, unknown>[]; errors: string[] }

/** CSV を読み、内容を確かめてから取り込むボタン */
export default function CsvImport({ headers, parse, importRows, unit, help }: {
  headers: string[]
  parse: (f: File) => Promise<Parsed>
  importRows: (rows: Record<string, unknown>[]) => Promise<void>
  unit: string
  help: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function pick(f: File | undefined) {
    if (!f) return
    setMsg('')
    try { setParsed(await parse(f)) } catch (e) { setMsg(errorText(e)) }
    if (input.current) input.current.value = ''
  }

  async function run() {
    if (!parsed) return
    setBusy(true); setMsg('')
    try { await importRows(parsed.rows); setMsg(`${parsed.rows.length}${unit}を読み込みました。`); setParsed(null) }
    catch (e) { setMsg(errorText(e)) }
    finally { setBusy(false) }
  }

  return (
    <>
      <label className="btn">CSV 読み込み<input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => pick(e.target.files?.[0])} /></label>
      <button className="btn quiet" onClick={() => writeCsv([], headers, 'ひな形.csv')}>ひな形</button>
      {(parsed || msg) && (
        <div className="confirm full">
          {parsed && <>
            <p>{parsed.rows.length}{unit}を読み込めます。{parsed.errors.length > 0 && <span className="warn">{parsed.errors.length}行は読み込めません。</span>}</p>
            {parsed.errors.length > 0 && <ul className="errors">{parsed.errors.slice(0, 20).map(e => <li key={e}>{e}</li>)}{parsed.errors.length > 20 && <li>ほか {parsed.errors.length - 20} 行</li>}</ul>}
            <p className="muted small">{help}</p>
            <div className="row">
              <button className="btn primary" disabled={busy || parsed.rows.length === 0} onClick={run}>{busy ? '読み込み中…' : `${parsed.rows.length}${unit}を読み込む`}</button>
              <button className="btn" onClick={() => setParsed(null)}>やめる</button>
            </div>
          </>}
          {msg && <p className="msg">{msg}</p>}
        </div>
      )}
    </>
  )
}

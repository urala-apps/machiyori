import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { Order } from '../lib/types'
import { errorText, faxAddress, jpDateTime, statusLabel, viaLabel } from '../lib/format'
import { downloadBlob, sheetPdf } from '../lib/pdf'
import OrderSheet from '../components/OrderSheet'

export default function SheetsPage({ ids }: { ids: string[] }) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [printing, setPrinting] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    if (ids.length === 0) { setOrders([]); return }
    const { data } = await supabase.from('orders').select('*, order_lines(*)').in('id', ids).order('order_no')
    setOrders((data ?? []) as Order[])
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // 印刷：選んだ発注書だけを印刷する
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done, { once: true })
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [printing])

  if (!orders) return <p className="muted">読み込み中…</p>
  if (orders.length === 0) return <p className="muted">発注書が見つかりません。<a href="#/history">履歴</a>から開いてください。</p>

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={() => go('order')}>← 発注画面へ</button>
        {orders.length > 1 && <button className="btn" onClick={() => setPrinting(orders.map(o => o.id))}>すべて印刷</button>}
        <span className="muted small">{orders.length}枚。作った発注書は履歴に残ります。</span>
      </div>
      {orders.map(o => (
        <SheetBlock key={o.id} order={o} reload={load} printTarget={!printing || printing.includes(o.id)}
          onPrint={() => setPrinting([o.id])} />
      ))}
    </div>
  )
}

function SheetBlock({ order: o, reload, printTarget, onPrint }: {
  order: Order; reload: () => Promise<void>; printTarget: boolean; onPrint: () => void
}) {
  const { suppliers, settings, toast } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState<'email' | 'fax' | 'printed' | 'cancel' | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  // 宛先は今の取引先の情報から取る（作ったあとに直したメール・FAX 番号も使えるように）
  const sup = suppliers.find(s => s.id === o.supplier_id) ?? o.supplier_snapshot
  const mailTo = sup.email
  const faxTo = faxAddress(settings.fax_gateway, sup.fax)
  const fileName = `${o.order_no}.pdf`

  async function makePdf() {
    if (!ref.current) throw new Error('発注書が表示されていません')
    return sheetPdf(ref.current)
  }

  async function savePdf() {
    setBusy('pdf'); setError('')
    try { downloadBlob(await makePdf(), `発注書_${o.order_no}_${o.supplier_snapshot.name}.pdf`) }
    catch (e) { setError(errorText(e)) }
    finally { setBusy('') }
  }

  async function send(via: 'email' | 'fax') {
    setBusy(via); setError('')
    try {
      const blob = await makePdf()
      const path = `orders/${o.id}.pdf`
      const up = await supabase.storage.from('order-pdfs').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
      if (up.error) throw up.error
      const upd = await supabase.from('orders').update({ pdf_path: path }).eq('id', o.id)
      if (upd.error) throw upd.error
      const { data, error } = await supabase.functions.invoke('send-order', { body: { order_id: o.id, via } })
      if (error) {
        // 関数が返したエラー文を出す
        const ctx = (error as { context?: Response }).context
        const body = ctx ? await ctx.json().catch(() => null) : null
        throw new Error(body?.error || errorText(error))
      }
      toast(via === 'email' ? `${data.to} にメールで送りました` : `FAX の送信を受け付けました（${sup.fax}）。結果はメールで届きます`)
      setConfirm(null)
      await reload()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy('') }
  }

  async function rpc(fn: 'mark_order_printed' | 'cancel_order') {
    setBusy(fn); setError('')
    const { error } = await supabase.rpc(fn, { p_order_id: o.id })
    setBusy('')
    if (error) { setError(errorText(error)); return }
    setConfirm(null)
    await reload()
  }

  const isPrimary = (m: 'email' | 'fax') => sup.send_method === m ? 'btn primary' : 'btn'
  const closed = o.status === 'cancelled'

  return (
    <section className={printTarget ? 'sheet-block print-target' : 'sheet-block'}>
      <div className="sheet-actions no-print">
        <div className="sheet-actions-head">
          <strong>{o.supplier_snapshot.name}</strong>
          <span className={`chip status-${o.status}`}>{statusLabel[o.status]}</span>
          {o.sent_via && <span className="muted small">{viaLabel[o.sent_via]} {jpDateTime(o.sent_at)}{o.sent_to && `（${o.sent_to}）`}</span>}
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy} onClick={savePdf}>{busy === 'pdf' ? '作成中…' : 'PDFを保存'}</button>
          <button className="btn" disabled={!!busy} onClick={onPrint}>印刷</button>
          <button className={isPrimary('email')} disabled={!!busy || closed || !mailTo} title={mailTo ? '' : '取引先にメールアドレスがありません'} onClick={() => setConfirm('email')}>メールで送る</button>
          <button className={isPrimary('fax')} disabled={!!busy || closed || !faxTo} title={faxTo ? '' : 'FAX 番号かインターネットFAX の設定がありません'} onClick={() => setConfirm('fax')}>FAXで送る</button>
          {o.status === 'draft' && <button className="btn" disabled={!!busy} onClick={() => setConfirm('printed')}>手で送った</button>}
          {!closed && <button className="btn quiet" disabled={!!busy} onClick={() => setConfirm('cancel')}>取り消す</button>}
        </div>
        {sup.fax && !settings.fax_gateway && <p className="muted small">インターネットFAX が未設定です。「印刷」で FAX 機・複合機から送り、「手で送った」を押してください（管理者が「設定」で登録できます）。</p>}
        {sup.fax && <p className="muted small">複合機の PC-FAX で送るときは、「印刷」を押して、印刷画面のプリンターで複合機の FAX ドライバーを選び、宛先に {sup.fax} を入れます。送ったら「手で送った」を押してください。</p>}

        {confirm && (
          <div className="confirm">
            {confirm === 'email' && <p><b>{mailTo}</b> に、発注書の PDF（{fileName}）を付けてメールで送ります。</p>}
            {confirm === 'fax' && <p><b>FAX {sup.fax}</b> に送ります（インターネットFAX の宛先 {faxTo}）。</p>}
            {confirm === 'printed' && <p>印刷して FAX 機などで送ったことを記録します。</p>}
            {confirm === 'cancel' && <p>この発注書を「取消」にします。{o.status === 'sent' && '送った相手には、別に取消の連絡をしてください。'}</p>}
            {o.status === 'sent' && (confirm === 'email' || confirm === 'fax') && <p className="warn">この発注書は送信済みです。もう一度送ります。</p>}
            <div className="row">
              <button className="btn primary" disabled={!!busy} onClick={() =>
                confirm === 'email' || confirm === 'fax' ? send(confirm)
                  : rpc(confirm === 'printed' ? 'mark_order_printed' : 'cancel_order')}>
                {busy ? '処理中…' : confirm === 'email' ? 'メールを送る' : confirm === 'fax' ? 'FAX を送る' : confirm === 'printed' ? '記録する' : '取り消す'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => setConfirm(null)}>やめる</button>
            </div>
          </div>
        )}
        {error && <p className="msg">{error}</p>}
      </div>
      <div className="sheet-scroll"><OrderSheet ref={ref} order={o} /></div>
    </section>
  )
}

import { forwardRef } from 'react'
import type { Order } from '../lib/types'
import { deliveryLines, jpDate, num, yen } from '../lib/format'

const MIN_ROWS = 12

/** A4 の発注書。画面のテーマに関係なく白い紙。fax を渡すと、上に FAX の送り状の欄を付ける（FAX 用に印刷するとき） */
const OrderSheet = forwardRef<HTMLDivElement, { order: Order; fax?: string }>(function OrderSheet({ order: o, fax }, ref) {
  const s = o.supplier_snapshot
  const st = o.store_snapshot
  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.line_no - b.line_no)
  const blanks = Math.max(0, MIN_ROWS - (fax ? 4 : 0) - lines.length)  // FAX の欄の分だけ空行を減らして A4 1枚に収める
  const hasReduced = o.tax_detail.some(t => t.rate === 8)
  const dl = deliveryLines(o)

  return (
    <div className="sheet" ref={ref}>
      {o.status === 'cancelled' && <div className="sheet-void">取消</div>}
      {fax && (
        <div className="sheet-fax">
          <div><span>FAX 送信先</span><b>{fax}</b>　{s.name} {s.attention || '御中'}</div>
          <div><span>送信元</span>{st.name}{st.fax && `　FAX ${st.fax}`}{st.tel && `　TEL ${st.tel}`}</div>
          <div><span>送信枚数</span>1枚（この用紙を含む）</div>
        </div>
      )}
      <div className="sheet-meta"><span>発注番号：{o.order_no}</span><span>発注日：{jpDate(o.order_date)}</span></div>
      <h1 className="sheet-title">発注書</h1>
      <div className="sheet-parties">
        <div className="sheet-to">
          <div className="name">{s.name}　<span className="nowrap">{s.attention || '御中'}</span></div>
          <div>{s.tel && `TEL ${s.tel}`}　{s.fax && `FAX ${s.fax}`}</div>
        </div>
        <div className="sheet-from">
          <div className="name">{st.name}</div>
          {(st.zip || st.address) && <div>{st.zip && `〒${st.zip} `}{st.address}</div>}
          <div>{st.tel && `TEL ${st.tel}`}{st.fax && `　FAX ${st.fax}`}</div>
          {st.person && <div>担当：{st.person}</div>}
        </div>
      </div>
      <p className="sheet-lead">下記のとおり発注いたします。</p>
      <div className="sheet-sum"><div>合計金額</div><div>{yen(o.total)}（税込）</div></div>
      <div className="sheet-info">
        <div>{dl.whenLabel}</div><div>{dl.when}</div>
        <div>{dl.whereLabel}</div><div>{dl.where}{dl.note && <><br />{dl.note}</>}</div>
      </div>
      <table className="sheet-table">
        <thead><tr>
          <th style={{ width: '8mm' }}>No</th><th style={{ width: '22mm' }}>品番</th><th>品名</th><th style={{ width: '26mm' }}>規格</th>
          <th style={{ width: '13mm' }}>数量</th><th style={{ width: '15mm' }}>単位</th><th style={{ width: '19mm' }}>単価</th><th style={{ width: '23mm' }}>金額</th>
        </tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id}>
              <td className="c">{l.line_no}</td><td>{l.code}</td><td>{l.name}{l.tax_rate === 8 && ' ※'}</td><td>{l.spec}</td>
              <td className="r">{num(l.qty)}</td><td className="c">{l.unit}</td><td className="r">{num(l.price)}</td><td className="r">{num(l.price * l.qty)}</td>
            </tr>
          ))}
          {Array.from({ length: blanks }, (_, i) => <tr key={'b' + i}>{Array.from({ length: 8 }, (_, j) => <td key={j} />)}</tr>)}
        </tbody>
      </table>
      <table className="sheet-totals">
        <tbody>
          <tr><td>小計（税抜）</td><td className="r">{num(o.subtotal)}</td></tr>
          {o.tax_detail.map(t => <tr key={t.rate}><td>消費税 {t.rate}%{t.rate === 8 && '（軽減）'}</td><td className="r">{num(t.tax)}</td></tr>)}
          <tr><td>合計（税込）</td><td className="r"><b>{num(o.total)}</b></td></tr>
        </tbody>
      </table>
      {hasReduced && <div className="sheet-note">※は軽減税率（8%）対象</div>}
      <div className="sheet-remarks"><span>備考</span>{o.remarks}</div>
    </div>
  )
})

export default OrderSheet

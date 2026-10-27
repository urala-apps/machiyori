import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { Item } from '../lib/types'
import { errorText, methodLabel, readLocal, writeLocal, yen } from '../lib/format'

const CART_KEY = 'machiyori.cart'
const STORE_KEY = 'machiyori.store'

function loadCart(): Record<string, number> {
  try { return JSON.parse(readLocal(CART_KEY) || '{}') } catch { return {} }
}

export default function OrderPage() {
  const { stores, suppliers, profile } = useApp()
  const activeStores = stores.filter(s => s.active)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState(() => readLocal(STORE_KEY) || profile.default_store_id || '')
  const [q, setQ] = useState('')
  const [sup, setSup] = useState('')
  const [onlyCart, setOnlyCart] = useState(false)
  const [cart, setCart] = useState<Record<string, number>>(loadCart)
  const [due, setDue] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('items').select('*').eq('active', true).order('code').then(({ data }) => {
      setItems((data ?? []) as Item[]); setLoading(false)
    })
  }, [])
  useEffect(() => { writeLocal(CART_KEY, JSON.stringify(cart)) }, [cart])
  useEffect(() => {
    if (!activeStores.some(s => s.id === storeId) && activeStores[0]) setStoreId(activeStores[0].id)
  }, [activeStores, storeId])

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers])
  const supById = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers])

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    return items.filter(i =>
      (!sup || i.supplier_id === sup) &&
      (!onlyCart || cart[i.id] > 0) &&
      (!k || `${i.code ?? ''} ${i.name} ${i.spec} ${supName[i.supplier_id] ?? ''}`.toLowerCase().includes(k)))
  }, [items, q, sup, onlyCart, cart, supName])

  const groups = useMemo(() => {
    const g: Record<string, { item: Item; qty: number }[]> = {}
    for (const i of items) if (cart[i.id] > 0) (g[i.supplier_id] ||= []).push({ item: i, qty: cart[i.id] })
    return Object.entries(g).sort((a, b) => (supName[a[0]] ?? '').localeCompare(supName[b[0]] ?? '', 'ja'))
  }, [items, cart, supName])

  const setQty = (id: string, v: number) => setCart(c => {
    const n = { ...c }
    const qty = Math.max(0, Math.min(99999, Math.floor(v || 0)))
    if (qty) n[id] = qty; else delete n[id]
    return n
  })

  async function create() {
    setBusy(true); setError('')
    const lines = groups.flatMap(([, ls]) => ls.map(l => ({ item_id: l.item.id, qty: l.qty })))
    const { data, error } = await supabase.rpc('create_orders', {
      p_store_id: storeId, p_due_date: due || null, p_remarks: remarks, p_lines: lines,
    })
    setBusy(false)
    if (error) { setError(errorText(error)); return }
    setCart({}); setDue(''); setRemarks('')
    go('sheets/' + (data as string[]).join(','))
  }

  const store = activeStores.find(s => s.id === storeId)

  return (
    <div className="grid-order">
      <section className="panel">
        <div className="panel-head">
          <h2>商品を選ぶ</h2>
          <span className="muted small">{loading ? '読み込み中…' : `${rows.length} / ${items.length} 品`}</span>
        </div>
        <div className="toolbar">
          <input type="search" aria-label="品名・品番・取引先で探す" placeholder="品名・品番・取引先で探す" value={q} onChange={e => setQ(e.target.value)} className="grow" />
          <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
            <option value="">すべての取引先</option>
            {suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyCart} onChange={e => setOnlyCart(e.target.checked)} />かごの商品だけ</label>
        </div>
        <div className="tbl-wrap">
          <table className="list">
            <thead><tr><th>品番</th><th>品名・規格</th><th>取引先</th><th className="num">単価(税抜)</th><th className="num">数量</th></tr></thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.id} className={cart[i.id] ? 'picked' : undefined}>
                  <td><span className="chip">{i.code}</span></td>
                  <td>{i.name}<div className="sub">{i.spec}{i.spec && ' ／ '}{i.unit}{i.tax_rate === 8 && ' ／ 軽減8%'}</div></td>
                  <td className="sub">{supName[i.supplier_id]}</td>
                  <td className="num">{yen(i.price)}</td>
                  <td className="num">
                    <span className="qty">
                      <button className="btn small" aria-label={`${i.name}を減らす`} onClick={() => setQty(i.id, (cart[i.id] || 0) - 1)}>−</button>
                      <input type="number" min={0} inputMode="numeric" aria-label={`${i.name}の数量`} placeholder="0"
                        value={cart[i.id] || ''} onChange={e => setQty(i.id, +e.target.value)} />
                      <button className="btn small" aria-label={`${i.name}を増やす`} onClick={() => setQty(i.id, (cart[i.id] || 0) + 1)}>＋</button>
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="muted">
                {items.length === 0 ? '商品がまだありません。「商品」画面で登録するか、CSV で読み込んでください。' : '該当する商品がありません。'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="panel cart">
        <h2>発注かご</h2>
        <div className="field">
          <label htmlFor="store">発注する店舗</label>
          <select id="store" value={storeId} onChange={e => { setStoreId(e.target.value); writeLocal(STORE_KEY, e.target.value) }}>
            {activeStores.map(s => <option key={s.id} value={s.id}>{s.name}{s.kind === 'mobile' ? '（移動型）' : ''}</option>)}
          </select>
          {activeStores.length === 0 && <span className="warn small">店舗がまだありません。管理者が「店舗」画面で登録してください。</span>}
          {store?.delivery_note && <span className="muted small">納品先：{store.delivery_note}</span>}
        </div>

        {groups.length === 0 && <p className="muted small">数量を入れると、取引先ごとにここへまとまります。取引先ごとに1枚ずつ発注書を作ります。</p>}
        {groups.map(([sid, ls]) => {
          const s = supById[sid]
          const sub = ls.reduce((a, l) => a + l.item.price * l.qty, 0)
          return (
            <div className="cart-group" key={sid}>
              <h3><span>{s?.name}</span>{s && <span className="chip">{methodLabel[s.send_method]}</span>}</h3>
              {ls.map(l => <div className="cart-line" key={l.item.id}><span>{l.item.name} × {l.qty}</span><span>{yen(l.item.price * l.qty)}</span></div>)}
              <div className="cart-line strong"><span>小計（税抜）</span><span>{yen(sub)}</span></div>
            </div>
          )
        })}

        <div className="cart-group">
          <div className="field"><label htmlFor="due">納品希望日</label><input id="due" type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
          <div className="field"><label htmlFor="remarks">備考（この発注の全部の発注書に入ります）</label><textarea id="remarks" value={remarks} onChange={e => setRemarks(e.target.value)} /></div>
          {error && <p className="msg">{error}</p>}
          <button className="btn primary wide" disabled={busy || groups.length === 0 || !storeId} onClick={create}>
            {busy ? '作成中…' : `発注書を作成（${groups.length}枚）`}
          </button>
          {groups.length > 0 && <button className="btn wide" onClick={() => setCart({})}>かごを空にする</button>}
        </div>
      </aside>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Item } from '../lib/types'
import { yen } from '../lib/format'
import { readCsv, writeCsv } from '../lib/csv'
import MasterTable, { type Field } from '../components/MasterTable'
import CsvImport from '../components/CsvImport'

const HEADERS = ['取引先コード', '取引先名', '品番', '品名', '規格', '単位', '単価', '税率', '使う']

export default function ItemsPage() {
  const { suppliers, isAdmin, toast } = useApp()
  const [items, setItems] = useState<Item[]>([])
  const [sup, setSup] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('items').select('*').order('code')
    setItems((data ?? []) as Item[])
  }, [])
  useEffect(() => { load() }, [load])

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers])
  const rows = sup ? items.filter(i => i.supplier_id === sup) : items

  const fields: Field<Item>[] = [
    { key: 'supplier_id', label: '取引先', type: 'select', required: true,
      options: suppliers.map(s => ({ value: s.id, label: s.name })), render: r => <span className="sub">{supName[r.supplier_id]}</span> },
    { key: 'code', label: '品番', render: r => <span className="chip">{r.code}</span> },
    { key: 'name', label: '品名', required: true },
    { key: 'spec', label: '規格', placeholder: '例 500ml×12' },
    { key: 'unit', label: '単位', placeholder: '例 ケース' },
    { key: 'price', label: '単価（税抜・円）', type: 'number', required: true, numeric: true, render: r => yen(r.price) },
    { key: 'tax_rate', label: '税率', type: 'select', required: true,
      options: [{ value: '10', label: '10%' }, { value: '8', label: '8%（軽減）' }], render: r => `${r.tax_rate}%` },
    { key: 'active', label: '使う（発注画面に出す）', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  async function save(v: Partial<Item>, id: string | null) {
    const row = {
      supplier_id: v.supplier_id, code: v.code?.toString().trim() || null, name: v.name?.trim(),
      spec: v.spec ?? '', unit: v.unit || '個', price: Math.round(Number(v.price) || 0),
      tax_rate: Number(v.tax_rate) === 8 ? 8 : 10, active: v.active ?? true,
    }
    const { error } = id ? await supabase.from('items').update(row).eq('id', id) : await supabase.from('items').insert(row)
    if (error) throw error
    toast('保存しました'); await load()
  }

  async function remove(r: Item) {
    const { error } = await supabase.from('items').delete().eq('id', r.id)
    if (error) throw error
    await load()
  }

  function exportCsv() {
    const byId = Object.fromEntries(suppliers.map(s => [s.id, s]))
    writeCsv(items.map(i => ({
      取引先コード: byId[i.supplier_id]?.code ?? '', 取引先名: byId[i.supplier_id]?.name ?? '', 品番: i.code ?? '', 品名: i.name,
      規格: i.spec, 単位: i.unit, 単価: i.price, 税率: i.tax_rate, 使う: i.active ? '1' : '0',
    })), HEADERS, '商品.csv')
  }

  async function parse(file: File) {
    const raw = await readCsv(file)
    const errors: string[] = []
    const out: Record<string, unknown>[] = []
    raw.forEach((r, n) => {
      const line = n + 2
      const s = suppliers.find(x => (r['取引先コード'] && x.code === r['取引先コード']) || (!r['取引先コード'] && x.name === r['取引先名']))
      if (!s) { errors.push(`${line}行目：取引先「${r['取引先コード'] || r['取引先名'] || '（空）'}」が見つかりません`); return }
      if (!r['品名']) { errors.push(`${line}行目：品名が空です`); return }
      const price = Number((r['単価'] ?? '').replace(/[,¥円\s]/g, ''))
      if (!Number.isFinite(price) || price < 0) { errors.push(`${line}行目：単価「${r['単価']}」が数字ではありません`); return }
      const rate = (r['税率'] ?? '').replace(/[%％\s]/g, '')
      out.push({
        supplier_id: s.id, code: r['品番'] || null, name: r['品名'], spec: r['規格'] ?? '', unit: r['単位'] || '個',
        price: Math.round(price), tax_rate: rate === '8' ? 8 : 10, active: !['0', 'いいえ', '×', 'false'].includes(r['使う'] ?? ''),
      })
    })
    return { rows: out, errors }
  }

  async function importRows(rows: Record<string, unknown>[]) {
    // 同じコードが CSV に2回あると取り込めないので、後ろの行を使う
    const withCode = [...new Map(rows.filter(r => r.code).map(r => [`${r.supplier_id}|${r.code}`, r])).values()]
    const noCode = rows.filter(r => !r.code)
    if (withCode.length) {
      const { error } = await supabase.from('items').upsert(withCode, { onConflict: 'supplier_id,code' })
      if (error) throw error
    }
    if (noCode.length) {
      const { error } = await supabase.from('items').insert(noCode)
      if (error) throw error
    }
    await load()
  }

  return (
    <MasterTable<Item>
      title="商品"
      note={<>単価は税抜で入れます。品番が同じ商品は CSV の読み込みで上書きされます。使わなくなった商品は「使う」のチェックを外すと、発注画面に出なくなります（過去の発注書はそのまま）。</>}
      rows={rows} fields={fields} canEdit={isAdmin} addLabel="商品を追加"
      blank={{ supplier_id: sup || suppliers[0]?.id, unit: '個', price: 0, tax_rate: 10, active: true }}
      search={(r, k) => `${r.code ?? ''} ${r.name} ${r.spec} ${supName[r.supplier_id] ?? ''}`.toLowerCase().includes(k)}
      onSave={save} onDelete={remove}
      toolbar={<>
        <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
          <option value="">すべての取引先</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn" onClick={exportCsv}>CSV 書き出し</button>
        {isAdmin && <CsvImport headers={HEADERS} parse={parse} importRows={importRows} unit="品"
          help="取引先は「取引先コード」で結びつけます。コードが空なら「取引先名」で探します。税率は 8 か 10。" />}
      </>}
    />
  )
}

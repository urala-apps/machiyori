import { useApp } from '../lib/app'
import { supabase } from '../lib/supabase'
import type { Store } from '../lib/types'
import MasterTable, { type Field } from '../components/MasterTable'

export default function StoresPage() {
  const { stores, isAdmin, reload, toast } = useApp()

  const fields: Field<Store>[] = [
    { key: 'code', label: '店舗コード', required: true, placeholder: '例 A、CAR', help: '英数字1〜4文字。発注番号に入ります（PO-A-20261027-001）', render: r => <span className="chip">{r.code}</span> },
    { key: 'name', label: '店名', required: true },
    { key: 'kind', label: '種類', type: 'select', required: true,
      options: [{ value: 'fixed', label: '実店舗' }, { value: 'mobile', label: '移動型店舗' }], render: r => r.kind === 'mobile' ? '移動型店舗' : '実店舗' },
    { key: 'zip', label: '郵便番号', render: false },
    { key: 'address', label: '住所' },
    { key: 'tel', label: '電話' },
    { key: 'fax', label: 'FAX', render: false },
    { key: 'email', label: 'メール', type: 'email', help: '取引先からの返信先にもなります', render: false },
    { key: 'person', label: '発注担当', render: false },
    { key: 'delivery_note', label: '納品先', placeholder: '例 〇〇倉庫（福井市△△1-2）', help: '空なら店の住所。移動型店舗は拠点・倉庫を書いてください' },
    { key: 'sort', label: '並び順', type: 'number', render: false },
    { key: 'active', label: '使う', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  async function save(v: Partial<Store>, id: string | null) {
    const row = {
      code: String(v.code ?? '').trim().toUpperCase(), name: v.name?.trim(), kind: v.kind === 'mobile' ? 'mobile' : 'fixed',
      zip: v.zip ?? '', address: v.address ?? '', tel: v.tel ?? '', fax: v.fax ?? '', email: v.email ?? '',
      person: v.person ?? '', delivery_note: v.delivery_note ?? '', sort: Number(v.sort) || 0, active: v.active ?? true,
    }
    if (!/^[A-Z0-9]{1,4}$/.test(row.code)) throw new Error('店舗コードは英数字1〜4文字にしてください')
    const { error } = id ? await supabase.from('stores').update(row).eq('id', id) : await supabase.from('stores').insert(row)
    if (error) throw error
    toast('保存しました'); await reload()
  }

  return (
    <MasterTable<Store>
      title="店舗"
      note="発注書の差出人になります。直した内容は、これから作る発注書から反映されます（作った発注書はそのまま）。"
      rows={stores} fields={fields} canEdit={isAdmin} addLabel="店舗を追加"
      blank={{ kind: 'fixed', active: true, sort: 0 }}
      onSave={save}
    />
  )
}

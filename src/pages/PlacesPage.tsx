import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { supabase } from '../lib/supabase'
import type { DeliveryPlace } from '../lib/types'
import MasterTable, { type Field } from '../components/MasterTable'

/** 指定の住所（外販の納品先）。日時は発注のときに入れる */
export default function PlacesPage() {
  const { isAdmin, toast } = useApp()
  const [places, setPlaces] = useState<DeliveryPlace[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('delivery_places').select('*').order('sort').order('name')
    setPlaces((data ?? []) as DeliveryPlace[])
  }, [])
  useEffect(() => { load() }, [load])

  const fields: Field<DeliveryPlace>[] = [
    { key: 'name', label: '名前', required: true, placeholder: '例 〇〇イベント会場、△△倉庫' },
    { key: 'zip', label: '郵便番号', render: false },
    { key: 'address', label: '住所' },
    { key: 'tel', label: '電話' },
    { key: 'note', label: '受け取りの注意', placeholder: '例 搬入口は裏の駐車場側', help: '発注書の納品先の下に出ます' },
    { key: 'sort', label: '並び順', type: 'number', render: false },
    { key: 'active', label: '使う', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  async function save(v: Partial<DeliveryPlace>, id: string | null) {
    const row = {
      name: v.name?.trim(), zip: v.zip ?? '', address: v.address ?? '', tel: v.tel ?? '', note: v.note ?? '',
      sort: Number(v.sort) || 0, active: v.active ?? true,
    }
    const { error } = id ? await supabase.from('delivery_places').update(row).eq('id', id) : await supabase.from('delivery_places').insert(row)
    if (error) throw error
    toast('保存しました'); await load()
  }

  async function remove(r: DeliveryPlace) {
    const { error } = await supabase.from('delivery_places').delete().eq('id', r.id)
    if (error) throw error
    await load()
  }

  return (
    <MasterTable<DeliveryPlace>
      title="納品先（指定の住所）"
      note="外販の発注で選べる納品先です。日時は発注のときに入れます。店舗への納品と集荷は、ここに登録しなくても選べます。"
      rows={places} fields={fields} canEdit={isAdmin} addLabel="納品先を追加"
      blank={{ active: true, sort: 0 }}
      search={(r, k) => `${r.name} ${r.address}`.toLowerCase().includes(k)}
      onSave={save} onDelete={remove}
    />
  )
}

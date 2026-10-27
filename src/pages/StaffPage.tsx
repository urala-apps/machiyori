import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Profile, Role } from '../lib/types'
import { errorText } from '../lib/format'

const ROLE: Record<Role, string> = { pending: '承認待ち', staff: 'スタッフ', admin: '管理者' }

export default function StaffPage() {
  const { profile: me, stores, toast } = useApp()
  const [list, setList] = useState<Profile[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setList((data ?? []) as Profile[])
  }, [])
  useEffect(() => { load() }, [load])

  async function update(p: Profile, patch: Partial<Profile>) {
    setError('')
    if (p.id === me.id && patch.role && patch.role !== 'admin') { setError('自分の管理者権限は外せません。ほかの管理者に頼んでください。'); return }
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) { setError(errorText(error)); return }
    toast('保存しました'); await load()
  }

  const pending = list.filter(p => p.role === 'pending').length

  return (
    <section className="panel">
      <div className="panel-head"><h2>スタッフ</h2>{pending > 0 && <span className="chip status-draft">承認待ち {pending}人</span>}</div>
      <div className="note">スタッフはログイン画面の「はじめての方はこちらから登録」で登録します。登録した人は「承認待ち」になるので、ここで「スタッフ」にすると使えます。商品・取引先・店舗・設定を直せるのは管理者だけです。</div>
      {error && <p className="msg">{error}</p>}
      <div className="tbl-wrap">
        <table className="list">
          <thead><tr><th>名前</th><th>メール</th><th>権限</th><th>いつもの店舗</th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td><input aria-label="名前" defaultValue={p.name} onBlur={e => e.target.value !== p.name && update(p, { name: e.target.value })} /></td>
                <td className="sub">{p.email}</td>
                <td>
                  <select aria-label="権限" value={p.role} onChange={e => update(p, { role: e.target.value as Role })}>
                    {(Object.keys(ROLE) as Role[]).map(r => <option key={r} value={r}>{ROLE[r]}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label="いつもの店舗" value={p.default_store_id ?? ''} onChange={e => update(p, { default_store_id: e.target.value || null })}>
                    <option value="">—</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">やめた人は「承認待ち」に戻すと使えなくなります。</p>
    </section>
  )
}

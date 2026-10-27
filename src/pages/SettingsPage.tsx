import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Settings } from '../lib/types'
import { errorText, faxAddress } from '../lib/format'

export default function SettingsPage() {
  const { settings, reload, toast } = useApp()
  const [v, setV] = useState<Settings>(settings)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(settings), [settings])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (v.fax_gateway && !v.fax_gateway.includes('{fax}')) { setError('宛先の形に {fax} を入れてください（FAX 番号が入る場所）。'); return }
    setBusy(true)
    const { error } = await supabase.from('settings').update({ ...v, updated_at: new Date().toISOString() }).eq('id', 1)
    setBusy(false)
    if (error) { setError(errorText(error)); return }
    toast('保存しました'); await reload()
  }

  return (
    <form className="panel narrow-wide" onSubmit={save}>
      <h2>設定</h2>

      <h3>インターネットFAX（メールtoFAX）</h3>
      <div className="note">
        契約したサービスが決めている「FAX を送るときのメールの宛先」の形を入れます。<code>{'{fax}'}</code> のところに取引先の FAX 番号（数字だけ）が入ります。
        サービスによっては、送信元のメールアドレスを先にサービスへ登録しておく必要があります（README を見てください）。
      </div>
      <div className="field">
        <label htmlFor="gw">宛先の形</label>
        <input id="gw" value={v.fax_gateway} placeholder="例 {fax}@（サービスのドメイン）" onChange={e => setV({ ...v, fax_gateway: e.target.value.trim() })} />
        {v.fax_gateway && <span className="muted small">例：FAX 0776-11-2222 → {faxAddress(v.fax_gateway, '0776-11-2222')}</span>}
      </div>

      <h3>メール</h3>
      <div className="field">
        <label htmlFor="reply">返信先のメールアドレス</label>
        <input id="reply" type="email" value={v.reply_to} onChange={e => setV({ ...v, reply_to: e.target.value.trim() })} />
        <span className="muted small">取引先が発注メールに返信したときの宛先。空なら店舗のメールアドレス。</span>
      </div>

      <h3>消費税</h3>
      <div className="field">
        <label htmlFor="round">端数の処理（税率ごと・発注書ごと）</label>
        <select id="round" value={v.tax_round} onChange={e => setV({ ...v, tax_round: e.target.value as Settings['tax_round'] })}>
          <option value="floor">切り捨て</option><option value="round">四捨五入</option><option value="ceil">切り上げ</option>
        </select>
      </div>

      {error && <p className="msg">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
    </form>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/format'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
        if (error) throw error
        if (!data.session) setMsg('確認のメールを送りました。メールのリンクを開いてから、ログインしてください。')
      }
    } catch (err) {
      const t = errorText(err)
      setMsg(t.includes('Invalid login') ? 'メールアドレスかパスワードが違います。' : t)
    } finally { setBusy(false) }
  }

  return (
    <main className="center">
      <form className="panel narrow" onSubmit={submit}>
        <h1>まちより 発注</h1>
        <p className="muted">{mode === 'login' ? 'スタッフのアカウントでログインしてください。' : '登録したあと、管理者の承認で使えるようになります。'}</p>
        {mode === 'signup' && (
          <div className="field"><label htmlFor="name">名前</label>
            <input id="name" value={name} onChange={e => setName(e.target.value)} required /></div>
        )}
        <div className="field"><label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="password">パスワード{mode === 'signup' && '（8文字以上）'}</label>
          <input id="password" type="password" minLength={mode === 'signup' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {msg && <p className="msg">{msg}</p>}
        <button className="btn primary wide" disabled={busy}>{mode === 'login' ? 'ログイン' : '登録する'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg('') }}>
          {mode === 'login' ? 'はじめての方はこちらから登録' : 'ログインに戻る'}
        </button>
      </form>
    </main>
  )
}

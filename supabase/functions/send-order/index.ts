// 発注書を送る：メールで取引先へ、または メールtoFAX のサービスへ（PDF を添付）
// 呼べるのはログインしたスタッフだけ。送信は Resend の API を使う。
//
// 必要な秘密の値（supabase secrets set で入れる。リポジトリには書かない）
//   RESEND_API_KEY  Resend の API キー
//   MAIL_FROM       送信元（例 "まちより 発注 <order@あなたのドメイン>"）。FAX サービスに登録したアドレスにする
import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const jpDate = (s: string | null) => {
  if (!s) return 'ご相談'
  const [y, m, d] = s.split('-')
  return `${y}年${+m}月${+d}日`
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST で呼んでください' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const mailFrom = Deno.env.get('MAIL_FROM')
  if (!resendKey || !mailFrom) return json({ error: 'メール送信の設定（RESEND_API_KEY・MAIL_FROM）がありません' }, 500)

  // 呼んだ人を確かめる
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'ログインし直してください' }, 401)
  const { data: me } = await admin.from('profiles').select('role, name').eq('id', user.id).single()
  if (!me || !['staff', 'admin'].includes(me.role)) return json({ error: '送信する権限がありません' }, 403)

  const { order_id, via } = await req.json().catch(() => ({}))
  if (typeof order_id !== 'string' || !['email', 'fax'].includes(via)) return json({ error: '送り先の指定が正しくありません' }, 400)

  const { data: order } = await admin.from('orders').select('*, order_lines(*), suppliers(*)').eq('id', order_id).single()
  if (!order) return json({ error: '発注書が見つかりません' }, 404)
  if (order.status === 'cancelled') return json({ error: '取消した発注書は送れません' }, 409)
  if (!order.pdf_path) return json({ error: '発注書の PDF がありません。もう一度お試しください' }, 400)
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).single()

  const sup = order.suppliers
  const store = order.store_snapshot
  let to = ''
  if (via === 'email') {
    to = (sup.email ?? '').trim()
    if (!to) return json({ error: '取引先にメールアドレスがありません' }, 400)
  } else {
    const digits = (sup.fax ?? '').replace(/\D/g, '')
    if (!settings?.fax_gateway) return json({ error: 'インターネットFAX の宛先が設定されていません' }, 400)
    if (!digits) return json({ error: '取引先に FAX 番号がありません' }, 400)
    to = settings.fax_gateway.split('{fax}').join(digits)
  }

  const file = await admin.storage.from('order-pdfs').download(order.pdf_path)
  if (file.error || !file.data) return json({ error: '発注書の PDF を読めませんでした' }, 500)
  const pdf = encodeBase64(new Uint8Array(await file.data.arrayBuffer()))

  const lines = [...order.order_lines].sort((a, b) => a.line_no - b.line_no)
  const subject = via === 'email' ? `【発注書】${order.order_no} ${store.name}` : `発注書 ${order.order_no}`
  // FAX サービスは本文を送り状にすることがあるので、FAX のときは短くする
  const text = via === 'fax'
    ? `${sup.name} ${sup.attention || '御中'}\n${store.name}より発注書をお送りします（${order.order_no}）。`
    : [
        `${sup.name} ${sup.attention || '御中'}`,
        '',
        `いつもお世話になっております。${store.name}の${store.person || me.name || ''}です。`,
        '下記のとおり発注いたします。発注書（PDF）を添付しております。',
        '',
        `発注番号：${order.order_no}`,
        `納品希望日：${jpDate(order.due_date)}`,
        `納品先：${store.delivery_note || store.name}`,
        '',
        ...lines.map(l => `${l.line_no}. ${l.code ?? ''} ${l.name} ${l.spec}　${l.qty}${l.unit}`),
        '',
        `合計（税込）：${yen(order.total)}`,
        ...(order.remarks ? ['', `備考：${order.remarks}`] : []),
        '',
        'お手数ですが、ご確認のほどよろしくお願いいたします。',
        '',
        store.name,
        [store.tel && `TEL ${store.tel}`, store.fax && `FAX ${store.fax}`].filter(Boolean).join(' / '),
      ].join('\n')

  const replyTo = settings?.reply_to || store.email || undefined
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: mailFrom, to: [to], reply_to: replyTo, subject, text,
      attachments: [{ filename: `${order.order_no}.pdf`, content: pdf }],
    }),
  })
  const detail = await res.text()

  await admin.from('send_logs').insert({ order_id, via, to_addr: to, ok: res.ok, detail: detail.slice(0, 1000), sent_by: user.id })
  if (!res.ok) return json({ error: `送信できませんでした（${res.status}）：${detail.slice(0, 300)}` }, 502)

  await admin.from('orders').update({
    status: 'sent', sent_via: via, sent_to: to, sent_at: new Date().toISOString(), sent_by: user.id,
  }).eq('id', order_id)
  return json({ ok: true, to })
})

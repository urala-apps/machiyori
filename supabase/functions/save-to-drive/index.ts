// 発注書の PDF を Google ドライブの指定フォルダに保存する（受け取り役は Google Apps Script：google-apps-script/drive-save.gs）
// 呼べるのはログインしたスタッフだけ。PDF は画面が先に保管庫（order-pdfs）に置いておく。
//
// 必要な秘密の値（Supabase の Edge Functions → Secrets。リポジトリには書かない）
//   DRIVE_WEBHOOK_URL     Apps Script のウェブアプリの URL
//   DRIVE_WEBHOOK_SECRET  Apps Script に書いた合言葉
// 保存先フォルダの ID は「設定」（settings.drive_folder_id）
import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import { Buffer } from 'node:buffer'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST で呼んでください' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 呼んだ人を確かめる
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'ログインし直してください' }, 401)
  const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (!me || !['staff', 'admin'].includes(me.role)) return json({ error: '保存する権限がありません' }, 403)

  const hook = Deno.env.get('DRIVE_WEBHOOK_URL')
  const secret = Deno.env.get('DRIVE_WEBHOOK_SECRET')
  if (!hook || !secret) return json({ error: 'ドライブ保存の設定（DRIVE_WEBHOOK_URL・DRIVE_WEBHOOK_SECRET）がありません' }, 500)
  const { data: settings } = await admin.from('settings').select('drive_folder_id').eq('id', 1).single()
  if (!settings?.drive_folder_id) return json({ error: '「設定」で保存先フォルダを決めてください' }, 400)

  const { order_id } = await req.json().catch(() => ({}))
  if (typeof order_id !== 'string') return json({ error: '発注書の指定が正しくありません' }, 400)
  const { data: order } = await admin.from('orders').select('id, order_no, order_date, pdf_path, supplier_snapshot').eq('id', order_id).single()
  if (!order) return json({ error: '発注書が見つかりません' }, 404)
  if (!order.pdf_path) return json({ error: '発注書の PDF がありません。もう一度お試しください' }, 400)

  const file = await admin.storage.from('order-pdfs').download(order.pdf_path)
  if (file.error || !file.data) return json({ error: '発注書の PDF を読めませんでした' }, 500)
  const content = Buffer.from(await file.data.arrayBuffer()).toString('base64')

  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret,
      folderId: settings.drive_folder_id,
      month: String(order.order_date).slice(0, 7),
      filename: `発注書_${order.order_no}_${order.supplier_snapshot?.name ?? ''}.pdf`,
      content,
    }),
  })
  const text = await res.text()
  let out: { ok?: boolean; url?: string; error?: string } = {}
  try { out = JSON.parse(text) } catch { /* Apps Script がエラーの画面（HTML）を返したとき */ }
  if (!res.ok || !out.ok || !out.url) {
    const why = out.error || (text.includes('<html') ? 'Apps Script の公開設定（アクセスできるユーザー：全員）を確かめてください' : text.slice(0, 200))
    return json({ error: why }, 502)
  }

  await admin.from('orders').update({ drive_url: out.url, drive_saved_at: new Date().toISOString() }).eq('id', order_id)
  return json({ ok: true, url: out.url })
})

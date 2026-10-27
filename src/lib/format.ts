export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
export const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

export function jpDate(s: string | null | undefined) {
  if (!s) return ''
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${y}年${+m}月${+d}日`
}

export function jpDateTime(s: string | null | undefined) {
  if (!s) return ''
  return new Date(s).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** FAX 番号を数字だけにして、メールtoFAX の宛先の形に入れる */
export function faxAddress(gateway: string, fax: string) {
  const digits = fax.replace(/\D/g, '')
  if (!gateway || !digits) return ''
  return gateway.split('{fax}').join(digits)
}

export const methodLabel = { fax: 'FAX', email: 'メール' } as const
export const statusLabel = { draft: '未送信', sent: '送信済み', cancelled: '取消' } as const
export const viaLabel = { email: 'メール', fax: 'FAX', print: '印刷' } as const

export function errorText(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function readLocal(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
export function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 保存できなくても動く */ }
}

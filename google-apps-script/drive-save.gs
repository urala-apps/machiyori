/**
 * まちより 発注：発注書の PDF を Google ドライブに保存する受け取り役（Google Apps Script）
 *
 * 使い方（README の「Google ドライブへの保存」）
 *  1. https://script.google.com で新しいプロジェクトを作り、このファイルの中身を貼る
 *  2. 下の SECRET を、自分で決めた長い合言葉（英数字 20 文字以上）に変える
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *     次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *  4. 出てきたウェブアプリの URL と合言葉を、Supabase の Secrets に入れる
 *     DRIVE_WEBHOOK_URL ／ DRIVE_WEBHOOK_SECRET
 *
 * 保存先フォルダは、発注システムの「設定」で決める（このスクリプトを動かすアカウントが編集できるフォルダ）。
 * 発注月ごとのフォルダ（例 2026-10）を自動で作り、同じ名前のファイルは新しいものに置き換える。
 */
const SECRET = 'ここを自分で決めた合言葉に変える';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!SECRET || SECRET.indexOf('ここを') === 0 || body.secret !== SECRET) return reply({ ok: false, error: '合言葉が違います' });
    const folder = DriveApp.getFolderById(body.folderId);
    const month = String(body.month || '').replace(/[^0-9-]/g, '') || 'その他';
    const sub = childFolder(folder, month);
    const name = String(body.filename).replace(/[\\/:*?"<>|]/g, '_');
    const old = sub.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.content), 'application/pdf', name);
    const file = sub.createFile(blob);
    return reply({ ok: true, id: file.getId(), url: file.getUrl() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function childFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

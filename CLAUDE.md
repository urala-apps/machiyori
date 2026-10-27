# Claude への申し送り

小売店の発注システム「まちより 発注」。くわしくは README.md。

- **応答は常に日本語**（代表 2026-10-27「常に日本語で応答して」）

- 画面：Vite + React + TypeScript（`src/`）。変えたら `npm run build`（型チェック込み）が通ること
- データ：Supabase。マイグレーションは `supabase/migrations/`。新しい表には必要な GRANT を同じファイルに書き、`anon` には何も与えない。行は RLS（`is_staff()`・`is_admin()`）で絞る
- 金額・消費税・発注番号はデータベースの関数 `create_orders` が決める。画面で計算した金額を保存しない
- 送信は Edge Function `supabase/functions/send-order`（Gmail の SMTP・465 番）。アプリ パスワードなどの秘密の値はリポジトリに書かない（Supabase の Secrets）
- 画面の文言はやさしい日本語で。ボタンは何が起きるかをそのまま書く

-- 関数の実行権限をしぼる（Supabase のセキュリティ診断より）
-- is_staff・is_admin は RLS の判定にだけ使う。ログインしていない人には要らない
revoke execute on function public.is_staff(), public.is_admin() from public, anon;
-- handle_new_user は登録のときのトリガーだけで動かす。API からは呼ばせない
revoke execute on function public.handle_new_user() from authenticated;

-- 納品先の選択・販売価格・お気に入り・発注の多い順・Google ドライブへの保存（代表 2026-10-28）
-- ・店舗の種類 mobile は画面では「外販」と呼ぶ（値はそのまま）。外販は1回ごとに店舗として登録する（名称・場所＝住所・期間）
-- ・納品先は「店舗に納品」「集荷」「指定の住所」「外販の会場に納品」。実店舗の発注は自分の店舗への納品か集荷、外販は全部から選べる
-- ・商品に販売価格（税込）を足す。発注書には仕入れ価格（price）を載せる

-- ---------- 外販の期間 ----------
alter table public.stores
  add column start_date date,   -- 外販の期間（実店舗は空）。終わった外販は発注の画面に出さない
  add column end_date date,
  add constraint stores_period check (end_date is null or start_date is null or end_date >= start_date);

-- ---------- 指定の住所（納品先） ----------
create table public.delivery_places (
  id uuid primary key default gen_random_uuid(),
  name text not null,                        -- 例 〇〇イベント会場、△△倉庫
  zip text not null default '',
  address text not null default '',
  tel text not null default '',
  note text not null default '',             -- 受け取りの注意など。発注書に出る
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.delivery_places enable row level security;
create policy delivery_places_read on public.delivery_places for select to authenticated using (public.is_staff());
create policy delivery_places_admin on public.delivery_places for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.delivery_places from anon, authenticated;
grant select, insert, update, delete on public.delivery_places to authenticated;
grant select, insert, update, delete on public.delivery_places to service_role;

-- ---------- 商品の販売価格 ----------
alter table public.items add column sale_price integer check (sale_price >= 0);   -- 販売価格（税込・円）。空でもよい

-- ---------- 発注の納品先 ----------
alter table public.orders
  add column delivery_type text not null default 'store' check (delivery_type in ('store', 'pickup', 'address', 'venue')),
  add column delivery_time text not null default '',   -- 例 10:00、午前中（日付は due_date）
  add column delivery_snapshot jsonb;                  -- 作った時点の納品先 {type, name, zip, address, tel, note}

-- 備考は発注書ごとに画面から書き直せる
grant update (remarks) on public.orders to authenticated;

-- ---------- Google ドライブへの保存 ----------
-- 発注書の PDF を、ボタンを押すたびに指定のフォルダへ保存する（Edge Function save-to-drive → Google Apps Script）
alter table public.settings add column drive_folder_id text not null default '';   -- 保存先フォルダの ID
alter table public.orders
  add column drive_url text,             -- ドライブに保存した PDF の URL（service_role が書く）
  add column drive_saved_at timestamptz;

-- ---------- お気に入り（スタッフごと） ----------
create table public.item_favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.item_favorites enable row level security;
create policy item_favorites_own on public.item_favorites for all to authenticated
  using (user_id = auth.uid() and public.is_staff()) with check (user_id = auth.uid() and public.is_staff());
revoke all on public.item_favorites from anon, authenticated;
grant select, insert, delete on public.item_favorites to authenticated;
grant select, insert, update, delete on public.item_favorites to service_role;

-- ---------- 発注の多い順 ----------
-- 店舗ごとの、商品の発注回数と数量の合計（取消は数えない）。RLS で承認済みスタッフだけ読める
create or replace function public.item_order_stats(p_store_id uuid)
returns table (item_id uuid, times int, qty int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select l.item_id, count(*)::int, sum(l.qty)::int
  from public.order_lines l join public.orders o on o.id = l.order_id
  where o.store_id = p_store_id and o.status <> 'cancelled' and l.item_id is not null
  group by l.item_id;
$$;
revoke execute on function public.item_order_stats(uuid) from public, anon;
grant execute on function public.item_order_stats(uuid) to authenticated;

-- ---------- 発注書を作る（納品先つき） ----------
-- p_delivery：{"type": "store" | "pickup" | "address" | "venue", "store_id": 外販が店舗に納品するときの店舗, "place_id": 指定の住所, "time": 時間}
-- venue は外販の会場（その外販の店舗の住所）に納品
-- 前のかたち（引数4つ）の関数は消さずに残す（画面を入れ替えるまで前の画面が動くように）。
-- p_delivery に既定値を付けないので、4つで呼べば前の関数、5つで呼べばこの関数になり、呼び分けが迷わない
create function public.create_orders(
  p_store_id uuid, p_due_date date, p_remarks text, p_lines jsonb, p_delivery jsonb
) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store public.stores;
  v_sup public.suppliers;
  v_dest_store public.stores;
  v_place public.delivery_places;
  v_type text := coalesce(nullif(p_delivery ->> 'type', ''), 'store');
  v_time text := left(coalesce(p_delivery ->> 'time', ''), 40);
  v_dest jsonb;
  v_round text;
  v_day date := (now() at time zone 'Asia/Tokyo')::date;
  v_n int;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_sub int;
  v_tax int;
  v_detail jsonb;
  v_want int;
  v_got int;
  v_lines jsonb;
begin
  if not public.is_staff() then
    raise exception '発注する権限がありません' using errcode = '42501';
  end if;
  select * into v_store from public.stores where id = p_store_id and active;
  if not found then raise exception '店舗が見つかりません'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '明細がありません';
  end if;

  -- 納品先を決める
  if v_type not in ('store', 'pickup', 'address', 'venue') then raise exception '納品先の種類が正しくありません'; end if;
  if v_store.kind = 'fixed' and v_type in ('address', 'venue') then
    raise exception '店舗からの発注は、店舗への納品か集荷を選んでください';
  end if;
  if v_type = 'store' then
    if v_store.kind = 'fixed' then
      v_dest_store := v_store;
    else
      select * into v_dest_store from public.stores
        where id = nullif(p_delivery ->> 'store_id', '')::uuid and kind = 'fixed' and active;
      if not found then raise exception '納品する店舗を選んでください'; end if;
    end if;
    v_dest := jsonb_build_object('type', 'store', 'name', v_dest_store.name, 'zip', v_dest_store.zip,
      'address', v_dest_store.address, 'tel', v_dest_store.tel, 'note', '');
  elsif v_type = 'venue' then
    v_dest := jsonb_build_object('type', 'venue', 'name', v_store.name, 'zip', v_store.zip,
      'address', v_store.address, 'tel', v_store.tel, 'note', '');
  elsif v_type = 'pickup' then
    v_dest := jsonb_build_object('type', 'pickup', 'name', '集荷', 'zip', '', 'address', '', 'tel', '', 'note', '');
  else
    select * into v_place from public.delivery_places
      where id = nullif(p_delivery ->> 'place_id', '')::uuid and active;
    if not found then raise exception '納品先の住所を選んでください'; end if;
    v_dest := jsonb_build_object('type', 'address', 'name', v_place.name, 'zip', v_place.zip,
      'address', v_place.address, 'tel', v_place.tel, 'note', v_place.note);
  end if;

  select jsonb_agg(jsonb_build_object('item_id', (e.v ->> 'item_id')::uuid, 'qty', (e.v ->> 'qty')::int, 'ord', e.ord))
    into v_lines
  from jsonb_array_elements(p_lines) with ordinality as e(v, ord)
  where coalesce((e.v ->> 'qty')::int, 0) > 0;
  if v_lines is null then raise exception '明細がありません'; end if;
  select count(*), count(i.id) into v_want, v_got
  from jsonb_to_recordset(v_lines) as l(item_id uuid, qty int, ord int)
  left join public.items i on i.id = l.item_id and i.active;
  if v_got <> v_want then raise exception '使えない商品が含まれています。画面を読み込み直してください'; end if;

  select tax_round into v_round from public.settings where id = 1;

  for v_sup in
    select s.* from public.suppliers s
    where s.id in (select i.supplier_id from jsonb_to_recordset(v_lines) as l(item_id uuid, qty int, ord int)
                   join public.items i on i.id = l.item_id)
    order by s.name
  loop
    insert into public.order_counters (store_id, day, n) values (p_store_id, v_day, 1)
      on conflict (store_id, day) do update set n = public.order_counters.n + 1
      returning n into v_n;

    insert into public.orders (order_no, store_id, supplier_id, created_by, order_date, due_date, remarks,
                               store_snapshot, supplier_snapshot, delivery_type, delivery_time, delivery_snapshot)
    values ('PO-' || upper(v_store.code) || '-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_n::text, 3, '0'),
            p_store_id, v_sup.id, auth.uid(), v_day, p_due_date, coalesce(p_remarks, ''),
            to_jsonb(v_store), to_jsonb(v_sup), v_type, v_time, v_dest)
    returning id into v_id;

    insert into public.order_lines (order_id, line_no, item_id, code, name, spec, unit, price, tax_rate, qty)
    select v_id, row_number() over (order by l.ord), i.id, i.code, i.name, i.spec, i.unit, i.price, i.tax_rate, l.qty
    from jsonb_to_recordset(v_lines) as l(item_id uuid, qty int, ord int)
    join public.items i on i.id = l.item_id
    where i.supplier_id = v_sup.id;

    select coalesce(jsonb_agg(jsonb_build_object('rate', t.tax_rate, 'base', t.base, 'tax', t.tax) order by t.tax_rate), '[]'),
           coalesce(sum(t.base), 0), coalesce(sum(t.tax), 0)
      into v_detail, v_sub, v_tax
    from (
      select tax_rate, sum(price * qty)::int as base,
             (case v_round
                when 'ceil' then ceil(sum(price * qty) * tax_rate / 100.0)
                when 'round' then round(sum(price * qty) * tax_rate / 100.0)
                else floor(sum(price * qty) * tax_rate / 100.0)
              end)::int as tax
      from public.order_lines where order_id = v_id group by tax_rate
    ) t;

    update public.orders set subtotal = v_sub, tax = v_tax, total = v_sub + v_tax, tax_detail = v_detail
    where id = v_id;
    v_ids := v_ids || v_id;
  end loop;

  return v_ids;
end;
$$;
revoke execute on function public.create_orders(uuid, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_orders(uuid, date, text, jsonb, jsonb) to authenticated;

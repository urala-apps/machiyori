-- まちより 発注システム：最初の表・関数・権限
-- 決まり：サイトから直接読み書きする表には、必要な GRANT をこのファイルの中で与える。
-- anon（ログインしていない人）には何も与えない。行は RLS で絞る。

-- ---------- スタッフ ----------
create type public.staff_role as enum ('pending', 'staff', 'admin');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9]{1,4}$'),  -- 発注番号に入る（例 A, CAR）
  name text not null,
  kind text not null default 'fixed' check (kind in ('fixed', 'mobile')),  -- 実店舗 / 移動型店舗
  zip text not null default '',
  address text not null default '',
  tel text not null default '',
  fax text not null default '',
  email text not null default '',
  person text not null default '',           -- 発注担当
  delivery_note text not null default '',    -- 納品先（移動型店舗の拠点・倉庫など）。空なら店の住所
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  role public.staff_role not null default 'pending',
  default_store_id uuid references public.stores (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 取引先・商品 ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text unique,                           -- CSV で商品と結びつける
  name text not null,
  attention text not null default '御中',      -- 宛名（例 営業部 御中）
  email text not null default '',
  fax text not null default '',
  tel text not null default '',
  send_method text not null default 'fax' check (send_method in ('fax', 'email')),
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  code text,
  name text not null,
  spec text not null default '',
  unit text not null default '個',
  price integer not null default 0 check (price >= 0),   -- 税抜の単価（円）
  tax_rate smallint not null default 10 check (tax_rate in (8, 10)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (supplier_id, code)
);
create index items_supplier_idx on public.items (supplier_id);

-- ---------- 設定（1行だけ） ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  fax_gateway text not null default '',      -- メールtoFAX の宛先の形。{fax} が FAX 番号（数字だけ）になる
  tax_round text not null default 'floor' check (tax_round in ('floor', 'round', 'ceil')),
  reply_to text not null default '',         -- 取引先が返信したときの宛先
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------- 発注 ----------
create table public.order_counters (
  store_id uuid not null references public.stores (id) on delete cascade,
  day date not null,
  n int not null,
  primary key (store_id, day)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  store_id uuid not null references public.stores (id),
  supplier_id uuid not null references public.suppliers (id),
  created_by uuid references public.profiles (id) on delete set null,
  order_date date not null,
  due_date date,
  remarks text not null default '',
  store_snapshot jsonb not null,             -- 作った時点の店・取引先（あとで直しても発注書は変わらない）
  supplier_snapshot jsonb not null,
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  tax_detail jsonb not null default '[]',    -- [{rate, base, tax}]
  status text not null default 'draft' check (status in ('draft', 'sent', 'cancelled')),
  pdf_path text,
  sent_via text check (sent_via in ('email', 'fax', 'print')),
  sent_to text,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_store_idx on public.orders (store_id);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  line_no int not null,
  item_id uuid references public.items (id) on delete set null,
  code text,
  name text not null,
  spec text not null default '',
  unit text not null default '',
  price integer not null,
  tax_rate smallint not null,
  qty integer not null check (qty > 0)
);
create index order_lines_order_idx on public.order_lines (order_id);

create table public.send_logs (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  via text not null,
  to_addr text not null default '',
  ok boolean not null,
  detail text not null default '',
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 権限の判定 ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('staff', 'admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 新しく登録した人は「承認待ち」。最初の1人だけは管理者にする（立ち上げ用）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end::public.staff_role
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 発注書を作る ----------
-- 明細 [{item_id, qty}] を取引先ごとに分けて、1取引先 = 1発注書で作る。
-- 単価・税率は商品の表から取り、金額もここで計算する（画面から送られた金額は使わない）。
create or replace function public.create_orders(
  p_store_id uuid, p_due_date date, p_remarks text, p_lines jsonb
) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store public.stores;
  v_sup public.suppliers;
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
                               store_snapshot, supplier_snapshot)
    values ('PO-' || upper(v_store.code) || '-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_n::text, 3, '0'),
            p_store_id, v_sup.id, auth.uid(), v_day, p_due_date, coalesce(p_remarks, ''),
            to_jsonb(v_store), to_jsonb(v_sup))
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

-- 印刷して FAX 機で送ったとき
create or replace function public.mark_order_printed(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  update public.orders
     set status = 'sent', sent_via = 'print', sent_to = coalesce(supplier_snapshot ->> 'fax', ''),
         sent_at = now(), sent_by = auth.uid()
   where id = p_order_id and status = 'draft';
  if found then
    insert into public.send_logs (order_id, via, to_addr, ok, detail, sent_by)
    values (p_order_id, 'print', '', true, '印刷して手で送信', auth.uid());
  end if;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;

-- ---------- RLS ----------
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.items enable row level security;
alter table public.settings enable row level security;
alter table public.order_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.send_logs enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy stores_read on public.stores for select to authenticated using (public.is_staff());
create policy stores_admin on public.stores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy suppliers_read on public.suppliers for select to authenticated using (public.is_staff());
create policy suppliers_admin on public.suppliers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy items_read on public.items for select to authenticated using (public.is_staff());
create policy items_admin on public.items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_read on public.settings for select to authenticated using (public.is_staff());
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy orders_read on public.orders for select to authenticated using (public.is_staff());
create policy orders_pdf on public.orders for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy order_lines_read on public.order_lines for select to authenticated using (public.is_staff());
create policy send_logs_read on public.send_logs for select to authenticated using (public.is_staff());

-- ---------- GRANT（必要な分だけ） ----------
revoke all on public.stores, public.profiles, public.suppliers, public.items, public.settings,
  public.order_counters, public.orders, public.order_lines, public.send_logs from anon, authenticated;

grant select, insert, update, delete on public.stores, public.suppliers, public.items to authenticated;
grant select, update on public.settings to authenticated;
grant select on public.profiles to authenticated;
grant update (name, role, default_store_id) on public.profiles to authenticated;
grant select on public.orders, public.order_lines, public.send_logs to authenticated;
grant update (pdf_path) on public.orders to authenticated;   -- 送信は Edge Function（service_role）が書く
-- order_counters は関数の中だけで使う
-- Edge Function（service_role）は発注・送信の記録を読み書きする
grant select, insert, update, delete on public.stores, public.profiles, public.suppliers, public.items, public.settings,
  public.order_counters, public.orders, public.order_lines, public.send_logs to service_role;

revoke execute on function public.create_orders(uuid, date, text, jsonb),
  public.mark_order_printed(uuid), public.cancel_order(uuid), public.handle_new_user() from public, anon;
grant execute on function public.create_orders(uuid, date, text, jsonb),
  public.mark_order_printed(uuid), public.cancel_order(uuid) to authenticated;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- ---------- 発注書 PDF の置き場（非公開） ----------
insert into storage.buckets (id, name, public) values ('order-pdfs', 'order-pdfs', false)
  on conflict (id) do nothing;
create policy order_pdfs_read on storage.objects for select to authenticated
  using (bucket_id = 'order-pdfs' and public.is_staff());
create policy order_pdfs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'order-pdfs' and public.is_staff());
create policy order_pdfs_update on storage.objects for update to authenticated
  using (bucket_id = 'order-pdfs' and public.is_staff());

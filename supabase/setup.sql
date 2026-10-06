-- =====================================================================
-- AMADORA · מערכת ניהול הזמנות · מבנה בסיס הנתונים
-- להרצה פעם אחת ב-Supabase: SQL Editor -> New query -> הדבקה -> Run
-- בטוח להרצה חוזרת (לא מוחק נתונים קיימים).
-- =====================================================================

-- ---------- הגדרות כלליות (שורה אחת) ----------
create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  vat_rate     numeric(5,4) not null default 0.18 check (vat_rate >= 0 and vat_rate < 1),
  sla_days     int not null default 14 check (sla_days > 0),
  warn_days_1  int not null default 6 check (warn_days_1 >= 0),
  warn_days_2  int not null default 3 check (warn_days_2 >= 0),
  factory_days int not null default 5 check (factory_days > 0),
  updated_at   timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- חגים (ימים שאינם ימי עסקים, בנוסף לשישי ושבת) ----------
create table if not exists public.holidays (
  day  date primary key,
  name text not null
);

-- ---------- הזמנות ----------
create sequence if not exists public.order_number_seq start with 2772;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      int  not null unique,  -- מוקצה אוטומטית רק אחרי שכל הבדיקות עברו
  customer_name     text not null check (length(btrim(customer_name)) > 0),
  customer_phone    text,
  entered_at        date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  description       text not null default '',
  source            text,
  notes             text,

  -- סטטוס הזמנה. NULL = ממתין לשיוך (הזמנות שיובאו מהאקסל)
  status            text check (status in ('new','to_factory','factory','returned','ready','with_customer')),
  status_changed_at timestamptz,
  delivered_at      timestamptz,

  -- הרכב עלויות ומחיר
  cost_lior         numeric(12,2) not null default 0 check (cost_lior >= 0),
  cost_diamonds     numeric(12,2) not null default 0 check (cost_diamonds >= 0),
  sale_price        numeric(12,2) not null default 0 check (sale_price >= 0),

  -- תשלום ראשון (מקדמה) - חובה בפתיחת הזמנה
  payment1_amount   numeric(12,2) check (payment1_amount >= 0),
  payment1_method   text check (payment1_method in ('מזומן','העברה בנקאית','אשראי','שת"פ','פייבוקס','ביט','אתר')),
  payment1_invoice  boolean not null default false,

  -- תשלום שני (השלמה) - חובה לפני "מוכן למסירה"
  payment2_amount   numeric(12,2) check (payment2_amount >= 0),
  payment2_method   text check (payment2_method in ('מזומן','העברה בנקאית','אשראי','שת"פ','פייבוקס','ביט','אתר')),
  payment2_invoice  boolean not null default false,
  payment2_at       timestamptz,

  -- בדיקות שלב (מסך "דורש טיפול")
  stones_inserted     boolean not null default false,  -- הכנסת אבנים
  stones_not_needed   boolean not null default false,  -- אין צורך בהכנסת אבנים
  check_jewelry       boolean not null default false,  -- בדיקת התכשיט
  check_sizes         boolean not null default false,  -- מידות
  check_gold_color    boolean not null default false,  -- צבע זהב
  pickup_coordinated  boolean not null default false,  -- תיאום איסוף/משלוח

  -- זמן במפעל
  factory_started_at  timestamptz,                     -- תחילת השהות הנוכחית במפעל
  factory_days_carry  int not null default 0 check (factory_days_carry >= 0),  -- ימים שנצברו בשהויות קודמות

  legacy_payment_note text,
  is_import         boolean not null default false,
  archived_at       timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by_name   text,
  updated_by_name   text
);
alter table public.orders alter column order_number drop default;

-- עמודות שנוספו אחרי ההקמה הראשונה (בטוח להרצה חוזרת)
alter table public.settings add column if not exists factory_days int not null default 5 check (factory_days > 0);
alter table public.orders
  add column if not exists stones_inserted    boolean not null default false,
  add column if not exists stones_not_needed  boolean not null default false,
  add column if not exists check_jewelry      boolean not null default false,
  add column if not exists check_sizes        boolean not null default false,
  add column if not exists check_gold_color   boolean not null default false,
  add column if not exists pickup_coordinated boolean not null default false,
  add column if not exists factory_started_at timestamptz,
  add column if not exists factory_days_carry int not null default 0 check (factory_days_carry >= 0);
alter sequence public.order_number_seq owned by public.orders.order_number;

create index if not exists orders_status_idx  on public.orders (status) where deleted_at is null;
create index if not exists orders_entered_idx on public.orders (entered_at);

-- ---------- היסטוריית שינויים ----------
create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_name  text,
  type        text not null,
  from_status text,
  to_status   text,
  details     jsonb
);
create index if not exists order_events_order_idx on public.order_events (order_id, at);
create index if not exists order_events_type_idx  on public.order_events (type, at);

-- =====================================================================
-- כללי עבודה (נאכפים בבסיס הנתונים, גם לחיבורים חיצוניים)
-- =====================================================================
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  steps    text[] := array['new','to_factory','factory','returned','ready','with_customer'];
  new_step int;
  old_step int := 0;
begin
  new_step := coalesce(array_position(steps, new.status), 0);
  if tg_op = 'INSERT' then
    if not new.is_import then
      if new.payment1_amount is null then
        raise exception 'יש להזין כמה שולם בפתיחת ההזמנה (אפשר להזין 0).';
      end if;
      if not new.payment1_invoice then
        raise exception 'לא ניתן לפתוח הזמנה לפני שיצאה חשבונית. יש לסמן "יצאה חשבונית".';
      end if;
      if new.status is null then
        new.status := 'new';
      end if;
    end if;
    new.created_by_name := coalesce(new.created_by_name, new.updated_by_name);
    if new.status is not null then
      new.status_changed_at := now();
    end if;
  else
    new.updated_at := now();
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
    if not new.is_import and new.payment1_amount is null then
      raise exception 'לא ניתן למחוק את סכום המקדמה (אפשר להזין 0).';
    end if;
  end if;

  if new.payment1_amount > 0 and new.payment1_method is null then
    raise exception 'יש לבחור איך שולמה המקדמה.';
  end if;

  if new.stones_inserted and new.stones_not_needed then
    raise exception 'יש לבחור רק אחד: "הכנסת אבנים" או "אין צורך בהכנסת אבנים".';
  end if;

  -- בדיקות שלב: נאכפות רק בהתקדמות קדימה (חזרה אחורה תמיד מותרת).
  -- הזמנה שעדיין לא שויך לה סטטוס (ייבוא מהאקסל) פטורה בשיוך הראשון.
  if tg_op = 'UPDATE' and old.status is not null then
    old_step := coalesce(array_position(steps, old.status), 0);
    if new_step > old_step then
      if new_step >= 3 and old_step < 3 and not (new.stones_inserted or new.stones_not_needed) then
        raise exception 'לפני מעבר למפעל יש לסמן "הכנסת אבנים" או "אין צורך בהכנסת אבנים".';
      end if;
      if new_step >= 5 and old_step < 5 then
        if not (new.check_jewelry and new.check_sizes and new.check_gold_color) then
          raise exception 'לפני מעבר ל"מוכן למסירה" יש לסמן "בדיקת התכשיט", "מידות" ו"צבע זהב".';
        end if;
        if new.payment2_amount is not null and not new.payment2_invoice then
          raise exception 'לפני מעבר ל"מוכן למסירה" יש לסמן שיצאה חשבונית על השלמת התשלום.';
        end if;
      end if;
      if new_step >= 6 and old_step < 6 and not new.pickup_coordinated then
        raise exception 'לפני מסירה ללקוח יש לסמן "תיאום איסוף/משלוח".';
      end if;
    end if;
  end if;

  -- כניסה למפעל: אם לא נקבע אחרת, הספירה מתחילה עכשיו
  if new.status = 'factory' and (tg_op = 'INSERT' or old.status is distinct from 'factory')
     and (tg_op = 'INSERT' or new.factory_started_at is not distinct from old.factory_started_at) then
    new.factory_started_at := now();
  end if;

  -- מעבר ל"מוכן למסירה" / "אצל הלקוח" מחייב פרטי השלמת תשלום
  if new.status in ('ready','with_customer') then
    if new.payment2_amount is null then
      raise exception 'לפני מעבר ל"מוכן למסירה" יש להזין את השלמת התשלום: כמה נותר לשלם, איך שולם והאם יצאה חשבונית.';
    end if;
    if new.payment2_amount > 0 and new.payment2_method is null then
      raise exception 'יש לבחור איך שולמה השלמת התשלום.';
    end if;
  end if;
  if new.payment2_amount > 0 and new.payment2_method is null then
    raise exception 'יש לבחור איך שולמה השלמת התשלום.';
  end if;

  -- תאריך הזנת התשלום השני
  if new.payment2_amount is null then
    new.payment2_at := null;
  elsif tg_op = 'INSERT' or old.payment2_amount is null then
    new.payment2_at := coalesce(new.payment2_at, now());
  end if;

  -- מספר הזמנה רץ (מ-2772), מוקצה בסוף כדי שהזמנה שנדחתה לא "תשרוף" מספר
  if tg_op = 'INSERT' and new.order_number is null then
    new.order_number := nextval('public.order_number_seq');
  end if;

  -- מועד מסירה ללקוח (עוצר את מונה ימי האספקה)
  if new.status = 'with_customer' then
    if tg_op = 'INSERT' or old.status is distinct from 'with_customer' then
      new.delivered_at := now();
    end if;
  else
    new.delivered_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard
  before insert or update on public.orders
  for each row execute function public.orders_guard();

-- ---------- רישום היסטוריה אוטומטי ----------
create or replace function public.orders_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor   text := coalesce(new.updated_by_name, new.created_by_name);
  changed text[] := '{}';
  ck      jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into order_events (order_id, actor_name, type, to_status, details)
    values (new.id, actor, case when new.is_import then 'imported' else 'created' end, new.status,
            jsonb_build_object('payment1_amount', new.payment1_amount, 'payment1_method', new.payment1_method));
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into order_events (order_id, actor_name, type, from_status, to_status)
    values (new.id, actor, 'status', old.status, new.status);
  end if;

  if new.payment2_amount is not null and old.payment2_amount is null then
    insert into order_events (order_id, actor_name, type, details)
    values (new.id, actor, 'payment2', jsonb_build_object(
      'amount', new.payment2_amount, 'method', new.payment2_method, 'invoice', new.payment2_invoice));
  end if;

  if new.archived_at is distinct from old.archived_at then
    insert into order_events (order_id, actor_name, type)
    values (new.id, actor, case when new.archived_at is null then 'unarchived' else 'archived' end);
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    insert into order_events (order_id, actor_name, type)
    values (new.id, actor, case when new.deleted_at is null then 'restored' else 'deleted' end);
  end if;

  if new.order_number     is distinct from old.order_number     then changed := changed || 'order_number'::text; end if;
  if new.customer_name    is distinct from old.customer_name    then changed := changed || 'customer_name'::text; end if;
  if new.customer_phone   is distinct from old.customer_phone   then changed := changed || 'customer_phone'::text; end if;
  if new.entered_at       is distinct from old.entered_at       then changed := changed || 'entered_at'::text; end if;
  if new.description      is distinct from old.description      then changed := changed || 'description'::text; end if;
  if new.source           is distinct from old.source           then changed := changed || 'source'::text; end if;
  if new.notes            is distinct from old.notes            then changed := changed || 'notes'::text; end if;
  if new.cost_lior        is distinct from old.cost_lior        then changed := changed || 'cost_lior'::text; end if;
  if new.cost_diamonds    is distinct from old.cost_diamonds    then changed := changed || 'cost_diamonds'::text; end if;
  if new.sale_price       is distinct from old.sale_price       then changed := changed || 'sale_price'::text; end if;
  if new.payment1_amount  is distinct from old.payment1_amount
     or new.payment1_method is distinct from old.payment1_method
     or new.payment1_invoice is distinct from old.payment1_invoice then changed := changed || 'payment1'::text; end if;
  if old.payment2_amount is not null and (
        new.payment2_amount  is distinct from old.payment2_amount
     or new.payment2_method  is distinct from old.payment2_method
     or new.payment2_invoice is distinct from old.payment2_invoice) then changed := changed || 'payment2'::text; end if;

  if new.stones_inserted    is distinct from old.stones_inserted    then ck := ck || jsonb_build_object('stones_inserted', new.stones_inserted); end if;
  if new.stones_not_needed  is distinct from old.stones_not_needed  then ck := ck || jsonb_build_object('stones_not_needed', new.stones_not_needed); end if;
  if new.check_jewelry      is distinct from old.check_jewelry      then ck := ck || jsonb_build_object('check_jewelry', new.check_jewelry); end if;
  if new.check_sizes        is distinct from old.check_sizes        then ck := ck || jsonb_build_object('check_sizes', new.check_sizes); end if;
  if new.check_gold_color   is distinct from old.check_gold_color   then ck := ck || jsonb_build_object('check_gold_color', new.check_gold_color); end if;
  if new.pickup_coordinated is distinct from old.pickup_coordinated then ck := ck || jsonb_build_object('pickup_coordinated', new.pickup_coordinated); end if;
  if ck <> '{}'::jsonb then
    insert into order_events (order_id, actor_name, type, details) values (new.id, actor, 'checklist', ck);
  end if;

  if array_length(changed, 1) > 0 then
    insert into order_events (order_id, actor_name, type, details)
    values (new.id, actor, 'edit', jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return null;
end;
$$;

drop trigger if exists orders_log on public.orders;
create trigger orders_log
  after insert or update on public.orders
  for each row execute function public.orders_log();

-- =====================================================================
-- הרשאות: רק משתמשים מחוברים. אין גישה לאורחים.
-- =====================================================================
alter table public.orders       enable row level security;
alter table public.order_events enable row level security;
alter table public.settings     enable row level security;
alter table public.holidays     enable row level security;

revoke all on public.orders, public.order_events, public.settings, public.holidays from anon;
grant select, insert, update, delete on public.orders   to authenticated;
grant select                         on public.order_events to authenticated;
grant select, update                 on public.settings to authenticated;
grant select, insert, update, delete on public.holidays to authenticated;
grant usage, select on sequence public.order_number_seq to authenticated;
grant all on public.orders, public.order_events, public.settings, public.holidays to service_role;
grant usage, select on sequence public.order_number_seq to service_role;

drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;
create policy orders_select on public.orders for select to authenticated using (true);
create policy orders_insert on public.orders for insert to authenticated with check (true);
create policy orders_update on public.orders for update to authenticated using (true) with check (true);
-- מחיקה לצמיתות אפשרית רק להזמנה שכבר נמצאת בסל המחזור
create policy orders_delete on public.orders for delete to authenticated using (deleted_at is not null);

drop policy if exists events_select on public.order_events;
create policy events_select on public.order_events for select to authenticated using (true);

drop policy if exists settings_select on public.settings;
drop policy if exists settings_update on public.settings;
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (true) with check (true);

drop policy if exists holidays_all on public.holidays;
create policy holidays_all on public.holidays for all to authenticated using (true) with check (true);
-- =====================================================================
-- נתוני פתיחה: חגים 2026-2030 ו-7 ההזמנות מקובץ האקסל
-- בטוח להרצה חוזרת: רשומות קיימות לא ישוכפלו.
-- =====================================================================

insert into public.holidays (day, name) values
  ('2026-04-02', 'פסח'),
  ('2026-04-08', 'שביעי של פסח'),
  ('2026-04-22', 'יום העצמאות'),
  ('2026-05-22', 'שבועות'),
  ('2026-09-12', 'ראש השנה א׳'),
  ('2026-09-13', 'ראש השנה ב׳'),
  ('2026-09-21', 'יום כיפור'),
  ('2026-09-26', 'סוכות'),
  ('2026-10-03', 'שמיני עצרת / שמחת תורה'),
  ('2027-04-22', 'פסח'),
  ('2027-04-28', 'שביעי של פסח'),
  ('2027-05-12', 'יום העצמאות'),
  ('2027-06-11', 'שבועות'),
  ('2027-10-02', 'ראש השנה א׳'),
  ('2027-10-03', 'ראש השנה ב׳'),
  ('2027-10-11', 'יום כיפור'),
  ('2027-10-16', 'סוכות'),
  ('2027-10-23', 'שמיני עצרת / שמחת תורה'),
  ('2028-04-11', 'פסח'),
  ('2028-04-17', 'שביעי של פסח'),
  ('2028-05-02', 'יום העצמאות'),
  ('2028-05-31', 'שבועות'),
  ('2028-09-21', 'ראש השנה א׳'),
  ('2028-09-22', 'ראש השנה ב׳'),
  ('2028-09-30', 'יום כיפור'),
  ('2028-10-05', 'סוכות'),
  ('2028-10-12', 'שמיני עצרת / שמחת תורה'),
  ('2029-03-31', 'פסח'),
  ('2029-04-06', 'שביעי של פסח'),
  ('2029-04-19', 'יום העצמאות'),
  ('2029-05-20', 'שבועות'),
  ('2029-09-10', 'ראש השנה א׳'),
  ('2029-09-11', 'ראש השנה ב׳'),
  ('2029-09-19', 'יום כיפור'),
  ('2029-09-24', 'סוכות'),
  ('2029-10-01', 'שמיני עצרת / שמחת תורה'),
  ('2030-04-18', 'פסח'),
  ('2030-04-24', 'שביעי של פסח'),
  ('2030-05-08', 'יום העצמאות'),
  ('2030-06-07', 'שבועות'),
  ('2030-09-28', 'ראש השנה א׳'),
  ('2030-09-29', 'ראש השנה ב׳'),
  ('2030-10-07', 'יום כיפור'),
  ('2030-10-12', 'סוכות'),
  ('2030-10-19', 'שמיני עצרת / שמחת תורה')
on conflict (day) do nothing;

insert into public.orders (order_number, entered_at, customer_name, description, sale_price, legacy_payment_note, notes, source, is_import, created_by_name, updated_by_name) values
  (2715, '2026-10-04', 'טלי צורבל', 'זוג עגילים 0.30 + 0.15 בודד
אלגריסי 0.30 *2
בודד 0.15 * 1 - אלגריסי', 2000.0, '2000 בהעברה', null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2716, '2026-10-04', 'ליהיא קלוו', 'תיקון מידה לטבעת', 0, null, null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2717, '2026-10-04', 'ניצן שטיינברג', 'שרשרת MOM בלי לב + צארם אות L', 4100.0, 'שילם 2050 במורנינג', null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2718, '2026-10-04', 'לוסי', 'צמיד טניס תיקון', 0, null, null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2719, '2026-10-05', 'בת שבע', 'עגילי פסים', 0, null, null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2720, '2026-10-05', 'בת שבע', 'שיבוץ אבן בטבעת', 0, null, null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל'),
  (2721, '2026-10-05', 'ורד שרון', 'הוספת אות R', 1600.0, 'שולם באשראי', null, null, true, 'ייבוא מאקסל', 'ייבוא מאקסל')
on conflict (order_number) do nothing;

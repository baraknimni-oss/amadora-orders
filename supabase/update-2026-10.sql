-- =====================================================================
-- AMADORA · עדכון אוקטובר 2026: בדיקות שלב, חשבונית חובה, ימים במפעל
-- להרצה פעם אחת ב-Supabase: SQL Editor -> New query -> הדבקה -> Run
-- בטוח להרצה חוזרת. לא מוחק ולא משנה נתונים קיימים (מלבד מילוי תאריך כניסה למפעל
-- להזמנות שנמצאות כרגע במפעל).
-- =====================================================================

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

-- ---------- כללי העבודה המעודכנים ----------
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

-- ---------- רישום היסטוריה (כולל סימוני בדיקות) ----------
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

-- ---------- הזמנות שכבר נמצאות במפעל: מאיזה יום לספור ----------
-- לפי מועד הכניסה האחרון לסטטוס "מפעל" מתוך ההיסטוריה, ואם אין - מועד שינוי הסטטוס האחרון.
update public.orders o
set factory_started_at = coalesce(
  (select max(e.at) from public.order_events e
    where e.order_id = o.id and e.type in ('status', 'created') and e.to_status = 'factory'),
  o.status_changed_at, now())
where o.status = 'factory' and o.factory_started_at is null;

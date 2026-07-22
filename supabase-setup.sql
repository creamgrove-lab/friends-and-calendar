-- 妳想約約ㄇ / 關於我的行事曆-2
-- Supabase setup for: friends no login, admin login only.
-- 使用方式：
-- 1. 先在 Supabase Authentication 建立妳自己的管理者帳號。
-- 2. 把下面 ADMIN EMAIL 那一行改成妳登入 Supabase Auth 用的 email。
-- 3. 到 Supabase > SQL Editor > New query，整份貼上後按 Run。

create extension if not exists pgcrypto;

-- 管理者名單：朋友不用帳號，只有這裡列出的 email 可以管理後台資料。
create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

-- ADMIN EMAIL: 請把 your-email@example.com 改成妳自己的管理者 email。
insert into public.admin_emails (email)
values ('milyss.studio@gmail.com')
on conflict (email) do nothing;

-- 後台可編輯的首頁文字、how it works 留言板等設定。
create table if not exists public.app_settings (
  id text primary key default 'main' check (id = 'main'),
  hero_eyebrow text not null default 'for close friends',
  hero_title text not null default '妳想約約ㄇ',
  hero_body text not null default '看看我哪天有空。點綠色日期就可以送出預約申請。',
  how_kicker text not null default 'how it works',
  how_title text not null default '怎麼使用',
  how_body text not null default '點綠色日期，填小窗送出預約。\n我同意後，行事曆會同步更新。\n已同意的時段不能重複申請。',
  how_visible boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values ('main')
on conflict (id) do nothing;

-- 邀約類型：後台可新增/編輯/刪除。
create table if not exists public.activity_types (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  label text not null,
  short_label text not null default '邀約',
  blocks integer not null default 1 check (blocks > 0),
  reply_template text not null default '{name}，我收到你的邀約了。',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.activity_types (code, label, short_label, blocks, reply_template, sort_order)
values
  ('overnight1', '申請過1夜', '過夜', 24, '{name}，我同意囉！{date} {time} 可以過夜。', 10),
  ('overnight2', '申請過2夜', '過夜', 48, '{name}，我同意囉！{date} {time} 可以過2夜。', 20),
  ('live3', '申請同居3夜', '同居', 72, '{name}，我同意囉！{date} {time} 可以同居3夜。', 30),
  ('liveweek', '申請同居1周', '同居', 168, '{name}，我同意囉！{date} {time} 可以同居1周。', 40),
  ('kidnap', '申請綁架妳', '綁架', 6, '{name}，綁架申請先通過，我們再細談。', 50),
  ('meal', '女人跟我吃飯', '吃飯', 2, '{name}，可以吃飯！{date} {time} 見。', 60),
  ('outing', '女人跟我走', '出門', 4, '{name}，可以出門！我先留 {date} {time}。', 70),
  ('game', '女人打game', 'game', 3, '{name}，可以打 game！{date} {time} 開局。', 80),
  ('chat', '女人咱們聊聊', '聊聊', 2, '{name}，可以聊聊，我先留 {date} {time}。', 90),
  ('note', '我要說悄悄話', '有留言', 1, '{name}，我收到你的悄悄話了。', 100)
on conflict (code) do nothing;

-- 公開月曆日期設定：妳在後台設定哪天請約我 / busy / 自填狀態。
create table if not exists public.calendar_days (
  date date primary key,
  status text not null default 'closed' check (status in ('open', 'partial', 'pending', 'booked', 'closed', 'note')),
  memo text not null default '',
  public_status text not null default '',
  public_event text not null default '',
  public_request text not null default '',
  public_remaining text not null default '',
  available_times text[] not null default '{}',
  request_sync_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 朋友送出的邀約申請：朋友免登入，只填名字即可送出。
create table if not exists public.invite_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  activity_type_id uuid references public.activity_types(id) on delete set null,
  activity_code text,
  request_date date not null,
  start_time time,
  end_time time,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'change', 'declined', 'done')),
  admin_note text not null default '',
  reply_draft text not null default '',
  sent_status text not null default 'pending',
  sent_reply text not null default '',
  sent_admin_note text not null default '',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email 通知紀錄：Edge Function 寄信後會寫入，方便之後檢查有沒有通知成功。
create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  invite_request_id uuid references public.invite_requests(id) on delete cascade,
  channel text not null default 'email',
  recipient text not null,
  status text not null check (status in ('sent', 'failed')),
  provider text not null default 'resend',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists notification_logs_request_idx on public.notification_logs(invite_request_id);
create index if not exists notification_logs_created_idx on public.notification_logs(created_at);
create index if not exists calendar_days_date_idx on public.calendar_days(date);
create index if not exists invite_requests_date_idx on public.invite_requests(request_date);
create index if not exists invite_requests_status_idx on public.invite_requests(status);
create index if not exists activity_types_sort_idx on public.activity_types(sort_order);

-- updated_at 自動更新。
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_app_settings_updated_at on public.app_settings;
create trigger touch_app_settings_updated_at
before update on public.app_settings
for each row execute function public.touch_updated_at();

drop trigger if exists touch_activity_types_updated_at on public.activity_types;
create trigger touch_activity_types_updated_at
before update on public.activity_types
for each row execute function public.touch_updated_at();

drop trigger if exists touch_calendar_days_updated_at on public.calendar_days;
create trigger touch_calendar_days_updated_at
before update on public.calendar_days
for each row execute function public.touch_updated_at();

drop trigger if exists touch_invite_requests_updated_at on public.invite_requests;
create trigger touch_invite_requests_updated_at
before update on public.invite_requests
for each row execute function public.touch_updated_at();

-- 判斷目前登入者是否為管理者。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 開啟 Row Level Security。
alter table public.admin_emails enable row level security;
alter table public.app_settings enable row level security;
alter table public.activity_types enable row level security;
alter table public.calendar_days enable row level security;
alter table public.invite_requests enable row level security;
alter table public.notification_logs enable row level security;

-- 重新建立 policy，避免重複貼上時出錯。
drop policy if exists "admin can read admin emails" on public.admin_emails;
drop policy if exists "admin can manage admin emails" on public.admin_emails;
drop policy if exists "public can read app settings" on public.app_settings;
drop policy if exists "admin can manage app settings" on public.app_settings;
drop policy if exists "public can read active activity types" on public.activity_types;
drop policy if exists "admin can manage activity types" on public.activity_types;
drop policy if exists "public can read calendar days" on public.calendar_days;
drop policy if exists "admin can manage calendar days" on public.calendar_days;
drop policy if exists "public can create invite requests" on public.invite_requests;
drop policy if exists "admin can read invite requests" on public.invite_requests;
drop policy if exists "admin can manage invite requests" on public.invite_requests;
drop policy if exists "admin can read notification logs" on public.notification_logs;
drop policy if exists "admin can manage notification logs" on public.notification_logs;

-- admin_emails：只有管理者可看/管理。
create policy "admin can read admin emails"
on public.admin_emails for select
using (public.is_admin());

create policy "admin can manage admin emails"
on public.admin_emails for all
using (public.is_admin())
with check (public.is_admin());

-- app_settings：朋友可讀公開文字；只有管理者可改。
create policy "public can read app settings"
on public.app_settings for select
using (true);

create policy "admin can manage app settings"
on public.app_settings for all
using (public.is_admin())
with check (public.is_admin());

-- activity_types：朋友只看 active；管理者可管理全部。
create policy "public can read active activity types"
on public.activity_types for select
using (active = true or public.is_admin());

create policy "admin can manage activity types"
on public.activity_types for all
using (public.is_admin())
with check (public.is_admin());

-- calendar_days：朋友可看公開月曆；只有管理者可改。
create policy "public can read calendar days"
on public.calendar_days for select
using (true);

create policy "admin can manage calendar days"
on public.calendar_days for all
using (public.is_admin())
with check (public.is_admin());

-- invite_requests：朋友免登入可新增 pending 申請；只有管理者可讀取和審核。
create policy "public can create invite requests"
on public.invite_requests for insert
with check (
  status = 'pending'
  and coalesce(name, '') <> ''
  and request_date is not null
);

create policy "admin can read invite requests"
on public.invite_requests for select
using (public.is_admin());

create policy "admin can manage invite requests"
on public.invite_requests for all
using (public.is_admin())
with check (public.is_admin());



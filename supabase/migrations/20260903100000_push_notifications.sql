-- Web push: one row per browser subscription, plus a tiny settings table that
-- holds the server's VAPID key pair so no extra environment variables are
-- needed. Browser clients never touch these tables directly.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  game_code text not null,
  player_id text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_game_player_idx
  on public.push_subscriptions (game_code, player_id);

alter table public.app_settings enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.app_settings to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

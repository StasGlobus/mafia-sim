-- Durable server-owned state for scheduled Mafia games.
-- Browser clients never access these tables directly; Vercel uses a Supabase
-- secret key, while RLS and revoked public grants block anonymous access.

create table if not exists public.live_games (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  state jsonb not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_game_events (
  id bigint generated always as identity primary key,
  game_code text not null references public.live_games(code) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists live_game_events_game_code_created_at_idx
  on public.live_game_events (game_code, created_at);

create or replace function public.set_live_games_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists live_games_set_updated_at on public.live_games;
create trigger live_games_set_updated_at
before update on public.live_games
for each row
execute function public.set_live_games_updated_at();

alter table public.live_games enable row level security;
alter table public.live_game_events enable row level security;

revoke all on table public.live_games from anon, authenticated;
revoke all on table public.live_game_events from anon, authenticated;
grant select, insert, update, delete on table public.live_games to service_role;
grant select, insert, update, delete on table public.live_game_events to service_role;
grant usage, select on sequence public.live_game_events_id_seq to service_role;

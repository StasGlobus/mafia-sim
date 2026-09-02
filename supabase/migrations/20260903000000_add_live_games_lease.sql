-- A short lease lets exactly one request run the agent engine for a game at a
-- time. Parallel polls from several players skip the work instead of
-- generating the same agent messages twice.

alter table public.live_games
  add column if not exists lease_until timestamptz;

create index if not exists live_games_running_idx
  on public.live_games ((state->>'status'));

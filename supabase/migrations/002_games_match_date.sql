alter table if exists public.games
  add column if not exists match_date date;

create index if not exists idx_games_match_date on public.games(match_date);

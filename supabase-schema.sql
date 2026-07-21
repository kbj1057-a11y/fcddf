-- FC어울림 초기 DB 스키마
-- Supabase → SQL Editor 에서 전체 복사 후 Run 하세요

-- 1. 선수 명단
create table if not exists players (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone_last4 text not null,
  phone_full text,
  is_guest boolean default false,
  tier text not null check (tier in ('S','A','B','C')),
  preferred_position text check (preferred_position in ('FW','MF','DF','GK')),
  created_at timestamp default now()
);

-- 2. 출석 기록
create table if not exists attendance (
  id uuid default gen_random_uuid() primary key,
  match_date date not null,
  player_id uuid not null references players(id),
  arrival_time timestamp not null default now(),
  status text not null check (status in ('ATTENDING','EARLY_EXIT','ABSENT')),
  exit_time timestamp,
  unique(match_date, player_id)
);

-- 3. 경기 정보
create table if not exists games (
  id uuid default gen_random_uuid() primary key,
  played_at timestamp not null default now(),
  label text,
  status text not null default 'COMPLETED',
  created_at timestamp default now()
);

-- 4. 쿼터(1~4쿼터)
create table if not exists match_quarters (
  id uuid default gen_random_uuid() primary key,
  match_date date not null,
  quarter_number integer not null check (quarter_number between 1 and 4),
  status text not null default 'COMPLETED',
  started_at timestamp,
  ended_at timestamp,
  unique(match_date, quarter_number)
);

-- 5. 라인업
create table if not exists quarter_lineups (
  id uuid default gen_random_uuid() primary key,
  quarter_id uuid not null references match_quarters(id),
  player_id uuid not null references players(id),
  team text not null check (team in ('A','B','BENCH')),
  position text,
  is_gk boolean default false,
  played_minutes integer default 12
);

-- 6. (선택) 인덱스: 날짜 조회 속도 향상
create index if not exists idx_attendance_match_date on attendance(match_date);
create index if not exists idx_match_quarters_match_date on match_quarters(match_date);
create index if not exists idx_quarter_lineups_quarter_id on quarter_lineups(quarter_id);
create index if not exists idx_quarter_lineups_player_id on quarter_lineups(player_id);

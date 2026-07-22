-- 백업 테이블 3개 생성
create table if not exists public.games_backup as
select *, now() as backup_at
from public.games with no data;

create table if not exists public.match_quarters_backup as
select *, now() as backup_at
from public.match_quarters with no data;

create table if not exists public.quarter_lineups_backup as
select *, now() as backup_at
from public.quarter_lineups with no data;

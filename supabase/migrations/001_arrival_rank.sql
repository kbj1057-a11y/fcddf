-- Migration: remove preferred_position, add arrival_rank to attendance

-- Remove preferred_position column
alter table players drop column if exists preferred_position;

-- Add arrival_rank for 출석 순서
alter table attendance add column if not exists arrival_rank integer;
create index if not exists idx_attendance_arrival_rank on attendance(match_date, arrival_rank);

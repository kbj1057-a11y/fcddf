import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Player = {
  id: string;
  name: string;
  phone_last4: string;
  phone_full?: string | null;
  is_guest: boolean;
  tier: "S" | "A" | "B" | "C";
  created_at: string;
};

export type Attendance = {
  id: string;
  match_date: string;
  player_id: string;
  arrival_time: string;
  status: "ATTENDING" | "EARLY_EXIT" | "ABSENT";
  exit_time: string | null;
  arrival_rank: number | null;
};

export type MatchQuarter = {
  id: string;
  match_date: string;
  quarter_number: number;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED";
  started_at: string | null;
  ended_at: string | null;
};

export type QuarterLineup = {
  id: string;
  quarter_id: string;
  player_id: string;
  team: "A" | "B" | "BENCH";
  position: string | null;
  is_gk: boolean;
  played_minutes: number;
  referee: boolean;
  assistant_referee: boolean;
};

export type Game = {
  id: string;
  played_at: string;
  label: string | null;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED";
  created_at: string;
};

export type RoleType = "player" | "gk" | "referee" | "assistant_referee";

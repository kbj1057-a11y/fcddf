import { create } from "zustand";
import type { Player, Attendance, Game } from "../lib/supabase";

export type MatchStore = {
  matchDate: string;
  setMatchDate: (matchDate: string) => void;
  gameLabel: string;
  setGameLabel: (gameLabel: string) => void;
  players: Player[];
  setPlayers: (players: Player[]) => void;
  attendances: Attendance[];
  setAttendances: (attendances: Attendance[]) => void;
  lineups: LineupMap;
  setLineups: (lineups: LineupMap) => void;
  games: Game[];
  setGames: (games: Game[]) => void;
  activeGame?: Game;
  setActiveGame: (activeGame?: Game) => void;
};

export type LineupMap = Record<string, "A" | "B" | "BENCH">;

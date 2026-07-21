"use client";

import { useState } from "react";
import { Button, Stack, Text, Title, Group, SimpleGrid, Box } from "@mantine/core";
import { supabase } from "@/lib/supabase";
import type { Player, Attendance, Game } from "@/lib/supabase";

type Step = "ATTENDANCE" | "LINEUP" | "CONFIRM";

export default function MatchControl() {
  const [matchDate, setMatchDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [gameLabel, setGameLabel] = useState("1");
  const [step, setStep] = useState<Step>("ATTENDANCE");
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [lineups, setLineups] = useState<Record<string, "A" | "B" | "BENCH">>({});
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGame] = useState<Game | null>(null);

  const loadPlayers = async () => {
    setLoading(true);
    const { data } = await supabase.from("players").select("*").order("name");
    setPlayers(data || []);
    setLoading(false);
  };

  const markAttendance = async (playerId: string, status: Attendance["status"]) => {
    await supabase
      .from("attendance")
      .upsert({ match_date: matchDate, player_id: playerId, status }, { onConflict: "match_date,player_id" });
    setAttendances((prev) => {
      const next = prev.filter((a) => a.player_id !== playerId);
      return [
        ...next,
        { id: playerId, match_date: matchDate, player_id: playerId, arrival_time: new Date().toISOString(), status, exit_time: null } as Attendance,
      ];
    });
  };

  const saveGame = async () => {
    setLoading(true);
    try {
      const { data: game, error: gameErr } = await supabase
        .from("games")
        .insert({ played_at: new Date().toISOString(), label: gameLabel, status: "COMPLETED" })
        .select()
        .single();
      if (gameErr) { console.error("games insert", gameErr); alert("게임 저장 실패: " + gameErr.message); setLoading(false); return; }
      if (!game) { console.error("games insert no data"); setLoading(false); return; }
      const gameId = game.id;
      const quarterIds: string[] = [];

      for (let q = 1; q <= 4; q++) {
        const { data: quarter, error: qErr } = await supabase
          .from("match_quarters")
          .insert({ match_date: matchDate, quarter_number: q, status: "COMPLETED" })
          .select()
          .single();
        if (qErr) { console.error(`match_quarters insert q=${q}`, qErr); alert(`쿼터${q} 저장 실패: ${qErr.message}`); setLoading(false); return; }
        if (!quarter) { console.error(`match_quarters insert q=${q} no data`); setLoading(false); return; }
        quarterIds.push(quarter.id);

        const rows = Object.entries(lineups).map(([playerId, team]) => ({
          quarter_id: quarter.id,
          player_id: playerId,
          team,
          position: team === "BENCH" ? "BENCH" : null,
          is_gk: false,
          played_minutes: team === "BENCH" ? 0 : 12,
        }));
        const { error: qlErr } = await supabase.from("quarter_lineups").insert(rows);
        if (qlErr) { console.error(`quarter_lineups insert q=${q}`, qlErr); alert(`라인업${q} 저장 실패: ${qlErr.message}`); setLoading(false); return; }
      }

      setGames((prev) => [...prev, game]);
      setActiveGame(game);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <Title order={2}>FC어울림 매치 컨트롤</Title>
      <Group gap="sm" wrap="wrap">
        <input
          type="date"
          value={matchDate}
          onChange={(e) => setMatchDate(e.target.value)}
          className="border rounded px-3 py-3 text-black"
        />
        <input
          type="text"
          value={gameLabel}
          onChange={(e) => setGameLabel(e.target.value)}
          placeholder="게임번호"
          className="border rounded px-3 py-3 text-black w-24"
        />
        <Button onClick={loadPlayers} disabled={loading} size="lg">
          선수 불러오기
        </Button>
      </Group>

      <Box>
        <Button variant="light" color="gray" onClick={() => setStep("ATTENDANCE")}>
          출석
        </Button>
        <Button variant="light" color="gray" onClick={() => setStep("LINEUP")}>
          라인업
        </Button>
        <Button variant="light" color="gray" onClick={() => setStep("CONFIRM")}>
          확정
        </Button>
      </Box>

      {step === "ATTENDANCE" && (
        <Stack gap="sm">
          <Title order={3}>출석 체크</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {players.map((p) => {
              const att = attendances.find((a) => a.player_id === p.id);
              return (
                <Group key={p.id} justify="space-between" className="border rounded p-3">
                  <Text>{p.name}</Text>
                  <Group gap="xs">
                    <Button size="xs" color={att?.status === "ATTENDING" ? "green" : "gray"} onClick={() => markAttendance(p.id, "ATTENDING")}>
                      참가
                    </Button>
                    <Button size="xs" color={att?.status === "ABSENT" ? "red" : "gray"} onClick={() => markAttendance(p.id, "ABSENT")}>
                      결석
                    </Button>
                  </Group>
                </Group>
              );
            })}
          </SimpleGrid>
        </Stack>
      )}

      {step === "LINEUP" && (
        <Stack gap="sm">
          <Title order={3}>라인업</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {players.map((p) => (
              <Group key={p.id} justify="space-between" className="border rounded p-3">
                <Text>{p.name}</Text>
                <select
                  value={lineups[p.id] || "BENCH"}
                  onChange={(e) => setLineups((prev) => ({ ...prev, [p.id]: e.target.value as "A" | "B" | "BENCH" }))}
                  className="border rounded px-2 py-2 text-black"
                >
                  <option value="A">A팀</option>
                  <option value="B">B팀</option>
                  <option value="BENCH">벤치</option>
                </select>
              </Group>
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {step === "CONFIRM" && (
        <Stack gap="sm">
          <Title order={3}>확정 및 저장</Title>
          <Text>게임: {gameLabel}</Text>
          <Button size="xl" color="green" onClick={saveGame} disabled={loading}>
            {loading ? "저장 중..." : "1게임 확정 저장"}
          </Button>
          <Group gap="sm">
            <Button variant="light" onClick={async () => {
              setLoading(true);
              const { data } = await supabase.from("games").select("*").order("played_at", { ascending: false });
              setGames(data || []);
              setLoading(false);
            }}>오늘 하루 보기</Button>
          </Group>
          <Stack gap="xs">
            {games.map((g) => (
              <Text key={g.id}>{g.label} - {g.status}</Text>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

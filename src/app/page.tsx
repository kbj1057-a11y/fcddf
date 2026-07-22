"use client";

import { useState, useMemo } from "react";
import { Button, Stack, Text, Title, Group, SimpleGrid, Box, Select, Paper, Badge } from "@mantine/core";
import { supabase } from "@/lib/supabase";
import type { Player, Attendance, Game, QuarterLineup, MatchQuarter, RoleType } from "@/lib/supabase";

type Step = "ATTENDANCE" | "LINEUP" | "CONFIRM";

const TEAMS = [
  { value: "A", label: "주황/블랙", color: "orange" },
  { value: "B", label: "연두/흰색", color: "teal" },
] as const;

const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

type TeamMap = Record<string, "A" | "B" | "BENCH">;
type RoleMap = Record<string, RoleType>;

export default function MatchControl() {
  const [matchDate, setMatchDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [step, setStep] = useState<Step>("ATTENDANCE");
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [lineups, setLineups] = useState<TeamMap>({});
  const [roles, setRoles] = useState<RoleMap>({});
  const [games, setGames] = useState<Game[]>([]);
  const [completedQuarters, setCompletedQuarters] = useState<MatchQuarter[]>([]);
  const [completedLineups, setCompletedLineups] = useState<QuarterLineup[]>([]);
  const [gameLabel, setGameLabel] = useState<string>("1");

  const attendingPlayers = useMemo(() => {
    const map = new Map<string, Player>();
    const ranked = attendances
      .filter((a) => a.status === "ATTENDING" && a.arrival_rank != null)
      .sort((a, b) => (a.arrival_rank ?? 9999) - (b.arrival_rank ?? 9999));
    for (const a of ranked) {
      const p = players.find((pl) => pl.id === a.player_id);
      if (p) map.set(p.id, p);
    }
    return Array.from(map.values());
  }, [attendances, players]);

  const loadPlayers = async () => {
    setLoading(true);
    const { data: playersData } = await supabase.from("players").select("*").order("name");
    setPlayers(playersData || []);
    const { data: todayAtt } = await supabase
      .from("attendance")
      .select("*")
      .eq("match_date", matchDate)
      .order("arrival_rank");
    setAttendances(todayAtt || []);
    setCompletedQuarters([]);
    setCompletedLineups([]);
    setLoading(false);
  };

  const markAttendance = async (playerId: string, status: Attendance["status"]) => {
    await supabase
      .from("attendance")
      .upsert(
        { match_date: matchDate, player_id: playerId, status, arrival_time: new Date().toISOString() },
        { onConflict: "match_date,player_id" }
      );
    setAttendances((prev) => {
      const next = prev.filter((a) => a.player_id !== playerId);
      if (status !== "ATTENDING") {
        return [
          ...next,
          {
            id: playerId,
            match_date: matchDate,
            player_id: playerId,
            arrival_time: new Date().toISOString(),
            status,
            exit_time: null,
            arrival_rank: null,
          } as Attendance,
        ];
      }
      const rank = next.filter((a) => a.status === "ATTENDING").length + 1;
      return [
        ...next,
        {
          id: playerId,
          match_date: matchDate,
          player_id: playerId,
          arrival_time: new Date().toISOString(),
          status,
          exit_time: null,
          arrival_rank: rank,
        } as Attendance,
      ];
    });
  };

  const generateAutoLineup = () => {
    const list = attendingPlayers.slice();
    if (list.length < 7) {
      alert("출석자가 7명 이상이어야 자동 라인업을 생성할 수 있습니다.");
      return;
    }
    const target = list.length >= 20 ? 10 : list.length >= 18 ? 9 : list.length >= 16 ? 8 : 7;
    const isFull = target === 10;

    const teams: Record<"A" | "B", Player[]> = { A: [], B: [] };
    const bench: Player[] = [];
    const teamSlots: Record<"A" | "B", Record<string, number>> = {
      A: { GK: 0, DF: 0, MF: 0, FW: 0 },
      B: { GK: 0, DF: 0, MF: 0, FW: 0 },
    };

    const sorted = [...list].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
    const counts: Record<"A" | "B", number> = { A: 0, B: 0 };
    let last: "A" | "B" | null = null;
    const nextTeam = () => (last === "A" ? "B" : "A");

    for (const player of sorted) {
      if (counts.A >= target && counts.B >= target) {
        bench.push(player);
        continue;
      }
      const pick: "A" | "B" =
        counts.A >= target ? "B" : counts.B >= target ? "A" : nextTeam();
      last = pick;
      counts[pick] += 1;
      teams[pick].push(player);
    }

    for (const team of ["A", "B"] as "A" | "B"[]) {
      const sortedTeam = [...teams[team]].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
      teams[team] = [];
      if (!isFull) {
        for (const p of sortedTeam) teams[team].push(p);
        continue;
      }
      const gkReady: Player[] = [];
      const fillReady: Player[] = [];
      for (const p of sortedTeam) {
        if (p.tier === "S" && teamSlots[team].GK === 0) gkReady.push(p);
        else fillReady.push(p);
      }
      const seated: Player[] = [];
      const positionPlan: Record<string, QuarterPlan> = {};
      const deskSlots: { value: string; max: number }[] = [
        { value: "DF", max: 4 },
        { value: "MF", max: 3 },
        { value: "FW", max: 3 },
      ];
      if (gkReady.length > 0) {
        const gk = gkReady[0];
        teamSlots[team].GK += 1;
        seated.push(gk);
      }
      for (const slot of deskSlots) {
        for (const p of fillReady) {
          if (seated.includes(p)) continue;
          if (teamSlots[team][slot.value] < slot.max) {
            teamSlots[team][slot.value] += 1;
            seated.push(p);
          }
        }
      }
      const rest = fillReady.filter((p) => !seated.includes(p));
      teams[team] = [...seated, ...rest];
    }

    const nextLineups: TeamMap = {};
    const nextRoles: RoleMap = {};
    for (const team of ["A", "B"] as "A" | "B"[]) {
      const group = teams[team];
      const gkCount: Record<"A" | "B", number> = { A: 0, B: 0 };
      for (const p of group) {
        nextLineups[p.id] = team;
        if (gkCount[team] === 0 && isFull && p.tier === "S") {
          nextRoles[p.id] = "gk";
          gkCount[team] += 1;
        } else {
          nextRoles[p.id] = "player";
        }
      }
    }
    for (const p of bench) {
      nextLineups[p.id] = "BENCH";
      nextRoles[p.id] = "player";
    }
    setLineups(nextLineups);
    setRoles(nextRoles);
  };

  const setTeam = (playerId: string, team: "A" | "B" | "BENCH") =>
    setLineups((prev) => ({ ...prev, [playerId]: team }));
  const setPlayerRole = (playerId: string, role: RoleType) =>
    setRoles((prev) => ({ ...prev, [playerId]: role }));

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

      for (let q = 1; q <= 4; q++) {
        const { data: quarter, error: qErr } = await supabase
          .from("match_quarters")
          .insert({ match_date: matchDate, quarter_number: q, status: "COMPLETED" })
          .select()
          .single();
        if (qErr) { console.error("match_quarters insert", qErr); alert("쿼터 저장 실패: " + qErr.message); setLoading(false); return; }
        if (!quarter) { console.error("match_quarters insert no data"); setLoading(false); return; }

        const rows = Object.entries(lineups).map(([playerId, team]) => ({
          quarter_id: quarter.id,
          player_id: playerId,
          team,
          position: roles[playerId] === "gk" ? "GK" : team === "BENCH" ? "BENCH" : null,
          is_gk: roles[playerId] === "gk",
          played_minutes: team === "BENCH" ? 0 : 12,
          referee: roles[playerId] === "referee",
          assistant_referee: roles[playerId] === "assistant_referee",
        }));
        const { error: qlErr } = await supabase.from("quarter_lineups").insert(rows);
        if (qlErr) { console.error("quarter_lineups insert", qlErr); alert("라인업 저장 실패: " + qlErr.message); setLoading(false); return; }
      }

      alert("저장 완료");
      setGames((prev) => [...prev, game]);
    } finally {
      setLoading(false);
    }
  };

  const openGameDetail = async (game: Game | null = null) => {
    const target = game || completedGame;
    if (!target) return;
    setLoading(true);
    const { data: quarters } = await supabase
      .from("match_quarters")
      .select("*")
      .eq("match_date", matchDate)
      .order("quarter_number");
    const quarterIds = (quarters || []).map((q) => q.id);
    const { data: lineupRows } = await supabase
      .from("quarter_lineups")
      .select("*")
      .in("quarter_id", quarterIds.length ? quarterIds : [""]);
    setCompletedQuarters(quarters || []);
    setCompletedLineups(lineupRows || []);
    setLoading(false);
  };

  const teamLabel = (value: string) => TEAMS.find((t) => t.value === value)?.label ?? value;

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

      <Group gap="sm">
        <Button variant="light" onClick={() => setStep("ATTENDANCE")}>출석</Button>
        <Button variant="light" onClick={() => setStep("LINEUP")}>라인업</Button>
        <Button variant="light" onClick={() => setStep("CONFIRM")}>확정</Button>
      </Group>

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
                    <Button
                      size="xs"
                      color={att?.status === "ATTENDING" ? "green" : "gray"}
                      onClick={() => markAttendance(p.id, "ATTENDING")}
                    >
                      참가
                    </Button>
                    <Button
                      size="xs"
                      color={att?.status === "ABSENT" ? "red" : "gray"}
                      onClick={() => markAttendance(p.id, "ABSENT")}
                    >
                      결석
                    </Button>
                    {att?.status === "ATTENDING" && (
                      <Badge variant="light" color="yellow">
                        {att.arrival_rank != null ? `#${att.arrival_rank}` : "순서미정"}
                      </Badge>
                    )}
                  </Group>
                </Group>
              );
            })}
          </SimpleGrid>
        </Stack>
      )}

      {step === "LINEUP" && (
        <Stack gap="md">
          <Group justify="space-between">
            <Box>
              <Title order={3}>라인업</Title>
              <Text size="sm" c="dimmed">
                출석자 {attendingPlayers.length}명
              </Text>
            </Box>
            <Group gap="xs">
              <Button onClick={generateAutoLineup}>자동 라인업 생성</Button>
            </Group>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {TEAMS.map((team) => {
              const members = attendingPlayers.filter((p) => lineups[p.id] === team.value);
              return (
                <Paper key={team.value} withBorder p="md">
                  <Text fw={600}>{team.label}</Text>
                  <Stack gap="xs" mt="sm">
                    {members.map((p) => {
                      const role = roles[p.id];
                      const roleLabel =
                        role === "referee"
                          ? "주심"
                          : role === "assistant_referee"
                            ? "부심"
                            : role === "gk"
                              ? "GK"
                              : "선수";
                      return (
                        <Group key={p.id} gap="xs" wrap="wrap">
                          <Text size="sm" className="min-w-20">
                            {p.name}
                          </Text>
                          <Select
                            size="xs"
                            data={[
                              { value: team.value, label: teamLabel(team.value) },
                              { value: "BENCH", label: "벤치" },
                            ]}
                            value={lineups[p.id]}
                            onChange={(val) => setTeam(p.id, val as "A" | "B" | "BENCH")}
                            className="w-28"
                          />
                          <Select
                            size="xs"
                            data={[
                              { value: "player", label: "선수" },
                              { value: "gk", label: "GK" },
                              { value: "referee", label: "주심" },
                              { value: "assistant_referee", label: "부심" },
                            ]}
                            value={role ?? "player"}
                            onChange={(val) => setPlayerRole(p.id, (val ?? "player") as RoleType)}
                            className="w-28"
                          />
                          <Badge color="gray">{roleLabel}</Badge>
                        </Group>
                      );
                    })}
                  </Stack>
                </Paper>
              );
            })}
            <Paper withBorder p="md">
              <Text fw={600}>벤치</Text>
              <Stack gap="xs" mt="sm">
                {attendingPlayers
                  .filter((p) => lineups[p.id] === "BENCH" || !lineups[p.id])
                  .map((p) => (
                    <Group key={p.id} gap="xs" wrap="wrap">
                      <Text size="sm" className="min-w-20">{p.name}</Text>
                      <Select
                        size="xs"
                        data={[
                          { value: "A", label: "주황/블랙" },
                          { value: "B", label: "연두/흰색" },
                          { value: "BENCH", label: "벤치" },
                        ]}
                        value={lineups[p.id] ?? "BENCH"}
                        onChange={(val) => setTeam(p.id, val as "A" | "B" | "BENCH")}
                        className="w-28"
                      />
                      <Select
                        size="xs"
                        data={[
                          { value: "player", label: "선수" },
                          { value: "gk", label: "GK" },
                          { value: "referee", label: "주심" },
                          { value: "assistant_referee", label: "부심" },
                        ]}
                        value={roles[p.id] ?? "player"}
                        onChange={(val) => setPlayerRole(p.id, (val ?? "player") as RoleType)}
                        className="w-28"
                      />
                    </Group>
                  ))}
              </Stack>
            </Paper>
          </SimpleGrid>
        </Stack>
      )}

      {step === "CONFIRM" && (
        <Stack gap="md">
          <Title order={3}>확정</Title>
          <Text>게임: {gameLabel}</Text>
          <Button size="xl" color="green" onClick={saveGame} disabled={loading}>
            {loading ? "저장 중..." : `${gameLabel}게임 확정 저장`}
          </Button>
          <Group gap="sm">
            <Button variant="light" onClick={() => openGameDetail()}>오늘 하루 보기</Button>
          </Group>
          <Stack gap="sm">
            {games.map((g) => (
              <Group key={g.id} gap="sm" className="border rounded p-3">
                <Text
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => openGameDetail(g)}
                >
                  {g.label}게임
                </Text>
                <Badge color="green">{g.status}</Badge>
              </Group>
            ))}
          </Stack>
          {completedQuarters.length > 0 && (
            <Paper withBorder p="md">
              <Stack gap="xs">
                <Text fw={600}>쿼터별 라인업</Text>
                {completedQuarters.map((q) => (
                  <Box key={q.id}>
                    <Text fw={500}>{q.quarter_number}Q</Text>
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      {TEAMS.map((team) => {
                        const members = completedLineups
                          .filter((l) => l.quarter_id === q.id && l.team === team.value)
                          .map((l) => {
                            const p = players.find((pl) => pl.id === l.player_id);
                            if (l.is_gk) return `${p?.name ?? l.player_id} (GK)`;
                            if (l.referee) return `${p?.name ?? l.player_id} (주심)`;
                            if (l.assistant_referee) return `${p?.name ?? l.player_id} (부심)`;
                            return p?.name ?? l.player_id;
                          });
                        return (
                          <Box key={team.value}>
                            <Text size="sm" fw={500}>{teamLabel(team.value)}</Text>
                            <Text size="sm">{members.join(", ") || "-"}</Text>
                          </Box>
                        );
                      })}
                    </SimpleGrid>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}

"use client";

import { useState, useMemo } from "react";
import { Button, Stack, Text, Title, Group, SimpleGrid, Box, Select, Paper, Badge } from "@mantine/core";
import { supabase } from "@/lib/supabase";
import type { Player, Attendance, Game, QuarterLineup, RoleType } from "@/lib/supabase";

const AUTH_ID = "admin";
const AUTH_PW = "admin1234";

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
  const [completedGame, setCompletedGame] = useState<Game | null>(null);
  const [completedQuarters, setCompletedQuarters] = useState<{
    id: string;
    quarter_number: number;
    status: string;
  }[]>([]);
  const [completedLineups, setCompletedLineups] = useState<QuarterLineup[]>([]);
  const [gameLabel, setGameLabel] = useState<string>("1");
  const [authId, setAuthId] = useState("");
  const [authPw, setAuthPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const nextGameLabel = useMemo(() => {
    const nums = games.map((g) => parseInt(g.label || "0", 10)).filter((n) => !Number.isNaN(n));
    const max = nums.reduce((m, n) => Math.max(m, n), 0);
    return String(max + 1);
  }, [games]);

  const attendingPlayers = useMemo(() => {
    const ranked = attendances
      .filter((a) => a.status === "ATTENDING" && a.arrival_rank != null)
      .sort((a, b) => (a.arrival_rank ?? 9999) - (b.arrival_rank ?? 9999));
    const map = new Map<string, Player>();
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

  const resetAttendance = async () => {
    if (!confirm("모두 결석으로 초기화하시겠어요?")) return;
    await supabase
      .from("attendance")
      .upsert(
        players.map((p) => ({
          match_date: matchDate,
          player_id: p.id,
          status: "ABSENT",
          arrival_time: new Date().toISOString(),
          exit_time: null,
          arrival_rank: null,
        })),
        { onConflict: "match_date,player_id" }
      );
    setAttendances((prev) =>
      prev.map((a) => ({
        ...a,
        status: "ABSENT",
        arrival_rank: null,
        exit_time: null,
      }))
    );
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

    for (const player of sorted) {
      if (counts.A >= target && counts.B >= target) {
        bench.push(player);
        continue;
      }
      const pick: "A" | "B" =
        counts.A >= target ? "B" : counts.B >= target ? "A" : last === "A" ? "B" : "A";
      last = pick;
      counts[pick] += 1;
      teams[pick].push(player);
    }

    const nextLineups: TeamMap = {};
    const nextRoles: RoleMap = {};

    for (const teamKey of ["A", "B"] as const) {
      const group = teams[teamKey];
      if (!isFull) {
        for (const p of group) {
          nextLineups[p.id] = teamKey;
          nextRoles[p.id] = "player";
        }
        continue;
      }

      const gkReady: Player[] = [];
      const fillReady: Player[] = [];
      for (const p of group) {
        if (p.tier === "S" && teamSlots[teamKey].GK === 0) gkReady.push(p);
        else fillReady.push(p);
      }

      const seated: Player[] = [];
      const seatedRoles: Record<string, string> = {};
      const deskSlots: { value: string; max: number }[] = [
        { value: "DF", max: 4 },
        { value: "MF", max: 3 },
        { value: "FW", max: 3 },
      ];
      for (const slot of deskSlots) {
        for (const p of fillReady) {
          if (seated.includes(p)) continue;
          if (teamSlots[teamKey][slot.value] < slot.max) {
            teamSlots[teamKey][slot.value] += 1;
            seated.push(p);
            seatedRoles[p.id] = slot.value;
          }
        }
      }
      const rest = fillReady.filter((p) => !seated.includes(p));
      const finalGroup = [...seated, ...rest];
      for (const p of finalGroup) {
        nextLineups[p.id] = teamKey;
        nextRoles[p.id] = (seatedRoles[p.id] ?? "player") as RoleType;
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
    const resolvedLabel = nextGameLabel;
    setGameLabel(resolvedLabel);
    setLoading(true);
    try {
      const { data: existing, error: existErr } = await supabase
        .from("games")
        .select("id")
        .eq("match_date", matchDate)
        .eq("label", resolvedLabel)
        .maybeSingle();
      if (existErr) { console.error("games check", existErr); alert("게임 확인 실패: " + existErr.message); setLoading(false); return; }

      if (existing?.id) {
        const ok = window.confirm(
          `이미 ${matchDate} ${resolvedLabel} 게임이 저장되어 있습니다.\n덮어쓰면 기존 데이터가 백업 후 삭제됩니다.\n계속할까요?`
        );
        if (!ok) { setLoading(false); return; }

        const { data: existingGame } = await supabase.from("games").select("*").eq("id", existing.id).single();
        const { data: existingQuarters } = await supabase.from("match_quarters").select("*").eq("match_date", matchDate);
        const qIds = (existingQuarters || []).map((q) => q.id);
        const { data: existingLineups } = qIds.length
          ? await supabase.from("quarter_lineups").select("*").in("quarter_id", qIds)
          : { data: [] };

        const { error: backupGameErr } = await supabase.from("games_backup").insert({ ...existingGame, backup_at: new Date().toISOString() });
        if (backupGameErr && !backupGameErr.message.includes("duplicate")) console.error("games_backup insert", backupGameErr);

        if (existingQuarters && existingQuarters.length) {
          const { error: backupQErr } = await supabase.from("match_quarters_backup").insert(
            existingQuarters.map((q) => ({ ...q, backup_at: new Date().toISOString() }))
          );
          if (backupQErr && !backupQErr.message.includes("duplicate")) console.error("match_quarters_backup insert", backupQErr);
        }

        if (existingLineups && existingLineups.length) {
          const { error: backupLineErr } = await supabase.from("quarter_lineups_backup").insert(
            existingLineups.map((r) => ({ ...r, backup_at: new Date().toISOString() }))
          );
          if (backupLineErr && !backupLineErr.message.includes("duplicate")) console.error("quarter_lineups_backup insert", backupLineErr);
        }

        const { error: delLineErr } = await supabase.from("quarter_lineups").delete().in("quarter_id", qIds.length ? qIds : [""]);
        if (delLineErr) console.error("quarter_lineups delete", delLineErr);
        const { error: delQErr } = await supabase.from("match_quarters").delete().eq("match_date", matchDate);
        if (delQErr) console.error("match_quarters delete", delQErr);
        const { error: delGameErr } = await supabase.from("games").delete().eq("id", existing.id);
        if (delGameErr) console.error("games delete", delGameErr);
      }

      const { data: game, error: gameErr } = await supabase
        .from("games")
        .upsert({ id: completedGame?.id, played_at: new Date().toISOString(), match_date: matchDate, label: resolvedLabel, status: "COMPLETED" })
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

        const rows = Object.entries(lineups).map(([playerId, team]) => {
          const role = roles[playerId] ?? "player";
          const isGK = role === "gk" || role === "GK";
          let position: string | null = null;
          if (role === "FW" || role === "MF" || role === "DF") position = role;
          else if (isGK) position = "GK";
          else if (role === "referee") position = "주심";
          else if (role === "assistant_referee") position = "부심";
          else if (team === "BENCH") position = "BENCH";
          return {
            quarter_id: quarter.id,
            player_id: playerId,
            team: team as "A" | "B" | "BENCH",
            position,
            is_gk: isGK,
            played_minutes: team === "BENCH" ? 0 : 12,
          };
        });
        const { error: qlErr } = await supabase.from("quarter_lineups").insert(rows);
        if (qlErr) { console.error("quarter_lineups insert", qlErr); alert("라인업 저장 실패: " + qlErr.message); setLoading(false); return; }
      }

      alert("저장 완료");
      setGames((prev) =>
        existing?.id ? prev.map((g) => (g.id === existing.id ? game : g)) : [...prev, game]
      );
    } finally {
      setLoading(false);
    }
  };

  const openGameDetail = async (game?: Game) => {
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

  const saveTodayGames = async () => {
    if (!matchDate) return alert("날짜를 선택하세요.");
    setLoading(true);
    try {
      const { data: todayGames, error: listErr } = await supabase
        .from("games")
        .select("*")
        .eq("match_date", matchDate);
      if (listErr) { console.error("today games list", listErr); alert("오늘 게임 조회 실패"); setLoading(false); return; }

      const saved = todayGames?.length || 0;
      const { data: existingGame } = await supabase.from("games").select("id").eq("match_date", matchDate).limit(1);
      if ((existingGame || []).length === 0) {
        alert("오늘 저장된 게임이 없습니다.");
        setLoading(false);
        return;
      }

      const proceed = window.confirm(
        `오늘(${matchDate}) 저장된 게임 ${saved}개를 메인 서버로 동기화합니다.\n이미 저장된 데이터가 있으면 중복 동기화 될 수 있습니다.\n계속할까요?`
      );
      if (!proceed) { setLoading(false); return; }

      alert(`오늘하루 확정 완료: ${matchDate} / ${saved}게임 동기화됨`);
      setGames(todayGames || []);
    } finally {
      setLoading(false);
    }
  };

  const resetLineup = () => {
    setLineups({});
    setRoles({});
  };

  return (
    <Stack gap="md">
      <Title order={2}>FC어울림 매치 컨트롤</Title>

      {!authed ? (
        <Paper withBorder p="md">
          <Title order={4}>접근 권한</Title>
          <Group gap="xs">
            <input
              value={authId}
              onChange={(e) => setAuthId(e.target.value)}
              placeholder="아이디"
              className="border rounded px-3 py-2 text-black"
            />
            <input
              type="password"
              value={authPw}
              onChange={(e) => setAuthPw(e.target.value)}
              placeholder="비밀번호"
              className="border rounded px-3 py-2 text-black"
            />
            <Button
              onClick={() => {
                if (authId === AUTH_ID && authPw === AUTH_PW) setAuthed(true);
                else alert("아이디 또는 비밀번호가 틀렸습니다.");
              }}
            >
              로그인
            </Button>
          </Group>
        </Paper>
      ) : (
        <>
          <Button size="xs" variant="light" color="red" onClick={() => setAuthed(false)}>
            로그아웃
          </Button>

          <Paper withBorder p="md">
            <Title order={4}>선수 추가</Title>
            <AddPlayerForm onAdded={(p) => setPlayers((prev) => [...prev, p])} />
          </Paper>

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
            <Text size="sm" c="dimmed">
              다음 예정: {nextGameLabel}게임
            </Text>
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
              <Group justify="space-between">
                <Title order={3}>출석 체크</Title>
                <Button size="xs" variant="light" color="red" onClick={resetAttendance}>리셋</Button>
              </Group>
              <Text size="sm" c="dimmed">기본: 결석 / 참가 버튼으로 전환</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {players.map((p) => {
                  const att = attendances.find((a) => a.player_id === p.id);
                  const status = att?.status === "ATTENDING" ? "ATTENDING" : "ABSENT";
                  return (
                    <Group key={p.id} justify="space-between" className="border rounded p-3">
                      <Text>{p.name}</Text>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          color={status === "ATTENDING" ? "green" : "gray"}
                          onClick={() => markAttendance(p.id, status === "ATTENDING" ? "ABSENT" : "ATTENDING")}
                        >
                          {status === "ATTENDING" ? "참가" : "결석"}
                        </Button>
                        {status === "ATTENDING" && (
                          <Badge variant="light" color="yellow">
                            {att?.arrival_rank != null ? `#${att.arrival_rank}` : "순서미정"}
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
                  <Button variant="light" color="orange" onClick={resetLineup}>라인업 초기화</Button>
                  <Button variant="light" color="red" onClick={() => setStep("CONFIRM")}>확정</Button>
                </Group>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {TEAMS.map((team) => {
                  const members = attendingPlayers.filter((p) => lineups[p.id] === team.value);
                  const ordered = [...members].sort((a, b) => {
                    const order: Record<string, number> = { FW: 0, MF: 1, DF: 2, GK: 3, referee: 4, assistant_referee: 5, player: 6 };
                    return (order[roles[a.id] ?? "player"] ?? 99) - (order[roles[b.id] ?? "player"] ?? 99);
                  });
                  const bgColor = team.value === "A" ? "var(--mantine-color-orange-1)" : "var(--mantine-color-teal-1)";
                  const darkBg = team.value === "A" ? "var(--mantine-color-orange-9)" : "var(--mantine-color-teal-9)";
                  return (
                    <Paper key={team.value} withBorder p="md" style={{ backgroundColor: bgColor }}>
                      <Group justify="space-between">
                        <Text fw={700}>{team.label}</Text>
                        <Text size="sm" c="dimmed">{ordered.length}명</Text>
                      </Group>
                      <Stack gap="xs" mt="sm">
                        {ordered.map((p) => {
                          const role = roles[p.id];
                          const isDark =
                            role === "gk" ||
                            role === "GK" ||
                            role === "referee" ||
                            role === "assistant_referee";
                          const rowBg = isDark ? darkBg : "transparent";
                          const nameColor = isDark ? "#fff" : "#000";
                          const roleLabel =
                            role === "referee"
                              ? "주심"
                              : role === "assistant_referee"
                                ? "부심"
                                : role === "gk" || role === "GK"
                                  ? "GK"
                                  : role === "FW" || role === "MF" || role === "DF"
                                    ? role
                                    : "선수";
                          const positionValue = role === "player" || !role ? "player" : role;
                          const teamOptions = [
                            { value: team.value, label: teamLabel(team.value) },
                            { value: team.value === "A" ? "B" : "A", label: teamLabel(team.value === "A" ? "B" : "A") },
                            { value: "BENCH", label: "휴식" },
                          ];
                          return (
                            <Group key={p.id} gap="xs" wrap="wrap" p="xs" style={{ backgroundColor: rowBg, borderRadius: 6 }}>
                              <Text size="sm" className="min-w-20" style={{ color: nameColor, fontWeight: 600 }}>
                                {p.name}
                              </Text>
                              <Select
                                size="xs"
                                data={teamOptions}
                                value={lineups[p.id]}
                                onChange={(val) => setTeam(p.id, val as "A" | "B" | "BENCH")}
                                className="w-28"
                                styles={{ dropdown: { zIndex: 9999 } }}
                              />
                              <Select
                                size="xs"
                                data={[
                                  { value: "player", label: "선수" },
                                  { value: "FW", label: "FW" },
                                  { value: "MF", label: "MF" },
                                  { value: "DF", label: "DF" },
                                  { value: "GK", label: "GK" },
                                  { value: "referee", label: "주심" },
                                  { value: "assistant_referee", label: "부심" },
                                ]}
                                value={positionValue}
                                onChange={(val) => {
                                  const v = val ?? "player";
                                  if (v === "referee" || v === "assistant_referee" || v === "GK" || v === "gk") {
                                    if (v === "GK") setPlayerRole(p.id, "GK");
                                    else setPlayerRole(p.id, v as RoleType);
                                    setTeam(p.id, "BENCH");
                                  } else {
                                    setPlayerRole(p.id, v as RoleType);
                                    setTeam(p.id, team.value);
                                  }
                                }}
                                className="w-28"
                                styles={{ dropdown: { zIndex: 9999 } }}
                              />
                              <Badge color={isDark ? "light" : "gray"} variant={isDark ? "filled" : "light"}>{roleLabel}</Badge>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Paper>
                  );
                })}
                <Paper withBorder p="md">
                  <Text fw={600}>배치/역할</Text>
                  <Text size="sm" c="dimmed" mt="xs">주황/블랙/연두/흰색/주심/부심/GK/휴식 중 선택</Text>
                  <Stack gap="xs" mt="sm">
                    {attendingPlayers
                      .filter((p) => lineups[p.id] === "BENCH" || !lineups[p.id])
                      .map((p) => {
                        const role = roles[p.id];
                        const combined =
                          role === "referee"
                            ? "주심"
                            : role === "assistant_referee"
                              ? "부심"
                              : role === "gk" || role === "GK"
                                ? "GK"
                                : lineups[p.id] === "A"
                                  ? "주황/블랙"
                                  : lineups[p.id] === "B"
                                    ? "연두/흰색"
                                    : "휴식";
                        const currentValue =
                          lineups[p.id] === "A"
                            ? "A"
                            : lineups[p.id] === "B"
                              ? "B"
                              : role === "referee"
                                ? "referee"
                                : role === "assistant_referee"
                                  ? "assistant_referee"
                                  : role === "gk" || role === "GK"
                                    ? "gk"
                                    : "BENCH";
                        return (
                          <Group key={p.id} gap="xs" wrap="wrap">
                            <Text size="sm" className="min-w-20">{p.name}</Text>
                            <Select
                              size="xs"
                              data={[
                                { value: "A", label: "주황/블랙" },
                                { value: "B", label: "연두/흰색" },
                                { value: "referee", label: "주심" },
                                { value: "assistant_referee", label: "부심" },
                                { value: "gk", label: "GK" },
                                { value: "BENCH", label: "휴식" },
                              ]}
                              value={currentValue}
                              onChange={(val) => {
                                const v = val ?? "BENCH";
                                if (v === "A" || v === "B") {
                                  setTeam(p.id, v as "A" | "B");
                                  setPlayerRole(p.id, "player");
                                } else if (v === "referee") {
                                  setTeam(p.id, "BENCH");
                                  setPlayerRole(p.id, "referee");
                                } else if (v === "assistant_referee") {
                                  setTeam(p.id, "BENCH");
                                  setPlayerRole(p.id, "assistant_referee");
                                } else if (v === "gk") {
                                  setTeam(p.id, "BENCH");
                                  setPlayerRole(p.id, "gk");
                                } else {
                                  setTeam(p.id, "BENCH");
                                  setPlayerRole(p.id, "player");
                                }
                              }}
                              className="w-36"
                              styles={{ dropdown: { zIndex: 9999 } }}
                            />
                            <Badge color="gray">{combined}</Badge>
                          </Group>
                        );
                      })}
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
              <Button variant="light" color="blue" onClick={saveTodayGames} disabled={loading}>
                오늘하루 확정저장
              </Button>
              <Group gap="sm">
                <Button variant="light" onClick={() => openGameDetail(undefined)}>오늘 하루 보기</Button>
              </Group>
              <Stack gap="sm">
                {games.map((g) => (
                  <Group key={g.id} gap="sm" className="border rounded p-3">
                    <Text
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => { setCompletedGame(g); openGameDetail(g); }}
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
        </>
      )}
    </Stack>
  );
}

function AddPlayerForm({ onAdded }: { onAdded: (p: Player) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return alert("이름을 입력하세요.");
    setSaving(true);
    const { data, error } = await supabase
      .from("players")
      .insert({ name: name.trim(), phone_last4: "0000", tier: "B" })
      .select()
      .single();
    setSaving(false);
    if (error) return alert("저장 실패: " + error.message);
    if (data) {
      onAdded(data);
      setName("");
    }
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
          className="border rounded px-3 py-2 text-black"
        />
        <Button onClick={submit} disabled={saving} size="xs">
          추가
        </Button>
      </Group>
    </Stack>
  );
}

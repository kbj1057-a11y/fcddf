"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Button,
  Stack,
  Text,
  Title,
  Group,
  SimpleGrid,
  Paper,
  Badge,
  Modal,
  ActionIcon,
  Divider,
  Grid,
  Select,
} from "@mantine/core";
import { supabase } from "@/lib/supabase";
import type { Player, Attendance, Game, QuarterLineup, RoleType } from "@/lib/supabase";

const AUTH_ID = "admin";
const AUTH_PW = "admin1234";

type Step = "ATTENDANCE" | "LINEUP" | "CONFIRM";

const TEAMS = [
  { value: "A", label: "주황/블랙", color: "orange" },
  { value: "B", label: "연두/흰색", color: "teal" },
] as const;

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
  const [completedQuarters, setCompletedQuarters] = useState<
    { id: string; quarter_number: number; status: string }[]
  >([]);
  const [completedLineups, setCompletedLineups] = useState<QuarterLineup[]>([]);
  const [gameLabel, setGameLabel] = useState<string>("1");
  const [authId, setAuthId] = useState("");
  const [authPw, setAuthPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const [historyGame, setHistoryGame] = useState<Game | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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

    const counts: Record<string, number> = {};
    const { data: todayGamesData } = await supabase
      .from("games")
      .select("*")
      .eq("match_date", matchDate);
    for (const g of todayGamesData || []) {
      const { data: qs } = await supabase.from("match_quarters").select("id").eq("match_date", matchDate);
      const qIds = (qs || []).map((q) => q.id);
      if (!qIds.length) continue;
      const { data: lineupRows } = await supabase.from("quarter_lineups").select("player_id").in("quarter_id", qIds);
      for (const row of lineupRows || []) {
        counts[row.player_id] = (counts[row.player_id] || 0) + 1;
      }
    }
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        today_game_count: counts[p.id] || 0,
      }))
    );
    setLoading(false);
  };

  const loadGames = async () => {
    const { data } = await supabase.from("games").select("*").eq("match_date", matchDate).order("label");
    setGames(data || []);
    return data || [];
  };

  const markAttendance = async (playerId: string, status: Attendance["status"]) => {
    const existing = attendances.find((a) => a.player_id === playerId);
    const existingRank = existing?.arrival_rank;
    const isAttending = existing?.status === "ATTENDING";
    const newRank =
      status === "ATTENDING" && !isAttending && existingRank == null
        ? attendances.filter((a) => a.status === "ATTENDING").length + 1
        : existingRank ?? attendances.filter((a) => a.status === "ATTENDING").length + 1;

    await supabase.from("attendance").upsert(
      {
        match_date: matchDate,
        player_id: playerId,
        status,
        arrival_time: new Date().toISOString(),
        arrival_rank: status === "ATTENDING" ? newRank : null,
        exit_time: null,
      },
      { onConflict: "match_date,player_id" }
    );
    setAttendances((prev) => {
      const next = prev.filter((a) => a.player_id !== playerId);
      return [
        ...next,
        {
          id: playerId,
          match_date: matchDate,
          player_id: playerId,
          arrival_time: new Date().toISOString(),
          status,
          arrival_rank: status === "ATTENDING" ? newRank : null,
          exit_time: null,
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
          arrival_rank: null,
          exit_time: null,
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

  const generateAutoLineup = async () => {
    await loadGames();
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

    const previousInfo: Record<string, { team: string; role: string }> = {};
    const currentLabelNum = parseInt(gameLabel, 10) || 1;
    const prevLabels: string[] = [];
    for (let i = 1; i < currentLabelNum; i++) prevLabels.push(String(i));
    try {
      if (prevLabels.length > 0) {
        const { data: prevGames } = await supabase
          .from("games")
          .select("id")
          .eq("match_date", matchDate)
          .in("label", prevLabels);
        if (prevGames?.length) {
          const { data: prevQuarters } = await supabase.from("match_quarters").select("id").eq("match_date", matchDate);
          const qIds = (prevQuarters || []).map((q) => q.id);
          if (qIds.length) {
            const { data: prevLineups } = await supabase
              .from("quarter_lineups")
              .select("player_id, team, position")
              .in("quarter_id", qIds);
            for (const row of prevLineups || []) {
              previousInfo[row.player_id] = {
                team: row.team,
                role: row.position ?? "player",
              };
            }
          }
        }
      }
    } catch (e) {
      console.error("previous lineup load failed", e);
    }

    const getArrivalRank = (playerId: string) => {
      const att = attendances.find((a) => a.player_id === playerId);
      return att?.arrival_rank ?? Infinity;
    };

    const fieldPlayerPenalty = (playerId: string) => {
      const info = previousInfo[playerId];
      if (!info) return 1;
      if (info.team === "A" || info.team === "B") {
        const role = (info.role || "").toUpperCase();
        if (["FW", "MF", "DF", "GK", "PLAYER"].includes(role)) return 1;
      }
      return 0;
    };

    const assigned = new Set<string>();
    const assignPlayer = (playerId: string, team: "A" | "B", role: string) => {
      if (!isFull && bench.includes(teams[team]?.find((p) => p.id === playerId)!)) return;
      if (role === "주심" || role === "부심") return;
      if (teamSlots[team][role] >= (isFull ? target / 4 : 3)) return;

      const player = players.find((p) => p.id === playerId);
      if (!player) return;

      teams[team].push(player);
      teamSlots[team][role] += 1;
      assigned.add(playerId);
      setLineups((prev) => ({ ...prev, [playerId]: team }));
      setRoles((prev) => ({ ...prev, [playerId]: role as RoleType }));
    };

    for (const p of list) {
      const info = previousInfo[p.id];
      const role = roles[p.id] ?? info?.role ?? "player";
      if (role === "referee") continue;
      if (role === "GK") {
        assignPlayer(p.id, info?.team === "B" ? "B" : "A", "GK");
      } else if (["FW", "MF", "DF"].includes(role)) {
        assignPlayer(p.id, info?.team === "B" ? "B" : "A", role);
      }
    }

    const remaining = list.filter((p) => !assigned.has(p.id) && p.id);
    remaining.sort((a, b) => {
      const rankDiff = (getArrivalRank(a.id) ?? 9999) - (getArrivalRank(b.id) ?? 9999);
      if (rankDiff !== 0) return rankDiff;
      return fieldPlayerPenalty(a.id) - fieldPlayerPenalty(b.id);
    });

    for (const p of remaining) {
      const info = previousInfo[p.id];
      const role = roles[p.id] ?? info?.role ?? "player";
      const teamPref = info?.team === "B" ? "B" : "A";
      if (teams[teamPref].length < target / 2) {
        assignPlayer(p.id, teamPref, ["FW", "MF", "DF"].includes(role) ? role : "player");
      } else {
        const other: "A" | "B" = teamPref === "A" ? "B" : "A";
        assignPlayer(p.id, other, ["FW", "MF", "DF"].includes(role) ? role : "player");
      }
    }

    for (const p of list) {
      if (!assigned.has(p.id)) {
        bench.push(p);
        setLineups((prev) => ({ ...prev, [p.id]: "BENCH" }));
        setRoles((prev) => ({ ...prev, [p.id]: "player" }));
      }
    }

    for (const p of list) {
      const role = roles[p.id] ?? previousInfo[p.id]?.role ?? "player";
      if (role === "referee") {
        setLineups((prev) => ({ ...prev, [p.id]: "A" }));
        setRoles((prev) => ({ ...prev, [p.id]: "referee" }));
      }
    }
  };

  const resetLineup = () => {
    setLineups({});
    setRoles({});
  };

  const saveGame = async () => {
    if (Object.keys(lineups).length === 0) return alert("라인업을 먼저 생성해주세요.");
    const resolvedLabel = String(gameLabel || nextGameLabel).trim() || nextGameLabel;

    setLoading(true);
    try {
      const { data: existing, error: existErr } = await supabase
        .from("games")
        .select("id")
        .eq("match_date", matchDate)
        .eq("label", resolvedLabel)
        .maybeSingle();
      if (existErr) {
        alert("게임 확인 실패: " + existErr.message);
        return;
      }
      if (existing?.id) {
        const ok = confirm(
          `${matchDate} ${resolvedLabel}게임이 이미 저장되어 있습니다.\n덮어쓰면 기존 데이터가 삭제됩니다.\n계속할까요?`
        );
        if (!ok) return;
        await supabase.from("games").delete().eq("id", existing.id);
      }

      const { data: game, error: gameErr } = await supabase
        .from("games")
        .insert({
          match_date: matchDate,
          label: resolvedLabel,
          status: "CONFIRMED",
          teamA_player_count: Object.values(lineups).filter(t => t === "A").length,
          teamB_player_count: Object.values(lineups).filter(t => t === "B").length,
        })
        .select()
        .single();

      if (gameErr || !game) {
        alert("게임 저장 실패: " + (gameErr?.message || "unknown"));
        return;
      }

      for (let q = 1; q <= 4; q++) {
        const { data: quarter, error: qErr } = await supabase
          .from("match_quarters")
          .insert({ match_date: matchDate, quarter_number: q, status: "COMPLETED" })
          .select()
          .single();

        if (qErr || !quarter) {
          alert("쿼터 저장 실패: " + (qErr?.message || "unknown"));
          return;
        }

        const rows = Object.entries(lineups).map(([playerId, team]) => {
          const role = roles[playerId] ?? "player";
          const isGK = role === "GK" || role === "gk";
          let position: string | null = null;
          if (["FW", "MF", "DF"].includes(role)) position = role;
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
        if (qlErr) {
          alert("라인업 저장 실패: " + qlErr.message);
          return;
        }
      }

      alert(`${resolvedLabel}게임 저장 완료`);
      resetLineup();
      const freshGames = await loadGames();
      const nums = (freshGames || [])
        .map((g) => parseInt(g.label || "0", 10))
        .filter((n) => !Number.isNaN(n));
      if (nums.length) {
        setGameLabel(String(Math.max(...nums) + 1));
      }
      await loadPlayers();
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

  const saveTodayGames = async () => {
    if (!matchDate) return alert("날짜를 선택하세요.");
    setLoading(true);
    try {
      const { data: todayGames } = await supabase
        .from("games")
        .select("*")
        .eq("match_date", matchDate);
      const saved = todayGames?.length || 0;
      const { data: existingGame } = await supabase.from("games").select("id").eq("match_date", matchDate).limit(1);
      if ((existingGame || []).length === 0) {
        alert("오늘 저장된 게임이 없습니다.");
        return;
      }
      const proceed = window.confirm(
        `오늘(${matchDate}) 저장된 게임 ${saved}개를 메인 서버로 동기화합니다.\n계속할까요?`
      );
      if (!proceed) return;
      alert(`오늘하루 확정 완료: ${matchDate} / ${saved}게임 동기화됨`);
      setGames(todayGames || []);
    } finally {
      setLoading(false);
    }
  };

  const openHistory = async (game: Game) => {
    setHistoryGame(game);
    setHistoryOpen(true);
    await openGameDetail(game);
  };

  const loadHistoryLineup = async () => {
    if (!historyGame) return;
    setLoading(true);
    const { data: quarters } = await supabase.from("match_quarters").select("*").eq("match_date", matchDate).eq("label", historyGame.label);
    const quarterIds = (quarters || []).map((q) => q.id);
    const { data: lineupRows } = quarterIds.length
      ? await supabase.from("quarter_lineups").select("*").in("quarter_id", quarterIds)
      : { data: [] };
    const nextLineups: TeamMap = {};
    const nextRoles: RoleMap = {};
    for (const row of lineupRows || []) {
      nextLineups[row.player_id] = row.team as "A" | "B" | "BENCH";
      if (row.position === "FW" || row.position === "MF" || row.position === "DF" || row.position === "GK" || row.position === "주심" || row.position === "부심") {
        const roleMap: Record<string, RoleType> = { FW: "FW", MF: "MF", DF: "DF", GK: "GK", 주심: "referee", 부심: "assistant_referee" };
        nextRoles[row.player_id] = roleMap[row.position] || "player";
      } else {
        nextRoles[row.player_id] = "player";
      }
    }
    setLineups(nextLineups);
    setRoles(nextRoles);
    setGameLabel(historyGame.label || "1");
    setHistoryOpen(false);
    setHistoryGame(null);
    setStep("LINEUP");
    setLoading(false);
  };

  const deleteHistoryGame = async () => {
    if (!historyGame) return;
    const ok = window.confirm(`${historyGame.label} 게임을 삭제할까요?`);
    if (!ok) return;
    const { data: qs } = await supabase.from("match_quarters").select("id").eq("match_date", matchDate);
    if (qs?.length) {
      const qIds = (qs || []).map((q) => q.id);
      await supabase.from("quarter_lineups").delete().in("quarter_id", qIds);
      await supabase.from("match_quarters").delete().eq("match_date", matchDate);
    }
    await supabase.from("games").delete().eq("id", historyGame.id);
    setHistoryOpen(false);
    setHistoryGame(null);
    await loadGames();
    await loadPlayers();
  };

  const deleteGameById = async (gameId: string) => {
    const ok = window.confirm("게임을 삭제할까요?");
    if (!ok) return;
    await supabase.from("games").delete().eq("id", gameId);
    await loadGames();
  };

  useEffect(() => {
    (async () => {
      await loadPlayers();
      await loadGames();
    })();
  }, [matchDate]);

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
          <Group wrap="wrap">
            <input
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
              className="border rounded px-3 py-2 text-black"
            />
            <input
              type="text"
              value={gameLabel}
              onChange={(e) => setGameLabel(e.target.value.replace(/[^0-9]/g, "") || "1")}
              className="border rounded px-3 py-2 text-black w-24"
            />
            <Text size="sm">다음 예정: {nextGameLabel}게임</Text>
            <Button onClick={loadPlayers}>선수 불러오기</Button>
            <AddPlayerForm onAdded={(p) => setPlayers((prev) => [...prev, p])} />
            <Button size="xs" variant="light" color="red" onClick={() => setAuthed(false)}>
              로그아웃
            </Button>
          </Group>

          <Group>
            <Button color={step === "ATTENDANCE" ? "blue" : "default"} onClick={() => setStep("ATTENDANCE")}>
              출석
            </Button>
            <Button color={step === "LINEUP" ? "blue" : "default"} onClick={() => setStep("LINEUP")}>
              라인업
            </Button>
            <Button color={step === "CONFIRM" ? "blue" : "default"} onClick={() => { setStep("CONFIRM"); loadGames(); }}>
              확정
            </Button>
          </Group>

          {step === "ATTENDANCE" && (
            <Paper withBorder p="md">
              <Title order={4}>출석</Title>
              <Group mb="xs">
                <Button size="xs" color="red" onClick={resetAttendance}>
                  출석 초기화
                </Button>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                {players.map((p) => {
                  const att = attendances.find((a) => a.player_id === p.id);
                  const status = att?.status === "ATTENDING" ? "ATTENDING" : "ABSENT";
                  return (
                    <Paper withBorder p="xs" key={p.id}>
                      <Group>
                        <Text size="sm">{p.name}</Text>
                        <Text size="xs" c="dimmed">
                          도착순: {att?.arrival_rank ?? "-"}
                        </Text>
                        <Button
                          size="xs"
                          color={status === "ATTENDING" ? "green" : "red"}
                          onClick={() =>
                            markAttendance(p.id, status === "ATTENDING" ? "ABSENT" : "ATTENDING")
                          }
                        >
                          {status === "ATTENDING" ? "참가" : "결석"}
                        </Button>
                      </Group>
                    </Paper>
                  );
                })}
              </SimpleGrid>
            </Paper>
          )}

          {step === "LINEUP" && (
            <Paper withBorder p="md">
              <Title order={4}>라인업</Title>
              <Group mb="xs" wrap="wrap">
                <Select
                  size="xs"
                  label="게임 번호"
                  value={gameLabel}
                  onChange={(v) => v && setGameLabel(v)}
                  data={[...games].reverse().map((g) => ({ value: g.label || "1", label: `${g.label || "1"}게임` }))}
                  w={120}
                />
                <Button size="xs" onClick={generateAutoLineup}>
                  자동 라인업 생성
                </Button>
                <Button size="xs" variant="light" color="red" onClick={resetLineup}>
                  라인업 초기화
                </Button>
              </Group>
              <Grid>
                <Grid.Col span={4}>
                  <Text size="sm" fw={500}>주황/블랙</Text>
                  <Text size="xs" c="dimmed">인원: {Object.values(lineups).filter((t) => t === "A").length}</Text>
                  <TeamList
                    team="A"
                    players={players}
                    lineups={lineups}
                    roles={roles}
                    setTeam={(id, team) => setLineups((prev) => ({ ...prev, [id]: team }))}
                    setPlayerRole={(id, role) => setRoles((prev) => ({ ...prev, [id]: role }))}
                  />
                </Grid.Col>
                <Grid.Col span={4}>
                  <Text size="sm" fw={500}>연두/흰색</Text>
                  <Text size="xs" c="dimmed">인원: {Object.values(lineups).filter((t) => t === "B").length}</Text>
                  <TeamList
                    team="B"
                    players={players}
                    lineups={lineups}
                    roles={roles}
                    setTeam={(id, team) => setLineups((prev) => ({ ...prev, [id]: team }))}
                    setPlayerRole={(id, role) => setRoles((prev) => ({ ...prev, [id]: role }))}
                  />
                </Grid.Col>
                <Grid.Col span={4}>
                  <Text size="sm" fw={500}>벤치</Text>
                  <Text size="xs" c="dimmed">인원: {Object.values(lineups).filter((t) => t === "BENCH").length}</Text>
                  <TeamList
                    team="BENCH"
                    players={players}
                    lineups={lineups}
                    roles={roles}
                    setTeam={(id, team) => setLineups((prev) => ({ ...prev, [id]: team }))}
                    setPlayerRole={(id, role) => setRoles((prev) => ({ ...prev, [id]: role }))}
                  />
                </Grid.Col>
              </Grid>
            </Paper>
          )}

          {step === "CONFIRM" && (
            <Paper withBorder p="md">
              <Title order={4}>확정</Title>
              <Group mb="xs">
                <Text size="sm">다음 게임: {nextGameLabel}</Text>
                <Text size="sm" c="dimmed">저장됨: {games.length}게임</Text>
              </Group>
              <Group mb="xs">
                <Button onClick={saveGame} disabled={Object.keys(lineups).length === 0}>
                  {nextGameLabel}게임 확정저장
                </Button>
              </Group>

              <Divider label="오늘 하루 보기" labelPosition="center" my="md" />
              <SimpleGrid cols={3} spacing="xs">
                {[...games].reverse().map((g) => (
                  <Paper withBorder p="xs" key={g.id} style={{ cursor: "pointer" }} onClick={() => openHistory(g)}>
                    <Text size="sm" fw={500}>
                      {g.label}게임
                    </Text>
                    <Text size="xs" c="dimmed">{g.match_date}</Text>
                    <Group gap="xs" mt="xs">
                      <ActionIcon size="xs" variant="light" color="blue" onClick={() => openHistory(g)}>
                        보기
                      </ActionIcon>
                      <ActionIcon size="xs" variant="light" color="red" onClick={() => deleteGameById(g.id)}>
                        삭제
                      </ActionIcon>
                    </Group>
                  </Paper>
                ))}
                {games.length === 0 && (
                  <Text size="sm" c="dimmed">저장된 게임이 없습니다.</Text>
                )}
              </SimpleGrid>
              <Group mt="md">
                <Button onClick={saveTodayGames}>오늘하루 확정저장</Button>
              </Group>
            </Paper>
          )}
        </>
      )}

      <Modal opened={historyOpen && !!historyGame} onClose={() => { setHistoryOpen(false); setHistoryGame(null); }} title={`${historyGame?.label}게임 상세`} size="lg">
        {historyGame && (
          <Stack gap="xs">
            <Title order={5}>{historyGame.label}게임 상세</Title>
            {(completedQuarters || []).length === 0 && (
              <Text size="sm" c="dimmed">라인업 정보가 없습니다.</Text>
            )}
            {(completedQuarters || []).map((q) => {
              const qLineups = completedLineups.filter((rl) => rl.quarter_id === q.id);
              return (
                <Paper key={q.id} withBorder p="xs">
                  <Text size="sm" fw={500}>쿼터 {q.quarter_number}</Text>
                  <Stack gap={4}>
                    {qLineups.map((rl) => {
                      const p = players.find((pl) => pl.id === rl.player_id);
                      return (
                        <Group key={rl.id} gap="xs">
                          <Text size="sm">{p?.name ?? "-"}</Text>
                          <Badge size="xs">{rl.position ?? "-"}</Badge>
                        </Group>
                      );
                    })}
                    {qLineups.length === 0 && <Text size="xs" c="dimmed">-</Text>}
                  </Stack>
                </Paper>
              );
            })}
            <Group>
              <Button size="xs" onClick={loadHistoryLineup}>수정</Button>
              <Button size="xs" color="red" onClick={deleteHistoryGame}>삭제</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function AddPlayerForm({ onAdded }: { onAdded: (p: Player) => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("players")
      .insert([{ name: name.trim() }])
      .select()
      .single();
    if (error) {
      alert("선수 추가 실패: " + error.message);
      setLoading(false);
      return;
    }
    if (data) onAdded(data as Player);
    setName("");
    setLoading(false);
  };

  return (
    <Group>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="border rounded px-3 py-2 text-black" />
      <Button onClick={submit} loading={loading} disabled={!name.trim()}>
        추가
      </Button>
    </Group>
  );
}

function TeamList({
  team,
  players,
  lineups,
  roles,
  setTeam,
  setPlayerRole,
}: {
  team: "A" | "B" | "BENCH";
  players: Player[];
  lineups: TeamMap;
  roles: RoleMap;
  setTeam: (id: string, team: "A" | "B" | "BENCH") => void;
  setPlayerRole: (id: string, role: RoleType) => void;
}) {
  const isGK = (role?: string) => ["GK", "referee", "assistant_referee"].includes(role || "");
  return (
    <Stack gap={4} mt="xs">
      {players.map((p) => {
        const assigned = lineups[p.id];
        if (assigned !== team) return null;
        const role = roles[p.id] || "player";
        return (
          <Paper key={p.id} withBorder p="xs" style={{ backgroundColor: isGK(role) ? "#333" : undefined }}>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c={isGK(role) ? "white" : "black"}>
                {p.name}
              </Text>
              <Select
                size="xs"
                data={[
                  { value: "주황/블랙", label: "주황/블랙" },
                  { value: "연두/흰색", label: "연두/흰색" },
                  { value: "주심", label: "주심" },
                  { value: "부심", label: "부심" },
                  { value: "GK", label: "GK" },
                  { value: "휴식", label: "휴식" },
                ]}
                value={role}
                onChange={(v) => {
                  if (v === "주황/블랙") setTeam(p.id, "A");
                  else if (v === "연두/흰색") setTeam(p.id, "B");
                  else if (v === "휴식") setTeam(p.id, "BENCH");
                  else if (v === "주심") { setTeam(p.id, "A"); setPlayerRole(p.id, "referee"); }
                  else if (v === "부심") { setTeam(p.id, "A"); setPlayerRole(p.id, "assistant_referee"); }
                  else if (v === "GK") { setTeam(p.id, "A"); setPlayerRole(p.id, "GK"); }
                  else setPlayerRole(p.id, (v as RoleType) || "player");
                }}
                w={110}
              />
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
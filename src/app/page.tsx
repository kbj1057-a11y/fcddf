"use client";

import { useState, useMemo } from "react";
import { Button, Stack, Text, Title, Group, SimpleGrid, Box, Select, Paper, Badge, Modal, ActionIcon, Table, Divider, Grid } from "@mantine/core";
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

  const playerTodayGameCount: Record<string, number> = {};

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
        arrival_rank: newRank,
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
    const prevLabels = [];
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

    const sorted = [...list].sort((a, b) => {
      const pa = fieldPlayerPenalty(a.id) - fieldPlayerPenalty(b.id);
      if (pa !== 0) return pa;
      const ra = getArrivalRank(a.id) - getArrivalRank(b.id);
      if (ra !== 0) return ra;
      return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
    });

    const counts: Record<"A" | "B", number> = { A: 0, B: 0 };
    let last: "A" | "B" | null = null;

    for (const player of sorted) {
      if (counts.A >= target && counts.B >= target) {
        bench.push(player);
        continue;
      }
      const prev = previousInfo[player.id];
      const preferA = prev?.team === "B";
      const preferB = prev?.team === "A";

      let pick: "A" | "B";
      if (counts.A >= target) pick = "B";
      else if (counts.B >= target) pick = "A";
      else if (preferB && counts.B < target && last !== "B") pick = "B";
      else if (preferA && counts.A < target && last !== "A") pick = "A";
      else pick = last === "A" ? "B" : "A";

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
      for (const p of gkReady) {
        nextLineups[p.id] = teamKey;
        nextRoles[p.id] = "GK";
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
      if (existErr) {
        console.error("games check", existErr);
        alert("게임 확인 실패: " + existErr.message);
        setLoading(false);
        return;
      }

      if (existing?.id) {
        const ok = window.confirm(
          `이미 ${matchDate} ${resolvedLabel} 게임이 저장되어 있습니다.\n덮어쓰면 기존 데이터가 백업 후 삭제됩니다.\n계속할까요?`
        );
        if (!ok) {
          setLoading(false);
          return;
        }

        const { data: existingGame } = await supabase.from("games").select("*").eq("id", existing.id).single();
        const { data: existingQuarters } = await supabase.from("match_quarters").select("*").eq("match_date", matchDate);
        const qIds = (existingQuarters || []).map((q) => q.id);
        const { data: existingLineups } = qIds.length
          ? await supabase.from("quarter_lineups").select("*").in("quarter_id", qIds)
          : { data: [] };

        await supabase.from("games_backup").insert({ ...existingGame, backup_at: new Date().toISOString() });
        if (existingQuarters && existingQuarters.length) {
          await supabase.from("match_quarters_backup").insert(
            existingQuarters.map((q) => ({ ...q, backup_at: new Date().toISOString() }))
          );
        }
        if (existingLineups && existingLineups.length) {
          await supabase.from("quarter_lineups_backup").insert(
            existingLineups.map((r) => ({ ...r, backup_at: new Date().toISOString() }))
          );
        }
        await supabase.from("quarter_lineups").delete().in("quarter_id", qIds.length ? qIds : [""]);
        await supabase.from("match_quarters").delete().eq("match_date", matchDate);
        await supabase.from("games").delete().eq("id", existing.id);
      }

      const { data: game, error: gameErr } = await supabase
        .from("games")
        .upsert({ id: completedGame?.id, played_at: new Date().toISOString(), match_date: matchDate, label: resolvedLabel, status: "COMPLETED" })
        .select()
        .single();
      if (gameErr) {
        console.error("games insert", gameErr);
        alert("게임 저장 실패: " + gameErr.message);
        setLoading(false);
        return;
      }
      if (!game) {
        console.error("games insert no data");
        setLoading(false);
        return;
      }

      for (let q = 1; q <= 4; q++) {
        const { data: quarter, error: qErr } = await supabase
          .from("match_quarters")
          .insert({ match_date: matchDate, quarter_number: q, status: "COMPLETED" })
          .select()
          .single();
        if (qErr) {
          console.error("match_quarters insert", qErr);
          alert("쿼터 저장 실패: " + qErr.message);
          setLoading(false);
          return;
        }
        if (!quarter) {
          console.error("match_quarters insert no data");
          setLoading(false);
          return;
        }

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
        if (qlErr) {
          console.error("quarter_lineups insert", qlErr);
          alert("라인업 저장 실패: " + qlErr.message);
          setLoading(false);
          return;
        }
      }

      alert("저장 완료");
      resetLineup();
      const latestGames = await loadGames();
      const nums = latestGames.map((g) => parseInt(g.label || "0", 10)).filter((n) => !Number.isNaN(n));
      const max = nums.reduce((m, n) => Math.max(m, n), 0);
      setGameLabel(String(max + 1));
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
    const { data: lineupRows } = await supabase.from("quarter_lineups").select("*").in("quarter_id", quarterIds.length ? quarterIds : [""]);
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
      if (listErr) {
        console.error("today games list", listErr);
        alert("오늘 게임 조회 실패");
        setLoading(false);
        return;
      }

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
      if (!proceed) {
        setLoading(false);
        return;
      }

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
        const roleMap: Record<string, RoleType> = { "FW": "FW", "MF": "MF", "DF": "DF", "GK": "GK", "주심": "referee", "부심": "assistant_referee" };
        nextRoles[row.player_id] = roleMap[row.position] || "player";
      } else {
        nextRoles[row.player_id] = row.position === "BENCH" ? "player" : "player";
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
              className="border rounded px-3 py-2 text-black w-24"
              placeholder="게임 번호"
            />
            <Button onClick={loadPlayers}>데이터 불러오기</Button>
            <Button onClick={loadGames}>게임 불러오기</Button>
          </Group>

          <Group gap="xs">
            <Button
              variant={step === "ATTENDANCE" ? "filled" : "light"}
              onClick={() => setStep("ATTENDANCE")}
            >
              출석
            </Button>
            <Button
              variant={step === "LINEUP" ? "filled" : "light"}
              onClick={() => setStep("LINEUP")}
            >
              라인업
            </Button>
            <Button
              variant={step === "CONFIRM" ? "filled" : "light"}
              onClick={() => setStep("CONFIRM")}
            >
              확정
            </Button>
          </Group>

          {step === "ATTENDANCE" && (
            <Paper withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Title order={4}>출석 체크</Title>
                <Button size="xs" color="red" onClick={resetAttendance}>
                  리셋
                </Button>
              </Group>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                {players.map((p) => {
                  const att = attendances.find((a) => a.player_id === p.id);
                  const status = att?.status === "ATTENDING" ? "ATTENDING" : "ABSENT";
                  return (
                    <Paper withBorder p="xs" key={p.id}>
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
              <Grid mb="xs">
                <Grid.Col span={4}>
                  <Text size="sm" fw={500}>주황/블랙</Text>
                  <Text size="xs" c="dimmed">인원: {Object.values(lineups).filter((t) => t === "A").length}</Text>
                  <TeamList
                    team="A"
                    players={players}
                    lineups={lineups}
                    roles={roles}
                    setTeam={setTeam}
                    setPlayerRole={setPlayerRole}
                    bg="orange"
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
                    setTeam={setTeam}
                    setPlayerRole={setPlayerRole}
                    bg="teal"
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
                    setTeam={setTeam}
                    setPlayerRole={setPlayerRole}
                    bg="gray"
                  />
                </Grid.Col>
              </Grid>
            </Paper>
          )}

          {step === "CONFIRM" && (
            <Paper withBorder p="md">
              <Title order={4}>확정</Title>
              <Group mb="xs">
                <Text size="sm">
                  다음 게임: {nextGameLabel}
                </Text>
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
                    <Text size="xs" c="dimmed" onClick={() => openHistory(g)}>
                      보기 | 삭제 버튼
                    </Text>
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
              </SimpleGrid>
              <Group mt="md">
                <Button onClick={saveTodayGames}>오늘하루 확정저장</Button>
              </Group>
            </Paper>
          )}
        </>
      )}

      <Modal
        opened={historyOpen && !!historyGame}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryGame(null);
        }}
        title={`${historyGame?.label}게임 상세`}
        size="lg"
      >
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
      console.error("player insert", error);
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
  bg,
}: {
  team: "A" | "B" | "BENCH";
  players: Player[];
  lineups: TeamMap;
  roles: RoleMap;
  setTeam: (id: string, team: "A" | "B" | "BENCH") => void;
  setPlayerRole: (id: string, role: RoleType) => void;
  bg: string;
}) {
  return (
    <Stack gap={4} mt="xs">
      {players.map((p) => {
        const assigned = lineups[p.id];
        if (assigned !== team) return null;
        const isGK = ["GK", "주심", "부심"].includes(roles[p.id] || "player");
        return (
          <Paper
            key={p.id}
            withBorder
            p="xs"
            style={{ backgroundColor: isGK ? "#333" : undefined }}
          >
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c={isGK ? "white" : "black"}>
                {p.name}
              </Text>
              {p.today_game_count ? (
                <Badge size="xs" circle>{p.today_game_count}</Badge>
              ) : null}
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
                value={roles[p.id] || (team === "BENCH" ? "휴식" : "player")}
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

import type { AdminView, LiveGame, LiveView, Player, Role } from "./types";
import { PHASE_HE, ROLE_HE, WEEKDAYS_HE } from "./types";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function prettyJerusalem(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const wdMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const wd = wdMap[parts.weekday ?? ""] ?? 0;
  return `יום ${WEEKDAYS_HE[wd]} ${pad(Number(parts.hour))}:${pad(Number(parts.minute))}`;
}

function deathText(d: LiveGame["deaths"][number]): string {
  const roleHe = ROLE_HE[d.role];
  if (d.kind === "human" && d.realName) {
    return `${d.name} היה ${roleHe}. היה ${d.realName}.`;
  }
  return `${d.name} היה ${roleHe}. לא היה בן אדם.`;
}

function entitledChannel(me: Player, channel: string): boolean {
  if (channel === "public" || channel === "events") return true;
  if (channel === "wolves" && me.role === "wolf") return true;
  if (channel === "seer" && me.role === "seer") return true;
  if (channel === "doctor" && me.role === "doctor") return true;
  return false;
}

export function playerView(game: LiveGame, me: Player, now = Date.now()): LiveView {
  const lobby = game.phase === "lobby" || game.status === "idle";
  const running = game.status === "running";
  const ended = game.status === "ended" || game.phase === "ended";

  const canSpeak =
    Boolean(me.alive) &&
    !me.muted &&
    ((game.phase === "day" && game.openChannel === "public") ||
      (game.phase === "night_wolves" && me.role === "wolf" && game.openChannel === "wolves"));

  const canVote = game.phase === "day" && me.alive && !me.cannotVote;

  let nightAction: "wolf" | "seer" | "doctor" | null = null;
  if (me.alive) {
    if (game.phase === "night_wolves" && me.role === "wolf") nightAction = "wolf";
    if (game.phase === "night_seer" && me.role === "seer") nightAction = "seer";
    if (game.phase === "night_doctor" && me.role === "doctor") nightAction = "doctor";
  }

  const pack =
    me.role === "wolf"
      ? game.players.filter((p) => p.role === "wolf" && p.id !== me.id).map((p) => p.name)
      : [];

  const mem = game.memories[me.id];
  const inspections: { name: string; result: string }[] = [];
  if (me.role === "seer" && mem) {
    for (const [id, k] of Object.entries(mem.known)) {
      const n = game.players.find((p) => p.id === id)?.name ?? id;
      inspections.push({ name: n, result: k === "wolf" ? "זאב" : "לא זאב" });
    }
  }

  let myNightPick: string | null = null;
  if (nightAction === "wolf") myNightPick = game.night.wolfTarget;
  if (nightAction === "seer") myNightPick = game.night.seerTarget;
  if (nightAction === "doctor") myNightPick = game.night.doctorTarget;

  const votesOn: Record<string, string[]> = {};
  for (const p of game.players) votesOn[p.id] = [];
  if (game.phase === "day" || game.phase === "hang") {
    for (const [voterId, targetId] of Object.entries(game.votes)) {
      const voter = game.players.find((p) => p.id === voterId);
      if (!voter?.alive) continue;
      if (!votesOn[targetId]) votesOn[targetId] = [];
      votesOn[targetId].push(voter.name);
    }
  }

  const players = game.players.map((p) => {
    const dead = !p.alive;
    let role: Role | null = null;
    if (p.id === me.id && !lobby) role = p.role;
    else if (dead) role = p.role;
    return {
      id: p.id,
      name: p.name,
      alive: p.alive,
      isMe: p.id === me.id,
      role,
      votes: (votesOn[p.id] ?? []).length,
      voters: votesOn[p.id] ?? [],
    };
  });

  const waitText =
    game.phase === "wait" && game.waitWeekday != null
      ? `היום אין משחק. חוזרים ביום ${WEEKDAYS_HE[game.waitWeekday]}`
      : null;

  const nextLockAt =
    running && game.nextLockAt > 0 ? new Date(game.nextLockAt).toISOString() : null;

  let status: LiveView["status"] = "running";
  if (lobby) status = "lobby";
  if (ended) status = "ended";

  return {
    code: game.code,
    sharePath: `/g/${game.code}`,
    status,
    phase: game.phase,
    phaseLabel: PHASE_HE[game.phase] ?? game.phase,
    dayNumber: game.dayNumber,
    schedule: game.schedule,
    nextLockAt,
    nextLockPretty: nextLockAt ? prettyJerusalem(game.nextLockAt) : null,
    waitText,
    players,
    messages: game.messages.filter((m) => entitledChannel(me, m.channel)),
    lastKill: game.lastKill
      ? { name: game.lastKill.name, saved: game.lastKill.saved }
      : null,
    deaths: game.deaths.map((d) => ({
      name: d.name,
      text: deathText(d),
      role: d.role,
      kind: d.kind,
    })),
    winner: game.winner,
    winnerText: game.winnerText,
    humansJoined: game.players.filter((p) => p.kind === "human").length,
    seats: 8,
    me: {
      playerId: me.id,
      fakeName: me.name,
      realName: me.realName ?? "",
      role: lobby ? null : me.role,
      alive: me.alive,
      muted: me.muted,
      cannotVote: me.cannotVote,
      isHost: me.id === game.hostId,
      canSpeak,
      canVote,
      canNightPick: nightAction !== null,
      nightAction,
      pack,
      inspections,
      myVote: game.votes[me.id] ?? null,
      myNightPick,
    },
    now: new Date(now).toISOString(),
  };
}

export function adminView(game: LiveGame, me: Player, now = Date.now()): AdminView {
  const lobby = game.phase === "lobby" || game.status === "idle";
  const pv = playerView(game, me, now);
  const { players: _playerRoster, ...rest } = pv;
  void _playerRoster;

  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    return game.players.find((p) => p.id === id)?.name ?? null;
  };

  return {
    ...rest,
    isAdmin: true,
    messages: game.messages.filter((m) => m.channel === "public" || m.channel === "events"),
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      realName: p.kind === "human" ? p.realName ?? null : null,
      kind: p.kind ?? "agent",
      alive: p.alive,
      role: lobby ? null : p.role,
      personality: p.personality,
    })),
    wolfMsgs: game.messages.filter((m) => m.channel === "wolves"),
    seerMsgs: game.messages.filter((m) => m.channel === "seer"),
    doctorMsgs: game.messages.filter((m) => m.channel === "doctor"),
    night: {
      wolfTargetName: nameOf(game.night.wolfTarget),
      seerTargetName: nameOf(game.night.seerTarget),
      doctorTargetName: nameOf(game.night.doctorTarget),
    },
    eventLog: [...game.eventLog],
  };
}

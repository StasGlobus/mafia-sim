import crypto from "crypto";
import type { LiveGame, LiveSchedule, LiveView, Personality, Player, Role } from "./types";
import { DEFAULT_CONFIG, DEFAULT_SCHEDULE, LIVE_SEATS, ROLE_HE } from "./types";
import { pickNames, shuffle } from "./names";
import { NAME_POOL } from "./names";
import {
  ALL_PERSONALITIES,
  DECK_ROLES,
  checkWin,
  majorityTarget,
  openFor,
} from "./engine";
import {
  dayPulse,
  doctorPulse,
  living,
  pickDoctorSave,
  pickDayVote,
  pickSeerInspect,
  pickWolfKill,
  resetDayTalk,
  seerPulse,
  uniquePush,
  wolfPulse,
} from "./agents";
import { getLive, hasLive, setLive } from "./live-store";
import { playerView, prettyJerusalem } from "./view";

export { prettyJerusalem };

const TZ = "Asia/Jerusalem";
const CODE_ALPHABET = "אבגדהוזחטיכלמנסעפצקרשת23456789";
const PULSE_EVERY_MS = 25_000;
const MAX_WINDOW_STEPS = 8;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function rnd() {
  return Math.random();
}

function uid(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function makeSecret() {
  return crypto.randomBytes(18).toString("base64url");
}

function makeCode(): string {
  let c = "";
  for (let i = 0; i < 4; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return c;
}

export function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function findPlayerBySecret(game: LiveGame, secret: string): Player | null {
  for (const [id, s] of Object.entries(game.secrets)) {
    if (secretsEqual(s, secret)) {
      return game.players.find((p) => p.id === id) ?? null;
    }
  }
  return null;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

export function tzParts(ms: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const obj: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  const wd: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second),
    weekday: wd[obj.weekday] ?? 0,
  };
}

export function jerusalemToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 6; i++) {
    const p = tzParts(utc);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = wanted - got;
    if (diff === 0) break;
    utc += diff;
  }
  return utc;
}

function addDaysYmd(y: number, mo: number, d: number, n: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function nextPlayDayStart(afterMs: number, schedule: LiveSchedule): number {
  const start = parseHm(schedule.dayStart);
  const p0 = tzParts(afterMs);
  for (let i = 0; i < 16; i++) {
    const ymd = addDaysYmd(p0.year, p0.month, p0.day, i);
    const noon = jerusalemToUtc(ymd.year, ymd.month, ymd.day, 12, 0);
    const wd = tzParts(noon).weekday;
    if (!schedule.days.includes(wd)) continue;
    const t = jerusalemToUtc(ymd.year, ymd.month, ymd.day, start.h, start.m);
    if (t > afterMs) return t;
  }
  const ymd = addDaysYmd(p0.year, p0.month, p0.day, 7);
  return jerusalemToUtc(ymd.year, ymd.month, ymd.day, start.h, start.m);
}

function todayDayEnd(ms: number, schedule: LiveSchedule): number {
  const p = tzParts(ms);
  const e = parseHm(schedule.dayEnd);
  return jerusalemToUtc(p.year, p.month, p.day, e.h, e.m);
}

function todayDayStart(ms: number, schedule: LiveSchedule): number {
  const p = tzParts(ms);
  const s = parseHm(schedule.dayStart);
  return jerusalemToUtc(p.year, p.month, p.day, s.h, s.m);
}

function initialWindow(now: number, schedule: LiveSchedule) {
  const p = tzParts(now);
  const start = parseHm(schedule.dayStart);
  const end = parseHm(schedule.dayEnd);
  const startMs = jerusalemToUtc(p.year, p.month, p.day, start.h, start.m);
  const endMs = jerusalemToUtc(p.year, p.month, p.day, end.h, end.m);
  const play = schedule.days.includes(p.weekday);
  if (play && now >= startMs && now < endMs) {
    return {
      phase: "day" as const,
      windowStartAt: startMs,
      nextLockAt: endMs,
      dayNumber: 1,
      waitWeekday: null as number | null,
    };
  }
  const next = nextPlayDayStart(now, schedule);
  return {
    phase: "wait" as const,
    windowStartAt: now,
    nextLockAt: next,
    dayNumber: 0,
    waitWeekday: tzParts(next).weekday,
  };
}

function announce(game: LiveGame, text: string) {
  uniquePush(game, {
    channel: "public",
    authorId: null,
    authorName: "מערכת",
    text,
    narrator: true,
  });
}

function setElapsed(game: LiveGame, now: number) {
  game.phaseElapsedMs = Math.max(0, now - (game.windowStartAt || now));
  game.phaseDurationMs = Math.max(0, game.nextLockAt - (game.windowStartAt || now));
  game.lastTickAt = now;
}

function liveKill(game: LiveGame, id: string, how: string, at: number) {
  const p = game.players.find((x) => x.id === id);
  if (!p || !p.alive) return;
  p.alive = false;
  const roleHe = ROLE_HE[p.role];
  const kind = p.kind === "human" ? "human" : "agent";
  const extra =
    kind === "human" && p.realName ? `היה ${p.realName}.` : "לא היה בן אדם.";
  announce(game, `${p.name} ${how}. היה ${roleHe}. ${extra}`);
  game.deaths.push({
    playerId: p.id,
    name: p.name,
    role: p.role,
    kind,
    realName: kind === "human" ? p.realName ?? null : null,
    how,
    dayNumber: game.dayNumber,
    ts: at,
  });
  game.eventLog.push(`יום ${game.dayNumber}: ${p.name} מת (${roleHe})`);
}

function applySeerLook(game: LiveGame, seer: Player, targetId: string) {
  const t = game.players.find((p) => p.id === targetId);
  if (!t) return;
  const isWolf = t.role === "wolf";
  if (!game.memories[seer.id]) {
    game.memories[seer.id] = {
      known: {},
      messagesToday: 0,
      lastText: "",
      plannedVote: null,
      spokeAtProgress: [],
    };
  }
  game.memories[seer.id]!.known[t.id] = isWolf ? "wolf" : "not_wolf";
  uniquePush(game, {
    channel: "seer",
    authorId: seer.id,
    authorName: seer.name,
    text: `${t.name}: ${isWolf ? "זאב" : "לא זאב"}`,
    narrator: true,
  });
}

function applyDoctorLog(game: LiveGame, doc: Player, targetId: string) {
  const t = game.players.find((p) => p.id === targetId);
  uniquePush(game, {
    channel: "doctor",
    authorId: doc.id,
    authorName: doc.name,
    text: `שומר על ${t?.name ?? "?"} הלילה`,
    narrator: true,
  });
}

function enterDay(game: LiveGame, at: number, dayNumber: number) {
  game.dayNumber = dayNumber;
  game.phase = "day";
  game.openChannel = "public";
  game.votes = {};
  resetDayTalk(game);
  game.windowStartAt = at;
  game.nextLockAt = todayDayEnd(at, game.schedule);
  if (game.nextLockAt <= at) {
    // safety: if clocks align oddly, lock at next play dayEnd after a full dayStart
    const nextStart = nextPlayDayStart(at, game.schedule);
    game.nextLockAt = todayDayEnd(nextStart, game.schedule);
  }
  setElapsed(game, at);
  announce(game, "יום. מדברים, אחר כך מצביעים.");
}

function enterNight(game: LiveGame, at: number) {
  announce(game, "לילה. הזאבים עובדים.");
  game.night = { wolfTarget: null, seerTarget: null, doctorTarget: null };
  game.phase = "night_wolves";
  game.openChannel = "wolves";
  resetDayTalk(game);
  const nightEnd = nextPlayDayStart(at, game.schedule);
  const third = Math.max(1, (nightEnd - at) / 3);
  game.nightThirdMs = third;
  game.nightEndAt = nightEnd;
  game.windowStartAt = at;
  game.nextLockAt = at + third;
  setElapsed(game, at);
}

function enterNightStep(
  game: LiveGame,
  at: number,
  phase: "night_seer" | "night_doctor",
  stepIndex: 1 | 2,
) {
  game.phase = phase;
  game.openChannel = openFor(phase);
  game.windowStartAt = at;
  if (phase === "night_doctor") {
    game.nextLockAt = game.nightEndAt || at + (game.nightThirdMs || 0);
  } else {
    game.nextLockAt = at + (game.nightThirdMs || 0);
  }
  setElapsed(game, at);
  void stepIndex;
}

function resolveLiveDay(game: LiveGame, at: number) {
  for (const p of living(game)) {
    if (p.kind === "human" || p.cannotVote) continue;
    if (!game.votes[p.id]) {
      const t = pickDayVote(game, p);
      if (t) game.votes[p.id] = t;
    }
  }
  const target = majorityTarget(game);
  for (const p of game.players) {
    p.muted = false;
    p.cannotVote = false;
  }
  if (target) {
    const name = game.players.find((p) => p.id === target)?.name ?? "";
    announce(game, `יש רוב. ${name}.`);
    liveKill(game, target, "נתלה", at);
    if (checkWin(game)) {
      game.nextLockAt = at;
      game.openChannel = "none";
      return;
    }
  } else {
    announce(game, "אין רוב. אף אחד לא נתלה.");
  }
  enterNight(game, at);
}

function resolveLiveWolves(game: LiveGame, at: number) {
  if (!game.night.wolfTarget) {
    const agentWolves = living(game).filter((p) => p.role === "wolf" && p.kind !== "human");
    if (agentWolves.length) game.night.wolfTarget = pickWolfKill(game);
  }
  enterNightStep(game, at, "night_seer", 1);
}

function resolveLiveSeer(game: LiveGame, at: number) {
  const seer = living(game).find((p) => p.role === "seer");
  if (seer && !game.night.seerTarget && seer.kind !== "human") {
    game.night.seerTarget = pickSeerInspect(game, seer);
  }
  if (seer && game.night.seerTarget && !game.memories[seer.id]?.known[game.night.seerTarget]) {
    applySeerLook(game, seer, game.night.seerTarget);
  }
  enterNightStep(game, at, "night_doctor", 2);
}

function resolveLiveDoctor(game: LiveGame, at: number) {
  const doc = living(game).find((p) => p.role === "doctor");
  if (doc && !game.night.doctorTarget && doc.kind !== "human") {
    game.night.doctorTarget = pickDoctorSave(game, doc);
  }
  if (doc && game.night.doctorTarget) {
    applyDoctorLog(game, doc, game.night.doctorTarget);
  }
  finishNight(game, at);
}

function finishNight(game: LiveGame, at: number) {
  const targetId = game.night.wolfTarget;
  const saved = Boolean(targetId && targetId === game.night.doctorTarget);
  const target = targetId ? game.players.find((p) => p.id === targetId) : null;

  announce(game, "בוקר.");

  if (!target || !targetId) {
    game.lastKill = { playerId: null, name: null, role: null, saved: false };
    announce(game, "הלילה עבר בלי גופה.");
  } else if (saved) {
    game.lastKill = {
      playerId: target.id,
      name: target.name,
      role: target.role,
      saved: true,
    };
    announce(game, "ניסו להרוג. מישהו שמר. נכשל.");
  } else if (target.alive) {
    game.lastKill = {
      playerId: target.id,
      name: target.name,
      role: target.role,
      saved: false,
    };
    liveKill(game, target.id, "נמצא מת בבוקר", at);
  }

  if (checkWin(game)) {
    game.nextLockAt = at;
    game.openChannel = "none";
    return;
  }
  enterDay(game, at, game.dayNumber + 1);
}

function resolveLiveWindow(game: LiveGame, at: number) {
  switch (game.phase) {
    case "wait":
      enterDay(game, at, game.dayNumber === 0 ? 1 : game.dayNumber);
      break;
    case "day":
      resolveLiveDay(game, at);
      break;
    case "night_wolves":
      resolveLiveWolves(game, at);
      break;
    case "night_seer":
      resolveLiveSeer(game, at);
      break;
    case "night_doctor":
      resolveLiveDoctor(game, at);
      break;
    default:
      game.nextLockAt = at + 86_400_000;
      break;
  }
}

async function pulseAgents(game: LiveGame) {
  switch (game.phase) {
    case "day":
      await dayPulse(game);
      break;
    case "night_wolves":
      await wolfPulse(game);
      break;
    case "night_seer":
      seerPulse(game);
      break;
    case "night_doctor":
      doctorPulse(game);
      break;
    default:
      break;
  }
}

export async function catchUp(game: LiveGame, now = Date.now()): Promise<LiveGame> {
  if (game.status !== "running" || game.phase === "ended") {
    game.lastTickAt = now;
    return game;
  }
  let guard = 0;
  while (game.status === "running" && now >= game.nextLockAt && guard < MAX_WINDOW_STEPS) {
    guard += 1;
    const lockAt = game.nextLockAt;
    resolveLiveWindow(game, lockAt);
    if (game.status !== "running") break;
  }
  setElapsed(game, now);
  if (game.status === "running" && now < game.nextLockAt) {
    if (now - game.lastAgentPulseAt >= PULSE_EVERY_MS) {
      game.lastAgentPulseAt = now;
      await pulseAgents(game);
    }
  }
  return game;
}

function nextFakeName(used: string[]): string {
  const pool = NAME_POOL.filter((n) => !used.includes(n));
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)]!;
  return `שחקן${used.length + 1}`;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 1 || t.length > 24) return null;
  return t;
}

function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length < 3 || t.length > 8) return null;
  return t;
}

export function parseSchedule(body: {
  dayStart?: string;
  dayEnd?: string;
  days?: number[];
}): LiveSchedule | { error: string } {
  const dayStart = typeof body.dayStart === "string" ? body.dayStart : DEFAULT_SCHEDULE.dayStart;
  const dayEnd = typeof body.dayEnd === "string" ? body.dayEnd : DEFAULT_SCHEDULE.dayEnd;
  if (!HM.test(dayStart) || !HM.test(dayEnd)) {
    return { error: "שעות לא תקינות" };
  }
  const a = parseHm(dayStart);
  const b = parseHm(dayEnd);
  if (a.h * 60 + a.m >= b.h * 60 + b.m) {
    return { error: "סגירה חייבת להיות אחרי פתיחה" };
  }
  let days = Array.isArray(body.days) ? body.days.map((d) => Number(d)) : DEFAULT_SCHEDULE.days;
  days = [...new Set(days.filter((d) => d >= 0 && d <= 6))];
  if (!days.length) days = [...DEFAULT_SCHEDULE.days];
  return { timezone: "Asia/Jerusalem", days, dayStart, dayEnd };
}

function emptyLive(code: string, host: Player, secret: string, schedule: LiveSchedule): LiveGame {
  const now = Date.now();
  return {
    id: uid("lg"),
    code,
    hostId: host.id,
    schedule,
    startedAt: null,
    secrets: { [host.id]: secret },
    deaths: [],
    nextLockAt: 0,
    waitWeekday: null,
    lastAgentPulseAt: 0,
    windowStartAt: now,
    nightThirdMs: 0,
    nightEndAt: 0,
    status: "idle",
    phase: "lobby",
    dayNumber: 0,
    speed: 1,
    config: { ...DEFAULT_CONFIG },
    players: [host],
    messages: [],
    votes: {},
    night: { wolfTarget: null, seerTarget: null, doctorTarget: null },
    lastKill: null,
    hangTarget: null,
    winner: null,
    winnerText: "",
    openChannel: "none",
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
    lastTickAt: now,
    lastPulseAt: 0,
    createdAt: now,
    eventLog: [],
    memories: {},
    usedPublicTexts: [],
  };
}

export type ActionResult =
  | { ok: true; game: LiveView; me?: { playerId: string; secret: string; fakeName: string } }
  | { ok: false; error: string; status: number };

function viewOf(game: LiveGame, me: Player, now: number, extra?: { playerId: string; secret: string; fakeName: string }): ActionResult {
  return {
    ok: true,
    game: playerView(game, me, now),
    me: extra,
  };
}

export function createLiveGame(input: {
  realName: string;
  dayStart?: string;
  dayEnd?: string;
  days?: number[];
}): ActionResult {
  const realName = cleanName(input.realName);
  if (!realName) return { ok: false, error: "צריך שם", status: 400 };
  const schedule = parseSchedule(input);
  if ("error" in schedule) return { ok: false, error: schedule.error, status: 400 };

  let code = makeCode();
  let guard = 0;
  while (hasLive(code) && guard < 20) {
    code = makeCode();
    guard += 1;
  }
  const secret = makeSecret();
  const host: Player = {
    id: uid("h"),
    name: nextFakeName([]),
    role: "villager",
    personality: "naive",
    alive: true,
    muted: false,
    cannotVote: false,
    kind: "human",
    realName,
    host: true,
  };
  const game = emptyLive(code, host, secret, schedule);
  setLive(game);
  return viewOf(game, host, Date.now(), { playerId: host.id, secret, fakeName: host.name });
}

export function joinLiveGame(input: { code: string; realName: string; secret?: string }): ActionResult {
  const code = cleanCode(input.code);
  if (!code) return { ok: false, error: "קוד לא תקין", status: 400 };
  const game = getLive(code);
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };

  if (input.secret) {
    const existing = findPlayerBySecret(game, input.secret);
    if (existing) return viewOf(game, existing, Date.now());
  }

  if (game.phase !== "lobby" || game.status !== "idle") {
    return { ok: false, error: "המשחק כבר רץ", status: 400 };
  }
  const humans = game.players.filter((p) => p.kind === "human");
  if (humans.length >= LIVE_SEATS) {
    return { ok: false, error: "מלא", status: 400 };
  }
  const realName = cleanName(input.realName);
  if (!realName) return { ok: false, error: "צריך שם", status: 400 };

  const secret = makeSecret();
  const used = game.players.map((p) => p.name);
  const player: Player = {
    id: uid("h"),
    name: nextFakeName(used),
    role: "villager",
    personality: "naive",
    alive: true,
    muted: false,
    cannotVote: false,
    kind: "human",
    realName,
    host: false,
  };
  game.players.push(player);
  game.secrets[player.id] = secret;
  setLive(game);
  return viewOf(game, player, Date.now(), { playerId: player.id, secret, fakeName: player.name });
}

export async function startLiveGame(input: { code: string; secret: string }): Promise<ActionResult> {
  const game = getLive(input.code.trim());
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };
  const me = findPlayerBySecret(game, input.secret);
  if (!me) return { ok: false, error: "לא מזוהה", status: 401 };
  if (me.id !== game.hostId) return { ok: false, error: "רק המארח מתחיל", status: 403 };
  if (game.phase !== "lobby") return { ok: false, error: "כבר התחיל", status: 400 };
  const humans = game.players.filter((p) => p.kind === "human");
  if (humans.length < 1) return { ok: false, error: "צריך לפחות אחד", status: 400 };

  const now = Date.now();
  const need = LIVE_SEATS - game.players.length;
  const usedNames = game.players.map((p) => p.name);
  const agentNames = pickNames(Math.max(need, 0), rnd).filter((n) => !usedNames.includes(n));
  const extra = NAME_POOL.filter((n) => !usedNames.includes(n) && !agentNames.includes(n));
  const personalities = shuffle([...ALL_PERSONALITIES], rnd);
  for (let i = 0; i < need; i++) {
    const name = agentNames[i] ?? extra[i] ?? `שחקן${game.players.length + 1}`;
    const agent: Player = {
      id: uid("a"),
      name,
      role: "villager",
      personality: (personalities[i % personalities.length] ?? "quiet") as Personality,
      alive: true,
      muted: false,
      cannotVote: false,
      kind: "agent",
      realName: null,
      host: false,
    };
    game.players.push(agent);
  }

  const roles = shuffle([...DECK_ROLES], rnd) as Role[];
  const pers = shuffle([...ALL_PERSONALITIES], rnd);
  game.players.forEach((p, i) => {
    p.role = roles[i] ?? "villager";
    if (p.kind !== "human") p.personality = pers[i] ?? p.personality;
    game.memories[p.id] = {
      known: {},
      messagesToday: 0,
      lastText: "",
      plannedVote: null,
      spokeAtProgress: [],
    };
  });

  const win = initialWindow(now, game.schedule);
  game.startedAt = now;
  game.status = "running";
  game.phase = win.phase;
  game.dayNumber = win.dayNumber;
  game.windowStartAt = win.windowStartAt;
  game.nextLockAt = win.nextLockAt;
  game.waitWeekday = win.waitWeekday;
  game.openChannel = openFor(win.phase);
  game.lastAgentPulseAt = now;
  setElapsed(game, now);

  announce(game, "שמונה שמות. מי הזאב.");
  if (win.phase === "day") {
    announce(game, "יום. מדברים, אחר כך מצביעים.");
  } else {
    announce(game, `היום סגור. החלון ביום ${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][win.waitWeekday ?? 0]}.`);
  }

  await catchUp(game, now);
  setLive(game);
  return viewOf(game, me, now);
}

export async function liveGet(input: { code: string; secret: string }): Promise<ActionResult> {
  const game = getLive(input.code.trim());
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };
  const me = findPlayerBySecret(game, input.secret);
  if (!me) return { ok: false, error: "לא מזוהה", status: 401 };
  const now = Date.now();
  if (game.status === "running") {
    await catchUp(game, now);
    setLive(game);
  }
  return viewOf(game, me, now);
}

export async function liveSay(input: { code: string; secret: string; text: string }): Promise<ActionResult> {
  const game = getLive(input.code.trim());
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };
  const me = findPlayerBySecret(game, input.secret);
  if (!me) return { ok: false, error: "לא מזוהה", status: 401 };
  const now = Date.now();
  if (game.status === "running") await catchUp(game, now);

  const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "ריק", status: 400 };
  if (text.length > 240) return { ok: false, error: "ארוך מדי", status: 400 };
  if (!me.alive) return { ok: false, error: "מתים לא כותבים", status: 400 };
  if (me.muted) return { ok: false, error: "נסתמת היום", status: 400 };

  const wolfOk = game.phase === "night_wolves" && me.role === "wolf" && game.openChannel === "wolves";
  const dayOk = game.phase === "day" && game.openChannel === "public";
  if (!wolfOk && !dayOk) return { ok: false, error: "הצ'אט סגור עכשיו", status: 400 };

  uniquePush(game, {
    channel: wolfOk ? "wolves" : "public",
    authorId: me.id,
    authorName: me.name,
    text,
  });
  setLive(game);
  return viewOf(game, me, now);
}

export async function liveVote(input: { code: string; secret: string; targetId: string }): Promise<ActionResult> {
  const game = getLive(input.code.trim());
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };
  const me = findPlayerBySecret(game, input.secret);
  if (!me) return { ok: false, error: "לא מזוהה", status: 401 };
  const now = Date.now();
  if (game.status === "running") await catchUp(game, now);
  if (game.phase !== "day") return { ok: false, error: "אין הצבעה עכשיו", status: 400 };
  if (!me.alive) return { ok: false, error: "מתים לא מצביעים", status: 400 };
  if (me.cannotVote) return { ok: false, error: "בלי הצבעה היום", status: 400 };
  const target = game.players.find((p) => p.id === input.targetId);
  if (!target?.alive) return { ok: false, error: "על מי", status: 400 };
  game.votes[me.id] = target.id;
  setLive(game);
  return viewOf(game, me, now);
}

export async function liveNightPick(input: {
  code: string;
  secret: string;
  targetId: string;
}): Promise<ActionResult> {
  const game = getLive(input.code.trim());
  if (!game) return { ok: false, error: "אין משחק כזה", status: 404 };
  const me = findPlayerBySecret(game, input.secret);
  if (!me) return { ok: false, error: "לא מזוהה", status: 401 };
  const now = Date.now();
  if (game.status === "running") await catchUp(game, now);
  if (!me.alive) return { ok: false, error: "מתים לא בוחרים", status: 400 };
  const target = game.players.find((p) => p.id === input.targetId);
  if (!target?.alive) return { ok: false, error: "על מי", status: 400 };

  if (game.phase === "night_wolves" && me.role === "wolf") {
    if (target.role === "wolf") return { ok: false, error: "לא על הזאבים", status: 400 };
    game.night.wolfTarget = target.id;
    setLive(game);
    return viewOf(game, me, now);
  }
  if (game.phase === "night_seer" && me.role === "seer") {
    if (target.id === me.id) return { ok: false, error: "לא על עצמך", status: 400 };
    if (game.night.seerTarget && game.night.seerTarget !== target.id) {
      return { ok: false, error: "כבר בדקת", status: 400 };
    }
    if (!game.night.seerTarget) {
      game.night.seerTarget = target.id;
      applySeerLook(game, me, target.id);
    }
    setLive(game);
    return viewOf(game, me, now);
  }
  if (game.phase === "night_doctor" && me.role === "doctor") {
    game.night.doctorTarget = target.id;
    setLive(game);
    return viewOf(game, me, now);
  }
  return { ok: false, error: "לא התור שלך", status: 400 };
}

export { todayDayStart, todayDayEnd };

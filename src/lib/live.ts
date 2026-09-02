import crypto from "crypto";
import type {
  AdminView,
  ChatMessage,
  DirectorEvent,
  Gender,
  LiveGame,
  LiveRules,
  LiveSchedule,
  LiveView,
  Personality,
  Player,
  Role,
} from "./types";
import {
  DEFAULT_CONFIG,
  DEFAULT_LIVE_RULES,
  DEFAULT_SCHEDULE,
  MAX_LIVE_SEATS,
  MIN_LIVE_SEATS,
  QUICK_DAY_OPTIONS,
  QUICK_NIGHT_OPTIONS,
  ROOM_CODE_LENGTH,
  ROLE_HE,
} from "./types";
import { genderOfName, NAMES, NAME_POOL, pickNames, shuffle } from "./names";
import { ALL_PERSONALITIES, checkWin, majorityTarget, openFor } from "./engine";
import { living, pickDoctorSave, pickSeerInspect, pickWolfKill, resetDayTalk, uniquePush } from "./agents";
import { getLive, LiveStoreConflictError, releaseLeaseLive, setLive, tryLeaseLive } from "./live-store";
import { adminView, playerView, prettyJerusalem } from "./view";
import { chooseDirectorEvent } from "./director";
import { flushPushOutbox, queuePush } from "./push";
import {
  chooseVote,
  endReveal,
  ensureAgentState,
  makeBudget,
  onDirectorEvent,
  onNewDay,
  onPublicMessage,
  onVote,
  onWolfMessage,
  runAgentEvents,
  scheduleDay,
  scheduleNight,
  scheduleNightStep,
  type TickBudget,
} from "./live-agents";

export { prettyJerusalem };

const TZ = "Asia/Jerusalem";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_WINDOW_STEPS = 8;
const LEASE_MS = 15_000;
const MIN = 60_000;
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
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return c;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pickAllowed<T extends number>(value: unknown, options: readonly T[], fallback: T): T {
  const n = Number(value);
  return (options as readonly number[]).includes(n) ? (n as T) : fallback;
}

function rulesFor(game: LiveGame): LiveRules {
  const raw: Partial<LiveRules> = game.rules ?? DEFAULT_LIVE_RULES;
  const seats = clamp(raw.seats ?? DEFAULT_LIVE_RULES.seats, MIN_LIVE_SEATS, MAX_LIVE_SEATS);
  const wolfCount = clamp(raw.wolfCount ?? Math.max(1, Math.floor(seats / 4)), 1, Math.max(1, Math.floor((seats - 1) / 2)));
  const rules: LiveRules = {
    seats,
    wolfCount,
    hasSeer: raw.hasSeer ?? true,
    hasDoctor: raw.hasDoctor ?? true,
    identityMode: raw.identityMode === "real" ? "real" : "aliases",
    botMode: raw.botMode === "humans_only" ? "humans_only" : "fill",
    directorStyle: raw.directorStyle && ["classic", "dynamic", "wild"].includes(raw.directorStyle) ? raw.directorStyle : "dynamic",
    mode: raw.mode === "quick" ? "quick" : "scheduled",
    quickDayMinutes: pickAllowed(raw.quickDayMinutes, QUICK_DAY_OPTIONS, DEFAULT_LIVE_RULES.quickDayMinutes),
    quickNightMinutes: pickAllowed(raw.quickNightMinutes, QUICK_NIGHT_OPTIONS, DEFAULT_LIVE_RULES.quickNightMinutes),
  };
  game.rules = rules;
  game.directorEvents ??= [];
  return rules;
}

function parseRules(input: Partial<LiveRules>): LiveRules {
  const seats = clamp(Number(input.seats ?? DEFAULT_LIVE_RULES.seats), MIN_LIVE_SEATS, MAX_LIVE_SEATS);
  return {
    seats,
    wolfCount: clamp(Number(input.wolfCount ?? Math.max(1, Math.floor(seats / 4))), 1, Math.max(1, Math.floor((seats - 1) / 2))),
    hasSeer: input.hasSeer !== false,
    hasDoctor: input.hasDoctor !== false,
    identityMode: input.identityMode === "real" ? "real" : "aliases",
    botMode: input.botMode === "humans_only" ? "humans_only" : "fill",
    directorStyle: input.directorStyle === "classic" || input.directorStyle === "wild" ? input.directorStyle : "dynamic",
    mode: input.mode === "quick" ? "quick" : "scheduled",
    quickDayMinutes: pickAllowed(input.quickDayMinutes, QUICK_DAY_OPTIONS, DEFAULT_LIVE_RULES.quickDayMinutes),
    quickNightMinutes: pickAllowed(input.quickNightMinutes, QUICK_NIGHT_OPTIONS, DEFAULT_LIVE_RULES.quickNightMinutes),
  };
}

function parseGender(raw: unknown, name: string): Gender {
  if (raw === "f" || raw === "m") return raw;
  return genderOfName(name);
}

function isQuick(game: LiveGame) {
  return rulesFor(game).mode === "quick";
}

function roleDeck(count: number, rules: LiveRules): Role[] {
  const wolves = clamp(rules.wolfCount, 1, Math.max(1, Math.floor((count - 1) / 2)));
  const deck: Role[] = Array.from({ length: wolves }, () => "wolf" as const);
  if (rules.hasSeer && deck.length < count) deck.push("seer");
  if (rules.hasDoctor && deck.length < count) deck.push("doctor");
  while (deck.length < count) deck.push("villager");
  return deck;
}

function publicName(realName: string, gender: Gender, rules: LiveRules, used: string[]) {
  if (rules.identityMode === "aliases") return nextFakeName(used, gender);
  if (!used.includes(realName)) return realName;
  let suffix = 2;
  while (used.includes(`${realName} ${suffix}`)) suffix += 1;
  return `${realName} ${suffix}`;
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
  if (!secret) return null;
  for (const [id, s] of Object.entries(game.secrets)) {
    if (secretsEqual(s, secret)) {
      return game.players.find((p) => p.id === id) ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time in Jerusalem
// ---------------------------------------------------------------------------

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
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
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

export function jerusalemToUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
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

function initialWindow(game: LiveGame, now: number) {
  if (isQuick(game)) {
    return {
      phase: "day" as const,
      windowStartAt: now,
      nextLockAt: now + rulesFor(game).quickDayMinutes * MIN,
      dayNumber: 1,
      waitWeekday: null as number | null,
    };
  }
  const schedule = game.schedule;
  const p = tzParts(now);
  const start = parseHm(schedule.dayStart);
  const end = parseHm(schedule.dayEnd);
  const startMs = jerusalemToUtc(p.year, p.month, p.day, start.h, start.m);
  const endMs = jerusalemToUtc(p.year, p.month, p.day, end.h, end.m);
  const play = schedule.days.includes(p.weekday);
  if (play && now >= startMs && now < endMs) {
    return { phase: "day" as const, windowStartAt: startMs, nextLockAt: endMs, dayNumber: 1, waitWeekday: null as number | null };
  }
  const next = nextPlayDayStart(now, schedule);
  return { phase: "wait" as const, windowStartAt: now, nextLockAt: next, dayNumber: 0, waitWeekday: tzParts(next).weekday };
}

// ---------------------------------------------------------------------------
// Narration and deaths
// ---------------------------------------------------------------------------

function announce(game: LiveGame, text: string, at?: number, tone?: ChatMessage["tone"]) {
  uniquePush(game, {
    channel: "public",
    authorId: null,
    authorName: "מערכת",
    text,
    narrator: true,
    ts: at,
    tone,
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
  const f = p.gender === "f";
  const was = f ? "הייתה" : "היה";
  const extra = kind === "human" && p.realName ? `${was} ${p.realName}.` : `לא ${was} בן אדם.`;
  announce(game, `${p.name} ${how}. ${was} ${roleHe}. ${extra}`, at);
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

function humanIds(game: LiveGame, onlyAlive = false): string[] {
  return game.players.filter((p) => p.kind === "human" && (!onlyAlive || p.alive)).map((p) => p.id);
}

function finishIfWon(game: LiveGame, at: number): boolean {
  if (!checkWin(game, at)) return false;
  endReveal(game, at);
  game.nextLockAt = at;
  game.openChannel = "none";
  queuePush(game, { kind: "game_over", playerIds: humanIds(game), title: "המשחק נגמר", body: game.winnerText || "הקלפים על השולחן.", tag: "game_over", at });
  return true;
}

const DIRECTOR_TITLES: Record<DirectorEvent["type"], string> = {
  omen: "רמז מהבמאי",
  silence: "איום לילי",
  lost_vote: "פתק קרוע",
  leak: "לחישה שדלפה",
  blood_moon: "ירח דם",
};

function randomOne<T>(items: T[]): T | null {
  return items.length ? items[Math.floor(Math.random() * items.length)]! : null;
}

async function applyDirectorEvent(game: LiveGame, at: number) {
  const decision = await chooseDirectorEvent(game);
  if (!decision) return;

  const alive = living(game);
  let text = decision.narration;

  if (decision.type === "silence") {
    const target = randomOne(alive);
    if (!target) return;
    target.muted = true;
    text = `${text} ${target.name} לא ${target.gender === "f" ? "יכולה" : "יכול"} לדבר היום.`;
  } else if (decision.type === "lost_vote") {
    const target = randomOne(alive);
    if (!target) return;
    target.cannotVote = true;
    text = `${text} הקול של ${target.name} לא ייספר היום.`;
  } else if (decision.type === "leak") {
    const whisper = [...game.messages].reverse().find((message) => message.channel === "wolves" && !message.narrator);
    if (!whisper) return;
    text = `${text} “${whisper.text.slice(0, 110)}”`;
  } else if (decision.type === "omen") {
    const wolf = randomOne(alive.filter((player) => player.role === "wolf"));
    const town = randomOne(alive.filter((player) => player.role !== "wolf"));
    if (!wolf || !town) return;
    const pair = shuffle([wolf.name, town.name], rnd);
    text = `${text} אחד מבין ${pair[0]} ו${pair[1]} הוא זאב.`;
  } else if (decision.type === "blood_moon") {
    const extraVictim = randomOne(alive.filter((player) => player.role !== "wolf"));
    if (!extraVictim) return;
    text = `${text} ${extraVictim.name} ${extraVictim.gender === "f" ? "נעלמה" : "נעלם"} תחת הירח האדום.`;
    liveKill(game, extraVictim.id, extraVictim.gender === "f" ? "נעלמה תחת הירח האדום" : "נעלם תחת הירח האדום", at);
  }

  const event: DirectorEvent = {
    id: uid("director"),
    type: decision.type,
    title: DIRECTOR_TITLES[decision.type],
    text,
    dayNumber: game.dayNumber + 1,
    ts: at,
  };
  game.directorEvents.unshift(event);
  game.directorEvents = game.directorEvents.slice(0, 20);
  game.eventLog.push(`במאי: ${event.title}`);
  announce(game, `✦ ${event.title}: ${text}`, at, "director");
  onDirectorEvent(game, event, at);
}

function applySeerLook(game: LiveGame, seer: Player, targetId: string, at: number) {
  const t = game.players.find((p) => p.id === targetId);
  if (!t) return;
  const isWolf = t.role === "wolf";
  if (!game.memories[seer.id]) {
    game.memories[seer.id] = { known: {}, messagesToday: 0, lastText: "", plannedVote: null, spokeAtProgress: [] };
  }
  const m = game.memories[seer.id]!;
  m.known[t.id] = isWolf ? "wolf" : "not_wolf";
  m.suspicion ??= {};
  m.reasons ??= {};
  m.suspicion[t.id] = isWolf ? 12 : -6;
  if (isWolf) m.reasons[t.id] = "בדקתי אותו בלילה";
  uniquePush(game, {
    channel: "seer",
    authorId: seer.id,
    authorName: seer.name,
    text: `${t.name}: ${isWolf ? (t.gender === "f" ? "זאבה" : "זאב") : (t.gender === "f" ? "לא זאבה" : "לא זאב")}`,
    narrator: true,
    ts: at,
  });
}

function applyDoctorLog(game: LiveGame, doc: Player, targetId: string, at: number) {
  const t = game.players.find((p) => p.id === targetId);
  uniquePush(game, {
    channel: "doctor",
    authorId: doc.id,
    authorName: doc.name,
    text: `${doc.gender === "f" ? "שומרת" : "שומר"} על ${t?.name ?? "?"} הלילה`,
    narrator: true,
    ts: at,
  });
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function enterDay(game: LiveGame, at: number, dayNumber: number) {
  game.dayNumber = dayNumber;
  game.phase = "day";
  game.openChannel = "public";
  game.votes = {};
  onNewDay(game, at);
  resetDayTalk(game);
  game.windowStartAt = at;
  if (isQuick(game)) {
    game.nextLockAt = at + rulesFor(game).quickDayMinutes * MIN;
  } else {
    game.nextLockAt = todayDayEnd(at, game.schedule);
    if (game.nextLockAt <= at) {
      // Safety: if the clock lands after today's closing time, lock at the next play day's end.
      const nextStart = nextPlayDayStart(at, game.schedule);
      game.nextLockAt = todayDayEnd(nextStart, game.schedule);
    }
  }
  setElapsed(game, at);
  scheduleDay(game, at);
  const alive = living(game).length;
  const closing = isQuick(game)
    ? `בעוד ${rulesFor(game).quickDayMinutes} דקות`
    : `ב${prettyJerusalem(game.nextLockAt).replace(/^יום \S+ /, "")}`;
  announce(game, `☀ יום ${dayNumber}. ${alive} בכפר. מדברים, מצביעים, ההצבעה ננעלת ${closing}.`, at, "recap");
  if (dayNumber > 1) {
    const kill = game.lastKill;
    const body = kill?.saved
      ? "ניסו להרוג בלילה ומישהו שמר. כולם חיים."
      : kill?.name
        ? `${kill.name} ${game.players.find((p) => p.id === kill.playerId)?.gender === "f" ? "נמצאה מתה" : "נמצא מת"}. ${kill.role ? `${game.players.find((p) => p.id === kill.playerId)?.gender === "f" ? "הייתה" : "היה"} ${ROLE_HE[kill.role]}.` : ""} ${alive} נשארו.`
        : `הלילה עבר בלי גופה. ${alive} בכפר.`;
    queuePush(game, { kind: "morning", playerIds: humanIds(game), title: `☀ יום ${dayNumber} ב-AiYara`, body: `${body} ההצבעה ננעלת ${closing}.`, tag: `morning-${dayNumber}`, at });
  }
}

function enterNight(game: LiveGame, at: number) {
  const nightEnd = isQuick(game) ? at + rulesFor(game).quickNightMinutes * MIN : nextPlayDayStart(at, game.schedule);
  const morning = isQuick(game) ? `בעוד ${rulesFor(game).quickNightMinutes} דקות` : prettyJerusalem(nightEnd);
  announce(game, `🌙 לילה. הכפר נסגר, הזאבים עובדים. הבוקר ${morning}.`, at, "recap");
  game.night = { wolfTarget: null, seerTarget: null, doctorTarget: null };
  game.phase = "night_wolves";
  game.openChannel = "wolves";
  resetDayTalk(game);
  const third = Math.max(1, (nightEnd - at) / 3);
  game.nightThirdMs = third;
  game.nightEndAt = nightEnd;
  game.windowStartAt = at;
  game.nextLockAt = at + third;
  setElapsed(game, at);
  scheduleNight(game, at);
  const wolves = game.players.filter((p) => p.kind === "human" && p.alive && p.role === "wolf").map((p) => p.id);
  if (wolves.length) {
    queuePush(game, { kind: "your_turn", playerIds: wolves, title: "🌙 התור שלך", body: "הלילה ירד. בחר מי לא יתעורר בבוקר.", tag: `turn-${game.dayNumber}-wolf`, at });
  }
  if (!isQuick(game)) {
    const others = humanIds(game).filter((id) => !wolves.includes(id));
    queuePush(game, { kind: "night", playerIds: others, title: "🌙 לילה בעיירה", body: `הכפר נסגר. הבוקר ${morning}.`, tag: `night-${game.dayNumber}`, at });
  }
}

function enterNightStep(game: LiveGame, at: number, phase: "night_seer" | "night_doctor") {
  game.phase = phase;
  game.openChannel = openFor(phase);
  game.windowStartAt = at;
  if (phase === "night_doctor") {
    game.nextLockAt = game.nightEndAt || at + (game.nightThirdMs || 0);
  } else {
    game.nextLockAt = at + (game.nightThirdMs || 0);
  }
  if (game.nextLockAt <= at) game.nextLockAt = at + MIN;
  setElapsed(game, at);
  scheduleNightStep(game, at, phase);
  const role = phase === "night_seer" ? "seer" : "doctor";
  const actor = game.players.find((p) => p.kind === "human" && p.alive && p.role === role);
  if (actor) {
    const f = actor.gender === "f";
    queuePush(game, {
      kind: "your_turn",
      playerIds: [actor.id],
      title: role === "seer" ? "🔮 התור שלך" : "🩺 התור שלך",
      body: role === "seer" ? `${f ? "בחרי" : "בחר"} מי לבדוק הלילה.` : `${f ? "בחרי" : "בחר"} על מי לשמור הלילה.`,
      tag: `turn-${game.dayNumber}-${role}`,
      at,
    });
  }
}

function resolveLiveDay(game: LiveGame, at: number) {
  for (const p of living(game)) {
    if (p.kind === "human" || p.cannotVote) continue;
    if (!game.votes[p.id]) {
      const t = chooseVote(game, p);
      if (t) game.votes[p.id] = t;
    }
  }
  const target = majorityTarget(game);
  if (target) {
    const victim = game.players.find((p) => p.id === target);
    game.lastLynch = {
      targetId: target,
      role: victim?.role ?? "villager",
      voters: Object.entries(game.votes)
        .filter(([, t]) => t === target)
        .map(([v]) => v),
      dayNumber: game.dayNumber,
    };
  } else {
    game.lastLynch = null;
  }
  for (const p of game.players) {
    p.muted = false;
    p.cannotVote = false;
  }
  if (target) {
    const victim = game.players.find((p) => p.id === target);
    const name = victim?.name ?? "";
    const count = Object.values(game.votes).filter((t) => t === target).length;
    announce(game, `ההצבעה ננעלה. ${count} קולות על ${name}. יש רוב.`, at);
    liveKill(game, target, victim?.gender === "f" ? "נתלתה" : "נתלה", at);
    queuePush(game, {
      kind: "lynch",
      playerIds: humanIds(game),
      title: "ההצבעה ננעלה",
      body: `${name} ${victim?.gender === "f" ? "נתלתה. הייתה" : "נתלה. היה"} ${ROLE_HE[victim?.role ?? "villager"]}.`,
      tag: `lynch-${game.dayNumber}`,
      at,
    });
    if (finishIfWon(game, at)) return;
  } else {
    announce(game, "ההצבעה ננעלה בלי רוב. אף אחד לא נתלה הפעם.", at);
    queuePush(game, { kind: "lynch", playerIds: humanIds(game), title: "ההצבעה ננעלה", body: "אין רוב. אף אחד לא נתלה, והלילה מגיע.", tag: `lynch-${game.dayNumber}`, at });
  }
  enterNight(game, at);
}

function resolveLiveWolves(game: LiveGame, at: number) {
  if (!game.night.wolfTarget) {
    const agentWolves = living(game).filter((p) => p.role === "wolf" && p.kind !== "human");
    if (agentWolves.length) game.night.wolfTarget = pickWolfKill(game);
  }
  enterNightStep(game, at, "night_seer");
}

function resolveLiveSeer(game: LiveGame, at: number) {
  const seer = living(game).find((p) => p.role === "seer");
  if (seer && !game.night.seerTarget && seer.kind !== "human") {
    game.night.seerTarget = pickSeerInspect(game, seer);
  }
  if (seer && game.night.seerTarget && !game.memories[seer.id]?.known[game.night.seerTarget]) {
    applySeerLook(game, seer, game.night.seerTarget, at);
  }
  enterNightStep(game, at, "night_doctor");
}

async function resolveLiveDoctor(game: LiveGame, at: number) {
  const doc = living(game).find((p) => p.role === "doctor");
  if (doc && !game.night.doctorTarget && doc.kind !== "human") {
    game.night.doctorTarget = pickDoctorSave(game, doc);
  }
  if (doc && game.night.doctorTarget) {
    applyDoctorLog(game, doc, game.night.doctorTarget, at);
  }
  await finishNight(game, at);
}

async function finishNight(game: LiveGame, at: number) {
  const targetId = game.night.wolfTarget;
  const saved = Boolean(targetId && targetId === game.night.doctorTarget);
  const target = targetId ? game.players.find((p) => p.id === targetId) : null;

  if (!target || !targetId) {
    game.lastKill = { playerId: null, name: null, role: null, saved: false };
    announce(game, "בוקר. הלילה עבר בלי גופה.", at);
  } else if (saved) {
    game.lastKill = { playerId: target.id, name: target.name, role: target.role, saved: true };
    announce(game, "בוקר. ניסו להרוג בלילה, ומישהו שמר. ההרג נכשל.", at);
  } else if (target.alive) {
    game.lastKill = { playerId: target.id, name: target.name, role: target.role, saved: false };
    announce(game, "בוקר.", at);
    liveKill(game, target.id, target.gender === "f" ? "נמצאה מתה בבוקר" : "נמצא מת בבוקר", at);
  }

  if (finishIfWon(game, at)) return;
  await applyDirectorEvent(game, at);
  if (finishIfWon(game, at)) return;
  enterDay(game, at, game.dayNumber + 1);
}

async function resolveLiveWindow(game: LiveGame, at: number) {
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
      await resolveLiveDoctor(game, at);
      break;
    default:
      game.nextLockAt = at + 86_400_000;
      break;
  }
}

/**
 * Bring a game up to `now`: replay the agents' planned actions, close windows
 * whose time has passed, and let agents act in the current window. Work is
 * bounded by `budget`; whatever is left over runs on the next request.
 */
export async function catchUp(game: LiveGame, now = Date.now(), budget: TickBudget = makeBudget()): Promise<LiveGame> {
  if (game.status !== "running" || game.phase === "ended") return game;
  rulesFor(game);
  ensureAgentState(game);
  let guard = 0;
  while (game.status === "running" && now >= game.nextLockAt && guard < MAX_WINDOW_STEPS) {
    guard += 1;
    const lockAt = game.nextLockAt;
    const complete = await runAgentEvents(game, lockAt, budget);
    if (!complete) return game;
    await resolveLiveWindow(game, lockAt);
    if (game.status !== "running") return game;
  }
  if (game.status === "running" && now < game.nextLockAt) {
    await runAgentEvents(game, now, budget);
  }
  return game;
}

// ---------------------------------------------------------------------------
// Names and input cleaning
// ---------------------------------------------------------------------------

function nextFakeName(used: string[], gender?: Gender): string {
  const pool = NAMES.filter((n) => !used.includes(n.name));
  const same = gender ? pool.filter((n) => n.gender === gender) : pool;
  const from = same.length ? same : pool;
  if (from.length) return from[Math.floor(Math.random() * from.length)]!.name;
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
  const t = raw.replace(/[\s-]/g, "").toUpperCase();
  if (t.length !== ROOM_CODE_LENGTH || [...t].some((character) => !CODE_ALPHABET.includes(character))) return null;
  return t;
}

export function parseSchedule(body: { dayStart?: string; dayEnd?: string; days?: number[] }): LiveSchedule | { error: string } {
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

function emptyLive(code: string, host: Player, secret: string, schedule: LiveSchedule, rules: LiveRules): LiveGame {
  const now = Date.now();
  return {
    id: uid("lg"),
    code,
    hostId: host.id,
    schedule,
    rules,
    directorEvents: [],
    remindersSent: [],
    claims: {},
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

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export type ActionResult =
  | { ok: true; game: LiveView | AdminView; me?: { playerId: string; secret: string; fakeName: string } }
  | { ok: false; error: string; status: number };

function viewOf(game: LiveGame, me: Player, now: number, extra?: { playerId: string; secret: string; fakeName: string }): ActionResult {
  return { ok: true, game: playerView(game, me, now), me: extra };
}

const NOT_FOUND: ActionResult = { ok: false, error: "אין משחק כזה", status: 404 };
const UNAUTHORIZED: ActionResult = { ok: false, error: "לא מזוהה", status: 401 };

/**
 * Load, change and save a game. When another request saved first, the change
 * is replayed on the fresh state so no player action is silently lost.
 */
async function mutate(code: string, fn: (game: LiveGame, now: number) => Promise<ActionResult>, retries = 3): Promise<ActionResult> {
  for (let attempt = 0; ; attempt++) {
    const game = await getLive(code);
    if (!game) return NOT_FOUND;
    const result = await fn(game, Date.now());
    if (!result.ok) return result;
    try {
      await setLive(game);
      return result;
    } catch (error) {
      if (error instanceof LiveStoreConflictError && attempt < retries) continue;
      throw error;
    }
  }
}

/**
 * Load a game for reading. Reads never run the agent engine inline: the
 * response goes out at once and `advanceLiveGame` runs afterwards, so the
 * client sees new lines on its next poll instead of waiting for the model.
 */
async function loadForRead(code: string, secret: string): Promise<{ game: LiveGame; me: Player; now: number } | ActionResult> {
  const game = await getLive(code);
  if (!game) return NOT_FOUND;
  const me = findPlayerBySecret(game, secret);
  if (!me) return UNAUTHORIZED;
  return { game, me, now: Date.now() };
}

/**
 * Background pass: bring one game up to date and persist it. Called after a
 * response has been sent (route handlers) and by the cron. The lease makes
 * sure only one pass runs per game at a time; the version check protects the
 * data if two still overlap.
 */
export async function advanceLiveGame(code: string, budget: TickBudget = makeBudget({ maxLlm: 4, deadlineMs: 12_000 })): Promise<void> {
  const clean = cleanCode(code);
  if (!clean) return;
  const now = Date.now();
  const leased = await tryLeaseLive(clean, LEASE_MS, now);
  if (!leased) return;
  let saved = false;
  try {
    const game = await getLive(clean);
    if (!game) return;
    const before = JSON.stringify(game);
    if (game.status === "running") await catchUp(game, now, budget);
    // Deliver notifications queued by this pass or by a player's action just before it.
    await flushPushOutbox(game);
    if (JSON.stringify(game) !== before) {
      await setLive(game);
      saved = true;
    }
  } catch (error) {
    if (!(error instanceof LiveStoreConflictError)) console.error("advanceLiveGame failed", error);
  } finally {
    if (!saved) await releaseLeaseLive(clean);
  }
}

/**
 * Before a player acts, close any window whose time has passed and replay due
 * agent actions with canned lines only, so the action is judged against the
 * real phase without waiting on the model. Model-quality lines for anything
 * still pending come from the background pass right after the response.
 */
async function advanceForWrite(game: LiveGame, now: number): Promise<ActionResult | null> {
  if (game.status !== "running") return null;
  await catchUp(game, now, makeBudget({ maxLlm: 0, maxEvents: 60, deadlineMs: 6_000 }));
  if (game.status === "running" && now >= game.nextLockAt) {
    return { ok: false, error: "המשחק מתעדכן, נסה שוב בעוד רגע", status: 409 };
  }
  return null;
}

export async function createLiveGame(input: {
  realName: string;
  gender?: string;
  dayStart?: string;
  dayEnd?: string;
  days?: number[];
  rules?: Partial<LiveRules>;
}): Promise<ActionResult> {
  const realName = cleanName(input.realName);
  if (!realName) return { ok: false, error: "צריך שם", status: 400 };
  const schedule = parseSchedule(input);
  if ("error" in schedule) return { ok: false, error: schedule.error, status: 400 };
  const rules = parseRules(input.rules ?? {});
  const gender = parseGender(input.gender, realName);

  const secret = makeSecret();
  const host: Player = {
    id: uid("h"),
    name: publicName(realName, gender, rules, []),
    role: "villager",
    personality: "chatty",
    alive: true,
    muted: false,
    cannotVote: false,
    kind: "human",
    realName,
    host: true,
    gender,
  };
  for (let guard = 0; guard < 20; guard += 1) {
    const game = emptyLive(makeCode(), host, secret, schedule, rules);
    try {
      await setLive(game);
      return viewOf(game, host, Date.now(), { playerId: host.id, secret, fakeName: host.name });
    } catch (error) {
      if (!(error instanceof LiveStoreConflictError)) throw error;
    }
  }
  return { ok: false, error: "לא הצלחנו ליצור קוד משחק, נסה שוב", status: 503 };
}

export async function joinLiveGame(input: { code: string; realName: string; gender?: string; secret?: string }): Promise<ActionResult> {
  const code = cleanCode(input.code);
  if (!code) return { ok: false, error: "קוד לא תקין", status: 400 };
  let created: { playerId: string; secret: string; fakeName: string } | undefined;
  return mutate(code, async (game, now) => {
    if (input.secret) {
      const existing = findPlayerBySecret(game, input.secret);
      if (existing) {
        if (game.status === "running") {
          const busy = await advanceForWrite(game, now);
          if (busy) return busy;
        }
        return viewOf(game, existing, now, { playerId: existing.id, secret: input.secret, fakeName: existing.name });
      }
    }
    if (game.phase !== "lobby") return { ok: false, error: "המשחק כבר התחיל", status: 400 };
    const rules = rulesFor(game);
    if (game.players.length >= rules.seats) return { ok: false, error: "מלא", status: 400 };
    const realName = cleanName(input.realName);
    if (!realName) return { ok: false, error: "צריך שם", status: 400 };
    const gender = parseGender(input.gender, realName);
    const secret = created?.secret ?? makeSecret();
    const player: Player = {
      id: created?.playerId ?? uid("p"),
      name: publicName(realName, gender, rules, game.players.map((p) => p.name)),
      role: "villager",
      personality: "chatty",
      alive: true,
      muted: false,
      cannotVote: false,
      kind: "human",
      realName,
      host: false,
      gender,
    };
    created = { playerId: player.id, secret, fakeName: player.name };
    game.players.push(player);
    game.secrets[player.id] = secret;
    return viewOf(game, player, now, created);
  });
}

export async function startLiveGame(input: { code: string; secret: string }): Promise<ActionResult> {
  const code = cleanCode(input.code);
  if (!code) return NOT_FOUND;
  return mutate(code, async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    if (me.id !== game.hostId) return { ok: false, error: "רק המנהל", status: 403 };
    if (game.phase !== "lobby") return { ok: false, error: "כבר התחיל", status: 400 };
    const humans = game.players.filter((p) => p.kind === "human");
    const rules = rulesFor(game);
    if (rules.botMode === "humans_only" && humans.length < rules.seats) {
      return { ok: false, error: `במצב ללא בוטים מחכים לכל ${rules.seats} השחקנים`, status: 400 };
    }
    if (humans.length < 1) return { ok: false, error: "צריך לפחות שחקן אחד", status: 400 };

    const targetCount = rules.botMode === "fill" ? rules.seats : Math.max(humans.length, MIN_LIVE_SEATS);
    const need = Math.max(0, targetCount - game.players.length);
    const usedNames = game.players.map((p) => p.name);
    const agentNames = pickNames(NAME_POOL.length, rnd).filter((n) => !usedNames.includes(n));
    const personalities = shuffle([...ALL_PERSONALITIES], rnd);
    for (let i = 0; i < need; i++) {
      const name = agentNames[i] ?? `שחקן${game.players.length + 1}`;
      game.players.push({
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
        gender: genderOfName(name),
      });
    }

    const roles = shuffle(roleDeck(game.players.length, rules), rnd) as Role[];
    const pers = shuffle([...ALL_PERSONALITIES], rnd);
    game.players.forEach((p, i) => {
      p.role = roles[i] ?? "villager";
      if (p.kind !== "human") p.personality = pers[i % pers.length] ?? p.personality;
      p.gender ??= genderOfName(p.realName ?? p.name);
      game.memories[p.id] = { known: {}, messagesToday: 0, lastText: "", plannedVote: null, spokeAtProgress: [], suspicion: {}, reasons: {}, saidToday: [] };
    });
    ensureAgentState(game);

    const win = initialWindow(game, now);
    game.startedAt = now;
    game.status = "running";
    game.lastAgentPulseAt = now;
    announce(game, `${game.players.length} שמות סביב השולחן. ${rules.wolfCount} מהם זאבים. הבמאי צופה.`, now);

    if (win.phase === "day") {
      enterDay(game, now, 1);
    } else {
      game.phase = "wait";
      game.dayNumber = 0;
      game.windowStartAt = win.windowStartAt;
      game.nextLockAt = win.nextLockAt;
      game.waitWeekday = win.waitWeekday;
      game.openChannel = openFor("wait");
      setElapsed(game, now);
      announce(game, `הכפר סגור עכשיו. היום הראשון נפתח ב${prettyJerusalem(win.nextLockAt)}.`, now);
    }

    await catchUp(game, now, makeBudget({ maxLlm: 0 }));
    return viewOf(game, me, now);
  });
}

export async function liveGet(input: { code: string; secret: string }): Promise<ActionResult> {
  const loaded = await loadForRead(input.code.trim(), input.secret);
  if ("ok" in loaded) return loaded;
  return viewOf(loaded.game, loaded.me, loaded.now);
}

export async function liveAdminGet(input: { code: string; secret: string }): Promise<ActionResult> {
  const loaded = await loadForRead(input.code.trim(), input.secret);
  if ("ok" in loaded) return loaded;
  if (loaded.me.id !== loaded.game.hostId) return { ok: false, error: "רק המנהל", status: 403 };
  return { ok: true, game: adminView(loaded.game, loaded.me, loaded.now) };
}

export async function liveSay(input: { code: string; secret: string; text: string }): Promise<ActionResult> {
  return mutate(input.code.trim(), async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    const busy = await advanceForWrite(game, now);
    if (busy) return busy;

    const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return { ok: false, error: "ריק", status: 400 };
    if (text.length > 240) return { ok: false, error: "ארוך מדי", status: 400 };
    if (!me.alive) return { ok: false, error: "מתים לא כותבים", status: 400 };
    if (me.muted) return { ok: false, error: "נסתמת היום", status: 400 };

    const wolfOk = game.phase === "night_wolves" && me.role === "wolf" && game.openChannel === "wolves";
    const dayOk = game.phase === "day" && game.openChannel === "public";
    if (!wolfOk && !dayOk) return { ok: false, error: "הצ'אט סגור עכשיו", status: 400 };

    const sent = uniquePush(game, {
      channel: wolfOk ? "wolves" : "public",
      authorId: me.id,
      authorName: me.name,
      text,
      ts: now,
    });
    if (!sent) return { ok: false, error: "ההודעה לא נשלחה", status: 400 };
    game.lastHumanActionAt = now;
    if (dayOk) onPublicMessage(game, sent, now);
    else onWolfMessage(game, sent, now);
    return viewOf(game, me, now);
  });
}

export async function liveVote(input: { code: string; secret: string; targetId: string }): Promise<ActionResult> {
  return mutate(input.code.trim(), async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    const busy = await advanceForWrite(game, now);
    if (busy) return busy;
    if (game.phase !== "day") return { ok: false, error: "לא עכשיו", status: 400 };
    if (!me.alive) return { ok: false, error: "מתים לא מצביעים", status: 400 };
    if (me.cannotVote) return { ok: false, error: "אין לך הצבעה היום", status: 400 };
    const target = game.players.find((p) => p.id === input.targetId);
    if (!target?.alive) return { ok: false, error: "על מי", status: 400 };
    if (game.votes[me.id] !== target.id) {
      game.votes[me.id] = target.id;
      onVote(game, me, target.id, now);
    }
    game.lastHumanActionAt = now;
    return viewOf(game, me, now);
  });
}

export async function liveNightPick(input: { code: string; secret: string; targetId: string }): Promise<ActionResult> {
  return mutate(input.code.trim(), async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    const busy = await advanceForWrite(game, now);
    if (busy) return busy;
    if (!me.alive) return { ok: false, error: "מתים לא פועלים", status: 400 };
    const target = game.players.find((p) => p.id === input.targetId);
    if (!target?.alive) return { ok: false, error: "על מי", status: 400 };
    game.lastHumanActionAt = now;

    if (game.phase === "night_wolves" && me.role === "wolf") {
      if (target.role === "wolf") return { ok: false, error: "לא על הזאבים", status: 400 };
      game.night.wolfTarget = target.id;
      return viewOf(game, me, now);
    }
    if (game.phase === "night_seer" && me.role === "seer") {
      if (target.id === me.id) return { ok: false, error: "לא על עצמך", status: 400 };
      if (game.night.seerTarget && game.memories[me.id]?.known[game.night.seerTarget]) {
        return { ok: false, error: "כבר בדקת הלילה", status: 400 };
      }
      game.night.seerTarget = target.id;
      applySeerLook(game, me, target.id, now);
      return viewOf(game, me, now);
    }
    if (game.phase === "night_doctor" && me.role === "doctor") {
      game.night.doctorTarget = target.id;
      return viewOf(game, me, now);
    }
    return { ok: false, error: "לא התור שלך", status: 400 };
  });
}

/** The host closes the table early. Every role is revealed so the group can debrief. */
export async function endLiveGame(input: { code: string; secret: string }): Promise<ActionResult> {
  return mutate(input.code.trim(), async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    if (me.id !== game.hostId) return { ok: false, error: "רק המנהל", status: 403 };
    if (game.status === "ended") return { ok: true, game: adminView(game, me, now) };
    game.status = "ended";
    game.phase = "ended";
    game.openChannel = "none";
    game.winner = null;
    game.winnerText = "המנהל סיים את המשחק.";
    game.nextLockAt = now;
    announce(game, "המנהל סיים את המשחק לפני הזמן.", now, "alert");
    endReveal(game, now);
    game.eventLog.push(`יום ${game.dayNumber}: המנהל סיים את המשחק`);
    queuePush(game, { kind: "game_over", playerIds: humanIds(game), title: "המשחק נגמר", body: "המנהל סיים את המשחק. הקלפים על השולחן.", tag: "game_over", at: now });
    return { ok: true, game: adminView(game, me, now) };
  });
}

export async function setLiveSchedule(input: {
  code: string;
  secret: string;
  dayStart?: string;
  dayEnd?: string;
  days?: number[];
}): Promise<ActionResult> {
  return mutate(input.code.trim(), async (game, now) => {
    const me = findPlayerBySecret(game, input.secret);
    if (!me) return UNAUTHORIZED;
    if (me.id !== game.hostId) return { ok: false, error: "רק המנהל", status: 403 };
    if (game.phase !== "lobby") return { ok: false, error: "אפשר לשנות שעות רק לפני שמתחילים", status: 400 };
    const schedule = parseSchedule(input);
    if ("error" in schedule) return { ok: false, error: schedule.error, status: 400 };
    game.schedule = schedule;
    return { ok: true, game: adminView(game, me, now) };
  });
}

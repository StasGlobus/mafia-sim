import type {
  Channel,
  GameConfig,
  GameState,
  Personality,
  Phase,
  Player,
  Role,
  Speed,
} from "./types";
import { DEFAULT_CONFIG, ROLE_HE } from "./types";
import { pickNames, shuffle } from "./names";
import {
  doctorPulse,
  dayPulse,
  living,
  pickDoctorSave,
  pickDayVote,
  pickSeerInspect,
  pickWolfKill,
  rnd,
  resetDayTalk,
  seerPulse,
  uniquePush,
  wolfPulse,
} from "./agents";
import { fill, pick, PHRASES } from "./phrases";

export const DECK_ROLES: Role[] = [
  "wolf",
  "wolf",
  "seer",
  "doctor",
  "villager",
  "villager",
  "villager",
  "villager",
];

export const ALL_PERSONALITIES: Personality[] = [
  "chatty",
  "quiet",
  "suspicious",
  "rambling",
  "joker",
  "anxious",
  "cold",
  "naive",
];

function uid(prefix: string) {
  return `${prefix}_${Math.floor(rnd() * 1e9).toString(36)}`;
}

function durationFor(phase: Phase, config: GameConfig): number {
  switch (phase) {
    case "wait":
    case "lobby":
    case "ended":
      return 0;
    case "dawn":
      return config.dawnMs;
    case "day":
      return config.dayMs;
    case "hang":
      return config.hangMs;
    case "night_wolves":
    case "night_seer":
    case "night_doctor":
      return config.nightStepMs;
    default:
      return 0;
  }
}

export function openFor(phase: Phase): Channel {
  switch (phase) {
    case "day":
      return "public";
    case "night_wolves":
      return "wolves";
    case "night_seer":
      return "seer";
    case "night_doctor":
      return "doctor";
    case "wait":
    default:
      return "none";
  }
}

function enterPhase(state: GameState, phase: Phase) {
  state.phase = phase;
  state.phaseElapsedMs = 0;
  state.phaseDurationMs = durationFor(phase, state.config);
  state.openChannel = openFor(phase);
  if (phase === "day") {
    state.votes = {};
    resetDayTalk(state);
    for (const p of state.players) {
      // muted/cannotVote apply to this day then clear at end
    }
  }
  if (phase === "night_wolves") {
    state.night.wolfTarget = null;
    resetDayTalk(state);
  }
  if (phase === "night_seer") state.night.seerTarget = null;
  if (phase === "night_doctor") state.night.doctorTarget = null;
}

export function logEvent(state: GameState, text: string, at?: number) {
  state.eventLog.push(`יום ${state.dayNumber}: ${text}`);
  uniquePush(state, {
    channel: "events",
    authorId: null,
    authorName: "מערכת",
    text,
    narrator: true,
    ts: at,
  });
}

export function narrator(state: GameState, text: string, at?: number) {
  uniquePush(state, {
    channel: "public",
    authorId: null,
    authorName: "מערכת",
    text,
    narrator: true,
    ts: at,
  });
}

function heCount(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function checkWin(state: GameState, at?: number): boolean {
  const alive = living(state);
  const wolves = alive.filter((p) => p.role === "wolf");
  const town = alive.filter((p) => p.role !== "wolf");
  if (wolves.length === 0) {
    state.status = "ended";
    state.phase = "ended";
    state.winner = "town";
    state.winnerText = "התושבים ניצחו. לא נשארו זאבים.";
    state.openChannel = "none";
    narrator(state, "התושבים ניצחו. לא נשארו זאבים. העיירה נקייה.", at);
    logEvent(state, "ניצחון תושבים", at);
    return true;
  }
  if (wolves.length >= town.length) {
    state.status = "ended";
    state.phase = "ended";
    state.winner = "wolves";
    const wolfPart = heCount(wolves.length, "זאב", "זאבים");
    const townPart = heCount(town.length, "תושב", "תושבים");
    state.winnerText = `הזאבים ניצחו. נשארו ${wolfPart} מול ${townPart}.`;
    state.openChannel = "none";
    narrator(state, `הזאבים ניצחו. נשארו ${wolfPart} מול ${townPart}. העיירה שלהם עכשיו.`, at);
    logEvent(state, "ניצחון זאבים", at);
    return true;
  }
  return false;
}

export function killPlayer(state: GameState, id: string, how: string) {
  const p = state.players.find((x) => x.id === id);
  if (!p || !p.alive) return;
  p.alive = false;
  const extra =
    p.kind === "human" && p.realName
      ? `היה ${p.realName}.`
      : "לא היה בן אדם.";
  narrator(state, `${p.name} ${how}. היה ${ROLE_HE[p.role]}. ${extra}`);
  logEvent(state, `${p.name} מת (${ROLE_HE[p.role]})`);
}

function maybeEvent(state: GameState) {
  if (state.dayNumber <= 1) return;
  if (rnd() > 0.38) return;
  const alive = living(state);
  if (!alive.length) return;
  const victim = pick(alive, rnd);
  const roll = rnd();
  if (roll < 0.24) {
    victim.muted = true;
    const text = `✦ הבמאי: ${victim.name} קיבל איום. הוא לא כותב היום.`;
    narrator(state, text);
    logEvent(state, text);
  } else if (roll < 0.48) {
    victim.cannotVote = true;
    const text = `✦ הבמאי: הפתק של ${victim.name} נקרע. אין לו הצבעה היום.`;
    narrator(state, text);
    logEvent(state, text);
  } else if (roll < 0.7) {
    const wolfLine = [...state.messages]
      .reverse()
      .find((m) => m.channel === "wolves" && m.authorId);
    if (wolfLine) {
      const text = `✦ הבמאי הדליף לחישה, בלי שם: «${wolfLine.text}»`;
      narrator(state, text);
      logEvent(state, "דליפה מערוץ הזאבים (בלי שם)");
    } else {
      victim.muted = true;
      const text = `✦ הבמאי: ${victim.name} לא יכול לדבר היום.`;
      narrator(state, text);
      logEvent(state, text);
    }
  } else if (roll < 0.9) {
    const wolf = pick(alive.filter((player) => player.role === "wolf"), rnd);
    const town = pick(alive.filter((player) => player.role !== "wolf"), rnd);
    if (!wolf || !town) return;
    const pair = shuffle([wolf.name, town.name], rnd);
    const text = `✦ רמז מהבמאי: אחד מבין ${pair[0]} ו${pair[1]} הוא זאב.`;
    narrator(state, text);
    logEvent(state, text);
  } else {
    const wolves = alive.filter((player) => player.role === "wolf");
    const town = alive.filter((player) => player.role !== "wolf");
    if (town.length < wolves.length + 3) return;
    const extra = pick(town, rnd);
    narrator(state, "✦ ירח דם. הלילה גובה מחיר נוסף.");
    killPlayer(state, extra.id, "נעלם תחת הירח האדום");
  }
}

function resolveDawn(state: GameState) {
  enterPhase(state, "day");
  narrator(state, "בוקר. מדברים, אחר כך מצביעים.");
}

export function majorityTarget(state: GameState): string | null {
  const alive = living(state);
  const need = Math.floor(alive.length / 2) + 1;
  const counts: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    const voter = state.players.find((p) => p.id === voterId);
    if (!voter?.alive) continue;
    counts[targetId] = (counts[targetId] ?? 0) + 1;
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of Object.entries(counts)) {
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  if (best && bestN >= need) return best;
  return null;
}

function resolveDay(state: GameState) {
  for (const p of living(state)) {
    if (p.cannotVote) continue;
    if (!state.votes[p.id]) {
      const t = pickDayVote(state, p);
      if (t) state.votes[p.id] = t;
    }
  }
  const target = majorityTarget(state);
  state.hangTarget = target;
  // clear day flags
  for (const p of state.players) {
    p.muted = false;
    p.cannotVote = false;
  }
  if (target) {
    const name = state.players.find((p) => p.id === target)?.name ?? "";
    narrator(state, `יש רוב. ${name}.`);
    enterPhase(state, "hang");
  } else {
    narrator(state, pick(PHRASES.NARRATOR_NO_HANG, rnd));
    logEvent(state, "אין רוב — אין תלייה");
    goNight(state);
  }
}

function resolveHang(state: GameState) {
  if (state.hangTarget) {
    killPlayer(state, state.hangTarget, "נתלה");
    state.hangTarget = null;
    if (checkWin(state)) return;
  }
  goNight(state);
}

function goNight(state: GameState) {
  narrator(state, pick(PHRASES.NARRATOR_NIGHT, rnd));
  enterPhase(state, "night_wolves");
}

function resolveWolves(state: GameState) {
  const wolvesAlive = living(state).some((p) => p.role === "wolf");
  if (!wolvesAlive) {
    checkWin(state);
    return;
  }
  if (!state.night.wolfTarget) {
    state.night.wolfTarget = pickWolfKill(state);
  }
  const seerAlive = living(state).some((p) => p.role === "seer");
  if (seerAlive) enterPhase(state, "night_seer");
  else {
    state.night.seerTarget = null;
    const docAlive = living(state).some((p) => p.role === "doctor");
    if (docAlive) enterPhase(state, "night_doctor");
    else finishNight(state);
  }
}

function resolveSeer(state: GameState) {
  const seer = living(state).find((p) => p.role === "seer");
  if (seer && !state.night.seerTarget) {
    state.night.seerTarget = pickSeerInspect(state, seer);
  }
  if (seer && state.night.seerTarget) {
    const t = state.players.find((p) => p.id === state.night.seerTarget);
    if (t) {
      const isWolf = t.role === "wolf";
      state.memories[seer.id] = state.memories[seer.id] ?? {
        known: {},
        messagesToday: 0,
        lastText: "",
        plannedVote: null,
        spokeAtProgress: [],
      };
      state.memories[seer.id].known[t.id] = isWolf ? "wolf" : "not_wolf";
      uniquePush(state, {
        channel: "seer",
        authorId: seer.id,
        authorName: seer.name,
        text: `${t.name}: ${isWolf ? "זאב" : "לא זאב"}`,
        narrator: true,
      });
      logEvent(state, `רואה בדק את ${t.name} (פרטי)`);
    }
  }
  const docAlive = living(state).some((p) => p.role === "doctor");
  if (docAlive) enterPhase(state, "night_doctor");
  else finishNight(state);
}

function resolveDoctor(state: GameState) {
  const doc = living(state).find((p) => p.role === "doctor");
  if (doc && !state.night.doctorTarget) {
    state.night.doctorTarget = pickDoctorSave(state, doc);
  }
  if (doc && state.night.doctorTarget) {
    const t = state.players.find((p) => p.id === state.night.doctorTarget);
    uniquePush(state, {
      channel: "doctor",
      authorId: doc.id,
      authorName: doc.name,
      text: fill(pick(PHRASES.DOCTOR_LOG, rnd), { t: t?.name ?? "?" }, { speaker: doc.gender, target: t?.gender }),
      narrator: true,
    });
    logEvent(state, `רופא בחר להגן (פרטי)`);
  }
  finishNight(state);
}

function finishNight(state: GameState) {
  const targetId = state.night.wolfTarget;
  const saved = Boolean(targetId && targetId === state.night.doctorTarget);
  const target = targetId ? state.players.find((p) => p.id === targetId) : null;

  state.dayNumber += 1;
  enterPhase(state, "dawn");
  narrator(state, pick(PHRASES.NARRATOR_DAWN, rnd));

  if (!target || !targetId) {
    state.lastKill = { playerId: null, name: null, role: null, saved: false };
    narrator(state, "הלילה עבר בלי גופה. מוזר.");
  } else if (saved) {
    state.lastKill = {
      playerId: target.id,
      name: target.name,
      role: target.role,
      saved: true,
    };
    narrator(state, "ניסו להרוג. מישהו שמר. נכשל.");
    logEvent(state, "ההרג נכשל (הגנת רופא)");
  } else if (target.alive) {
    state.lastKill = {
      playerId: target.id,
      name: target.name,
      role: target.role,
      saved: false,
    };
    killPlayer(state, target.id, "נמצא מת בבוקר");
  }

  if (checkWin(state)) return;
  maybeEvent(state);
  checkWin(state);
}

function resolveCurrent(state: GameState) {
  switch (state.phase) {
    case "dawn":
      resolveDawn(state);
      break;
    case "day":
      resolveDay(state);
      break;
    case "hang":
      resolveHang(state);
      break;
    case "night_wolves":
      resolveWolves(state);
      break;
    case "night_seer":
      resolveSeer(state);
      break;
    case "night_doctor":
      resolveDoctor(state);
      break;
    default:
      break;
  }
}

async function pulse(state: GameState) {
  switch (state.phase) {
    case "day":
      await dayPulse(state);
      break;
    case "night_wolves":
      await wolfPulse(state);
      break;
    case "night_seer":
      seerPulse(state);
      break;
    case "night_doctor":
      doctorPulse(state);
      break;
    default:
      break;
  }
}

export function idleState(config: GameConfig = DEFAULT_CONFIG): GameState {
  const now = Date.now();
  return {
    id: "idle",
    status: "idle",
    phase: "lobby",
    dayNumber: 0,
    speed: 1,
    config: { ...config },
    players: [],
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

export function startGame(config: GameConfig, speed: Speed = 1): GameState {
  const now = Date.now();
  const names = pickNames(8, rnd);
  const roles = shuffle(DECK_ROLES, rnd);
  const personalities = shuffle(ALL_PERSONALITIES, rnd);
  const players: Player[] = names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    role: roles[i]!,
    personality: personalities[i]!,
    alive: true,
    muted: false,
    cannotVote: false,
  }));

  const state: GameState = {
    id: uid("g"),
    status: "running",
    phase: "dawn",
    dayNumber: 1,
    speed,
    config: { ...DEFAULT_CONFIG, ...config },
    players,
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

  for (const p of players) {
    state.memories[p.id] = {
      known: {},
      messagesToday: 0,
      lastText: "",
      plannedVote: null,
      spokeAtProgress: [],
    };
  }

  enterPhase(state, "dawn");
  narrator(state, "שמונה שמות. מי הזאב.");
  narrator(state, pick(PHRASES.NARRATOR_DAWN, rnd));
  narrator(state, "אין גופה. יום ראשון.");
  logEvent(state, "משחק חדש — 8 סוכנים");
  return state;
}

export async function tick(state: GameState, now = Date.now()): Promise<GameState> {
  if (state.status !== "running") {
    state.lastTickAt = now;
    return state;
  }
  let dt = now - state.lastTickAt;
  if (dt < 0) dt = 0;
  if (dt > 4000) dt = 4000;
  state.lastTickAt = now;
  state.phaseElapsedMs += dt * state.speed;

  if (now - state.lastPulseAt >= 700) {
    state.lastPulseAt = now;
    await pulse(state);
  }

  let guard = 0;
  while (
    state.status === "running" &&
    state.phaseDurationMs > 0 &&
    state.phaseElapsedMs >= state.phaseDurationMs &&
    guard < 8
  ) {
    guard += 1;
    const leftover = state.phaseElapsedMs - state.phaseDurationMs;
    resolveCurrent(state);
    if (state.status !== "running") break;
    state.phaseElapsedMs = Math.max(0, leftover);
  }
  return state;
}

export async function applyControl(
  state: GameState,
  action: string,
  extra?: { speed?: Speed; config?: Partial<GameConfig> },
): Promise<GameState> {
  const now = Date.now();
  if (action === "pause" && state.status === "running") {
    await tick(state, now);
    state.status = "paused";
    state.lastTickAt = now;
  } else if (action === "resume" && state.status === "paused") {
    state.status = "running";
    state.lastTickAt = now;
  } else if (action === "setSpeed" && extra?.speed) {
    await tick(state, now);
    state.speed = extra.speed;
    state.lastTickAt = now;
  } else if (action === "setConfig" && extra?.config) {
    state.config = { ...state.config, ...extra.config };
    if (state.phase !== "lobby" && state.phase !== "ended") {
      state.phaseDurationMs = durationFor(state.phase, state.config);
    }
  } else if (action === "restart") {
    return startGame(state.config, state.speed);
  }
  return state;
}

export function publicView(state: GameState) {
  return {
    ...state,
    messages: state.messages.filter(
      (m) => m.channel === "public" || m.channel === "events",
    ),
  };
}

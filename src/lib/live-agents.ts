import type { AgentMemory, ChatMessage, DirectorEvent, LiveGame, Personality, Player } from "./types";
import { ROLE_HE } from "./types";
import {
  claimedSeer,
  isDirectlyAddressed,
  leadingTarget,
  living,
  mem,
  others,
  pickDoctorSave,
  pickSeerInspect,
  pickWolfKill,
  rnd,
  townLiving,
  uniquePush,
  voteCounts,
} from "./agents";
import { lineFor, type SpeakKind } from "./phrases";
import { generateAgentLine, llmAvailable } from "./llm";
import { queuePush } from "./push";

/**
 * Agent behaviour for live games.
 *
 * Nothing here runs on a timer. Every agent keeps a small plan in its memory
 * (when to speak next, a pending reaction, when to vote) and `runAgentEvents`
 * replays whatever is due whenever a request arrives. Messages are stamped
 * with the moment they were due, so a player who comes back after an hour sees
 * a conversation that happened while they were away, not a burst of messages
 * at the second they opened the app.
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/** Backfilled lines older than this use canned text instead of the model. */
const LLM_FRESH_MS = 6 * HOUR;
const MAX_REACTIONS_PER_DAY = 4;

// ---------------------------------------------------------------------------
// Per-request budget
// ---------------------------------------------------------------------------

export interface TickBudget {
  startedAt: number;
  deadlineAt: number;
  llmCalls: number;
  maxLlm: number;
  events: number;
  maxEvents: number;
}

export function makeBudget(opts?: { maxLlm?: number; maxEvents?: number; deadlineMs?: number }): TickBudget {
  const startedAt = Date.now();
  return {
    startedAt,
    deadlineAt: startedAt + (opts?.deadlineMs ?? 9_000),
    llmCalls: 0,
    maxLlm: opts?.maxLlm ?? 3,
    events: 0,
    maxEvents: opts?.maxEvents ?? 40,
  };
}

function mayUseLlm(budget: TickBudget, at: number): boolean {
  if (!llmAvailable()) return false;
  if (budget.llmCalls >= budget.maxLlm) return false;
  if (Date.now() > budget.deadlineAt - 3_500) return false;
  if (Date.now() - at > LLM_FRESH_MS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Personality tuning
// ---------------------------------------------------------------------------

interface Talk {
  /** Average minutes between spontaneous messages on a twelve hour day. */
  gapMin: number;
  /** Spontaneous messages per day before jitter. */
  budget: number;
  /** Chance to answer back when attacked or voted against. */
  react: number;
  /** How much other people's votes and accusations move this agent. */
  herd: number;
  /** Chance to jump in soon after someone else speaks. */
  momentum: number;
  /** Chance to join the leading vote late in the day. */
  bandwagon: number;
}

const TALK: Record<Personality, Talk> = {
  chatty: { gapMin: 55, budget: 12, react: 0.8, herd: 0.5, momentum: 0.5, bandwagon: 0.6 },
  rambling: { gapMin: 75, budget: 9, react: 0.55, herd: 0.4, momentum: 0.35, bandwagon: 0.5 },
  anxious: { gapMin: 70, budget: 9, react: 0.9, herd: 0.6, momentum: 0.45, bandwagon: 0.7 },
  joker: { gapMin: 80, budget: 8, react: 0.6, herd: 0.4, momentum: 0.4, bandwagon: 0.55 },
  suspicious: { gapMin: 90, budget: 8, react: 0.7, herd: 0.15, momentum: 0.35, bandwagon: 0.3 },
  naive: { gapMin: 110, budget: 6, react: 0.6, herd: 1.0, momentum: 0.3, bandwagon: 0.9 },
  cold: { gapMin: 160, budget: 4, react: 0.4, herd: 0.3, momentum: 0.15, bandwagon: 0.3 },
  quiet: { gapMin: 200, budget: 3, react: 0.35, herd: 0.45, momentum: 0.1, bandwagon: 0.5 },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function jitter(a: number, b: number) {
  return a + rnd() * (b - a);
}

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function lognormal(sigma: number) {
  return Math.exp(gauss() * sigma);
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function agentsAlive(game: LiveGame): Player[] {
  return living(game).filter((p) => p.kind !== "human");
}

function byId(game: LiveGame, id: string | null | undefined): Player | null {
  if (!id) return null;
  return game.players.find((p) => p.id === id) ?? null;
}

function dayLength(game: LiveGame) {
  return Math.max(10 * MIN, game.nextLockAt - game.windowStartAt);
}

function progressAt(game: LiveGame, at: number) {
  return clamp((at - game.windowStartAt) / dayLength(game), 0, 1);
}

function minutesLeft(game: LiveGame, at: number) {
  return Math.max(0, Math.round((game.nextLockAt - at) / MIN));
}

function majorityNeed(game: LiveGame) {
  return Math.floor(living(game).length / 2) + 1;
}

function hasMajority(game: LiveGame) {
  const lead = leadingTarget(game);
  if (!lead) return false;
  return (voteCounts(game)[lead] ?? 0) >= majorityNeed(game);
}

function roleWord(role: string | null | undefined) {
  if (role === "wolf") return "זאב";
  if (role === "seer") return "רואה";
  if (role === "doctor") return "רופא";
  return "תושב";
}

function isPack(a: Player, b: Player) {
  return a.role === "wolf" && b.role === "wolf";
}

/** Public messages a player wrote in roughly the last day. */
function recentPublicCount(game: LiveGame, playerId: string, at: number) {
  return game.messages.filter((m) => m.channel === "public" && !m.narrator && m.authorId === playerId && m.ts > at - 26 * HOUR).length;
}

function latestOtherPublicTs(game: LiveGame, me: Player, at: number): number | null {
  for (let i = game.messages.length - 1; i >= 0; i--) {
    const m = game.messages[i]!;
    if (m.ts > at) continue;
    if (m.channel !== "public" || m.narrator || m.authorId === me.id) continue;
    return m.ts;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suspicion model
// ---------------------------------------------------------------------------

function suspicionOf(game: LiveGame, me: Player): Record<string, number> {
  const m = mem(game, me.id);
  m.suspicion ??= {};
  m.reasons ??= {};
  return m.suspicion;
}

/** Nudge how much `observer` suspects `targetId`. Wolves never suspect the pack. */
export function bump(game: LiveGame, observer: Player, targetId: string, delta: number, reason?: string) {
  if (observer.kind === "human") return;
  if (observer.id === targetId) return;
  const target = byId(game, targetId);
  if (!target || isPack(observer, target)) return;
  const m = mem(game, observer.id);
  const s = suspicionOf(game, observer);
  // Seer knowledge is never overridden by gossip.
  if (observer.role === "seer" && m.known[targetId]) return;
  s[targetId] = clamp((s[targetId] ?? 0) + delta, -6, 12);
  if (reason && delta > 0) m.reasons![targetId] = reason;
}

interface Suspect {
  player: Player;
  score: number;
  reason: string;
}

/** Has this player written anything in the current day window? */
function spokeToday(game: LiveGame, playerId: string): boolean {
  return game.messages.some((m) => m.channel === "public" && !m.narrator && m.authorId === playerId && m.ts >= game.windowStartAt);
}

/**
 * Early in the day, silence is not evidence. A human who is still reading must
 * not become the default target of every bored agent.
 */
function quietGrace(game: LiveGame, at = Date.now()): boolean {
  return game.phase === "day" && progressAt(game, at) < 0.4;
}

function topSuspect(game: LiveGame, me: Player, exclude: string[] = [], at = Date.now()): Suspect | null {
  const s = suspicionOf(game, me);
  const reasons = mem(game, me.id).reasons ?? {};
  const grace = quietGrace(game, at);
  let best: Suspect | null = null;
  for (const p of others(game, me)) {
    if (exclude.includes(p.id) || isPack(me, p)) continue;
    const base = s[p.id] ?? 0;
    // Without real evidence, prefer people who have actually said something.
    const penalty = grace && base < 0.8 && !spokeToday(game, p.id) ? -0.9 : 0;
    const score = base + penalty + rnd() * 0.3;
    if (!best || score > best.score) best = { player: p, score: base + rnd() * 0.3, reason: reasons[p.id] ?? "" };
  }
  return best;
}

function knownWolfAlive(game: LiveGame, me: Player): Player | null {
  const m = mem(game, me.id);
  for (const [id, k] of Object.entries(m.known)) {
    if (k !== "wolf") continue;
    const p = byId(game, id);
    if (p?.alive) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export function chooseVote(game: LiveGame, me: Player): string | null {
  const cands = others(game, me).filter((p) => !isPack(me, p));
  if (!cands.length) return null;
  const counts = voteCounts(game);
  const lead = leadingTarget(game);
  const leadP = lead ? cands.find((p) => p.id === lead) ?? null : null;

  if (me.role === "seer") {
    const wolf = knownWolfAlive(game, me);
    if (wolf) return wolf.id;
  }

  if (me.role === "wolf") {
    // Blend in: ride the town's own momentum, otherwise push the loudest accuser.
    if (leadP && (counts[lead!] ?? 0) >= 2 && rnd() < 0.8) return leadP.id;
    const top = topSuspect(game, me);
    if (top && top.score > 0.2) return top.player.id;
    const prey = townLiving(game).filter((p) => p.id !== me.id);
    return prey.length ? prey[Math.floor(rnd() * prey.length)]!.id : null;
  }

  const top = topSuspect(game, me);
  if (top && (top.score > 1.5 || (top.score > 0.6 && rnd() < 0.7))) return top.player.id;
  if (me.personality === "naive" && leadP) return leadP.id;
  if (me.personality === "suspicious") {
    const quietest = [...cands].sort((a, b) => recentPublicCount(game, a.id, Date.now()) - recentPublicCount(game, b.id, Date.now()))[0];
    if (quietest) return quietest.id;
  }
  if (leadP && (counts[lead!] ?? 0) >= 2 && rnd() < 0.5) return leadP.id;
  return top?.player.id ?? cands[Math.floor(rnd() * cands.length)]!.id;
}

function switchAllowed(game: LiveGame, me: Player, targetId: string) {
  const target = byId(game, targetId);
  if (!target || target.id === me.id || isPack(me, target)) return false;
  if (me.role === "seer" && mem(game, me.id).known[targetId] === "not_wolf") return false;
  const own = suspicionOf(game, me)[targetId] ?? 0;
  if (me.personality === "suspicious") return own > 1;
  return own > -0.8;
}

function setVote(game: LiveGame, me: Player, targetId: string, at: number) {
  if (game.votes[me.id] === targetId) return false;
  game.votes[me.id] = targetId;
  mem(game, me.id).plannedVote = targetId;
  onVote(game, me, targetId, at);
  return true;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Scales the gaps between messages. Quick games compress to the 45 second floor. */
function dayFactor(game: LiveGame) {
  return clamp(dayLength(game) / (12 * HOUR), 0.011, 1.25);
}

/** Scales how many messages each agent gets per day. Short days still get a few. */
function budgetFactor(game: LiveGame) {
  return clamp(dayLength(game) / (12 * HOUR), 0.3, 1.25);
}

/** Reaction delays shrink on short days so answers land before the vote locks. */
function reactionScale(game: LiveGame) {
  return clamp(dayLength(game) / (2 * HOUR), 0.25, 1);
}

function sampleGap(game: LiveGame, me: Player, at: number) {
  const talk = TALK[me.personality];
  const m = mem(game, me.id);
  let gap = talk.gapMin * MIN * dayFactor(game) * lognormal(0.55);
  const p = progressAt(game, at);
  if (p < 0.1) gap *= 0.5;
  else if (p > 0.85) gap *= 0.6;
  const lastOther = latestOtherPublicTs(game, me, at);
  if (lastOther !== null && at - lastOther < 4 * MIN) gap *= 0.4;
  else if (lastOther !== null && at - lastOther > 60 * MIN) gap *= 1.4;
  if (game.lastHumanActionAt && at - game.lastHumanActionAt < 15 * MIN) gap *= 0.6;
  const left = (m.budgetToday ?? talk.budget) - m.messagesToday;
  const remaining = Math.max(0, game.nextLockAt - at);
  if (left > 0) gap = Math.max(gap, (remaining / (left + 1)) * 0.5);
  return clamp(gap, 45 * SEC, 3 * HOUR);
}

/** Called when a day opens. Spreads every agent's talking and voting over the day. */
export function scheduleDay(game: LiveGame, at: number) {
  ensureAgentState(game);
  const len = dayLength(game);
  const factor = dayFactor(game);
  const newsy = Boolean(game.lastKill?.name) || game.dayNumber > 1;
  for (const a of agentsAlive(game)) {
    const talk = TALK[a.personality];
    const m = mem(game, a.id);
    m.saidToday = [];
    m.reactedToMorning = false;
    m.reactionsToday = 0;
    m.reaction = null;
    m.actAt = null;
    m.budgetToday = Math.max(2, Math.round(talk.budget * budgetFactor(game) * jitter(0.75, 1.25)));
    const early = rnd() < (newsy ? 0.75 : 0.45) * clamp(talk.momentum + 0.5, 0.4, 1);
    const first = early ? jitter(1.5 * MIN, 40 * MIN) * factor : sampleGap(game, a, at);
    m.nextSpeakAt = Math.min(at + first, game.nextLockAt - 2 * MIN);
    const voteWindow: [number, number] =
      a.personality === "cold" ? [0.12, 0.4] : a.personality === "naive" ? [0.5, 0.85] : [0.2, 0.7];
    m.voteAt = at + len * jitter(voteWindow[0], voteWindow[1]);
    m.closingAt = at + len * jitter(0.86, 0.97);
  }
  for (const h of living(game).filter((p) => p.kind === "human")) {
    const m = mem(game, h.id);
    m.nextSpeakAt = null;
    m.reaction = null;
    m.voteAt = null;
    m.closingAt = null;
  }
}

/** Called when the wolves' part of the night opens. */
export function scheduleNight(game: LiveGame, at: number) {
  ensureAgentState(game);
  const third = Math.max(MIN, game.nightThirdMs || game.nextLockAt - at);
  for (const p of living(game)) {
    const m = mem(game, p.id);
    m.nextSpeakAt = null;
    m.reaction = null;
    m.voteAt = null;
    m.closingAt = null;
    m.actAt = null;
    m.messagesToday = 0;
    if (p.kind !== "human" && p.role === "wolf") {
      m.nextSpeakAt = at + third * jitter(0.03, 0.5);
    }
  }
}

/** Called when the seer's or doctor's step opens. The agent acts once, at a random moment. */
export function scheduleNightStep(game: LiveGame, at: number, phase: "night_seer" | "night_doctor") {
  ensureAgentState(game);
  const role = phase === "night_seer" ? "seer" : "doctor";
  const actor = living(game).find((p) => p.role === role && p.kind !== "human");
  for (const p of living(game)) mem(game, p.id).nextSpeakAt = null;
  if (!actor) return;
  const span = Math.max(MIN, game.nextLockAt - at);
  mem(game, actor.id).actAt = at + span * jitter(0.1, 0.8);
}

/** Make an older game safe for the scheduler. */
export function ensureAgentState(game: LiveGame) {
  game.claims ??= {};
  game.remindersSent ??= [];
  for (const p of game.players) {
    const m = mem(game, p.id);
    m.suspicion ??= {};
    m.reasons ??= {};
    m.saidToday ??= [];
  }
}

// ---------------------------------------------------------------------------
// Event reactions
// ---------------------------------------------------------------------------

const ACCUSATORY = /(זאב|חשוד|חשודה|מצביע|מצביעה|תולים|תליה|לתלות|משקר|משקרת|לא מסתדר|מוזר|שקרן)/;

function mentioned(game: LiveGame, text: string, exclude: string[]): Player[] {
  return living(game).filter((p) => !exclude.includes(p.id) && text.includes(p.name));
}

/** A human seer can say "אני הרואה, בדקתי את X, זאב" and the village will listen. */
function parseHumanClaim(game: LiveGame, author: Player, msg: ChatMessage, at: number) {
  if (!/אני\s+ה?רואה/.test(msg.text)) return;
  game.claims ??= {};
  const fresh = game.claims[author.id] !== "seer";
  game.claims[author.id] = "seer";
  const named = mentioned(game, msg.text, [author.id]);
  const saysWolf = /זאב/.test(msg.text) && !/לא\s+זאב/.test(msg.text);
  const saysClean = /לא\s+זאב|נקי|נקיה|בסדר/.test(msg.text);
  for (const a of agentsAlive(game)) {
    if (a.id === author.id) continue;
    if (a.role === "wolf") {
      bump(game, a, author.id, fresh ? 3 : 1, "טוען שהוא הרואה");
      continue;
    }
    for (const q of named) {
      if (saysWolf) bump(game, a, q.id, 2.5 * clamp(TALK[a.personality].herd + 0.5, 0.6, 1.5), `${author.name} הרואה אמר שהוא זאב`);
      else if (saysClean) bump(game, a, q.id, -2, undefined);
    }
  }
  if (fresh && saysWolf && named[0]?.role === "wolf" && named[0].kind !== "human") {
    const m = mem(game, named[0].id);
    m.reaction = { kind: "defend", dueAt: at + jitter(20 * SEC, 3 * MIN) * reactionScale(game), aboutId: author.id };
  }
}

/** Ripple a new public message through the agents' plans. */
export function onPublicMessage(game: LiveGame, msg: ChatMessage, at: number) {
  if (msg.channel !== "public" || msg.narrator) return;
  ensureAgentState(game);
  const author = byId(game, msg.authorId);
  if (author?.kind === "human") {
    game.lastHumanActionAt = at;
    parseHumanClaim(game, author, msg, at);
  }
  const accusatory = ACCUSATORY.test(msg.text);
  const named = mentioned(game, msg.text, author ? [author.id] : []);
  const scale = reactionScale(game);
  for (const h of named.filter((p) => p.kind === "human" && p.alive)) {
    queuePush(game, {
      kind: "mention",
      playerIds: [h.id],
      title: `${msg.authorName} בעיירה`,
      body: msg.text,
      tag: `mention-${h.id}`,
      at,
    });
  }
  for (const a of agentsAlive(game)) {
    if (a.id === author?.id) continue;
    const talk = TALK[a.personality];
    const m = mem(game, a.id);
    const addressed = !msg.replyToId && isDirectlyAddressed(msg.text, a.name);
    if (addressed && !a.muted) {
      m.reaction = { kind: "reply", dueAt: at + jitter(8 * SEC, 40 * SEC), messageId: msg.id, aboutId: author?.id };
    } else if (named.some((p) => p.id === a.id) && accusatory && author) {
      bump(game, a, author.id, 0.8, "האשים אותי");
      if (!m.reaction && !a.muted && rnd() < talk.react) {
        m.reaction = { kind: "defend", dueAt: at + jitter(20 * SEC, 3 * MIN) * scale, aboutId: author.id };
      }
    } else if (m.nextSpeakAt && rnd() < talk.momentum) {
      m.nextSpeakAt = Math.min(m.nextSpeakAt, at + jitter(30 * SEC, 5 * MIN) * scale);
    }
    if (author && accusatory && rnd() < 0.6) {
      for (const q of named) {
        if (q.id === a.id) continue;
        bump(game, a, q.id, 0.35 * talk.herd, `${author.name} ${author.gender === "f" ? "האשימה" : "האשים"} אותו`);
      }
      if (a.personality === "suspicious" && named.length) bump(game, a, author.id, 0.15, "מאשים הרבה");
    }
  }
}

/** A message in the wolves' room: agent wolves answer their pack mates. */
export function onWolfMessage(game: LiveGame, msg: ChatMessage, at: number) {
  if (msg.channel !== "wolves" || msg.narrator) return;
  ensureAgentState(game);
  const author = byId(game, msg.authorId);
  if (author?.kind === "human") game.lastHumanActionAt = at;
  for (const w of agentsAlive(game).filter((p) => p.role === "wolf" && p.id !== author?.id)) {
    const m = mem(game, w.id);
    if (m.reaction) continue;
    // Always answer a human pack mate; between agents, one short exchange is enough.
    if (author?.kind !== "human" && ((m.reactionsToday ?? 0) >= 1 || rnd() < 0.5)) continue;
    m.reaction = { kind: "wolf_plan", dueAt: at + jitter(10 * SEC, 70 * SEC), messageId: msg.id, aboutId: author?.id };
  }
}

/** Someone voted. The target may defend; everyone else updates their read of the room. */
export function onVote(game: LiveGame, voter: Player, targetId: string, at: number) {
  ensureAgentState(game);
  if (voter.kind === "human") game.lastHumanActionAt = at;
  const target = byId(game, targetId);
  if (target?.kind === "human" && target.alive && voter.id !== target.id) {
    const count = Object.values(game.votes).filter((t) => t === targetId).length;
    queuePush(game, {
      kind: "vote_against",
      playerIds: [target.id],
      title: `${voter.name} ${voter.gender === "f" ? "הצביעה" : "הצביע"} נגדך`,
      body: `${count} ${count === 1 ? "קול" : "קולות"} עליך, צריך ${majorityNeed(game)} לרוב. ${minutesLeft(game, at)} דקות לנעילה.`,
      tag: `vote-${game.dayNumber}-${target.id}`,
      at,
    });
  }
  const scale = reactionScale(game);
  for (const a of agentsAlive(game)) {
    if (a.id === voter.id) continue;
    const talk = TALK[a.personality];
    const m = mem(game, a.id);
    if (a.id === targetId) {
      bump(game, a, voter.id, 0.7, "הצביע נגדי");
      if (!m.reaction && !a.muted && rnd() < talk.react) {
        m.reaction = { kind: "defend", dueAt: at + jitter(30 * SEC, 4 * MIN) * scale, aboutId: voter.id };
      }
      continue;
    }
    const pile = Object.values(game.votes).filter((t) => t === targetId).length;
    // The first vote is a hint; a pile-on is not new information.
    bump(game, a, targetId, (0.35 / Math.sqrt(pile)) * talk.herd, `${voter.name} ${voter.gender === "f" ? "הצביעה" : "הצביע"} נגדו`);
    if (a.personality === "suspicious") bump(game, a, voter.id, 0.2, "ממהר להצביע");
  }
}

/** Overnight bookkeeping before a new day: decay, learn from yesterday's lynch, notice the quiet ones. */
export function onNewDay(game: LiveGame, at: number) {
  ensureAgentState(game);
  const lynch = game.lastLynch ?? null;
  for (const a of agentsAlive(game)) {
    const s = suspicionOf(game, a);
    for (const id of Object.keys(s)) s[id] = (s[id] ?? 0) * 0.6;
    if (lynch && lynch.dayNumber === game.dayNumber - 1) {
      for (const voterId of lynch.voters) {
        if (voterId === a.id) continue;
        if (lynch.role === "wolf") bump(game, a, voterId, -0.5);
        else bump(game, a, voterId, 0.9, "הצביע נגד תושב אתמול");
      }
    }
    if (a.personality === "suspicious") {
      const quietest = [...others(game, a)]
        .filter((p) => !isPack(a, p))
        .sort((x, y) => recentPublicCount(game, x.id, at) - recentPublicCount(game, y.id, at))[0];
      if (quietest) bump(game, a, quietest.id, 0.4, "שקט מדי");
    }
    if (a.role === "seer") {
      for (const [id, k] of Object.entries(mem(game, a.id).known)) {
        const m = mem(game, a.id);
        m.suspicion![id] = k === "wolf" ? 12 : -6;
        if (k === "wolf") m.reasons![id] = "בדקתי אותו בלילה";
      }
    }
  }
}

/** The director changed the day; agents react to what they can see. */
export function onDirectorEvent(game: LiveGame, event: DirectorEvent, at: number) {
  ensureAgentState(game);
  if (event.type === "omen") {
    const named = mentioned(game, event.text, []);
    for (const a of agentsAlive(game)) {
      for (const q of named) bump(game, a, q.id, 1.2, "הרמז של הבמאי");
    }
  }
  if (event.type === "leak") {
    // A leaked wolf whisper names a town target. People who mention that name look guilty.
    const named = mentioned(game, event.text, []);
    for (const a of agentsAlive(game)) {
      if (a.role === "wolf") continue;
      for (const q of named) bump(game, a, q.id, -0.6);
    }
  }
  void at;
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

interface SayOptions {
  channel?: "public" | "wolves";
  t?: Player | null;
  a?: Player | null;
  replyTo?: ChatMessage;
  reason?: string;
  hint?: string;
  asReaction?: boolean;
}

function hintFor(game: LiveGame, kind: SpeakKind, o: SayOptions, at: number): string {
  const t = o.t?.name ?? "";
  const a = o.a?.name ?? "";
  const why = o.reason ? ` הסיבה שלך: ${o.reason}.` : "";
  switch (kind) {
    case "accuse":
      return `להאשים את ${t} בקצרה ולתת סיבה אחת.${why}`;
    case "defend":
      return `להגן על ${t}: לא נראה לך זאב. תגיד למה בקצרה.`;
    case "deflect":
      return `${a ? `${a} מצביע או מאשים אותך.` : "מאשימים אותך."} תכחיש בביטחון ותפנה את החשד ל${t}.${why}`;
    case "push":
      return `נשארו ${minutesLeft(game, at)} דקות לנעילה. לדחוף את כולם להצביע על ${t} עכשיו.${why}`;
    case "claim":
      return `לחשוף שאתה הרואה ושבדקת את ${t} בלילה והוא זאב. ברור, חד, בלי היסוס.`;
    case "react_death":
      return `להגיב למוות של ${game.lastKill?.name ?? "מישהו"} (${roleWord(game.lastKill?.role)}) הבוקר. מה זה אומר על מי הזאבים.`;
    case "react_save":
      return "להגיב לזה שההרג נכשל הלילה. מישהו נשמר.";
    case "question":
      return `לשאול את ${t} שאלה ישירה וקצרה על ההצבעה או ההתנהגות שלו.`;
    case "small":
      return "להגיד משהו קצר על המצב בעיירה, בלי להאשים אף אחד.";
    case "vote":
      return `להודיע שאתה מצביע על ${t}.${why}`;
    case "panic":
      return "מצביעים עליך. להיבהל קצת ולהגיד שזה לא אתה.";
    case "reply":
      return `לענות ל${a} באופן ספציפי.${o.t ? ` אם צריך שם, החשוד שלך הוא ${t}.` : ""}${why}`;
    case "reply_back":
      return `לענות ל${a} באופן ספציפי, ולהגיד שדווקא ${a} עצמו הכי חשוד בעיניך.${why}`;
    case "deflect_back":
      return `${a} מאשים אותך. תכחיש ותחזיר את החשד אליו: מי שממהר להאשים מסתיר משהו.${why}`;
    case "wolf_plan":
      return `להציע לחבילה להרוג את ${t} הלילה ולהגיד למה במשפט.`;
    case "wolf_agree":
      return `להסכים עם החבילה על ${t} או להציע תיקון קטן.`;
  }
}

function factsFor(game: LiveGame, me: Player, at: number): string[] {
  const facts: string[] = [];
  if (game.phase === "day") {
    facts.push(`נשארו ${minutesLeft(game, at)} דקות עד שההצבעה ננעלת.`);
    const lead = leadingTarget(game);
    const counts = voteCounts(game);
    if (lead) {
      facts.push(`מוביל בהצבעה: ${byId(game, lead)?.name ?? "?"} עם ${counts[lead] ?? 0} קולות. צריך ${majorityNeed(game)} לרוב.`);
    } else {
      facts.push("עדיין אף אחד לא הצביע.");
    }
    const top = topSuspect(game, me, [], at);
    if (top && top.score > 0.5) facts.push(`החשוד העיקרי שלך: ${top.player.name}${top.reason ? ` (${top.reason})` : ""}.`);
    if (quietGrace(game, at)) {
      const silent = others(game, me).filter((p) => !spokeToday(game, p.id)).map((p) => p.name);
      if (silent.length) facts.push(`עוד לא כתבו היום: ${silent.join(", ")}. זה מוקדם, אנשים עוד לא הגיעו. שקט עכשיו הוא לא ראיה, אל תאשים בגלל זה.`);
    }
    const seer = claimedSeer(game);
    if (seer && seer.id !== me.id) facts.push(`${seer.name} ${seer.gender === "f" ? "טוענת שהיא" : "טוען שהוא"} הרואה.`);
  } else if (game.phase === "night_wolves") {
    const t = byId(game, game.night.wolfTarget);
    facts.push(t ? `היעד הנוכחי של החבילה: ${t.name}.` : "עוד לא נבחר יעד.");
  }
  return facts;
}

async function say(game: LiveGame, me: Player, kind: SpeakKind, at: number, budget: TickBudget, o: SayOptions = {}): Promise<ChatMessage | null> {
  const channel = o.channel ?? "public";
  if (game.openChannel !== channel) return null;
  if (!me.alive || me.muted) return null;
  const m = mem(game, me.id);
  const vars = {
    t: o.t?.name ?? "מישהו",
    a: o.a?.name ?? "",
    d: game.lastKill?.name ?? "מישהו",
    r: roleWord(game.lastKill?.role),
  };
  let text: string | null = null;
  if (mayUseLlm(budget, at)) {
    budget.llmCalls += 1;
    text = await generateAgentLine({
      state: game,
      me,
      channel,
      hint: o.hint ?? hintFor(game, kind, o, at),
      facts: factsFor(game, me, at),
      replyTo: o.replyTo,
      at,
    });
  }
  const genders = { speaker: me.gender, target: o.t?.gender };
  if (!text) text = lineFor(me.personality, kind, vars, rnd, genders);
  if (text === m.lastText) text = lineFor(me.personality, kind, vars, rnd, genders);
  if (!text) return null;
  const saved = uniquePush(game, {
    channel,
    authorId: me.id,
    authorName: me.name,
    text,
    ts: at,
    replyToId: o.replyTo?.id,
  });
  if (!saved) return null;
  if (saved.replyToId === undefined) delete saved.replyToId;
  m.lastText = text;
  m.lastSpokeAt = at;
  if (o.asReaction) m.reactionsToday = (m.reactionsToday ?? 0) + 1;
  else m.messagesToday += 1;
  if (channel === "public") {
    (m.saidToday ??= []).push(text);
    onPublicMessage(game, saved, at);
  } else {
    onWolfMessage(game, saved, at);
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

interface Plan {
  kind: SpeakKind;
  t?: Player | null;
  a?: Player | null;
  reason?: string;
}

function shouldClaim(game: LiveGame, me: Player, at: number): Player | null {
  if (me.role !== "seer") return null;
  const m = mem(game, me.id);
  if (m.claimed) return null;
  const wolf = knownWolfAlive(game, me);
  if (!wolf) return null;
  const votesOnMe = voteCounts(game)[me.id] ?? 0;
  const p = progressAt(game, at);
  const ripe = game.dayNumber >= 2 || votesOnMe >= 2 || p > 0.55;
  if (!ripe) return null;
  return rnd() < 0.5 ? wolf : null;
}

function applyClaim(game: LiveGame, seer: Player, wolf: Player, at: number) {
  game.claims ??= {};
  game.claims[seer.id] = "seer";
  mem(game, seer.id).claimed = true;
  for (const a of agentsAlive(game)) {
    if (a.id === seer.id) continue;
    if (a.role === "wolf") {
      bump(game, a, seer.id, 3, "חושף אותנו");
      continue;
    }
    bump(game, a, wolf.id, 2 + TALK[a.personality].herd, `${seer.name} הרואה אמר שהוא זאב`);
  }
  if (wolf.kind !== "human") {
    mem(game, wolf.id).reaction = { kind: "defend", dueAt: at + jitter(20 * SEC, 3 * MIN) * reactionScale(game), aboutId: seer.id };
  }
  game.eventLog.push(`יום ${game.dayNumber}: ${seer.name} חשף שהוא הרואה`);
}

function planDayLine(game: LiveGame, me: Player, at: number): Plan {
  const m = mem(game, me.id);
  const p = progressAt(game, at);
  const counts = voteCounts(game);
  const lead = leadingTarget(game);
  const leadP = byId(game, lead);
  const votesOnMe = counts[me.id] ?? 0;
  const top = topSuspect(game, me, [], at);
  const s = suspicionOf(game, me);

  if (!m.reactedToMorning && p < 0.35 && (game.lastKill || game.dayNumber > 1)) {
    m.reactedToMorning = true;
    if (game.lastKill?.saved) return { kind: "react_save" };
    if (game.lastKill?.name) return { kind: "react_death" };
    return { kind: "small" };
  }
  const claimWolf = shouldClaim(game, me, at);
  if (claimWolf) return { kind: "claim", t: claimWolf };
  if (votesOnMe >= 1 && rnd() < 0.6) {
    const attacker = byId(game, Object.entries(game.votes).find(([, t]) => t === me.id)?.[0] ?? null);
    const target = top && top.player.id !== attacker?.id && top.score > 0 ? top.player : attacker ?? top?.player ?? null;
    return { kind: "deflect", t: target, a: attacker, reason: top?.reason };
  }
  if (top && top.score >= 1 && rnd() < 0.6) return { kind: "accuse", t: top.player, reason: top.reason };
  if (p > 0.7 && !hasMajority(game) && rnd() < 0.5) {
    const mine = byId(game, game.votes[me.id]);
    const target = mine ?? top?.player ?? leadP;
    if (target && target.id !== me.id) return { kind: "push", t: target, reason: top?.reason };
  }
  if (leadP && leadP.id !== me.id && (s[leadP.id] ?? 0) <= -0.5 && !isPack(me, leadP) && rnd() < 0.4) {
    return { kind: "defend", t: leadP };
  }
  if (me.personality === "anxious" && votesOnMe > 0 && rnd() < 0.3) return { kind: "panic" };
  const r = rnd();
  const everyone = others(game, me).filter((x) => !isPack(me, x));
  const talkers = quietGrace(game, at) ? everyone.filter((x) => spokeToday(game, x.id)) : everyone;
  const pool = talkers.length ? talkers : everyone;
  const someone = top && top.score > 0.3 ? top.player : pool.length ? pool[Math.floor(rnd() * pool.length)]! : null;
  if (r < 0.3) return { kind: "question", t: someone };
  if (r < 0.6) return { kind: "small" };
  if (r < 0.85) return { kind: "accuse", t: someone, reason: top?.reason };
  const mine = byId(game, game.votes[me.id]);
  return mine ? { kind: "vote", t: mine } : { kind: "small" };
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

type EventKind = "reaction" | "speak" | "vote" | "closing" | "act" | "reminder";

interface DueEvent {
  at: number;
  kind: EventKind;
  agent?: Player;
  key?: string;
}

function reminderEvents(game: LiveGame): DueEvent[] {
  if (game.phase !== "day") return [];
  const len = dayLength(game);
  const out: DueEvent[] = [];
  const sent = game.remindersSent ?? [];
  const candidates: [string, number][] =
    len >= 3 * HOUR
      ? [
          [`d${game.dayNumber}-60`, game.nextLockAt - 60 * MIN],
          [`d${game.dayNumber}-10`, game.nextLockAt - 10 * MIN],
        ]
      : [[`d${game.dayNumber}-final`, game.nextLockAt - Math.max(MIN, Math.round(len * 0.2))]];
  for (const [key, at] of candidates) {
    if (sent.includes(key)) continue;
    if (at < game.windowStartAt + Math.min(20 * MIN, len * 0.3)) continue;
    out.push({ at, kind: "reminder", key });
  }
  return out;
}

function nextEvent(game: LiveGame, until: number): DueEvent | null {
  const events: DueEvent[] = [];
  const phase = game.phase;
  for (const a of agentsAlive(game)) {
    const m = mem(game, a.id);
    if (m.reaction && (phase === "day" || phase === "night_wolves")) events.push({ at: m.reaction.dueAt, kind: "reaction", agent: a });
    if (m.nextSpeakAt && (phase === "day" || (phase === "night_wolves" && a.role === "wolf"))) events.push({ at: m.nextSpeakAt, kind: "speak", agent: a });
    if (phase === "day") {
      if (m.voteAt) events.push({ at: m.voteAt, kind: "vote", agent: a });
      if (m.closingAt) events.push({ at: m.closingAt, kind: "closing", agent: a });
    }
    if (m.actAt && (phase === "night_seer" || phase === "night_doctor")) events.push({ at: m.actAt, kind: "act", agent: a });
  }
  events.push(...reminderEvents(game));
  const due = events.filter((e) => e.at <= until);
  if (!due.length) return null;
  const rank: Record<EventKind, number> = { reaction: 0, reminder: 1, act: 2, vote: 3, closing: 4, speak: 5 };
  due.sort((x, y) => x.at - y.at || rank[x.kind] - rank[y.kind]);
  return due[0]!;
}

async function runSpeak(game: LiveGame, me: Player, at: number, budget: TickBudget) {
  const m = mem(game, me.id);
  if (game.phase === "night_wolves") {
    m.nextSpeakAt = null;
    if (me.role !== "wolf") return;
    const humanWolf = living(game).some((p) => p.role === "wolf" && p.kind === "human");
    let kind: SpeakKind = "wolf_agree";
    if (!game.night.wolfTarget) {
      game.night.wolfTarget = pickWolfKill(game);
      kind = "wolf_plan";
    } else if (!humanWolf && rnd() < 0.25) {
      const alternative = pickWolfKill(game);
      if (alternative && alternative !== game.night.wolfTarget) {
        game.night.wolfTarget = alternative;
        kind = "wolf_plan";
      }
    }
    const t = byId(game, game.night.wolfTarget);
    await say(game, me, kind, at, budget, { channel: "wolves", t });
    const third = Math.max(MIN, game.nightThirdMs || 0);
    if (m.messagesToday < 2 && rnd() < 0.5) {
      const next = at + third * jitter(0.1, 0.5);
      if (next < game.nextLockAt - MIN) m.nextSpeakAt = next;
    }
    return;
  }
  if (game.phase !== "day" || !me.alive || me.muted) {
    m.nextSpeakAt = null;
    return;
  }
  if (m.messagesToday >= (m.budgetToday ?? TALK[me.personality].budget)) {
    m.nextSpeakAt = null;
    return;
  }
  const plan = planDayLine(game, me, at);
  if (plan.kind === "claim" && plan.t) {
    const saved = await say(game, me, "claim", at, budget, { t: plan.t });
    if (saved) applyClaim(game, me, plan.t, at);
  } else {
    await say(game, me, plan.kind, at, budget, { t: plan.t, a: plan.a, reason: plan.reason });
  }
  const next = at + sampleGap(game, me, at);
  m.nextSpeakAt = next < game.nextLockAt - MIN ? next : null;
}

async function runReaction(game: LiveGame, me: Player, at: number, budget: TickBudget) {
  const m = mem(game, me.id);
  const r = m.reaction;
  m.reaction = null;
  if (!r || !me.alive || me.muted) return;
  if ((m.reactionsToday ?? 0) >= MAX_REACTIONS_PER_DAY) return;
  const about = byId(game, r.aboutId);
  if (r.kind === "wolf_plan") {
    if (game.phase !== "night_wolves" || me.role !== "wolf") return;
    if (!game.night.wolfTarget) game.night.wolfTarget = pickWolfKill(game);
    const t = byId(game, game.night.wolfTarget);
    await say(game, me, game.night.wolfTarget ? "wolf_agree" : "wolf_plan", at, budget, { channel: "wolves", t, asReaction: true });
    return;
  }
  if (game.phase !== "day") return;
  const top = topSuspect(game, me, about ? [about.id] : []);
  if (r.kind === "reply") {
    const replyTo = game.messages.find((x) => x.id === r.messageId);
    if (!replyTo) return;
    m.lastDirectMessageId = replyTo.id;
    const s = suspicionOf(game, me);
    const target = about && (s[about.id] ?? 0) > 1 ? about : top?.player ?? about;
    const back = Boolean(about && target && target.id === about.id);
    await say(game, me, back ? "reply_back" : "reply", at, budget, { replyTo, a: about, t: target, reason: top?.reason, asReaction: true });
    return;
  }
  if (r.kind === "defend") {
    const s = suspicionOf(game, me);
    const target = about && (s[about.id] ?? 0) >= (top?.score ?? 0) && !isPack(me, about) ? about : top?.player ?? about;
    const back = Boolean(about && target && target.id === about.id);
    await say(game, me, back ? "deflect_back" : "deflect", at, budget, { a: about, t: target, reason: top?.reason, asReaction: true });
    return;
  }
  if (r.kind === "push") {
    const mine = byId(game, game.votes[me.id]) ?? top?.player ?? null;
    if (mine) await say(game, me, "push", at, budget, { t: mine, asReaction: true });
    return;
  }
  if (r.kind === "claim") {
    const wolf = knownWolfAlive(game, me);
    if (!wolf || mem(game, me.id).claimed) return;
    const saved = await say(game, me, "claim", at, budget, { t: wolf, asReaction: true });
    if (saved) applyClaim(game, me, wolf, at);
    return;
  }
  await say(game, me, "small", at, budget, { asReaction: true });
}

async function runVote(game: LiveGame, me: Player, at: number, budget: TickBudget) {
  const m = mem(game, me.id);
  m.voteAt = null;
  if (game.phase !== "day" || !me.alive || me.cannotVote) return;
  if (game.votes[me.id]) return;
  const target = chooseVote(game, me);
  if (!target) return;
  setVote(game, me, target, at);
  const t = byId(game, target);
  if (t && rnd() < 0.55 && m.messagesToday < (m.budgetToday ?? 6)) {
    const reason = (m.reasons ?? {})[target];
    await say(game, me, "vote", at, budget, { t, reason });
  }
}

async function runClosing(game: LiveGame, me: Player, at: number, budget: TickBudget) {
  const m = mem(game, me.id);
  m.closingAt = null;
  if (game.phase !== "day" || !me.alive || me.cannotVote) return;
  const talk = TALK[me.personality];
  const counts = voteCounts(game);
  const lead = leadingTarget(game);
  const mine = game.votes[me.id];
  const need = majorityNeed(game);
  const leadCount = lead ? counts[lead] ?? 0 : 0;
  if (lead && lead !== me.id && lead !== mine && leadCount >= 2 && switchAllowed(game, me, lead)) {
    const own = suspicionOf(game, me)[lead] ?? 0;
    const pull = talk.bandwagon * (leadCount >= need - 1 ? 1 : 0.55) * (own > 0.5 ? 1 : 0.7);
    if (rnd() < pull) {
      setVote(game, me, lead, at);
      const t = byId(game, lead);
      if (t && rnd() < 0.5) await say(game, me, "vote", at, budget, { t, reason: "רוב העיירה כבר שם" });
      return;
    }
  }
  if (!mine) {
    const target = chooseVote(game, me);
    if (!target) return;
    setVote(game, me, target, at);
    const t = byId(game, target);
    if (t && rnd() < 0.5) await say(game, me, "vote", at, budget, { t, reason: (m.reasons ?? {})[target] });
    return;
  }
  if (!hasMajority(game) && rnd() < 0.4) {
    const t = byId(game, mine);
    if (t) await say(game, me, "push", at, budget, { t, reason: (m.reasons ?? {})[mine] });
  }
}

function runAct(game: LiveGame, me: Player) {
  const m = mem(game, me.id);
  m.actAt = null;
  if (!me.alive) return;
  if (game.phase === "night_seer" && me.role === "seer" && !game.night.seerTarget) {
    game.night.seerTarget = pickSeerInspect(game, me);
  }
  if (game.phase === "night_doctor" && me.role === "doctor" && !game.night.doctorTarget) {
    game.night.doctorTarget = pickDoctorSave(game, me);
  }
}

function runReminder(game: LiveGame, key: string, at: number) {
  game.remindersSent ??= [];
  game.remindersSent.push(key);
  if (game.phase !== "day") return;
  const lead = leadingTarget(game);
  const counts = voteCounts(game);
  const need = majorityNeed(game);
  const leadName = byId(game, lead)?.name;
  const n = lead ? counts[lead] ?? 0 : 0;
  const left = minutesLeft(game, at);
  const leftText = left >= 55 ? "שעה" : `${left} דקות`;
  let text: string;
  if (key.endsWith("-60")) {
    text = leadName
      ? `${leftText} לנעילה. ${leadName} ${byId(game, lead)?.gender === "f" ? "מובילה" : "מוביל"} עם ${n} קולות. צריך ${need} לרוב.`
      : `${leftText} לנעילה ואף אחד עוד לא הצביע. אם אין רוב, אף אחד לא נתלה.`;
  } else {
    text = leadName
      ? n >= need
        ? `${leftText}. ${leadName} על הגרדום עם ${n} קולות.`
        : `${leftText}. ${leadName} עם ${n}. חסרים ${need - n} להחלטה.`
      : `${leftText} ואין רוב. הלילה מגיע בלי תלייה.`;
    for (const a of agentsAlive(game)) {
      const m = mem(game, a.id);
      if (!game.votes[a.id] && !a.cannotVote) m.voteAt = at + jitter(20 * SEC, 6 * MIN);
    }
  }
  uniquePush(game, { channel: "public", authorId: null, authorName: "מערכת", text, narrator: true, tone: "alert", ts: at });
  const undecided = living(game)
    .filter((p) => p.kind === "human" && !p.cannotVote && !game.votes[p.id])
    .map((p) => p.id);
  queuePush(game, { kind: "deadline", playerIds: undecided, title: `${leftText} להצבעה`, body: text, tag: `deadline-${game.dayNumber}`, at });
}

/**
 * Replay every planned agent action due by `until`. Returns false when the
 * request budget ran out before reaching `until`; the next request continues.
 */
export async function runAgentEvents(game: LiveGame, until: number, budget: TickBudget): Promise<boolean> {
  if (game.status !== "running") return true;
  ensureAgentState(game);
  for (let guard = 0; guard < 400; guard++) {
    const next = nextEvent(game, until);
    if (!next) return true;
    if (budget.events >= budget.maxEvents || Date.now() > budget.deadlineAt) return false;
    budget.events += 1;
    const at = Math.max(next.at, game.windowStartAt);
    switch (next.kind) {
      case "reaction":
        await runReaction(game, next.agent!, at, budget);
        break;
      case "speak":
        await runSpeak(game, next.agent!, at, budget);
        break;
      case "vote":
        await runVote(game, next.agent!, at, budget);
        break;
      case "closing":
        await runClosing(game, next.agent!, at, budget);
        break;
      case "act":
        runAct(game, next.agent!);
        break;
      case "reminder":
        runReminder(game, next.key!, at);
        break;
    }
    if (game.status !== "running") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Agents who are about to write in the channel the viewer can see. */
export function typingNames(game: LiveGame, me: Player, now: number): string[] {
  if (game.status !== "running") return [];
  const from = now - 90 * SEC;
  const to = now + 25 * SEC;
  const soon = (m: AgentMemory) => {
    const times = [m.reaction?.dueAt, m.nextSpeakAt].filter((t): t is number => typeof t === "number");
    return times.some((t) => t > from && t <= to);
  };
  if (game.phase === "day") {
    return agentsAlive(game)
      .filter((a) => !a.muted && soon(mem(game, a.id)))
      .map((a) => a.name);
  }
  if (game.phase === "night_wolves" && me.role === "wolf") {
    return agentsAlive(game)
      .filter((a) => a.role === "wolf" && soon(mem(game, a.id)))
      .map((a) => a.name);
  }
  return [];
}

/** Put every card on the table when the game ends. */
export function endReveal(game: LiveGame, at: number) {
  const list = game.players.map((p) => `${p.name} ${ROLE_HE[p.role]}${p.kind === "human" && p.realName ? ` (${p.realName})` : ""}`).join(" · ");
  uniquePush(game, {
    channel: "public",
    authorId: null,
    authorName: "מערכת",
    text: `הקלפים על השולחן: ${list}`,
    narrator: true,
    tone: "reveal",
    ts: at,
  });
}

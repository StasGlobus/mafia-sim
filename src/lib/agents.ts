import type {
  AgentMemory,
  GameState,
  Personality,
  Player,
} from "./types";
import { fill, lineFor, pick, PHRASES, type SpeakKind } from "./phrases";
import { generateAgentLine } from "./llm";

export function rnd(): number {
  return Math.random();
}

export function living(state: GameState): Player[] {
  return state.players.filter((p) => p.alive);
}

export function others(state: GameState, me: Player): Player[] {
  return living(state).filter((p) => p.id !== me.id);
}

export function townLiving(state: GameState): Player[] {
  return living(state).filter((p) => p.role !== "wolf");
}

export function mem(state: GameState, id: string): AgentMemory {
  if (!state.memories[id]) {
    state.memories[id] = {
      known: {},
      messagesToday: 0,
      lastText: "",
      plannedVote: null,
      spokeAtProgress: [],
    };
  }
  return state.memories[id];
}

function maxMessages(p: Personality): number {
  switch (p) {
    case "chatty":
    case "rambling":
    case "anxious":
      return 3;
    case "quiet":
    case "cold":
      return 1;
    default:
      return 2;
  }
}

function speakChance(p: Personality): number {
  switch (p) {
    case "chatty":
      return 0.28;
    case "rambling":
      return 0.22;
    case "anxious":
      return 0.24;
    case "joker":
      return 0.2;
    case "suspicious":
      return 0.18;
    case "naive":
      return 0.16;
    case "cold":
      return 0.08;
    case "quiet":
      return 0.07;
  }
}

export function uniquePush(
  state: GameState,
  msg: {
    channel: GameState["messages"][number]["channel"];
    authorId: string | null;
    authorName: string;
    text: string;
    narrator?: boolean;
    replyToId?: string;
    tone?: GameState["messages"][number]["tone"];
    /** Backdated timestamp. The message is inserted in time order. */
    ts?: number;
  },
): GameState["messages"][number] | null {
  const allowed =
    Boolean(msg.narrator) ||
    msg.channel === "events" ||
    msg.channel === state.openChannel;
  if (!allowed) return null;
  if (msg.channel === "public" && !msg.narrator) {
    const author = msg.authorId ? state.players.find((p) => p.id === msg.authorId) : null;
    if (author?.kind !== "human") {
      if (state.usedPublicTexts.includes(msg.text)) return null;
      state.usedPublicTexts.push(msg.text);
      if (state.usedPublicTexts.length > 80) state.usedPublicTexts.shift();
    }
  }
  const { ts, ...rest } = msg;
  const saved: GameState["messages"][number] = {
    id: `m${state.messages.length + 1}_${Math.floor(rnd() * 1e6)}`,
    ts: ts ?? Date.now(),
    ...rest,
  };
  if (saved.tone === undefined) delete saved.tone;
  // Keep the log in time order even when an agent line is generated late.
  let index = state.messages.length;
  while (index > 0 && state.messages[index - 1]!.ts > saved.ts) index -= 1;
  state.messages.splice(index, 0, saved);
  if (state.messages.length > 600) {
    state.messages = state.messages.slice(-480);
  }
  return saved;
}

function normalizedWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[^\p{L}\p{N}@]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/^@/, ""));
}

export function isDirectlyAddressed(text: string, name: string): boolean {
  const words = normalizedWords(text);
  if (!words.length) return false;
  if (text.includes(`@${name}`)) return true;
  if (words[0] === "היי" && words[1] === name) return true;
  if (words[0] === name) return true;
  return /[?？]/.test(text) && words[words.length - 1] === name;
}

function directRecipient(
  state: GameState,
  message: GameState["messages"][number],
): Player | null {
  if (message.channel !== "public" || message.narrator || message.replyToId) return null;
  return (
    living(state).find(
      (player) =>
        player.kind !== "human" &&
        player.id !== message.authorId &&
        !player.muted &&
        isDirectlyAddressed(message.text, player.name),
    ) ?? null
  );
}

function latestPendingDirectMessage(
  state: GameState,
): { agent: Player; message: GameState["messages"][number] } | null {
  const recent = state.messages.filter((message) => message.channel === "public").slice(-20).reverse();
  const newestMentionSeen = new Set<string>();
  for (const message of recent) {
    const agent = directRecipient(state, message);
    if (!agent) continue;
    // Only consider the newest direct message for each agent. Otherwise a reply
    // to a new question could make an older, already superseded question resurface.
    if (newestMentionSeen.has(agent.id)) continue;
    newestMentionSeen.add(agent.id);
    if (mem(state, agent.id).lastDirectMessageId === message.id) continue;
    return { agent, message };
  }
  return null;
}

function directFallback(state: GameState, me: Player, message: GameState["messages"][number]): string {
  const asker = state.players.find((player) => player.id === message.authorId);
  const choices = others(state, me).filter((player) => player.id !== asker?.id);
  const target = choices.find((player) => state.votes[me.id] === player.id) ?? pick(choices.length ? choices : others(state, me), rnd);
  const prefix = asker ? `${asker.name}, ` : "";
  const challenge = /(אתה\s+(זאב|משקר)|את\s+(זאבה|משקרת)|נראה לי ש?אתה|נראה לי ש?את)/.test(message.text);
  if (challenge) return `${prefix}לא. דווקא ${target?.name ?? "מישהו פה"} לא מסתדר לי`;
  if (/[?？]|מי|מה|למה|דעתך|חושב|חושבת|מרגיש|מרגישה|חשוד|חשודה/.test(message.text)) {
    return `${prefix}${target?.name ?? "עוד אין לי שם"} הכי לא מסתדר לי כרגע`;
  }
  return `${prefix}ראיתי. אני עדיין מנסה להבין את ${target?.name ?? "כולם"}`;
}

async function sendDirectReply(
  state: GameState,
  agent: Player,
  message: GameState["messages"][number],
): Promise<boolean> {
  const memory = mem(state, agent.id);
  // Mark before the model call so a concurrent poll cannot answer twice.
  memory.lastDirectMessageId = message.id;
  const generated = await generateAgentLine({ state, me: agent, channel: "public", replyTo: message });
  let text = generated ?? directFallback(state, agent, message);
  if (text === memory.lastText) text = directFallback(state, agent, message);
  if (!text) return false;
  const saved = uniquePush(state, {
    channel: "public",
    authorId: agent.id,
    authorName: agent.name,
    text,
    replyToId: message.id,
  });
  if (!saved) return false;
  memory.lastText = text;
  memory.messagesToday += 1;
  return true;
}

/** Immediately answers a human message when it starts with a living agent's name. */
export async function respondToDirectAddress(
  state: GameState,
  message: GameState["messages"][number],
): Promise<boolean> {
  if (state.openChannel !== "public") return false;
  const agent = directRecipient(state, message);
  if (!agent) return false;
  return sendDirectReply(state, agent, message);
}

export function randomTarget(cands: Player[], avoid?: string): Player | null {
  const pool = cands.filter((p) => p.id !== avoid);
  if (!pool.length) return null;
  return pick(pool, rnd);
}

export function mentionedNames(state: GameState, players: Player[]): Player[] {
  const recent = state.messages.filter((m) => m.channel === "public").slice(-12);
  const scored = players.map((p) => ({
    p,
    n: recent.filter((m) => m.text.includes(p.name)).length,
  }));
  scored.sort((a, b) => b.n - a.n);
  return scored.filter((s) => s.n > 0).map((s) => s.p);
}

export function voteCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of Object.values(state.votes)) {
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

export function leadingTarget(state: GameState): string | null {
  const counts = voteCounts(state);
  let best: string | null = null;
  let n = 0;
  for (const [id, c] of Object.entries(counts)) {
    if (c > n) {
      n = c;
      best = id;
    }
  }
  return best;
}

export function pickDayVote(state: GameState, me: Player): string | null {
  const cands = others(state, me);
  if (!cands.length) return null;
  const m = mem(state, me.id);

  if (me.role === "seer") {
    const wolfId = Object.entries(m.known).find(([, v]) => v === "wolf")?.[0];
    const wolf = cands.find((p) => p.id === wolfId);
    if (wolf) return wolf.id;
  }

  if (me.role === "wolf") {
    const town = cands.filter((p) => p.role !== "wolf");
    const packVotes = Object.entries(state.votes)
      .filter(([vid]) => {
        const v = state.players.find((p) => p.id === vid);
        return v?.role === "wolf" && v.id !== me.id;
      })
      .map(([, t]) => t);
    if (packVotes.length && rnd() < 0.75) {
      const follow = town.find((p) => p.id === packVotes[0]);
      if (follow) return follow.id;
    }
    const lead = leadingTarget(state);
    const leadP = town.find((p) => p.id === lead);
    if (leadP && rnd() < 0.45) return leadP.id;
    return randomTarget(town)?.id ?? null;
  }

  // town: follow heat, seer-ish talk, or majority
  const lead = leadingTarget(state);
  if (me.personality === "naive" && lead && lead !== me.id && rnd() < 0.7) {
    return lead;
  }
  if (me.personality === "anxious" && m.plannedVote && rnd() < 0.4) {
    // flip
    return randomTarget(cands, m.plannedVote)?.id ?? m.plannedVote;
  }
  if (me.personality === "suspicious") {
    const quiet = cands
      .slice()
      .sort(
        (a, b) =>
          (state.memories[a.id]?.messagesToday ?? 0) -
          (state.memories[b.id]?.messagesToday ?? 0),
      )[0];
    if (quiet && rnd() < 0.5) return quiet.id;
  }
  if (lead && rnd() < 0.35) return lead;
  const talked = mentionedNames(state, cands);
  if (talked[0] && rnd() < 0.4) return talked[0].id;
  return randomTarget(cands)?.id ?? null;
}

export function claimedSeer(state: GameState): Player | null {
  const claims = state.claims ?? {};
  return living(state).find((p) => claims[p.id] === "seer") ?? null;
}

export function pickWolfKill(state: GameState): string | null {
  const prey = townLiving(state);
  if (!prey.length) return null;
  if (state.night.wolfTarget && rnd() < 0.7) return state.night.wolfTarget;
  const seer = claimedSeer(state);
  if (seer && rnd() < 0.85) return seer.id;
  const yesterday = state.lastKill?.playerId;
  const talked = mentionedNames(state, prey);
  if (talked[0] && rnd() < 0.4) return talked[0].id;
  const votersOnWolf = prey.filter((p) => {
    const t = state.votes[p.id];
    const target = state.players.find((x) => x.id === t);
    return target?.role === "wolf";
  });
  if (votersOnWolf.length && rnd() < 0.4) return pick(votersOnWolf, rnd).id;
  return randomTarget(prey, yesterday ?? undefined)?.id ?? prey[0].id;
}

export function pickSeerInspect(state: GameState, seer: Player): string | null {
  const m = mem(state, seer.id);
  const unknown = others(state, seer).filter((p) => !m.known[p.id]);
  if (!unknown.length) return others(state, seer)[0]?.id ?? null;
  const noisy = unknown
    .slice()
    .sort(
      (a, b) =>
        (state.memories[b.id]?.messagesToday ?? 0) -
        (state.memories[a.id]?.messagesToday ?? 0),
    );
  if (noisy[0] && rnd() < 0.5) return noisy[0].id;
  return pick(unknown, rnd).id;
}

export function pickDoctorSave(state: GameState, doc: Player): string | null {
  const all = living(state);
  if (!all.length) return null;
  const seer = claimedSeer(state);
  if (seer && seer.id !== doc.id && rnd() < 0.75) return seer.id;
  if (rnd() < 0.4) return doc.id;
  const talked = mentionedNames(
    state,
    all.filter((p) => p.id !== doc.id),
  );
  if (talked[0] && rnd() < 0.5) return talked[0].id;
  if (state.lastKill?.saved && state.night.doctorTarget && rnd() < 0.3) {
    return state.night.doctorTarget;
  }
  return randomTarget(all)?.id ?? doc.id;
}

function kindForDay(state: GameState, me: Player, progress: number): SpeakKind {
  if (me.cannotVote === false && state.votes[me.id] && rnd() < 0.2) return "vote";
  if (progress < 0.22 && state.lastKill) {
    return state.lastKill.saved ? "react_save" : "react_death";
  }
  if (me.personality === "anxious" && rnd() < 0.2) return "panic";
  const r = rnd();
  if (r < 0.38) return "accuse";
  if (r < 0.52) return "question";
  if (r < 0.64) return "defend";
  if (r < 0.8) return "small";
  return "vote";
}

export async function dayPulse(state: GameState) {
  const progress =
    state.phaseDurationMs <= 0 ? 1 : state.phaseElapsedMs / state.phaseDurationMs;
  const alive = living(state);

  if (state.openChannel === "public") {
    const direct = latestPendingDirectMessage(state);
    if (direct) {
      await sendDirectReply(state, direct.agent, direct.message);
    } else {
      const candidates = alive.filter((me) => {
        if (me.kind === "human") return false;
        if (me.muted) return false;
        const m = mem(state, me.id);
        if (m.messagesToday >= maxMessages(me.personality)) return false;
        if (m.spokeAtProgress.some((x) => Math.abs(x - progress) < 0.08)) return false;
        return rnd() <= speakChance(me.personality) * (progress < 0.08 ? 1.4 : 1);
      });
      const me = candidates.length ? pick(candidates, rnd) : null;
      if (me) {
        const m = mem(state, me.id);
        const cands = others(state, me);
        const t = randomTarget(cands);
        const kind = kindForDay(state, me, progress);
        const vars = {
          t: t?.name ?? "מישהו",
          d: state.lastKill?.name ?? "מישהו",
          r: state.lastKill?.role ? roleWord(state.lastKill.role) : "?",
        };
        const llm = await generateAgentLine({ state, me, channel: "public" });
        const text = llm ?? lineFor(me.personality, kind, vars, rnd, { speaker: me.gender, target: t?.gender });
        if (text && text !== m.lastText) {
          uniquePush(state, {
            channel: "public",
            authorId: me.id,
            authorName: me.name,
            text,
          });
          m.lastText = text;
          m.messagesToday += 1;
          m.spokeAtProgress.push(progress);
        }
      }
    }
  }

  // votes start after ~20% of day
  if (progress < 0.18) return;
  for (const me of alive) {
    if (me.kind === "human") continue;
    if (me.cannotVote) continue;
    const m = mem(state, me.id);
    const has = Boolean(state.votes[me.id]);
    const shouldStart = !has && rnd() < (me.personality === "cold" ? 0.55 : 0.28);
    const shouldFlip =
      has &&
      progress > 0.55 &&
      rnd() < (me.personality === "anxious" ? 0.18 : 0.06);
    if (!shouldStart && !shouldFlip) continue;
    const target = pickDayVote(state, me);
    if (!target) continue;
    state.votes[me.id] = target;
    m.plannedVote = target;
    const named = state.players.find((p) => p.id === target)?.name ?? "";
    if (
      !me.muted &&
      state.openChannel === "public" &&
      m.messagesToday < maxMessages(me.personality) &&
      rnd() < 0.45
    ) {
      const text = lineFor(me.personality, "vote", { t: named, d: "", r: "" }, rnd, {
        speaker: me.gender,
        target: state.players.find((p) => p.id === target)?.gender,
      });
      uniquePush(state, {
        channel: "public",
        authorId: me.id,
        authorName: me.name,
        text,
      });
      m.messagesToday += 1;
      m.lastText = text;
    }
  }

  if (progress > 0.48) {
    const lead = leadingTarget(state);
    const counts = voteCounts(state);
    const leadN = lead ? (counts[lead] ?? 0) : 0;
    const need = Math.floor(alive.length / 2) + 1;
    if (lead && leadN >= 2 && leadN < need) {
      const leadP = state.players.find((x) => x.id === lead);
      for (const me of alive) {
        if (me.kind === "human") continue;
        if (me.cannotVote) continue;
        if (state.votes[me.id] === lead) continue;
        if (me.role === "wolf" && leadP?.role === "wolf") continue;
        if (rnd() < (progress > 0.72 ? 0.5 : 0.22)) {
          state.votes[me.id] = lead;
          mem(state, me.id).plannedVote = lead;
        }
      }
    }
  }
}

function roleWord(role: string) {
  if (role === "wolf") return "זאב";
  if (role === "seer") return "רואה";
  if (role === "doctor") return "רופא";
  return "תושב";
}

export async function wolfPulse(state: GameState) {
  if (state.openChannel !== "wolves") return;
  const wolves = living(state).filter((p) => p.role === "wolf");
  const agents = wolves.filter((p) => p.kind !== "human");
  if (!agents.length) return;
  const humanLocked = wolves.some((p) => p.kind === "human") && Boolean(state.night.wolfTarget);
  const targetId = humanLocked ? state.night.wolfTarget : pickWolfKill(state);
  state.night.wolfTarget = targetId;
  const tName = state.players.find((p) => p.id === targetId)?.name ?? "מישהו";
  const progress =
    state.phaseDurationMs <= 0 ? 1 : state.phaseElapsedMs / state.phaseDurationMs;
  const w = agents.find((w) => mem(state, w.id).messagesToday < 2);
  if (w && progress > 0.12 && rnd() < 0.55) {
    const m = mem(state, w.id);
    const llm = await generateAgentLine({ state, me: w, channel: "wolves" });
    const target = state.players.find((p) => p.id === targetId);
    const text = llm ?? fill(pick(PHRASES.WOLF_NIGHT, rnd), { t: tName }, { speaker: w.gender, target: target?.gender });
    if (text && text !== m.lastText) {
      uniquePush(state, {
        channel: "wolves",
        authorId: w.id,
        authorName: w.name,
        text,
      });
      m.messagesToday += 1;
      m.lastText = text;
    }
  }
}

export function seerPulse(state: GameState) {
  const seer = living(state).find((p) => p.role === "seer");
  if (!seer || state.openChannel !== "seer") return;
  if (seer.kind === "human") return;
  const id = pickSeerInspect(state, seer);
  state.night.seerTarget = id;
}

export function doctorPulse(state: GameState) {
  const doc = living(state).find((p) => p.role === "doctor");
  if (!doc || state.openChannel !== "doctor") return;
  if (doc.kind === "human") return;
  const id = pickDoctorSave(state, doc);
  state.night.doctorTarget = id;
}

export function resetDayTalk(state: GameState) {
  for (const id of Object.keys(state.memories)) {
    state.memories[id].messagesToday = 0;
    state.memories[id].spokeAtProgress = [];
  }
}

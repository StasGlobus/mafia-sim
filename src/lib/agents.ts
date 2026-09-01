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

function mem(state: GameState, id: string): AgentMemory {
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
  },
) {
  const allowed =
    Boolean(msg.narrator) ||
    msg.channel === "events" ||
    msg.channel === state.openChannel;
  if (!allowed) return;
  if (msg.channel === "public" && !msg.narrator) {
    if (state.usedPublicTexts.includes(msg.text)) return;
    state.usedPublicTexts.push(msg.text);
    if (state.usedPublicTexts.length > 80) state.usedPublicTexts.shift();
  }
  state.messages.push({
    id: `m${state.messages.length + 1}_${Math.floor(rnd() * 1e6)}`,
    ts: Date.now(),
    ...msg,
  });
  if (state.messages.length > 500) {
    state.messages = state.messages.slice(-400);
  }
}

function randomTarget(cands: Player[], avoid?: string): Player | null {
  const pool = cands.filter((p) => p.id !== avoid);
  if (!pool.length) return null;
  return pick(pool, rnd);
}

function mentionedNames(state: GameState, players: Player[]): Player[] {
  const recent = state.messages.filter((m) => m.channel === "public").slice(-12);
  const scored = players.map((p) => ({
    p,
    n: recent.filter((m) => m.text.includes(p.name)).length,
  }));
  scored.sort((a, b) => b.n - a.n);
  return scored.filter((s) => s.n > 0).map((s) => s.p);
}

function voteCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of Object.values(state.votes)) {
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

function leadingTarget(state: GameState): string | null {
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

export function pickWolfKill(state: GameState): string | null {
  const prey = townLiving(state);
  if (!prey.length) return null;
  if (state.night.wolfTarget && rnd() < 0.7) return state.night.wolfTarget;
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
    const candidates = alive.filter((me) => {
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
      const text = llm ?? lineFor(me.personality, kind, vars, rnd);
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

  // votes start after ~20% of day
  if (progress < 0.18) return;
  for (const me of alive) {
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
      const text = lineFor(me.personality, "vote", { t: named, d: "", r: "" }, rnd);
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
  if (role === "seer") return "חוזה";
  if (role === "doctor") return "רופא";
  return "כפרי";
}

export async function wolfPulse(state: GameState) {
  if (state.openChannel !== "wolves") return;
  const wolves = living(state).filter((p) => p.role === "wolf");
  const targetId = pickWolfKill(state);
  state.night.wolfTarget = targetId;
  const tName = state.players.find((p) => p.id === targetId)?.name ?? "מישהו";
  const progress =
    state.phaseDurationMs <= 0 ? 1 : state.phaseElapsedMs / state.phaseDurationMs;
  const w = wolves.find((w) => mem(state, w.id).messagesToday < 2);
  if (w && progress > 0.12 && rnd() < 0.55) {
    const m = mem(state, w.id);
    const llm = await generateAgentLine({ state, me: w, channel: "wolves" });
    const text = llm ?? fill(pick(PHRASES.WOLF_NIGHT, rnd), { t: tName });
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
  const id = pickSeerInspect(state, seer);
  state.night.seerTarget = id;
}

export function doctorPulse(state: GameState) {
  const doc = living(state).find((p) => p.role === "doctor");
  if (!doc || state.openChannel !== "doctor") return;
  const id = pickDoctorSave(state, doc);
  state.night.doctorTarget = id;
}

export function resetDayTalk(state: GameState) {
  for (const id of Object.keys(state.memories)) {
    state.memories[id].messagesToday = 0;
    state.memories[id].spokeAtProgress = [];
  }
}

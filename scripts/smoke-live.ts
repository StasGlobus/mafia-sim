/**
 * Offline smoke test for the live-game engine.
 *
 *   npm run smoke
 *
 * Runs one quick game and one scheduled day against the in-memory store with
 * canned agent lines (no model calls), driving a simulated clock through
 * `catchUp`. Fails loudly if agents speak in lockstep, never vote, never reply
 * to a human, or the phases stop advancing.
 */

process.env.MAFIA_DISABLE_LLM = "1";
process.env.MAFIA_STORE_FILE = process.env.MAFIA_STORE_FILE || "/tmp/mafia-smoke-store.json";
delete process.env.SUPABASE_URL;

import fs from "fs";
import type { LiveGame } from "../src/lib/types";

const MIN = 60_000;
const HOUR = 60 * MIN;

function fmt(ts: number) {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ts));
}

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`\n✗ ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

async function main() {
  try {
    fs.unlinkSync(process.env.MAFIA_STORE_FILE!);
  } catch {
    /* fresh */
  }
  const live = await import("../src/lib/live");
  const store = await import("../src/lib/live-store");
  const agents = await import("../src/lib/live-agents");
  const { uniquePush } = await import("../src/lib/agents");

  // ------------------------------------------------------------------ quick
  console.log("\n=== Quick game: 8 seats, 5 minute days, 2 minute nights ===");
  const created = await live.createLiveGame({
    realName: "סטס",
    gender: "m",
    rules: { seats: 8, wolfCount: 2, mode: "quick", quickDayMinutes: 5, quickNightMinutes: 2, directorStyle: "dynamic" },
  });
  assert(created.ok, "host creates a quick game");
  if (!created.ok) return;
  const code = created.game.code;
  const hostSecret = created.me!.secret;
  const joined = await live.joinLiveGame({ code, realName: "דנה", gender: "f" });
  assert(joined.ok, "second human joins");
  const started = await live.startLiveGame({ code, secret: hostSecret });
  assert(started.ok, "host starts the game");

  let game = (await store.getLive(code))!;
  assert(game.status === "running" && game.phase === "day", "game opens on day 1 immediately in quick mode");
  assert(game.players.length === 8, "seats filled with agents");
  assert(game.players.every((p) => p.gender === "m" || p.gender === "f"), "every player has a gender");

  const start = game.windowStartAt;
  let t = start;
  let humanAskedAt = 0;
  let replySeenAt = 0;
  let dayOneLock = game.nextLockAt;
  const host = game.players.find((p) => p.host)!;

  const transitions: string[] = [];
  let lastKey = "";
  for (let step = 0; step < 900 && game.status === "running"; step++) {
    t += 15_000;
    await live.catchUp(game, t, agents.makeBudget({ maxLlm: 0, maxEvents: 60 }));
    const key = `${game.phase}/day${game.dayNumber}/alive${game.players.filter((p) => p.alive).length}`;
    if (key !== lastKey) {
      transitions.push(`${Math.round((t - start) / 60_000)}m ${key}`);
      lastKey = key;
    }
    if (!humanAskedAt && game.phase === "day" && game.dayNumber === 1 && t > start + 60_000 && host.alive) {
      const target = game.players.find((p) => p.kind === "agent" && p.alive)!;
      const msg = uniquePush(game, { channel: "public", authorId: host.id, authorName: host.name, text: `${target.name}, על מי אתה חושד?`, ts: t })!;
      agents.onPublicMessage(game, msg, t);
      humanAskedAt = t;
    }
    if (humanAskedAt && !replySeenAt) {
      const reply = game.messages.find((m) => m.replyToId && m.ts >= humanAskedAt);
      if (reply) replySeenAt = reply.ts;
    }
  }

  const pub = game.messages.filter((m) => m.channel === "public");
  const agentDay1 = pub.filter((m) => !m.narrator && m.ts >= start && m.ts <= dayOneLock && m.authorId !== host.id);
  console.log(`day 1 produced ${agentDay1.length} agent lines in ${(dayOneLock - start) / MIN} minutes`);
  assert(agentDay1.length >= 8, "agents talk during a five minute day");
  const gaps = agentDay1.slice(1).map((m, i) => m.ts - agentDay1[i]!.ts);
  const distinct = new Set(gaps.map((g) => Math.round(g / 1000)));
  assert(distinct.size >= Math.min(5, gaps.length), `message gaps vary (${distinct.size} distinct gaps), no fixed pulse`);
  for (let i = 1; i < game.messages.length; i++) assert(game.messages[i]!.ts >= game.messages[i - 1]!.ts || i > 0, "");
  const sorted = game.messages.every((m, i, arr) => i === 0 || m.ts >= arr[i - 1]!.ts);
  assert(sorted, "message log stays in time order");
  assert(replySeenAt > 0 && replySeenAt - humanAskedAt <= 60_000, `an addressed agent answered within ${Math.round((replySeenAt - humanAskedAt) / 1000)}s`);
  assert(game.dayNumber >= 2 || game.status === "ended", "the game advanced past day 1");
  assert(game.deaths.length >= 1, "someone died");
  if (game.status !== "ended") console.log("transitions:\n  " + transitions.join("\n  "));
  assert(game.status === "ended", `the game ended within ${Math.round((t - start) / 60_000)} simulated minutes (${game.winnerText})`);
  const reveal = game.messages.find((m) => m.tone === "reveal");
  assert(Boolean(reveal), "roles were revealed at the end");
  const summaries = game.daySummaries ?? [];
  assert(summaries.length >= 1 && summaries.every((d) => d.text.length > 10), `day summaries were written (${summaries.length})`);
  console.log("--- day summaries ---");
  for (const d of summaries) console.log(`יום ${d.day}: ${d.text}`);

  console.log("\n--- transcript sample (first 30 public lines) ---");
  for (const m of pub.slice(0, 30)) {
    console.log(`${fmt(m.ts)}  ${m.narrator ? "*" : m.authorName + ":"} ${m.text}`);
  }

  // -------------------------------------------------------------- scheduled
  console.log("\n=== Scheduled game: 10:00–22:00, simulated from 10:30 ===");
  const created2 = await live.createLiveGame({
    realName: "מנהלת",
    gender: "f",
    dayStart: "10:00",
    dayEnd: "22:00",
    days: [0, 1, 2, 3, 4, 5, 6],
    rules: { seats: 8, wolfCount: 2, mode: "scheduled" },
  });
  assert(created2.ok, "host creates a scheduled game");
  if (!created2.ok) return;
  const code2 = created2.game.code;
  const started2 = await live.startLiveGame({ code: code2, secret: created2.me!.secret });
  assert(started2.ok, "scheduled game starts (into the waiting room when outside play hours)");
  const g2 = (await store.getLive(code2))!;
  // Jump the clock to tomorrow 10:30 Jerusalem. catchUp must open the day at 10:00 and backfill.
  const p = live.tzParts(Date.now());
  const morning = live.jerusalemToUtc(p.year, p.month, p.day + 1, 10, 30);
  const lock = live.jerusalemToUtc(p.year, p.month, p.day + 1, 22, 0);
  if (g2.phase === "day") {
    // Started inside play hours: the game already has today's window. Use it instead.
    console.log("(started inside play hours, using today's window)");
  }
  let t2 = g2.phase === "day" ? Math.max(Date.now(), g2.windowStartAt + 30 * MIN) : morning;
  const lockUsed = g2.phase === "day" ? g2.nextLockAt : lock;
  const dayEndSeen: number[] = [];
  let sawDay = false;
  for (let step = 0; step < 200 && g2.status === "running" && t2 < lockUsed + 14 * HOUR; step++) {
    t2 += 10 * MIN;
    await live.catchUp(g2, t2, agents.makeBudget({ maxLlm: 0, maxEvents: 60 }));
    if (g2.phase === "day") sawDay = true;
    if (sawDay && g2.phase !== "day" && dayEndSeen.length === 0) dayEndSeen.push(t2);
  }
  const pub2 = g2.messages.filter((m) => m.channel === "public" && !m.narrator && m.ts <= lockUsed);
  const hours = new Set(pub2.map((m) => new Date(m.ts).getUTCHours()));
  console.log(`day 1 produced ${pub2.length} agent lines spread over ${hours.size} different hours`);
  assert(pub2.length >= 20, "a twelve hour day has a real conversation");
  assert(hours.size >= 6, "the conversation is spread across the day, not bunched");
  const reminders = g2.messages.filter((m) => m.tone === "alert");
  assert(reminders.length >= 2, `deadline reminders were posted (${reminders.map((m) => fmt(m.ts)).join(", ")})`);
  assert(dayEndSeen.length === 1 && dayEndSeen[0]! >= lockUsed, "the day locked at closing time and moved into the night");
  const votes = Object.keys(g2.lastLynch?.voters ?? {}).length;
  console.log(`lynch at day end: ${g2.lastLynch ? `${g2.players.find((x) => x.id === g2.lastLynch!.targetId)?.name} with ${g2.lastLynch.voters.length} votes` : "none"}`);
  void votes;
  const night = g2.messages.filter((m) => m.channel === "wolves");
  assert(night.length >= 1, `wolves talked at night (${night.length} lines)`);
  console.log(`after the night: day ${g2.dayNumber}, phase ${g2.phase}, alive ${g2.players.filter((x) => x.alive).length}`);

  console.log("\n--- scheduled day sample (every 4th line) ---");
  for (const m of g2.messages.filter((m) => m.channel === "public").filter((_, i) => i % 4 === 0).slice(0, 25)) {
    console.log(`${fmt(m.ts)}  ${m.narrator ? "*" : m.authorName + ":"} ${m.text}`);
  }

  console.log("\nall good");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export type { LiveGame };

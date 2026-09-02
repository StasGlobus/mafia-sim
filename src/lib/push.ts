import crypto from "crypto";
import webpush from "web-push";
import type { LiveGame, PushEvent, PushKind } from "./types";
import { deletePushSubscription, getSetting, listPushSubscriptions, setSetting } from "./live-store";

/**
 * Web push for humans in a live game.
 *
 * Events are queued on the game state (`pushOutbox`) while the engine runs and
 * delivered by the background pass right after the response, so a player
 * action never waits for a push service. The VAPID key pair is created once
 * and kept in the store's settings table, so no environment variables are
 * needed; VAPID_SUBJECT can override the contact address.
 */

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const COOLDOWN_MS: Partial<Record<PushKind, number>> = {
  mention: 90_000,
  vote_against: 90_000,
};

let cached: VapidKeys | null = null;

function isVapid(value: unknown): value is VapidKeys {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as VapidKeys).publicKey === "string" &&
      typeof (value as VapidKeys).privateKey === "string" &&
      typeof (value as VapidKeys).subject === "string",
  );
}

/** Returns the server's VAPID keys, generating and storing them on first use. */
export async function vapidKeys(originHint?: string): Promise<VapidKeys> {
  if (cached) return cached;
  const stored = await getSetting("vapid");
  if (isVapid(stored)) {
    cached = stored;
    return stored;
  }
  const generated = webpush.generateVAPIDKeys();
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    (originHint && /^https:\/\//.test(originHint) ? originHint : null) ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "mailto:hello@aiyara.app");
  const keys: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
  await setSetting("vapid", keys);
  cached = keys;
  return keys;
}

export async function pushPublicKey(originHint?: string): Promise<string> {
  return (await vapidKeys(originHint)).publicKey;
}

/** Queue a notification for some players. Deduplicates by tag and respects per-kind cooldowns. */
export function queuePush(game: LiveGame, event: { kind: PushKind; playerIds: string[]; title: string; body: string; tag?: string; at?: number }) {
  const at = event.at ?? Date.now();
  game.pushOutbox ??= [];
  game.pushLastAt ??= {};
  const cooldown = COOLDOWN_MS[event.kind] ?? 0;
  const recipients = event.playerIds.filter((id) => {
    const player = game.players.find((p) => p.id === id);
    if (!player || player.kind !== "human") return false;
    if (cooldown) {
      const last = game.pushLastAt![`${id}:${event.kind}`] ?? 0;
      if (at - last < cooldown) return false;
    }
    return true;
  });
  if (!recipients.length) return;
  const tag = event.tag ?? `${event.kind}-${game.dayNumber}`;
  const existing = game.pushOutbox.find((e) => e.tag === tag);
  if (existing) {
    // Newer text wins; add any new recipients.
    existing.title = event.title;
    existing.body = event.body;
    for (const id of recipients) if (!existing.playerIds.includes(id)) existing.playerIds.push(id);
    return;
  }
  for (const id of recipients) game.pushLastAt[`${id}:${event.kind}`] = at;
  game.pushOutbox.push({
    id: `push_${crypto.randomBytes(4).toString("hex")}`,
    kind: event.kind,
    playerIds: recipients,
    title: event.title,
    body: event.body.slice(0, 180),
    tag,
    url: `/g/${game.code}`,
    ts: at,
  });
  if (game.pushOutbox.length > 30) game.pushOutbox = game.pushOutbox.slice(-30);
}

/**
 * Deliver everything in the outbox. Returns true when the outbox changed so
 * the caller knows to save. Dead endpoints are removed.
 */
export async function flushPushOutbox(game: LiveGame): Promise<boolean> {
  const outbox = game.pushOutbox ?? [];
  if (!outbox.length) return false;
  game.pushOutbox = [];
  const ids = [...new Set(outbox.flatMap((e) => e.playerIds))];
  let subs;
  try {
    subs = await listPushSubscriptions(game.code, ids);
  } catch (error) {
    console.error("push: could not list subscriptions", error);
    return true;
  }
  if (!subs.length) return true;
  let keys: VapidKeys;
  try {
    keys = await vapidKeys();
  } catch (error) {
    console.error("push: no VAPID keys", error);
    return true;
  }
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const jobs: Promise<void>[] = [];
  for (const event of outbox) {
    const payload = JSON.stringify({ title: event.title, body: event.body, tag: event.tag, url: event.url });
    for (const sub of subs) {
      if (!event.playerIds.includes(sub.playerId)) continue;
      jobs.push(
        webpush
          .sendNotification(sub.subscription as webpush.PushSubscription, payload, { TTL: 60 * 60 * 6, urgency: "high" })
          .then(() => undefined)
          .catch(async (error: { statusCode?: number }) => {
            if (error?.statusCode === 404 || error?.statusCode === 410) {
              await deletePushSubscription(sub.endpoint).catch(() => undefined);
            } else {
              console.error("push: send failed", error?.statusCode ?? error);
            }
          }),
      );
    }
  }
  await Promise.allSettled(jobs);
  return true;
}

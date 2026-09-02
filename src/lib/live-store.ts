import fs from "fs";
import path from "path";
import type { LiveGame } from "./types";

/**
 * Storage for live games.
 *
 * Supabase is used when SUPABASE_URL and a secret key are configured. Without
 * them the store falls back to process memory with a /tmp mirror, which is
 * enough for local development but resets on a cold start.
 *
 * Both adapters share the same semantics: every saved row carries a version,
 * updates are conditional on that version, and a short lease lets one request
 * at a time run the agent engine so parallel polls do not duplicate work.
 */

export type StoreKind = "supabase" | "memory";

export class LiveStoreConflictError extends Error {
  constructor() {
    super("This game changed before your action could be saved.");
    this.name = "LiveStoreConflictError";
  }
}

export class LiveStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Game storage is temporarily unavailable.");
    this.name = "LiveStoreUnavailableError";
    this.cause = cause;
  }
}

export interface PushSubscriptionRow {
  endpoint: string;
  gameCode: string;
  playerId: string;
  subscription: unknown;
}

interface Adapter {
  kind: StoreKind;
  get(code: string): Promise<{ game: LiveGame; version: number } | null>;
  insert(game: LiveGame): Promise<number>;
  update(game: LiveGame, expectedVersion: number): Promise<number>;
  tryLease(code: string, untilMs: number, nowMs: number): Promise<boolean>;
  releaseLease(code: string): Promise<void>;
  listRunning(): Promise<string[]>;
  ping(): Promise<void>;
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  savePushSubscription(row: PushSubscriptionRow): Promise<void>;
  listPushSubscriptions(gameCode: string, playerIds: string[]): Promise<PushSubscriptionRow[]>;
  deletePushSubscription(endpoint: string): Promise<void>;
}

const versions = new WeakMap<LiveGame, number>();

function key(code: string) {
  return code.trim().toUpperCase();
}

function unavailable(cause: unknown): LiveStoreUnavailableError {
  if (cause instanceof LiveStoreUnavailableError) return cause;
  return new LiveStoreUnavailableError(cause);
}

// ---------------------------------------------------------------------------
// Memory adapter (development fallback)
// ---------------------------------------------------------------------------

const MEMORY_FILE = process.env.MAFIA_STORE_FILE || path.join("/tmp", "mafia-live-games.json");

interface MemoryRow {
  json: string;
  version: number;
  leaseUntil: number;
}

function memoryAdapter(): Adapter {
  const rows = new Map<string, MemoryRow>();
  const settings = new Map<string, unknown>();
  const subs = new Map<string, PushSubscriptionRow>();
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = fs.readFileSync(MEMORY_FILE, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [code, row] of Object.entries(parsed)) {
        if (code === "__settings" && row && typeof row === "object") {
          for (const [k, v] of Object.entries(row as Record<string, unknown>)) settings.set(k, v);
          continue;
        }
        if (code === "__push" && Array.isArray(row)) {
          for (const r of row as PushSubscriptionRow[]) subs.set(r.endpoint, r);
          continue;
        }
        if (row && typeof row === "object" && "json" in row && typeof (row as { json?: unknown }).json === "string") {
          const r = row as { json: string; version?: number };
          rows.set(key(code), { json: r.json, version: Number(r.version ?? 1), leaseUntil: 0 });
        } else if (row && typeof row === "object") {
          // Older files stored the game object directly.
          rows.set(key(code), { json: JSON.stringify(row), version: 1, leaseUntil: 0 });
        }
      }
    } catch {
      /* first run or unreadable file */
    }
  }

  function persist() {
    try {
      const out: Record<string, unknown> = {};
      for (const [code, row] of rows) out[code] = { json: row.json, version: row.version };
      out.__settings = Object.fromEntries(settings);
      out.__push = [...subs.values()];
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(out));
    } catch {
      /* /tmp may be missing; memory still holds the state */
    }
  }

  return {
    kind: "memory",
    async get(code) {
      load();
      const row = rows.get(key(code));
      if (!row) return null;
      return { game: JSON.parse(row.json) as LiveGame, version: row.version };
    },
    async insert(game) {
      load();
      if (rows.has(game.code)) throw new LiveStoreConflictError();
      rows.set(game.code, { json: JSON.stringify(game), version: 1, leaseUntil: 0 });
      persist();
      return 1;
    },
    async update(game, expectedVersion) {
      load();
      const row = rows.get(game.code);
      if (!row || row.version !== expectedVersion) throw new LiveStoreConflictError();
      row.json = JSON.stringify(game);
      row.version = expectedVersion + 1;
      row.leaseUntil = 0;
      persist();
      return row.version;
    },
    async tryLease(code, untilMs, nowMs) {
      load();
      const row = rows.get(key(code));
      if (!row) return false;
      if (row.leaseUntil > nowMs) return false;
      row.leaseUntil = untilMs;
      return true;
    },
    async releaseLease(code) {
      const row = rows.get(key(code));
      if (row) row.leaseUntil = 0;
    },
    async listRunning() {
      load();
      const out: string[] = [];
      for (const [code, row] of rows) {
        try {
          const game = JSON.parse(row.json) as LiveGame;
          if (game.status === "running") out.push(code);
        } catch {
          /* skip broken rows */
        }
      }
      return out;
    },
    async ping() {
      load();
    },
    async getSetting(k) {
      load();
      return settings.has(k) ? settings.get(k)! : null;
    },
    async setSetting(k, value) {
      load();
      settings.set(k, value);
      persist();
    },
    async savePushSubscription(row) {
      load();
      subs.set(row.endpoint, row);
      persist();
    },
    async listPushSubscriptions(gameCode, playerIds) {
      load();
      return [...subs.values()].filter((r) => r.gameCode === key(gameCode) && playerIds.includes(r.playerId));
    },
    async deletePushSubscription(endpoint) {
      load();
      subs.delete(endpoint);
      persist();
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase adapter
// ---------------------------------------------------------------------------

let leaseColumnMissing = false;

async function supabaseAdapter(): Promise<Adapter> {
  const { supabaseAdmin } = await import("./supabase");
  const table = () => supabaseAdmin().from("live_games");

  return {
    kind: "supabase",
    async get(code) {
      const { data, error } = await table().select("state, version").eq("code", key(code)).maybeSingle();
      if (error) throw unavailable(error);
      if (!data) return null;
      return { game: data.state as LiveGame, version: Number(data.version) };
    },
    async insert(game) {
      const { data, error } = await table()
        .insert({ code: game.code, state: game, version: 1 })
        .select("version")
        .single();
      if (error?.code === "23505") throw new LiveStoreConflictError();
      if (error || !data) throw unavailable(error ?? "Insert returned no row");
      return Number(data.version);
    },
    async update(game, expectedVersion) {
      const nextVersion = expectedVersion + 1;
      for (let attempt = 0; attempt < 2; attempt++) {
        const patch: Record<string, unknown> = { state: game, version: nextVersion };
        if (!leaseColumnMissing) patch.lease_until = null;
        const { data, error } = await table()
          .update(patch)
          .eq("code", game.code)
          .eq("version", expectedVersion)
          .select("version")
          .maybeSingle();
        if (error) {
          if (!leaseColumnMissing && /lease_until/.test(error.message ?? "")) {
            leaseColumnMissing = true;
            console.warn("live_games.lease_until is missing; run supabase/migrations/20260903000000_add_live_games_lease.sql.");
            continue;
          }
          throw unavailable(error);
        }
        if (!data) throw new LiveStoreConflictError();
        return Number(data.version);
      }
      throw unavailable("Update failed twice");
    },
    async tryLease(code, untilMs, nowMs) {
      if (leaseColumnMissing) return true;
      const { data, error } = await table()
        .update({ lease_until: new Date(untilMs).toISOString() })
        .eq("code", key(code))
        .or(`lease_until.is.null,lease_until.lt.${new Date(nowMs).toISOString()}`)
        .select("code");
      if (error) {
        if (/lease_until/.test(error.message ?? "")) {
          // Migration 20260903000000 has not been applied yet. Fail open.
          leaseColumnMissing = true;
          console.warn("live_games.lease_until is missing; run the latest Supabase migration.");
          return true;
        }
        throw unavailable(error);
      }
      return (data?.length ?? 0) > 0;
    },
    async releaseLease(code) {
      if (leaseColumnMissing) return;
      await table().update({ lease_until: null }).eq("code", key(code));
    },
    async listRunning() {
      const { data, error } = await table().select("code").eq("state->>status", "running").limit(50);
      if (error) throw unavailable(error);
      return (data ?? []).map((row) => String(row.code));
    },
    async ping() {
      const { error } = await table().select("code", { count: "exact", head: true });
      if (error) throw unavailable(error);
    },
    async getSetting(k) {
      const { data, error } = await supabaseAdmin().from("app_settings").select("value").eq("key", k).maybeSingle();
      if (error) throw unavailable(error);
      return data ? data.value : null;
    },
    async setSetting(k, value) {
      const { error } = await supabaseAdmin().from("app_settings").upsert({ key: k, value, updated_at: new Date().toISOString() });
      if (error) throw unavailable(error);
    },
    async savePushSubscription(row) {
      const { error } = await supabaseAdmin()
        .from("push_subscriptions")
        .upsert({ endpoint: row.endpoint, game_code: key(row.gameCode), player_id: row.playerId, subscription: row.subscription });
      if (error) throw unavailable(error);
    },
    async listPushSubscriptions(gameCode, playerIds) {
      if (!playerIds.length) return [];
      const { data, error } = await supabaseAdmin()
        .from("push_subscriptions")
        .select("endpoint, game_code, player_id, subscription")
        .eq("game_code", key(gameCode))
        .in("player_id", playerIds);
      if (error) throw unavailable(error);
      return (data ?? []).map((r) => ({ endpoint: String(r.endpoint), gameCode: String(r.game_code), playerId: String(r.player_id), subscription: r.subscription }));
    },
    async deletePushSubscription(endpoint) {
      await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint);
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

let adapterPromise: Promise<Adapter> | null = null;

const URL_NAMES = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];
const SECRET_NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"];

function hasAny(names: string[]) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function supabaseConfigured(): boolean {
  return hasAny(URL_NAMES) && hasAny(SECRET_NAMES);
}

/** Which storage variables are present (names only, never values). For /api/health. */
export function storeEnvPresence(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of [...URL_NAMES, ...SECRET_NAMES, "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "SUPABASE_DB_URL", "SUPABASE_ANON_KEY", "VERCEL_ENV"]) {
    out[name] = Boolean(process.env[name]?.trim());
  }
  return out;
}

export function storeKind(): StoreKind {
  return supabaseConfigured() ? "supabase" : "memory";
}

function adapter(): Promise<Adapter> {
  if (adapterPromise) return adapterPromise;
  if (supabaseConfigured()) {
    adapterPromise = supabaseAdapter();
  } else {
    const level = process.env.VERCEL ? "error" : "warn";
    console[level](
      "Supabase is not configured; live games are stored in process memory and will reset on a cold start. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
    adapterPromise = Promise.resolve(memoryAdapter());
  }
  return adapterPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load a fresh, versioned copy of the game. Never send this object to the browser. */
export async function getLive(code: string): Promise<LiveGame | null> {
  try {
    const row = await (await adapter()).get(code);
    if (!row) return null;
    row.game.code = key(row.game.code || code);
    versions.set(row.game, row.version);
    return row.game;
  } catch (error) {
    if (error instanceof LiveStoreConflictError) throw error;
    throw unavailable(error);
  }
}

/**
 * Insert a new game or conditionally update a loaded one. Throws
 * LiveStoreConflictError when someone else saved first.
 */
export async function setLive(game: LiveGame): Promise<LiveGame> {
  game.code = key(game.code);
  const current = versions.get(game);
  try {
    const store = await adapter();
    const version = current === undefined ? await store.insert(game) : await store.update(game, current);
    versions.set(game, version);
    return game;
  } catch (error) {
    if (error instanceof LiveStoreConflictError || error instanceof LiveStoreUnavailableError) throw error;
    throw unavailable(error);
  }
}

/** Try to become the single request that advances this game for a few seconds. */
export async function tryLeaseLive(code: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  try {
    return await (await adapter()).tryLease(code, now + ttlMs, now);
  } catch {
    // A lease is an optimization; the version check still protects the data.
    return true;
  }
}

export async function releaseLeaseLive(code: string): Promise<void> {
  try {
    await (await adapter()).releaseLease(code);
  } catch {
    /* lease expires on its own */
  }
}

export async function listRunningLive(): Promise<string[]> {
  try {
    return await (await adapter()).listRunning();
  } catch (error) {
    throw unavailable(error);
  }
}

export async function getSetting(k: string): Promise<unknown | null> {
  return (await adapter()).getSetting(k);
}

export async function setSetting(k: string, value: unknown): Promise<void> {
  await (await adapter()).setSetting(k, value);
}

export async function savePushSubscription(row: PushSubscriptionRow): Promise<void> {
  await (await adapter()).savePushSubscription(row);
}

export async function listPushSubscriptions(gameCode: string, playerIds: string[]): Promise<PushSubscriptionRow[]> {
  return (await adapter()).listPushSubscriptions(gameCode, playerIds);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await (await adapter()).deletePushSubscription(endpoint);
}

export async function pingStore(): Promise<{ kind: StoreKind; ok: boolean; error?: string }> {
  const kind = storeKind();
  try {
    await (await adapter()).ping();
    return { kind, ok: true };
  } catch (error) {
    const cause = error instanceof LiveStoreUnavailableError ? error.cause : error;
    const message = cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String((cause as { message: unknown }).message) : String(cause);
    return { kind, ok: false, error: message };
  }
}

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

interface Adapter {
  kind: StoreKind;
  get(code: string): Promise<{ game: LiveGame; version: number } | null>;
  insert(game: LiveGame): Promise<number>;
  update(game: LiveGame, expectedVersion: number): Promise<number>;
  tryLease(code: string, untilMs: number, nowMs: number): Promise<boolean>;
  releaseLease(code: string): Promise<void>;
  listRunning(): Promise<string[]>;
  ping(): Promise<void>;
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
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = fs.readFileSync(MEMORY_FILE, "utf8");
      const parsed = JSON.parse(raw) as Record<string, { json?: string; version?: number } | LiveGame>;
      for (const [code, row] of Object.entries(parsed)) {
        if (row && typeof row === "object" && "json" in row && typeof row.json === "string") {
          rows.set(key(code), { json: row.json, version: Number(row.version ?? 1), leaseUntil: 0 });
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
      const out: Record<string, { json: string; version: number }> = {};
      for (const [code, row] of rows) out[code] = { json: row.json, version: row.version };
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
  };
}

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

let adapterPromise: Promise<Adapter> | null = null;

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
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

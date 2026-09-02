import fs from "fs";
import path from "path";
import { Client } from "pg";

/**
 * Applies supabase/migrations/*.sql in order. Shared by the CLI script and the
 * /api/admin/migrate route. Every migration is idempotent.
 */

/**
 * Supabase connection strings often carry `sslmode=require`, which makes `pg`
 * ignore the `ssl` option and then reject Supabase's own certificate chain.
 * We drop that parameter and turn verification off ourselves.
 */
export function normalizeDbUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw;
  }
}

export function migrationFiles(dir = path.join(process.cwd(), "supabase", "migrations")): { dir: string; files: string[] } {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return { dir, files };
}

export interface MigrateResult {
  ok: boolean;
  urlUsed: string | null;
  applied: string[];
  columns: string[];
  error?: string;
  attempts: { url: string; error: string }[];
}

function label(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "invalid url";
  }
}

const CONNECTION_ERRORS = /ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout|Connection terminated/i;

/** Tries each candidate URL until one connects, then applies every migration on it. */
export async function runMigrations(candidates: string[], dir?: string): Promise<MigrateResult> {
  const { files, dir: usedDir } = migrationFiles(dir);
  const result: MigrateResult = { ok: false, urlUsed: null, applied: [], columns: [], attempts: [] };
  if (!files.length) {
    result.error = `No .sql files in ${usedDir}`;
    return result;
  }
  for (const raw of candidates.filter(Boolean)) {
    const client = new Client({
      connectionString: normalizeDbUrl(raw),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.attempts.push({ url: label(raw), error: message });
      await client.end().catch(() => undefined);
      if (CONNECTION_ERRORS.test(message)) continue;
      result.error = message;
      return result;
    }
    result.urlUsed = label(raw);
    try {
      for (const file of files) {
        await client.query(fs.readFileSync(path.join(usedDir, file), "utf8"));
        result.applied.push(file);
      }
      const { rows } = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='live_games' order by ordinal_position",
      );
      result.columns = rows.map((r) => r.column_name);
      result.ok = true;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  result.error = result.error ?? "Could not connect with any of the database URLs.";
  return result;
}

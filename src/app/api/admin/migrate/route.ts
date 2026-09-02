import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { supabaseSecretEnv } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Applies supabase/migrations/*.sql from the deployment itself, using the
 * database URL the Vercel Supabase integration provides. Every migration is
 * idempotent, so calling this again is harmless.
 *
 *   curl -X POST https://<app>/api/admin/migrate -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
 *
 * The caller must present the same secret key the server uses for Supabase.
 * That key already grants full database access, so this adds no new power.
 */
function authorized(req: NextRequest): boolean {
  const expected = supabaseSecretEnv();
  if (!expected) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json(
      { error: "No database URL. Set SUPABASE_DB_URL, or install the Vercel Supabase integration (POSTGRES_URL)." },
      { status: 503 },
    );
  }

  const dir = path.join(process.cwd(), "supabase", "migrations");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return NextResponse.json({ error: `Migrations folder not found at ${dir}` }, { status: 500 });
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const applied: string[] = [];
  try {
    await client.connect();
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      applied.push(file);
    }
    const { rows } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='live_games' order by ordinal_position",
    );
    return NextResponse.json({ ok: true, applied, live_games_columns: rows.map((r) => r.column_name) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, applied, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

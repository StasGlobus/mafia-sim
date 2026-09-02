import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/lib/db-migrate";
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

  // Direct connection first, pooler as fallback (the direct host is IPv6 only on some plans).
  const candidates = [process.env.SUPABASE_DB_URL, process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL].filter(
    (v): v is string => Boolean(v),
  );
  if (!candidates.length) {
    return NextResponse.json(
      { error: "No database URL. Set SUPABASE_DB_URL, or install the Vercel Supabase integration (POSTGRES_URL)." },
      { status: 503 },
    );
  }

  const result = await runMigrations(candidates);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

import { NextRequest, NextResponse } from "next/server";
import { advanceLiveGame } from "@/lib/live";
import { makeBudget } from "@/lib/live-agents";
import { listRunningLive } from "@/lib/live-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Advances every running game, so agents keep talking and windows close even
 * when no player has the app open. Vercel calls this from vercel.json.
 *
 * With CRON_SECRET set, callers must send `Authorization: Bearer <secret>`
 * (Vercel does this automatically). Without it, only Vercel's own cron agent
 * is accepted. Either way the worst a caller can do is advance a game, which
 * any player's poll does too.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
  if (!process.env.VERCEL) return true;
  return /^vercel-cron\//i.test(req.headers.get("user-agent") ?? "");
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deadline = Date.now() + 45_000;
  const codes = await listRunningLive();
  const results: { code: string; ok: boolean; error?: string }[] = [];
  for (const code of codes) {
    if (Date.now() > deadline) break;
    try {
      await advanceLiveGame(code, makeBudget({ maxLlm: 2, deadlineMs: 8_000 }));
      results.push({ code, ok: true });
    } catch (error) {
      results.push({ code, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ running: codes.length, results });
}

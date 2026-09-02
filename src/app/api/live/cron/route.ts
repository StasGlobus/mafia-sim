import { NextRequest, NextResponse } from "next/server";
import { catchUp } from "@/lib/live";
import { makeBudget } from "@/lib/live-agents";
import { getLive, listRunningLive, releaseLeaseLive, setLive, tryLeaseLive } from "@/lib/live-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Advances every running game, so agents keep talking and windows close even
 * when no player has the app open. Vercel calls this from vercel.json with
 * `Authorization: Bearer $CRON_SECRET`; any external scheduler can do the same.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (secret ? auth !== `Bearer ${secret}` : Boolean(process.env.VERCEL)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deadline = Date.now() + 45_000;
  const codes = await listRunningLive();
  const results: { code: string; phase?: string; skipped?: string; error?: string }[] = [];

  for (const code of codes) {
    if (Date.now() > deadline) break;
    const game = await getLive(code);
    if (!game || game.status !== "running") continue;
    const now = Date.now();
    if (!(await tryLeaseLive(code, 15_000, now))) {
      results.push({ code, skipped: "another request is advancing this game" });
      continue;
    }
    const before = JSON.stringify(game);
    try {
      await catchUp(game, now, makeBudget({ maxLlm: 2, deadlineMs: 8_000 }));
      if (JSON.stringify(game) !== before) await setLive(game);
      else await releaseLeaseLive(code);
      results.push({ code, phase: game.phase });
    } catch (error) {
      await releaseLeaseLive(code);
      results.push({ code, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({ running: codes.length, results });
}

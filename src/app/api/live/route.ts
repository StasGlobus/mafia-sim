import { after, NextRequest, NextResponse } from "next/server";
import {
  advanceLiveGame,
  createLiveGame,
  endLiveGame,
  joinLiveGame,
  liveAdminGet,
  liveGet,
  liveNightPick,
  liveSay,
  liveVote,
  setLiveSchedule,
  startLiveGame,
  type ActionResult,
} from "@/lib/live";
import { deletePushSubscription, getLive, LiveStoreConflictError, LiveStoreUnavailableError, savePushSubscription } from "@/lib/live-store";
import { findPlayerBySecret } from "@/lib/live";
import type { LiveRules } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type AuthMap = Record<string, { playerId: string; secret: string }>;

function readAuth(req: NextRequest): AuthMap {
  const raw = req.cookies.get("mafia_live")?.value;
  if (!raw) return {};
  try {
    return JSON.parse(decodeURIComponent(raw)) as AuthMap;
  } catch {
    try {
      return JSON.parse(raw) as AuthMap;
    } catch {
      return {};
    }
  }
}

function withAuth(res: NextResponse, req: NextRequest, code: string, playerId: string, secret: string) {
  const map = readAuth(req);
  map[code] = { playerId, secret };
  res.cookies.set("mafia_live", encodeURIComponent(JSON.stringify(map)), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** Run the agent engine for this game once the response is on its way. */
function advanceLater(code: string | undefined) {
  if (!code) return;
  try {
    after(() => advanceLiveGame(code));
  } catch {
    // Outside a request scope (tests) there is nothing to defer to.
  }
}

function reply(req: NextRequest, result: ActionResult, code?: string, secret?: string, playerId?: string) {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const body: Record<string, unknown> = { game: result.game };
  if (result.me) body.me = result.me;
  const res = NextResponse.json(body);
  const c = code ?? result.game.code;
  const s = secret ?? result.me?.secret;
  const pid = playerId ?? result.me?.playerId ?? result.game.me.playerId;
  if (c && s && pid) withAuth(res, req, c, pid, s);
  return res;
}

function secretFrom(req: NextRequest, body: { code?: string; secret?: string }, code: string): string {
  if (typeof body.secret === "string" && body.secret) return body.secret;
  const q = req.nextUrl.searchParams.get("secret");
  if (q) return q;
  return readAuth(req)[code]?.secret ?? "";
}

export async function GET(req: NextRequest) {
  try {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "חסר קוד משחק" }, { status: 400 });
    const secret = secretFrom(req, { code }, code);
    const asAdmin = req.nextUrl.searchParams.get("asAdmin") === "true";
    if (!secret) {
      const game = await getLive(code);
      if (!game) return NextResponse.json({ error: "אין משחק כזה" }, { status: 404 });
      return NextResponse.json({
        needsAuth: true,
        status: game.status === "idle" ? "lobby" : game.status === "ended" ? "ended" : "running",
        phase: game.phase,
        humansJoined: game.players.filter((p) => p.kind === "human").length,
        seats: game.rules?.seats ?? 8,
        rules: game.rules,
        code: game.code,
      });
    }
    if (asAdmin) {
      const result = await liveAdminGet({ code, secret });
      if (result.ok && result.game.status === "running") advanceLater(code);
      return reply(req, result, code, secret);
    }
    const result = await liveGet({ code, secret });
    if (result.ok && result.game.status === "running") advanceLater(code);
    return reply(req, result, code, secret);
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const action = typeof body.action === "string" ? body.action : "get";

    if (action === "create") {
      const result = await createLiveGame({
        realName: String(body.realName ?? ""),
        gender: typeof body.gender === "string" ? body.gender : undefined,
        dayStart: typeof body.dayStart === "string" ? body.dayStart : undefined,
        dayEnd: typeof body.dayEnd === "string" ? body.dayEnd : undefined,
        days: Array.isArray(body.days) ? (body.days as number[]) : undefined,
        rules: typeof body.rules === "object" && body.rules ? body.rules as Partial<LiveRules> : undefined,
      });
      return reply(req, result);
    }

    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";

    if (action === "join") {
      const cookieSecret = code ? readAuth(req)[code]?.secret : undefined;
      const result = await joinLiveGame({
        code,
        realName: String(body.realName ?? ""),
        gender: typeof body.gender === "string" ? body.gender : undefined,
        secret: typeof body.secret === "string" ? body.secret : cookieSecret,
      });
      return reply(req, result);
    }

    const secret = secretFrom(req, { code, secret: typeof body.secret === "string" ? body.secret : undefined }, code);
    if (!code) return NextResponse.json({ error: "חסר קוד משחק" }, { status: 400 });
    if (!secret) return NextResponse.json({ error: "לא מצאנו אותך בשולחן הזה. כנסו מחדש עם הקוד" }, { status: 401 });

    const asAdmin = body.asAdmin === true;

    if (action === "pushSubscribe" || action === "pushUnsubscribe") {
      const game = await getLive(code);
      if (!game) return NextResponse.json({ error: "אין משחק כזה" }, { status: 404 });
      const me = findPlayerBySecret(game, secret);
      if (!me) return NextResponse.json({ error: "לא מצאנו אותך בשולחן הזה. כנסו מחדש עם הקוד" }, { status: 401 });
      const sub = body.subscription as { endpoint?: unknown } | undefined;
      const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : typeof body.endpoint === "string" ? body.endpoint : "";
      if (!endpoint || !/^https:\/\//.test(endpoint)) return NextResponse.json({ error: "מנוי לא תקין" }, { status: 400 });
      if (action === "pushUnsubscribe") {
        await deletePushSubscription(endpoint);
        return NextResponse.json({ ok: true });
      }
      await savePushSubscription({ endpoint, gameCode: game.code, playerId: me.id, subscription: sub });
      return NextResponse.json({ ok: true });
    }

    if (action === "admin" || (action === "get" && asAdmin)) {
      const result = await liveAdminGet({ code, secret });
      if (result.ok && result.game.status === "running") advanceLater(code);
      return reply(req, result, code, secret);
    }
    if (action === "end") {
      const result = await endLiveGame({ code, secret });
      if (result.ok) advanceLater(code);
      return reply(req, result, code, secret);
    }
    if (action === "setSchedule") {
      const result = await setLiveSchedule({
        code,
        secret,
        dayStart: typeof body.dayStart === "string" ? body.dayStart : undefined,
        dayEnd: typeof body.dayEnd === "string" ? body.dayEnd : undefined,
        days: Array.isArray(body.days) ? (body.days as number[]) : undefined,
      });
      return reply(req, result, code, secret);
    }
    if (action === "start") {
      const result = await startLiveGame({ code, secret });
      if (result.ok) advanceLater(code);
      if (result.ok && asAdmin) {
        const admin = await liveAdminGet({ code, secret });
        return reply(req, admin, code, secret);
      }
      return reply(req, result, code, secret);
    }
    if (action === "say") {
      const result = await liveSay({
        code,
        secret,
        text: String(body.text ?? ""),
        replyToId: typeof body.replyToId === "string" ? body.replyToId : undefined,
      });
      if (result.ok) advanceLater(code);
      return reply(req, result, code, secret);
    }
    if (action === "vote") {
      const result = await liveVote({ code, secret, targetId: String(body.targetId ?? "") });
      if (result.ok) advanceLater(code);
      return reply(req, result, code, secret);
    }
    if (action === "nightPick") {
      const result = await liveNightPick({ code, secret, targetId: String(body.targetId ?? "") });
      if (result.ok) advanceLater(code);
      return reply(req, result, code, secret);
    }

    const result = await liveGet({ code, secret });
    if (result.ok && result.game.status === "running") advanceLater(code);
    return reply(req, result, code, secret);
  } catch (error) {
    return storageError(error);
  }
}

function storageError(error: unknown) {
  if (error instanceof LiveStoreConflictError) {
    return NextResponse.json({ error: "מישהו הקדים אותך בשנייה. נסו שוב." }, { status: 409 });
  }
  if (error instanceof LiveStoreUnavailableError) {
    return NextResponse.json({ error: "השמירה לא זמינה כרגע. עוד רגע ננסה שוב." }, { status: 503 });
  }
  console.error("Live game API failed", error);
  return NextResponse.json({ error: "משהו נשבר אצלנו. נסו שוב עוד רגע." }, { status: 500 });
}

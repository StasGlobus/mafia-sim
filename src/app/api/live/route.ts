import { NextRequest, NextResponse } from "next/server";
import {
  createLiveGame,
  joinLiveGame,
  liveGet,
  liveNightPick,
  liveSay,
  liveVote,
  startLiveGame,
  type ActionResult,
} from "@/lib/live";
import { getLive } from "@/lib/live-store";

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
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "חסר קוד" }, { status: 400 });
  const secret = secretFrom(req, { code }, code);
  if (!secret) {
    const game = getLive(code);
    if (!game) return NextResponse.json({ error: "אין משחק כזה" }, { status: 404 });
    return NextResponse.json({
      needsAuth: true,
      status: game.status === "idle" ? "lobby" : game.status === "ended" ? "ended" : "running",
      phase: game.phase,
      humansJoined: game.players.filter((p) => p.kind === "human").length,
      seats: 8,
      code: game.code,
    });
  }
  const result = await liveGet({ code, secret });
  return reply(req, result, code, secret);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "get";

  if (action === "create") {
    const result = createLiveGame({
      realName: String(body.realName ?? ""),
      dayStart: typeof body.dayStart === "string" ? body.dayStart : undefined,
      dayEnd: typeof body.dayEnd === "string" ? body.dayEnd : undefined,
      days: Array.isArray(body.days) ? (body.days as number[]) : undefined,
    });
    return reply(req, result);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (action === "join") {
    const cookieSecret = code ? readAuth(req)[code]?.secret : undefined;
    const result = joinLiveGame({
      code,
      realName: String(body.realName ?? ""),
      secret: typeof body.secret === "string" ? body.secret : cookieSecret,
    });
    return reply(req, result);
  }

  const secret = secretFrom(req, { code, secret: typeof body.secret === "string" ? body.secret : undefined }, code);
  if (!code) return NextResponse.json({ error: "חסר קוד" }, { status: 400 });
  if (!secret) return NextResponse.json({ error: "חסר מפתח" }, { status: 401 });

  if (action === "start") {
    const result = await startLiveGame({ code, secret });
    return reply(req, result, code, secret);
  }
  if (action === "say") {
    const result = await liveSay({ code, secret, text: String(body.text ?? "") });
    return reply(req, result, code, secret);
  }
  if (action === "vote") {
    const result = await liveVote({ code, secret, targetId: String(body.targetId ?? "") });
    return reply(req, result, code, secret);
  }
  if (action === "nightPick") {
    const result = await liveNightPick({ code, secret, targetId: String(body.targetId ?? "") });
    return reply(req, result, code, secret);
  }

  const result = await liveGet({ code, secret });
  return reply(req, result, code, secret);
}

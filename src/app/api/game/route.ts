import { NextRequest, NextResponse } from "next/server";
import { getState, setState } from "@/lib/store";
import { applyControl, startGame, tick } from "@/lib/engine";
import { DEFAULT_CONFIG, type GameConfig, type Speed } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = getState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  let body: {
    action?: string;
    speed?: Speed;
    config?: Partial<GameConfig>;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body.action ?? "tick";
  let state = getState();

  if (action === "start") {
    const config = { ...DEFAULT_CONFIG, ...(body.config ?? state.config) };
    const speed = body.speed ?? state.speed ?? 1;
    state = startGame(config, speed);
    setState(state);
    return NextResponse.json(state);
  }

  if (action === "tick") {
    state = tick(state);
    setState(state);
    return NextResponse.json(state);
  }

  state = applyControl(state, action, {
    speed: body.speed,
    config: body.config,
  });
  setState(state);
  return NextResponse.json(state);
}

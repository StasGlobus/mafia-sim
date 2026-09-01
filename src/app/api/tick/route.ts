import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/store";
import { tick } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST() {
  const state = await tick(getState());
  setState(state);
  return NextResponse.json(state);
}

import { NextRequest, NextResponse } from "next/server";
import { pushPublicKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The VAPID public key browsers need to subscribe. Created on first call. */
export async function GET(req: NextRequest) {
  try {
    const publicKey = await pushPublicKey(req.nextUrl.origin);
    return NextResponse.json({ publicKey });
  } catch (error) {
    console.error("push key", error);
    return NextResponse.json({ error: "push unavailable" }, { status: 503 });
  }
}

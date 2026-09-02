import { NextResponse } from "next/server";
import { pingStore, storeEnvPresence } from "@/lib/live-store";
import { agentModelName, llmAvailable } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deployment check: which store is active, whether it answers, and whether agents can reach a model. */
export async function GET() {
  const store = await pingStore();
  return NextResponse.json(
    {
      ok: store.ok,
      store: store.kind,
      storeError: store.error ?? null,
      llm: llmAvailable() ? (process.env.OPENAI_API_KEY ? "openai" : "vercel-ai-gateway") : "canned-lines",
      model: agentModelName(),
      env: storeEnvPresence(),
      vercelEnv: process.env.VERCEL_ENV ?? null,
    },
    { status: store.ok ? 200 : 503 },
  );
}

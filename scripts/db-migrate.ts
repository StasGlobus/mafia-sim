/**
 * Applies supabase/migrations/*.sql to a Postgres database, in file order.
 *
 *   SUPABASE_DB_URL=postgresql://... npm run db:migrate
 *
 * The URL is the "Connection string" (URI, session or transaction pooler) from
 * Supabase > Project Settings > Database. It can also live in .env.local.
 * Every migration is written with IF NOT EXISTS / OR REPLACE, so running this
 * twice is safe.
 */

import fs from "fs";
import path from "path";
import { runMigrations } from "../src/lib/db-migrate";

/** Same files Next.js reads: .env.local wins over .env, real environment wins over both. */
function loadEnvLocal() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key!] !== undefined) continue;
      process.env[key!] = raw!.trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnvLocal();
  const candidates = [process.env.SUPABASE_DB_URL, process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL].filter(
    (v): v is string => Boolean(v),
  );
  if (!candidates.length) {
    console.error(
      [
        "SUPABASE_DB_URL is not set.",
        "Copy the connection string from the Connect button in the Supabase dashboard (URI),",
        "put it in .env (or .env.local) as SUPABASE_DB_URL=postgresql://... and run this again.",
      ].join("\n"),
    );
    process.exit(1);
  }
  const result = await runMigrations(candidates);
  for (const a of result.attempts) console.log(`could not connect to ${a.url}: ${a.error}`);
  for (const f of result.applied) console.log(`applied ${f}`);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`connected via ${result.urlUsed}`);
  console.log(`live_games columns: ${result.columns.join(", ")}`);
  console.log("done. Now set SUPABASE_URL and SUPABASE_SECRET_KEY and open /api/health.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

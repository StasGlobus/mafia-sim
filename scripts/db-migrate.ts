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
import { Client } from "pg";

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
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      [
        "SUPABASE_DB_URL is not set.",
        "Copy the connection string from Supabase > Project Settings > Database > Connection string (URI),",
        "put it in .env (or .env.local) as SUPABASE_DB_URL=postgresql://... and run this again.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!files.length) {
    console.error(`No .sql files in ${dir}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await client.query(sql);
      console.log("ok");
    }
    const { rows } = await client.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='live_games' order by ordinal_position",
    );
    console.log(`live_games columns: ${rows.map((r: { column_name: string }) => r.column_name).join(", ")}`);
    console.log("done. Now set SUPABASE_URL and SUPABASE_SECRET_KEY and open /api/health.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

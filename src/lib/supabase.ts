import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Names set by hand or by the Vercel Supabase integration. First non-empty wins. */
export const SUPABASE_URL_NAMES = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
export const SUPABASE_SECRET_NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"] as const;

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function supabaseUrlEnv() {
  return firstEnv(SUPABASE_URL_NAMES);
}

export function supabaseSecretEnv() {
  return firstEnv(SUPABASE_SECRET_NAMES);
}

/**
 * Returns the server-only Supabase client. This intentionally accepts no
 * browser/public key: game state includes player secrets and roles.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;

  const rawUrl = supabaseUrlEnv();
  const secretKey = supabaseSecretEnv();

  if (!rawUrl || !secretKey) {
    throw new Error(
      "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.",
    );
  }
  if (/^https?:/.test(secretKey)) {
    throw new Error(
      "SUPABASE_SECRET_KEY looks like a URL. Paste the secret key from Project Settings > API Keys (it starts with sb_secret_ or eyJ).",
    );
  }
  // Accept a pasted URL with a path (for example .../rest/v1) and keep only the origin.
  let url: string;
  try {
    url = new URL(rawUrl).origin;
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL. It should look like https://<project-ref>.supabase.co");
  }

  client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

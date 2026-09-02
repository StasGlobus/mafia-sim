import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Returns the server-only Supabase client. This intentionally accepts no
 * browser/public key: game state includes player secrets and roles.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;

  const rawUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

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

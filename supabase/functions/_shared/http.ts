// What the three edge functions share: replies, CORS, and calling the database.

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// SERVICE_KEY lets the project supply a new-style secret key if legacy keys are turned off.
export const SERVICE_KEY = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Answers the browser's preflight; null for a real request. Only POST is served. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    // Allow whatever headers the browser says the client will send (the Supabase client adds a few).
    const asked = req.headers.get("access-control-request-headers");
    return new Response(null, { status: 204, headers: asked ? { ...CORS, "Access-Control-Allow-Headers": asked } : CORS });
  }
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);
  return null;
}

/** The JSON body as an object; empty when there is none or it isn't JSON. */
export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const service = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

/** Calls a database function as the service role. Throws when the database refuses. */
export async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: service,
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** A table request as the service role (bypasses RLS: only for tables no client may touch). */
export async function table(method: string, path: string, rows?: unknown, prefer = ""): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...service, Prefer: prefer },
    body: rows === undefined ? undefined : JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** How tokens are stored: the SHA-256 of the token, in hex (private.token_hash in the database). */
export async function tokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

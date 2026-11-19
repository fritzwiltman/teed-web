// redeem-code: logs a phone in with a player or spectator code.
//
// The phone signs in anonymously first, then calls this with its session token and the code.
// All the rules (live trips only, rate limits, linking the session) are in the database function
// public.redeem_code (migration 0004), which only the service role may call. This function
// checks who is calling, works out their IP address and passes both on.
//
//   POST { "code": "PINES-FW26-K4M9" }      Authorization: Bearer <the phone's access token>
//   200  { status: "ok", role, trip, player }
//   404  { status: "invalid_code" }
//   409  { status: "trip_not_live", trip_status }
//   429  { status: "rate_limited", retry_after }   (seconds; also sent as Retry-After)
//   401  { status: "unauthorized" }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// SERVICE_KEY lets the project supply a new-style secret key if legacy keys are turned off.
const SERVICE_KEY = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const HTTP_STATUS: Record<string, number> = {
  ok: 200,
  invalid_code: 404,
  trip_not_live: 409,
  rate_limited: 429,
};

function json(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra, "Content-Type": "application/json" },
  });
}

// The platform's proxy puts the caller's address first in x-forwarded-for.
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    // Allow whatever headers the browser says the client will send (the Supabase client adds a few).
    const asked = req.headers.get("access-control-request-headers");
    return new Response(null, { status: 204, headers: asked ? { ...CORS, "Access-Control-Allow-Headers": asked } : CORS });
  }
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  // Who is calling? Ask Auth to validate the token rather than trusting its contents.
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return json({ status: "unauthorized" }, 401);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: req.headers.get("apikey") ?? ANON_KEY },
  });
  if (!userRes.ok) return json({ status: "unauthorized" }, 401);
  const user = await userRes.json() as { id?: string };
  if (!user.id) return json({ status: "unauthorized" }, 401);

  let code = "";
  try {
    const body = await req.json() as { code?: unknown };
    if (typeof body.code === "string") code = body.code.slice(0, 64);
  } catch {
    // no body or not JSON: treated as an empty code
  }

  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_code`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: code, p_user_id: user.id, p_ip: clientIp(req) }),
  });
  if (!rpc.ok) {
    console.error("redeem_code failed", rpc.status, await rpc.text());
    return json({ status: "error" }, 500);
  }

  const result = await rpc.json() as { status: string; retry_after?: number };
  const extra = result.status === "rate_limited" ? { "Retry-After": String(result.retry_after ?? 300) } : undefined;
  return json(result, HTTP_STATUS[result.status] ?? 500, extra);
});

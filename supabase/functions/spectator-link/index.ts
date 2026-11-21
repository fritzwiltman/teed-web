// spectator-link: hands out a trip's spectator link, and resets it.
//
// The link is never stored. It is derived from a server secret (SPECTATOR_LINK_SECRET) and a
// per-trip nonce; the database holds the nonce and the link's hash (spectator_links, which no
// client can read). So anyone on the trip can be given the current link to share, and a reset
// (a new nonce) makes the old link stop working.
//
//   POST { "trip_id": "...", "action": "get" }     anyone on the trip
//   POST { "trip_id": "...", "action": "reset" }   organizer, co-organizer or app admin: creates or replaces it
//   Authorization: Bearer <the caller's access token>
//   200  { token: "<for /watch/<token>>" }   (token is null from "get" when no link has been made)
//   401  { status: "unauthorized" }    403  { status: "forbidden" }

import { ANON_KEY, body, json, preflight, SUPABASE_URL, table, tokenHash } from "../_shared/http.ts";

const SECRET = Deno.env.get("SPECTATOR_LINK_SECRET") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function linkToken(tripId: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${tripId}:${nonce}`)));
}

/** The caller's standing on the trip, asked of the database as the caller: a role, 'admin' or null. */
async function tripRole(req: Request, tripId: string): Promise<string | null | undefined> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return undefined;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/trip_role`, {
    method: "POST",
    headers: { Authorization: authorization, apikey: req.headers.get("apikey") ?? ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_trip_id: tripId }),
  });
  if (!res.ok) return undefined;   // signed out, or a token Auth doesn't accept
  return await res.json() as string | null;
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const { trip_id: tripId, action } = await body(req);
  if (typeof tripId !== "string" || !UUID.test(tripId) || (action !== "get" && action !== "reset")) {
    return json({ status: "bad_request" }, 400);
  }

  const role = await tripRole(req, tripId);
  if (role === undefined) return json({ status: "unauthorized" }, 401);
  if (role === null) return json({ status: "forbidden" }, 403);
  if (action === "reset" && !["admin", "organizer", "co_organizer"].includes(role)) {
    return json({ status: "forbidden" }, 403);
  }
  if (SECRET.length < 32) {
    console.error("SPECTATOR_LINK_SECRET is not set (needs 32 characters or more)");
    return json({ status: "not_configured" }, 500);
  }

  try {
    if (action === "reset") {
      const nonce = base64url(crypto.getRandomValues(new Uint8Array(18)));
      const token = await linkToken(tripId, nonce);
      await table("POST", "spectator_links?on_conflict=trip_id",
        { trip_id: tripId, nonce, token_hash: await tokenHash(token), created_at: new Date().toISOString() },
        "resolution=merge-duplicates");
      return json({ token });
    }
    const rows = await table("GET", `spectator_links?trip_id=eq.${tripId}&select=nonce`) as { nonce: string }[];
    return json({ token: rows.length ? await linkToken(tripId, rows[0].nonce) : null });
  } catch (e) {
    console.error(e);
    return json({ status: "error" }, 500);
  }
});

// spectate: everything a spectator link shows.
//
// No account: the token in the link is looked up by its hash. What comes back is decided by the
// database function public.spectator_view (migration 0008): the trip's name and dates, rounds,
// groups, scores and presses; money settings only when the trip lets spectators see winnings.
// No itinerary, people list, emails or buy-ins. The anon role has no access to any table.
//
//   POST { "token": "<from /watch/<token>>" }
//   200  { trip: {...}, rounds: [...] }
//   404  { status: "invalid" }      (unknown or reset link, or the trip isn't published)

import { body, json, preflight, rpc, tokenHash } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const { token } = await body(req);
  if (typeof token !== "string" || !token || token.length > 200) return json({ status: "invalid" }, 404);

  try {
    const view = await rpc("spectator_view", { p_token_hash: await tokenHash(token) });
    return view ? json(view) : json({ status: "invalid" }, 404);
  } catch (e) {
    console.error(e);
    return json({ status: "error" }, 500);
  }
});

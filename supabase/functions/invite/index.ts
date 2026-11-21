// invite: what an invite link shows before the person has signed in.
//
// No account needed: the token in the link is the proof. The lookup is the database function
// public.invite_preview (migration 0008), which only the service role may call. Joining the
// trip happens after sign-in, through claim_invite().
//
//   POST { "token": "<from /invite/<token>>" }
//   200  { kind: "trip", inviter, name, email, trip: { name, start_date, end_date, players } }
//   200  { kind: "creator", inviter, name }        (an invite to plan trips)
//   404  { status: "invalid" }                     (unknown, used or replaced link)

import { body, json, preflight, rpc } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const { token } = await body(req);
  if (typeof token !== "string" || !token || token.length > 200) return json({ status: "invalid" }, 404);

  try {
    const preview = await rpc("invite_preview", { p_token: token });
    return preview ? json(preview) : json({ status: "invalid" }, 404);
  } catch (e) {
    console.error(e);
    return json({ status: "error" }, 500);
  }
});

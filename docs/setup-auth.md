# Setting up sign-in (M3.6)

What to set in Supabase and Gmail for email-code sign-in, and the order to roll M3.6 out in.
Nothing here goes in the repo: the app password and the spectator secret live only in Supabase.

## 1. Gmail: an app password

On the dedicated Gmail account:

1. Google Account → Security → turn on **2-Step Verification** (app passwords need it).
2. Google Account → Security → 2-Step Verification → **App passwords** (or https://myaccount.google.com/apppasswords).
   Create one named "Teed". Copy the 16 characters; spaces don't matter.

Gmail sends about 500 emails a day from a personal account. A trip is a few dozen codes.

## 2. Supabase dashboard

Project → **Authentication**.

**Emails → SMTP Settings**: turn on *Enable custom SMTP*.

| Field | Value |
| --- | --- |
| Sender email address | the Gmail address |
| Sender name | Teed |
| Host | `smtp.gmail.com` |
| Port number | `587` |
| Username | the full Gmail address |
| Password | the 16-character app password |
| Minimum interval per user | `30` seconds (the app lets someone ask for a new code after 30) |

**Emails → Templates**: for each of these three, set the subject to `Your Teed code` and replace the whole body
with the file's contents. The body must contain `{{ .Token }}` and no `{{ .ConfirmationURL }}`.

| Template in the dashboard | File |
| --- | --- |
| Confirm sign up | `supabase/templates/confirmation.html` (someone's first sign-in) |
| Magic link | `supabase/templates/magic_link.html` (every sign-in after that) |
| Change email address | `supabase/templates/email_change.html` |

**Sign In / Providers → Email**:

- *Enable Email provider*: on.
- *Confirm email*: **on**. This matters: with it off, an address counts as verified before its code is typed,
  and invites would be claimed by whoever typed someone else's email.
- *Email OTP length*: `6`.
- *Email OTP expiration*: `3600` seconds (the app says "That code expired" after an hour).

**Sign In / Providers → Allow anonymous sign-ins**: **off**. (Do this when you roll out, step 3 below: the app
in production today still uses it.)

**Rate Limits**: *Rate limit for sending emails* to at least `100` an hour.

No redirect URLs are needed: there are no links in the emails.

## 3. Rolling out

Migration 0008 changes the tables under the app that is live now, so do these together, in this order:

```
# 1. The spectator-link secret (any long random value; it never leaves Supabase)
npx supabase secrets set SPECTATOR_LINK_SECRET="$(openssl rand -base64 48)"

# 2. The new edge functions (harmless before the migration)
npx supabase functions deploy invite spectate spectator-link

# 3. The migration, then merge the PR straight away (Cloudflare deploys in a minute or two)
npx supabase db push

# 4. The old code-login function
npx supabase functions delete redeem-code
```

Then turn off anonymous sign-ins (above).

The migration keeps every trip, round and score. It makes the "This is me" player each trip's organizer, linked
to the owner's account (for a trip without one, the owner's account becomes a new organizer member), turns
co-admins into co-organizers, locks the handicaps of trips past their lock date, and deletes the anonymous users
that code logins created. To see it run on a copy of that shape first: `scripts/test-accounts-migration.sh`.

## 4. The app admin

The migration carries your admin rights over from `app_admins`, so sign in with the same email as before and you
are the app admin. If you ever need to set it by hand (after signing in once, so the profile exists), run this in
the SQL editor with your own address:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

## Local stack

`npx supabase start` (needs Docker) runs Auth with the same templates; sign-in emails land in the mail catcher at
http://127.0.0.1:54324. If the first emails are Supabase's stock ones, restart Auth once
(`docker restart supabase_auth_teed`): it reads the templates before the gateway is up. Sign in with a made-up
address such as `admin@teed.test`, then make it the app admin with the statement above. The edge functions need
`SPECTATOR_LINK_SECRET` in the environment (any 32+ characters) before `supabase start`.

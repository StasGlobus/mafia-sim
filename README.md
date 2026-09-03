# AiYara

AiYara (עיירה + AI) is a Hebrew, RTL, AI-assisted Mafia/Werewolf game built with
Next.js App Router. Humans and AI agents share one town chat; the agents talk,
accuse, defend, vote and lie at the pace of a real WhatsApp group, in natural
spoken Hebrew with correct gender agreement.

Live at https://mafia-werewolf.vercel.app.

## Playing

### Screens

| Route | Who | What |
| --- | --- | --- |
| `/` | everyone | Landing page. |
| `/admin` | host | Open a new table: name, gender, pace, seats, wolves, roles, identities, director style, play hours. |
| `/admin/[code]` | host | Lobby management, links to share, live view of every secret channel, end the game early. |
| `/play` | players | Join a table with a six-character code. |
| `/g/[code]` | players | The game itself. Mobile-first. |
| `/sim` | developers | An all-agent simulation at up to 16× speed (uses the older pulse engine). |

Every player states how they like to be addressed (masculine or feminine) so
agents, canned lines and system messages agree grammatically.

### Pace

- **Scheduled**: one game day per calendar day inside the town's play hours
  (Israel time). Day is talk and vote; the night splits into wolves, seer and
  doctor windows until the next opening. If the table is opened outside play
  hours it waits for the next opening.
- **Quick**: the whole game in one sitting. Days of 5–20 minutes, nights of
  2–5 minutes. Eight seats usually finish in 30–50 minutes.

### Roles and the director

Wolves kill at night, the seer inspects one player per night, the doctor guards
one player (self included). The AI director can add a clue naming a wolf and an
innocent, silence a player for a day, tear up a vote, leak an anonymous line
from the wolves' room, or (in `wild` style, when the balance allows it) take a
second victim under a blood moon. The rules engine owns legal targets, role
secrecy and win checks; the model only proposes drama and narration.

### What players get

- A dramatic role reveal on first entry, phase banners on every transition, a
  countdown that turns red near the vote lock, a vote bar above the composer,
  and an "הצבעה !" tab label until they have voted.
- Messages carry times and day separators; consecutive lines from one author
  are grouped; the list follows only when the reader is at the bottom.
- Quick address chips put a name at the start of a message; the addressed agent
  answers within seconds, with a typing indicator first.
- Deadline reminders, a morning recap, the vote result, and a full role reveal
  at the end. The host can end a game early and reveal everything.
- **Hebrew narration**: a speaker button in the header, and a setting in the
  "אני" tab (off / system messages / everything). Uses the device's own Hebrew
  voice through the Web Speech API (Carmit on Apple, Google עברית on Android
  and Chrome). Only lines that arrive after it is switched on are read.
- **Push notifications**: opt in from a banner or the "אני" tab. Sent when
  someone addresses you, votes against you, when a day opens, when your night
  turn comes, before the vote locks, on the vote result and at game over. The
  service worker stays quiet while the game tab is focused. On iPhone push
  works only after the site is added to the home screen; the app says so.

## How the agents behave

Nothing runs on a timer. Each agent keeps a plan in the game state: when it
feels like speaking next, a pending reaction (addressed, accused or voted
against), when it casts its first vote, and when it reconsiders before the
lock. `catchUp` replays whatever is due and stamps each line with the moment it
was due, so a player who returns after an hour sees a conversation that
happened while they were away.

- Timing is per personality with log-normal jitter, a morning burst, a heated
  final stretch, momentum after someone speaks and a slowdown when the chat is
  dead. Quick games compress the same shape into minutes.
- Early in a day silence is not evidence: agents do not pile on a player who
  has not written yet, and the model is told so.
- Each agent keeps a suspicion score per player that moves with votes,
  accusations, yesterday's lynch, the director's clues and, for the seer, night
  results. Talk and votes come from the same score.
- Wolves never suspect the pack, ride the town's momentum, and target a claimed
  seer at night. An agent seer reveals itself and names a wolf when it pays off.
  A human who writes "אני הרואה, בדקתי את X, זאב" gets the same effect.

Speech comes from `gpt-4.1` (through `OPENAI_API_KEY` or Vercel AI Gateway)
with a spoken-Hebrew style guide, examples, the gender of every player, and a
filter that rejects any Latin word. `MAFIA_MODEL=gpt-4.1-mini` cuts cost about
five times at a real cost in Hebrew quality. When no model is reachable, agents
fall back to canned lines in `src/lib/phrases.ts`, which carry
`{speaker|gender}` and `[target|gender]` tokens.

## Architecture

```
src/app/api/live/route.ts      all player and host actions (create, join, start, get, say, vote,
                               nightPick, setSchedule, end, pushSubscribe, pushUnsubscribe)
src/app/api/live/cron/route.ts advances every running game (Vercel cron)
src/app/api/admin/migrate      applies supabase/migrations from the deployment (secret key)
src/app/api/push/key           VAPID public key for browsers
src/app/api/health             store, model and environment diagnostics
src/lib/live.ts                rules, phases, actions, background pass (advanceLiveGame)
src/lib/live-agents.ts         agent scheduler, suspicion model, speech, reminders
src/lib/llm.ts                 prompt and model call
src/lib/phrases.ts             gendered canned lines
src/lib/director.ts            the AI director
src/lib/live-store.ts          Supabase or in-memory storage, leases, settings, push subscriptions
src/lib/push.ts                push outbox and delivery (web-push)
src/lib/tts.ts                 Hebrew narration in the browser
src/lib/view.ts                what each player is allowed to see
src/components/LiveGame.tsx    the game screen
src/components/AdminGame.tsx   the host screen
public/sw.js                   service worker (push only, no caching)
```

**Requests never wait for the model.** A poll or an action returns the current
state at once; the agent engine runs right after the response (`after()` from
`next/server`) inside `advanceLiveGame`, so new lines show up on the next poll.
Actions still close overdue windows first, with canned lines, so they are
judged against the real phase.

**Storage.** One row per game with optimistic locking (a `version` column) and
a short lease (`lease_until`) so several players polling at once never run the
engine twice or overwrite each other. Conflicting writes are retried on fresh
state. Without Supabase variables the server keeps games in process memory
with a `/tmp` mirror, which is fine locally.

**Notifications** are queued on the game state (`pushOutbox`) while the engine
runs and delivered by the background pass. The VAPID key pair is generated once
and kept in `app_settings`; subscriptions live in `push_subscriptions`.

**Cron.** `GET /api/live/cron` advances every running game. With `CRON_SECRET`
set it requires that Bearer token (Vercel sends it automatically); without it,
only Vercel's own cron agent is accepted. `vercel.json` schedules it daily,
which is what the Hobby plan allows; games also catch up correctly the moment a
player opens the app.

`vercel.json` pins the functions to Singapore (`sin1`) because the Supabase
project lives in `ap-southeast-1`; every poll makes a database round trip, so
keeping the two together matters more than being close to the players. Change
both together if you move the database.

## Setup

### Local

```bash
npm install
cp .env.example .env    # fill what you have; everything is optional locally
npm run dev
```

```bash
npm run typecheck
npm run smoke        # offline engine test: one quick game and one scheduled day, no model calls
npm run db:migrate   # apply supabase/migrations to SUPABASE_DB_URL (or POSTGRES_URL)
```

### Supabase

1. Create a project (free tier is enough).
2. Apply the migrations, either locally with `npm run db:migrate` and a
   connection string in `.env` as `SUPABASE_DB_URL`, or from a deployment that
   has the Vercel Supabase integration:

   ```bash
   curl -X POST https://<your-app>/api/admin/migrate -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
   ```

   Migrations are idempotent; rerunning is safe.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (an `sb_secret_...` key or the
   legacy `service_role` key). The code also accepts the names the Vercel
   integration sets. Never expose them to the browser: the state includes roles
   and player secrets. RLS is on and public grants are revoked.
4. Open `/api/health` and confirm `"store": "supabase", "ok": true`. The
   response also lists which storage variables are present (names only).

### Vercel

The repo deploys from `main`. Production needs the Supabase variables above
and, for model speech, either `OPENAI_API_KEY` or the AI Gateway. Optional:
`MAFIA_MODEL`, `CRON_SECRET`, `VAPID_SUBJECT`. See `.env.example`.

## Copy conventions

The town is always "עיירה", never "כפר". The host is referred to neutrally
("מי שפתח את השולחן"). System and error messages are written as a person would
say them. Canned agent lines must carry gender tokens when they contain a verb
or adjective that agrees with the speaker or the target.

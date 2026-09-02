# Mafia

A Hebrew, RTL, AI-assisted Mafia/Werewolf game built with Next.js App Router.
Humans and AI agents share one village chat; the agents talk, accuse, defend,
vote and lie at the pace of a real group chat.

## Game modes

- `/play` joins a game with a six-character room code.
- `/admin` creates and runs a game.
- `/sim` watches an all-agent development simulation at up to 16× speed.

The host picks 5–12 seats, the number of wolves, seer and doctor roles, real
names or aliases, human-only play or AI seat filling, the director style, and
the pace:

- **Scheduled** (`mode: scheduled`): one game day per calendar day inside the
  play hours (Israel time). Day is talk and vote; the night splits into wolves,
  seer and doctor windows until the next opening.
- **Quick** (`mode: quick`): the whole game in one sitting. Days of 5–20
  minutes, nights of 2–5 minutes. Eight seats usually finish in 30–50 minutes.

Every player states how they like to be addressed (masculine or feminine) so
agents and system messages agree grammatically in Hebrew.

## How the agents behave

Nothing runs on a timer. Each agent keeps a plan in the game state: when it
feels like speaking next, a pending reaction (someone addressed it, accused it
or voted against it), when it will cast its first vote, and when it reconsiders
before the deadline. Whenever any request arrives, `catchUp` replays whatever
was due and stamps each line with the moment it was due. A player who returns
after an hour sees a conversation that happened while they were away.

- Timing is per personality with log-normal jitter, a morning burst, a heated
  final stretch, momentum after someone speaks, and a slowdown when the chat is
  dead. Quick games compress the same shape into minutes.
- Agents keep a suspicion score per player that moves with votes, accusations,
  yesterday's lynch, the director's clues and, for the seer, night results.
  Talk and votes come from the same score, so an agent that accused you will
  vote against you unless the room changes its mind.
- Wolves never suspect the pack, ride the town's momentum, and target a claimed
  seer at night. An agent seer will reveal itself and name a wolf when it pays
  off. A human who writes "אני הרואה, בדקתי את X, זאב" gets the same effect.
- Addressing an agent by name gets a reply within seconds, with a typing
  indicator first. The system posts deadline reminders and reveals every role
  when the game ends.

Agent speech uses `gpt-4.1-mini` through `OPENAI_API_KEY` or Vercel AI Gateway.
Set `MAFIA_MODEL=gpt-4.1` for noticeably better Hebrew gender agreement. When no
model is reachable, agents fall back to canned lines so a game never stalls.

## Local development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm run smoke        # offline engine test: one quick game and one scheduled day
```

Without Supabase variables the server keeps live games in process memory with
a `/tmp` mirror, which is fine locally. `GET /api/health` reports the active
store, whether it answers, and whether a model is reachable.

## Persistence (Supabase)

Live games are stored in Supabase as one row per game with optimistic locking
and a short lease, so several players polling at once never duplicate agent
work or overwrite each other.

1. Create a Supabase project (free tier is enough).
2. Copy the connection string (Project Settings > Database > Connection
   string, URI) into `.env.local` as `SUPABASE_DB_URL`, then run:

   ```bash
   npm run db:migrate
   ```

   This applies `supabase/migrations/*.sql` in order and is safe to rerun.
   The SQL editor in the dashboard works too if you prefer pasting.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (a `sb_secret_...` key or the
   legacy `service_role` key) in `.env.local` and in Vercel. Never expose them
   to the browser: the state includes roles and player secrets. RLS is on and
   public grants are revoked, so the browser cannot read the tables even with
   the anon key.
4. Open `/api/health` and confirm `"store": "supabase", "ok": true`.

## Keeping games alive when nobody is watching

The engine advances on player requests. `GET /api/live/cron` advances every
running game and is protected by `CRON_SECRET` (sent as a Bearer token).
`vercel.json` schedules it once a day, which is what Vercel's Hobby plan
allows; on Pro you can raise the schedule to every few minutes, or point any
external scheduler at the endpoint. Without it, games still catch up
correctly the moment a player opens the app.

## Environment

See `.env.example` for every variable.

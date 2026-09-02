# Mafia

A Hebrew, RTL, AI-assisted Mafia/Werewolf game built with Next.js App Router.

## Game modes

- `/play` — join a scheduled live game with a six-character English room code.
- `/admin` — create and run a live game.
- `/sim` — watch an all-agent development simulation at up to 16× speed.

The live-game host can configure 5–12 seats, the number of wolves, seer and
doctor roles, real names or aliases, human-only play or AI seat filling, play
days and hours, and the AI director style.

The director has three styles:

- `classic` keeps the standard rules.
- `dynamic` can introduce balanced clues, silence, lost votes, and anonymous
  leaks from the wolf room.
- `wild` can also create a rare blood-moon night with a second victim when the
  current balance makes it safe.

The model proposes the dramatic event and narration. The server-side rules
engine owns legal targets, role secrecy, and win checks. Agent speech uses
`gpt-4.1-mini`; when model access is unavailable, the game falls back to local
lines and director decisions.

## Local development

```bash
npm install
npm run dev
```

Production model calls can use Vercel AI Gateway or `OPENAI_API_KEY`.

## Persistence

The current prototype stores simulator and live-game state in process memory
with a `/tmp` fallback. A Vercel cold start can reset active games. Durable
storage is the next required infrastructure step before relying on long-running
public games.

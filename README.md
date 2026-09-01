# mafia-sim

Hebrew RTL Next.js App Router simulator. Eight agents play mafia. No human login.

Persistence: module memory plus /tmp/mafia-sim-state.json. Vercel serverless cold starts can reset both.

Client POSTs /api/game with action tick every 1s while running. POST /api/tick is an alias.

Roles for 8 players: 2 wolves, 1 seer, 1 doctor, 4 villagers.
The spec listed 5 villagers and also 8 players; this keeps 8 seats with every named role.

Phases: dawn, day chat and vote, hang if majority of living, night wolves, seer, doctor, dawn.
Majority hang only. Doctor save means dawn says the kill failed.
On death: role plus the Hebrew line that they were not a human.

Agents are rule-based. No LLM key required.

UI is Hebrew only, dir=rtl. Public square plus god panel. Speed 1x/2x/4x, pause, restart, configurable phase durations.

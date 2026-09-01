"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GameConfig, GameState, Speed } from "@/lib/types";
import { CHANNEL_HE, DEFAULT_CONFIG, PERSONALITY_HE, PHASE_HE, ROLE_HE } from "@/lib/types";

type Tab = "public" | "god";

async function api(action: string, extra?: Record<string, unknown>): Promise<GameState> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json();
}

function remainingWallMs(s: GameState): number {
  if (s.status !== "running" && s.status !== "paused") return 0;
  const left1x = Math.max(0, s.phaseDurationMs - s.phaseElapsedMs);
  return left1x / Math.max(1, s.speed);
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `${r} שנ׳`;
}

const AVATAR = ["#c45c26", "#7a9e6a", "#c9a227", "#6b8cae", "#a85c7a", "#5c9e9a", "#b86b4a", "#8a7cc0"];
function colorFor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % AVATAR.length;
  return AVATAR[n]!;
}
function initial(name: string) {
  return name.trim().slice(0, 1) || "?";
}

function voteTally(s: GameState) {
  const counts: Record<string, { name: string; n: number; voters: string[] }> = {};
  for (const p of s.players.filter((p) => p.alive)) {
    counts[p.id] = { name: p.name, n: 0, voters: [] };
  }
  for (const [voterId, targetId] of Object.entries(s.votes)) {
    const voter = s.players.find((p) => p.id === voterId);
    if (!voter?.alive || !counts[targetId]) continue;
    counts[targetId].n += 1;
    counts[targetId].voters.push(voter.name);
  }
  return Object.entries(counts).sort((a, b) => b[1].n - a[1].n);
}

export default function Simulator() {
  const [state, setState] = useState<GameState | null>(null);
  const [tab, setTab] = useState<Tab>("public");
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [err, setErr] = useState<string | null>(null);
  const publicEnd = useRef<HTMLDivElement>(null);
  const godEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/game", { cache: "no-store" });
      const data = (await res.json()) as GameState;
      setState(data);
      if (data.config) setConfig(data.config);
    } catch {
      setErr("לא מצליח לדבר עם המנוע");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const running = state?.status === "running";
          const data = running ? await api("tick") : await (await fetch("/api/game", { cache: "no-store" })).json();
          setState(data);
        } catch {
          /* keep last */
        }
      })();
    }, 1000);
    return () => clearInterval(id);
  }, [state?.status]);

  useEffect(() => {
    publicEnd.current?.scrollIntoView({ block: "end" });
  }, [state?.messages.length, tab]);

  const publicMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "public"),
    [state?.messages],
  );
  const wolfMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "wolves"),
    [state?.messages],
  );
  const seerMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "seer"),
    [state?.messages],
  );
  const doctorMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "doctor"),
    [state?.messages],
  );

  const majorityNeed = state ? Math.floor(state.players.filter((p) => p.alive).length / 2) + 1 : 0;
  const tally = state ? voteTally(state) : [];
  const left = state ? remainingWallMs(state) : 0;

  async function start() {
    const data = await api("start", { config, speed: state?.speed ?? 1 });
    setState(data);
    setTab("public");
  }

  if (!state) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-paper">
        טוען…
      </div>
    );
  }

  const empty = state.status === "idle" && state.players.length === 0;

  return (
    <div className="min-h-dvh bg-night text-paper">
      <header className="sticky top-0 z-20 border-b border-[#3a2c22] bg-[#120e0c]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div>
            <div className="text-lg font-extrabold tracking-tight">מאפיה</div>
            <div className="text-xs text-dust">8 שמות. מי הזאב.</div>
          </div>
          {state.status !== "idle" && (
            <div className="flex items-center gap-2 text-sm">
              <span className="phase-pulse rounded bg-[#2a2118] px-2 py-1">
                {PHASE_HE[state.phase]}
              </span>
              {state.status !== "ended" && (
                <span className="rounded bg-blood/80 px-2 py-1 font-bold">
                  {fmt(left)}
                </span>
              )}
              <span className="hidden text-dust sm:inline">יום {state.dayNumber}</span>
            </div>
          )}
        </div>
      </header>

      {empty ? (
        <EmptyStart
          config={config}
          setConfig={setConfig}
          onStart={start}
          err={err}
        />
      ) : (
        <>
          <Controls
            state={state}
            config={config}
            setConfig={setConfig}
            setState={setState}
            onStart={start}
          />
          {state.winner && (
            <div className="mx-auto max-w-6xl px-3 pt-2">
              <div className="rounded-lg border border-paper/20 bg-blood px-4 py-3 text-center text-lg font-extrabold">
                {state.winnerText}
              </div>
            </div>
          )}
          <div className="mx-auto grid max-w-6xl gap-3 p-3 lg:grid-cols-[1fr_360px]">
            <div className="lg:hidden">
              <div className="mb-2 grid grid-cols-2 overflow-hidden rounded-lg border border-[#3a2c22]">
                <button
                  className={`py-2 text-sm font-bold ${tab === "public" ? "bg-paper text-ink" : "bg-[#1c1714]"}`}
                  onClick={() => setTab("public")}
                >
                  צ'אט
                </button>
                <button
                  className={`py-2 text-sm font-bold ${tab === "god" ? "bg-paper text-ink" : "bg-[#1c1714]"}`}
                  onClick={() => setTab("god")}
                >
                  אלוהים
                </button>
              </div>
            </div>

            <section className={tab === "public" ? "block" : "hidden lg:block"}>
              <PublicPane
                state={state}
                msgs={publicMsgs}
                tally={tally}
                majorityNeed={majorityNeed}
                endRef={publicEnd}
              />
            </section>
            <aside className={tab === "god" ? "block" : "hidden lg:block"}>
              <GodPane
                state={state}
                wolfMsgs={wolfMsgs}
                seerMsgs={seerMsgs}
                doctorMsgs={doctorMsgs}
                left={left}
                endRef={godEnd}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyStart({
  config,
  setConfig,
  onStart,
  err,
}: {
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
  onStart: () => void;
  err: string | null;
}) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-stretch gap-6 px-4 py-12">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold">8 שמות. מי הזאב.</h1>
        <p className="mt-2 text-dust">
          שני זאבים, חוזה, רופא, ארבעה תושבים. כולם כותבים כמו אנשים. אף אחד לא.
        </p>
      </div>
      <ConfigFields config={config} setConfig={setConfig} />
      <button
        onClick={onStart}
        className="rounded-2xl bg-paper py-5 text-2xl font-extrabold text-ink shadow-[0_8px_0_#6b5438] active:translate-y-1 active:shadow-none"
      >
        התחל משחק
      </button>
      {err && <p className="text-center text-sm text-red-300">{err}</p>}
      <ul className="space-y-1 text-sm text-dust">
        <li>יום: דיבור + הצבעה. רוב תולים. בלי רוב — אף אחד.</li>
        <li>לילה: זאבים → חוזה → רופא.</li>
        <li>אם הרופא שמר על הקורבן — ההרג נכשל.</li>
      </ul>
    </main>
  );
}

function ConfigFields({
  config,
  setConfig,
}: {
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
}) {
  function num(key: keyof GameConfig, label: string) {
    return (
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <input
          type="number"
          min={3}
          max={180}
          className="w-20 rounded bg-[#2a2118] px-2 py-1 text-left text-paper"
          value={Math.round(config[key] / 1000)}
          onChange={(e) =>
            setConfig({ ...config, [key]: Math.max(3, Number(e.target.value) || 3) * 1000 })
          }
        />
      </label>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-[#3a2c22] bg-[#1c1714] p-4">
      <div className="text-xs font-bold text-dust">זמנים (שניות, במהירות 1×)</div>
      {num("dayMs", "יום")}
      {num("nightStepMs", "כל שלב לילה")}
      {num("dawnMs", "שחר")}
      {num("hangMs", "תלייה")}
    </div>
  );
}

function Controls({
  state,
  config,
  setConfig,
  setState,
  onStart,
}: {
  state: GameState;
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
  setState: (s: GameState) => void;
  onStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  async function send(action: string, extra?: Record<string, unknown>) {
    const data = await api(action, extra);
    setState(data);
  }
  return (
    <div className="mx-auto max-w-6xl px-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "running" && (
          <button className="rounded bg-[#2a2118] px-3 py-2 text-sm" onClick={() => send("pause")}>
            השהה
          </button>
        )}
        {state.status === "paused" && (
          <button className="rounded bg-moss px-3 py-2 text-sm" onClick={() => send("resume")}>
            המשך
          </button>
        )}
        {([1, 2, 4] as Speed[]).map((sp) => (
          <button
            key={sp}
            className={`rounded px-3 py-2 text-sm ${state.speed === sp ? "bg-paper text-ink" : "bg-[#2a2118]"}`}
            onClick={() => send("setSpeed", { speed: sp })}
          >
            {sp}×
          </button>
        ))}
        <button className="rounded bg-[#2a2118] px-3 py-2 text-sm" onClick={() => setOpen((v) => !v)}>
          זמנים
        </button>
        <button className="rounded bg-blood px-3 py-2 text-sm font-bold" onClick={onStart}>
          משחק חדש
        </button>
      </div>
      {open && (
        <div className="mt-2 max-w-md">
          <ConfigFields config={config} setConfig={setConfig} />
          <button
            className="mt-2 rounded bg-paper px-3 py-1 text-sm text-ink"
            onClick={() => send("setConfig", { config })}
          >
            עדכן זמנים
          </button>
        </div>
      )}
    </div>
  );
}

function PublicPane({
  state,
  msgs,
  tally,
  majorityNeed,
  endRef,
}: {
  state: GameState;
  msgs: GameState["messages"];
  tally: ReturnType<typeof voteTally>;
  majorityNeed: number;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  const showVote = state.phase === "day" || state.phase === "hang";
  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col overflow-hidden rounded-xl border border-[#3a2c22] bg-[#1a1410]">
      <div className="border-b border-[#3a2c22] px-3 py-2 text-sm font-bold">
        הצ'אט
        <span className="mr-2 font-normal text-dust">מה ששחקן רואה</span>
      </div>
      <div className="chat-scroll min-h-0 flex-1 space-y-2 p-3">
        {msgs.map((m) => (
          <div key={m.id} className={m.narrator ? "text-center" : ""}>
            {m.narrator ? (
              <div className="mx-auto max-w-md rounded-xl bg-[#2a2118] px-3 py-2 text-center text-sm text-[#e8d7b0]">
                {m.text}
              </div>
            ) : (
              <div className="flex max-w-[92%] items-end gap-2">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink"
                  style={{ background: colorFor(m.authorId ?? m.authorName) }}
                >
                  {initial(m.authorName)}
                </div>
                <div>
                  <div className="mb-0.5 text-[11px] text-dust">{m.authorName}</div>
                  <div className="inline-block rounded-2xl rounded-tr-sm bg-[#2f241c] px-3 py-2 text-sm leading-snug">
                    {m.text}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {showVote && (
        <div className="border-t border-[#3a2c22] bg-[#14100c] p-3">
          <div className="mb-2 text-xs font-bold text-dust">
            הצבעה חיה · צריך {majorityNeed} לרוב
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tally.map(([id, v]) => (
              <div key={id} className="rounded-lg bg-[#2a2118] px-2 py-2 text-sm">
                <div className="mb-1 flex justify-between font-bold">
                  <span className="truncate">{v.name}</span>
                  <span>{v.n}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-[#14100c]">
                  <div
                    className="h-full rounded bg-paper/80"
                    style={{ width: `${majorityNeed ? Math.min(100, (v.n / majorityNeed) * 100) : 0}%` }}
                  />
                </div>
                <div className="mt-1 truncate text-[10px] text-dust">
                  {v.voters.length ? v.voters.join(", ") : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GodPane({
  state,
  wolfMsgs,
  seerMsgs,
  doctorMsgs,
  left,
  endRef,
}: {
  state: GameState;
  wolfMsgs: GameState["messages"];
  seerMsgs: GameState["messages"];
  doctorMsgs: GameState["messages"];
  left: number;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  const wolfPick = state.players.find((p) => p.id === state.night.wolfTarget);
  const seerPick = state.players.find((p) => p.id === state.night.seerTarget);
  const docPick = state.players.find((p) => p.id === state.night.doctorTarget);
  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col gap-2 overflow-y-auto">
      <div className="rounded-xl border border-[#3a2c22] bg-god p-3 text-sm">
        <div className="font-bold">מבט אלוהים</div>
        <div className="mt-1 text-dust">
          ערוץ פתוח: <b className="text-paper">{CHANNEL_HE[state.openChannel]}</b>
        </div>
        <div className="text-dust">
          נעילה בעוד <b className="text-paper">{fmt(left)}</b> · {state.speed}×
          {state.status === "paused" ? " · מושהה" : ""}
        </div>
      </div>
      <div className="rounded-xl border border-[#3a2c22] bg-god p-3">
        <div className="mb-2 text-sm font-bold">שחקנים</div>
        <ul className="space-y-1 text-sm">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 ${
                p.alive ? "bg-[#2a2118]" : "bg-[#1a1210] text-dust line-through"
              }`}
            >
              <span>
                {p.name}{" "}
                <span className="text-[10px] no-underline">
                  {PERSONALITY_HE[p.personality]}
                </span>
              </span>
              <span className={`text-xs ${p.role === "wolf" ? "text-red-300" : "text-[#c8e0b8]"}`}>
                {ROLE_HE[p.role]} {p.alive ? "" : "· מת"}
                {p.muted ? " · אילם" : ""}
                {p.cannotVote ? " · בלי הצבעה" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Priv title="זאבים" lines={wolfMsgs.map((m) => `${m.authorName}: ${m.text}`)} extra={wolfPick ? `בחירה: ${wolfPick.name}` : "אין בחירה"} />
      <Priv title="חוזה" lines={seerMsgs.map((m) => m.text)} extra={seerPick ? `בודק: ${seerPick.name}` : ""} />
      <Priv title="רופא" lines={doctorMsgs.map((m) => m.text)} extra={docPick ? `מגן: ${docPick.name}` : ""} />
      <div className="rounded-xl border border-[#3a2c22] bg-god p-3">
        <div className="mb-1 text-sm font-bold">יומן אירועים</div>
        <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-dust">
          {(state.eventLog.length ? state.eventLog : ["—"]).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function Priv({ title, lines, extra }: { title: string; lines: string[]; extra: string }) {
  return (
    <div className="rounded-xl border border-[#3a2c22] bg-god p-3">
      <div className="mb-1 text-sm font-bold">{title}</div>
      {extra && <div className="mb-1 text-xs text-[#e8d7b0]">{extra}</div>}
      <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-dust">
        {lines.length ? lines.map((t, i) => <div key={i}>{t}</div>) : <div>—</div>}
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

const DAYS = [
  { i: 0, l: "א" },
  { i: 1, l: "ב" },
  { i: 2, l: "ג" },
  { i: 3, l: "ד" },
  { i: 4, l: "ה" },
  { i: 5, l: "ו" },
  { i: 6, l: "ש" },
] as const;

function saveMe(code: string, me: { playerId: string; secret: string; fakeName: string }) {
  try {
    localStorage.setItem(`mafia-live:${code}`, JSON.stringify(me));
  } catch {
    /* ignore */
  }
}

export default function PlayPage() {
  const router = useRouter();
  const [realName, setRealName] = useState("");
  const [code, setCode] = useState("");
  const [dayStart, setDayStart] = useState("10:00");
  const [dayEnd, setDayEnd] = useState("22:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleDay(i: number) {
    setDays((cur) => {
      if (cur.includes(i)) {
        const next = cur.filter((d) => d !== i);
        return next.length ? next : cur;
      }
      return [...cur, i].sort();
    });
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      error?: string;
      game?: { code: string };
      me?: { playerId: string; secret: string; fakeName: string };
    };
    if (!res.ok || data.error) throw new Error(data.error ?? "לא הלך");
    return data;
  }

  async function join() {
    setErr(null);
    setBusy(true);
    try {
      const data = await post({ action: "join", code: code.trim(), realName: realName.trim() });
      if (data.me && data.game) saveMe(data.game.code, data.me);
      router.push(`/g/${data.game!.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "לא הלך");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setErr(null);
    setBusy(true);
    try {
      const data = await post({
        action: "create",
        realName: realName.trim(),
        dayStart,
        dayEnd,
        days,
      });
      if (data.me && data.game) saveMe(data.game.code, data.me);
      router.push(`/g/${data.game!.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "לא הלך");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-night px-4 py-8 text-paper">
      <Link href="/" className="text-sm text-dust">
        ← חזרה
      </Link>
      <h1 className="mt-6 text-3xl font-extrabold">עם חברים</h1>
      <p className="mt-2 text-dust">שם אמיתי רק אצלך. בכפר כולם עם שם מזויף.</p>

      <label className="mt-8 text-sm text-dust">השם שלך</label>
      <input
        className="mt-1 min-h-12 w-full rounded-2xl bg-white/10 px-4 text-base text-paper placeholder:text-dust"
        placeholder="איך קוראים לך"
        value={realName}
        onChange={(e) => setRealName(e.target.value)}
        autoComplete="name"
      />

      <div className="mt-8 rounded-3xl bg-white/5 p-4">
        <div className="font-extrabold">יש קוד?</div>
        <div className="mt-3 flex gap-2">
          <input
            className="min-h-12 min-w-0 flex-1 rounded-2xl bg-white/10 px-4 text-base tracking-widest text-paper"
            placeholder="אבג32"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
          />
          <button
            onClick={() => void join()}
            disabled={busy || !realName.trim() || !code.trim()}
            className="min-h-12 rounded-2xl bg-paper px-5 font-extrabold text-ink disabled:opacity-40"
          >
            הכנס
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-white/5 p-4">
        <div className="font-extrabold">או פותחים משחק</div>
        <p className="mt-2 text-sm text-dust">ביום הצ&apos;אט פתוח בשעות האלה. בלילה הזאבים עובדים.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-dust">פתיחה</span>
            <input
              type="time"
              value={dayStart}
              onChange={(e) => setDayStart(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-2xl bg-white/10 px-3 text-paper"
            />
          </label>
          <label className="text-sm">
            <span className="text-dust">סגירה</span>
            <input
              type="time"
              value={dayEnd}
              onChange={(e) => setDayEnd(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-2xl bg-white/10 px-3 text-paper"
            />
          </label>
        </div>
        <div className="mt-4 text-sm text-dust">ימים</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d.i);
            return (
              <button
                key={d.i}
                type="button"
                onClick={() => toggleDay(d.i)}
                className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-extrabold ${
                  on ? "bg-paper text-ink" : "bg-white/10 text-dust"
                }`}
              >
                {d.l}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => void create()}
          disabled={busy || !realName.trim()}
          className="mt-5 min-h-14 w-full rounded-2xl bg-blood text-lg font-extrabold disabled:opacity-40"
        >
          פתח משחק
        </button>
      </div>
      {err && <p className="mt-4 text-center text-sm text-red-300">{err}</p>}
    </div>
  );
}

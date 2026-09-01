"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: code.trim(), realName: realName.trim() }),
      });
      const data = (await res.json()) as {
        error?: string;
        game?: { code: string };
        me?: { playerId: string; secret: string; fakeName: string };
      };
      if (!res.ok || data.error) throw new Error(data.error ?? "לא הלך");
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
      <h1 className="mt-6 text-3xl font-extrabold">נכנסים לשחק</h1>
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
        <div className="font-extrabold">קוד השולחן</div>
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

      <p className="mt-8 text-center text-sm text-dust">
        רוצה לפתוח שולחן?{" "}
        <Link href="/admin" className="font-bold text-paper underline-offset-4 hover:underline">
          ניהול
        </Link>
      </p>
      {err && <p className="mt-4 text-center text-sm text-red-300">{err}</p>}
    </div>
  );
}

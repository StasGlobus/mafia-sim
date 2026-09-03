"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ROOM_CODE_LENGTH, type Gender } from "@/lib/types";

function saveMe(code: string, me: { playerId: string; secret: string; fakeName: string }) {
  try {
    localStorage.setItem(`mafia-live:${code}`, JSON.stringify(me));
  } catch {
    /* The secure cookie still keeps the session available. */
  }
}

function cleanRoomCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

export default function PlayPage() {
  const router = useRouter();
  const [realName, setRealName] = useState("");
  const [code, setCode] = useState("");
  const [gender, setGender] = useState<Gender>("m");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: code.trim(), realName: realName.trim(), gender }),
      });
      const data = (await res.json()) as {
        error?: string;
        game?: { code: string };
        me?: { playerId: string; secret: string; fakeName: string };
      };
      if (!res.ok || data.error || !data.game) throw new Error(data.error ?? "לא הצלחנו להיכנס למשחק");
      if (data.me) saveMe(data.game.code, data.me);
      router.push(`/g/${data.game.code}`);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "לא הצלחנו להיכנס למשחק");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-page relative min-h-dvh overflow-x-clip text-paper">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[48%] lg:block">
        <Image src="/art/villager.png" alt="" fill sizes="48vw" className="object-cover object-[45%_center] opacity-45" priority />
        <div className="absolute inset-0 bg-gradient-to-l from-night via-night/45 to-night/10" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-12 lg:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 rounded-xl text-sm font-bold text-paper/70 transition hover:text-paper">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5" aria-hidden="true">→</span>
            חזרה לעיירה
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-black">
            <Image src="/art/icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-[10px]" />
            AiYara
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-2 lg:gap-12 lg:py-10">
          <section className="order-2 hidden max-w-xl lg:order-1 lg:block">
            <p className="text-sm font-bold text-ember">מצטרפים לשולחן</p>
            <h1 className="font-display mt-3 text-[1.9rem] sm:text-5xl">בעיירה כבר מחכים לך.<br />בשם אחר.</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-paper/75 sm:text-lg sm:leading-8">
              צריך רק את הקוד שקיבלתם ממי שפתח את השולחן. שם נקבע גם אם משחקים בשמות אמיתיים או שכל אחד מקבל שם אחר.
            </p>
            <div className="mt-8 hidden gap-3 text-sm text-paper/55 sm:flex">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">5–12 שחקנים</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">אנשים, בוטים, או שניהם</span>
            </div>
          </section>

          <section className="entry-panel order-1 rounded-[30px] border border-white/10 p-5 backdrop-blur-xl sm:p-8 lg:order-2" aria-labelledby="join-title">
            <div className="mb-7">
              <h2 id="join-title" className="font-display text-2xl">כניסה לשולחן</h2>
              <p className="mt-1 text-sm text-paper/50">שני פרטים — ואתם בפנים.</p>
            </div>

            <form onSubmit={join} className="space-y-5">
              <label className="block" htmlFor="real-name">
                <span className="text-sm font-bold text-paper/75">איך קוראים לך?</span>
                <input
                  id="real-name"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-base text-paper placeholder:text-paper/25 transition focus:border-ember/70 focus:bg-black/35 focus:outline-none"
                  placeholder="השם האמיתי שלך"
                  value={realName}
                  onChange={(event) => setRealName(event.target.value.slice(0, 24))}
                  autoComplete="name"
                  maxLength={24}
                  required
                />
                <span className="mt-2 block text-xs text-paper/40">המשחק יציג אותו רק אם השולחן משחק בשמות אמיתיים.</span>
                <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="איך לפנות אליך">
                  {([["m", "פונים אליי בזכר"], ["f", "פונים אליי בנקבה"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={gender === id} onClick={() => setGender(id)} className={`min-h-10 rounded-xl border text-xs font-bold transition ${gender === id ? "border-paper/50 bg-paper/10 text-paper" : "border-white/10 bg-white/[.03] text-paper/50"}`}>{label}</button>
                  ))}
                </div>
              </label>

              <label className="block" htmlFor="room-code">
                <span className="text-sm font-bold text-paper/75">קוד המשחק</span>
                <input
                  id="room-code"
                  className="mt-2 min-h-16 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-center font-mono text-2xl font-black tracking-[.32em] text-paper placeholder:text-paper/20 transition focus:border-ember/70 focus:bg-black/35 focus:outline-none"
                  placeholder="N7GHT2"
                  value={code}
                  onChange={(event) => setCode(cleanRoomCode(event.target.value))}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={ROOM_CODE_LENGTH}
                  required
                />
              </label>

              {err && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

              <button
                type="submit"
                disabled={busy || !realName.trim() || code.length !== ROOM_CODE_LENGTH}
                className="min-h-16 w-full rounded-2xl bg-paper px-5 text-lg font-black text-ink shadow-[0_14px_35px_rgba(0,0,0,.2)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                {busy ? "נכנסים…" : "קחו אותי לעיירה"}
              </button>
            </form>

            <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-paper/50">
              אין לכם קוד?{" "}
              <Link href="/admin" className="font-black text-paper underline decoration-ember/60 underline-offset-4 hover:text-white">פותחים שולחן חדש</Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

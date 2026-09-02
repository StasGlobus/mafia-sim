import type { Gender } from "./types";

export const NAMES: { name: string; gender: Gender }[] = [
  { name: "יואב", gender: "m" },
  { name: "נועה", gender: "f" },
  { name: "איתי", gender: "m" },
  { name: "מאיה", gender: "f" },
  { name: "דני", gender: "m" },
  { name: "שירה", gender: "f" },
  { name: "עומר", gender: "m" },
  { name: "תמר", gender: "f" },
  { name: "ליאור", gender: "m" },
  { name: "יעל", gender: "f" },
  { name: "רועי", gender: "m" },
  { name: "הילה", gender: "f" },
  { name: "אביב", gender: "m" },
  { name: "קרן", gender: "f" },
  { name: "עידו", gender: "m" },
  { name: "נטע", gender: "f" },
  { name: "גיא", gender: "m" },
  { name: "מיכל", gender: "f" },
  { name: "אלון", gender: "m" },
  { name: "סתיו", gender: "f" },
  { name: "יובל", gender: "m" },
  { name: "רותם", gender: "f" },
];

export const NAME_POOL = NAMES.map((n) => n.name);

/** Best guess for a name's grammatical gender. Unknown names default to masculine. */
export function genderOfName(name: string): Gender {
  const clean = name.trim().split(/\s+/)[0] ?? "";
  const known = NAMES.find((n) => n.name === clean);
  if (known) return known.gender;
  if (/[הת]$/.test(clean) && !/^(משה|יהודה|אריה|שלמה|נחמיה|ירמיה|עובדיה|צביקה|מוטה|אלישע)$/.test(clean)) return "f";
  return "m";
}

export function pickNames(n: number, rnd: () => number): string[] {
  const copy = [...NAME_POOL];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const NAME_POOL = [
  "יואב",
  "נועה",
  "איתי",
  "מאיה",
  "דני",
  "שירה",
  "עומר",
  "תמר",
  "ליאור",
  "יעל",
  "רועי",
  "הילה",
  "אביב",
  "קרן",
  "עידו",
  "נטע",
  "גיא",
  "מיכל",
  "אלון",
  "סתיו",
  "יובל",
  "רותם",
];

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

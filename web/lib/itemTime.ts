/** Item lengths in the order of service: "4:30" ⇄ seconds. */

export const mmssAny = (sec: number | null | undefined) => {
  if (sec == null) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "4:30" or "270" (seconds) → seconds; "" → 0; anything else → null. */
export function parseLength(v: string): number | null {
  const t = v.trim();
  if (!t) return 0;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[2]) > 59 ? null : Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** As typed in the order of service: "4:30", or just minutes ("5" = 5:00). */
export function parseMinutes(v: string): number | null {
  const t = v.trim();
  if (/^\d{1,3}$/.test(t)) return Number(t) * 60;
  return parseLength(t);
}

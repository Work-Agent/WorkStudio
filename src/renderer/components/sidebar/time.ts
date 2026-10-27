/** 时间戳 → 侧栏短时间（今日 HH:mm，否则 M/D）。 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

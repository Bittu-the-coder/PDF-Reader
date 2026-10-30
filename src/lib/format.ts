/** "45 sec", "8 min", "1 h 20 min" */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds / 10) * 10)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

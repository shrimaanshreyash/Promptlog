export function parseUtcTimestamp(ts: string): Date {
  const s = ts.includes('Z') || ts.includes('+') ? ts : ts + 'Z';
  return new Date(s);
}

export function formatLocalDateTime(ts: string): string {
  return parseUtcTimestamp(ts).toLocaleString();
}

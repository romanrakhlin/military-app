// Minimal iCalendar (RFC 5545) generation for card-benefit reset reminders.
// The client can hand the returned text to EventKit or import it directly.

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  /** All-day event date (uses the UTC calendar date). */
  date: Date;
  url?: string;
}

function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function ymd(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}`
  );
}

/** Fold lines to 75 octets per RFC 5545. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export function buildIcs(events: IcsEvent[], calendarName = "Valor Card Benefits", stamp?: Date): string {
  // DTSTAMP is the generation time, not the event date.
  const dtstamp = `${ymd(stamp ?? new Date())}T000000Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Valor//Card Benefits//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calendarName)}`,
  ];
  for (const e of events) {
    const day = ymd(e.date);
    // DTEND is exclusive per RFC 5545 — an all-day event ends the next day.
    const nextDay = ymd(new Date(e.date.getTime() + 24 * 60 * 60 * 1000));
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${esc(e.uid)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay}`);
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    if (e.url) lines.push(fold(`URL:${esc(e.url)}`));
    lines.push("BEGIN:VALARM");
    lines.push("TRIGGER:-P3D");
    lines.push("ACTION:DISPLAY");
    lines.push(fold(`DESCRIPTION:${esc(e.title)}`));
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');

// Builds a one-event calendar file. METHOD REQUEST creates/updates the organizer's calendar entry, CANCEL removes it.
// Times are UTC (YYYYMMDDTHHMMSSZ) so no timezone definition is needed.
export function buildIcs({ uid, sequence, method, startUtc, endUtc, summary, location, description, organizerEmail, attendeeEmail }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taste of Turkiye//Scheduling//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:${uid}`, `SEQUENCE:${sequence}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART:${startUtc}`, `DTEND:${endUtc}`, `SUMMARY:${esc(summary)}`, `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(description)}`, `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=Taste of Turkiye:mailto:${organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${attendeeEmail}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function render(tpl, vars) {
  return String(tpl ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

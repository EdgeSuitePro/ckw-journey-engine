import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { BUSINESS, JOURNEY } from './config';

const TZ = BUSINESS.timezone;

/** A wall-clock time in the shop's timezone → UTC Date. */
export function shopTime(dateISO: string, hhmm: string): Date {
  return fromZonedTime(`${dateISO}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}`, TZ);
}

/** yyyy-MM-dd of a Date in the shop's timezone. */
export function shopDate(d: Date): string {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}

export function shopHour(d: Date): number {
  return toZonedTime(d, TZ).getHours();
}

/** "Thu, Oct 16" */
export function fmtDay(d: Date | string): string {
  return formatInTimeZone(new Date(d), TZ, 'EEE, MMM d');
}

/** "10–12pm", "8–10am", "12–2pm" */
export function fmtWindow(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sh = formatInTimeZone(s, TZ, 'h');
  const sm = formatInTimeZone(s, TZ, 'mm');
  const eh = formatInTimeZone(e, TZ, 'h');
  const em = formatInTimeZone(e, TZ, 'mm');
  const ea = formatInTimeZone(e, TZ, 'aaa');
  const sa = formatInTimeZone(s, TZ, 'aaa');
  const startText = `${sh}${sm === '00' ? '' : `:${sm}`}${sa === ea ? '' : sa}`;
  return `${startText}–${eh}${em === '00' ? '' : `:${em}`}${ea}`;
}

/** "Thu, Oct 16 · 10–12pm" */
export function fmtSlot(start: Date | string, end: Date | string): string {
  return `${fmtDay(start)} · ${fmtWindow(start, end)}`;
}

/**
 * Move a send time out of quiet hours (8pm–9am Central) to 9am the next
 * allowed morning. Transactional "your knives are ready" texts opt out of this.
 */
export function respectQuietHours(at: Date): Date {
  const hour = shopHour(at);
  if (hour >= JOURNEY.quietEndHour && hour < JOURNEY.quietStartHour) return at;
  const day = hour >= JOURNEY.quietStartHour ? addDays(at, 1) : at;
  return shopTime(shopDate(day), `${String(JOURNEY.quietEndHour).padStart(2, '0')}:00`);
}

/** A specific hour on the day `days` after `from`, in shop time. */
export function daysLaterAt(from: Date, days: number, hhmm: string): Date {
  return shopTime(shopDate(addDays(from, days)), hhmm);
}

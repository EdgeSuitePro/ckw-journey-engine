import { addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { BUSINESS } from './config';
import { shopDate, shopTime } from './time';

export interface DropWindowRule {
  weekday: number; // 0 = Sunday
  start_time: string; // "08:00:00"
  end_time: string;
  capacity: number;
  active: boolean;
}

export interface Slot {
  start: string; // ISO
  end: string;
  capacity: number;
  remaining: number;
}

/**
 * Expand weekly window rules into concrete slots, minus blackout days,
 * already-booked spots, and anything starting too soon.
 */
export function buildSlots(opts: {
  rules: DropWindowRule[];
  blackouts: string[]; // yyyy-MM-dd
  taken: Record<string, number>; // ISO start → count
  now: Date;
  days: number;
  minLeadMinutes: number;
}): Slot[] {
  const blackout = new Set(opts.blackouts);
  const earliest = opts.now.getTime() + opts.minLeadMinutes * 60_000;
  const slots: Slot[] = [];

  for (let i = 0; i < opts.days; i++) {
    const day = shopDate(addDays(opts.now, i));
    if (blackout.has(day)) continue;
    const weekday = toZonedTime(shopTime(day, '12:00'), BUSINESS.timezone).getDay();
    const rules = opts.rules
      .filter((r) => r.active && r.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (const rule of rules) {
      const start = shopTime(day, rule.start_time.slice(0, 5));
      if (start.getTime() < earliest) continue;
      const end = shopTime(day, rule.end_time.slice(0, 5));
      const iso = start.toISOString();
      const used = opts.taken[iso] ?? 0;
      slots.push({ start: iso, end: end.toISOString(), capacity: rule.capacity, remaining: Math.max(0, rule.capacity - used) });
    }
  }
  return slots;
}

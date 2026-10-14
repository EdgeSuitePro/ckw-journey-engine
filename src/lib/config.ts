/**
 * Business configuration. Anything that changes per-season lives in env vars
 * so it can be adjusted in Vercel without a code change.
 */
export const BUSINESS = {
  name: 'Chef KnifeWorks',
  shortName: 'CKW',
  timezone: 'America/Chicago',
  address: process.env.NEXT_PUBLIC_SHOP_ADDRESS ?? 'Maple Grove, MN',
  phoneDisplay: process.env.NEXT_PUBLIC_SHOP_PHONE_DISPLAY ?? '',
  signoff: '— Chef KnifeWorks',
} as const;

function int(value: string | undefined, fallback: number) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const JOURNEY = {
  /** How many days after pickup we suggest the next sharpening. */
  resharpenAfterDays: int(process.env.RESHARPEN_AFTER_DAYS, 90),
  /** Days after pickup before asking for a review. */
  reviewAfterDays: int(process.env.REVIEW_AFTER_DAYS, 2),
  /** Days after pickup before sending the referral invite. */
  referralInviteAfterDays: int(process.env.REFERRAL_INVITE_AFTER_DAYS, 7),
  /** Never ask the same customer for a review more often than this. */
  reviewCooldownDays: int(process.env.REVIEW_COOLDOWN_DAYS, 365),
  /** Hours after a ready notice before a gentle pickup nudge. */
  pickupNudgeAfterHours: int(process.env.PICKUP_NUDGE_AFTER_HOURS, 48),
  /** What the referrer and friend each get, in plain words. */
  referralReward: process.env.REFERRAL_REWARD_TEXT ?? '$10 off',
  /** Quiet hours for non-urgent texts, Central time (24h clock). */
  quietStartHour: 20,
  quietEndHour: 9,
  /** How far ahead customers can book. */
  bookingHorizonDays: int(process.env.BOOKING_HORIZON_DAYS, 21),
  /** Minimum notice before a window starts. */
  minLeadMinutes: int(process.env.BOOKING_MIN_LEAD_MINUTES, 30),
} as const;

export function appUrl(path = '') {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'localhost:3000')
    .replace(/\/$/, '');
  const withScheme = base.startsWith('http') ? base : `https://${base}`;
  return `${withScheme}${path.startsWith('/') ? path : `/${path}`}`;
}

export const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL ?? 'https://www.google.com/maps';

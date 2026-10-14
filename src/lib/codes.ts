import { randomBytes, randomInt } from 'node:crypto';

// No 0/O, 1/I/L — codes get read aloud and typed from texts.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function shortCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const reservationCode = () => `CKW-${shortCode(4)}`;

export function referralCode(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10) || 'SHARP';
  return `${first}-${shortCode(4)}`;
}

/** Unguessable token for private customer links (order page, review redirect). */
export const accessToken = () => randomBytes(18).toString('base64url');

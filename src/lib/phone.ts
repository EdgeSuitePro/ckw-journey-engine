/** Normalise a US phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null;
  return `+1${ten}`;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.replace(/^\+1/, '');
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Billing as the API returns it (GET /api/v1/billing and friends). Prices are in paise.

export type BillingStatus = 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
export type BillingInterval = 'MONTH' | 'YEAR';

export interface Plan {
  id: string;
  code: string;
  name: string;
  tier: string;
  /** null: unlimited. */
  seatLimit: number | null;
  courseLimit: number | null;
  storageGb: number | null;
  monthlyPaise: number;
  yearlyPaise: number;
}

export interface BillingProfile {
  legalName: string;
  gstin: string | null;
  address: string;
  stateCode: string;
}

export interface BillingUsage {
  seats: number;
  seatLimit: number | null;
  courses: number;
  courseLimit: number | null;
  storageBytes: number;
  storageLimitBytes: number | null;
}

export interface BillingOverview {
  /** A payment was started and the provider has not confirmed it yet; `status` is still NONE meanwhile. */
  pending: boolean;
  pendingSince: string | null;
  plan: Plan | null;
  status: BillingStatus;
  interval: BillingInterval | null;
  seats: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: BillingUsage;
  profile: BillingProfile | null;
  razorpayKeyId: string | null;
  /** False when the platform has no Razorpay credentials: nothing can be bought. */
  configured: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  issuedAt: string;
  amountPaise: number;
  taxPaise: number;
  status: string;
}

/** Paise as rupees with Indian digit grouping: 1234567 paise -> "₹12,345.67" (whole rupees drop the decimals). */
export function formatInr(paise: number): string {
  if (!Number.isFinite(paise)) return '—';
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** What `seats` seats of `plan` cost for one interval, in paise (prices are per seat). */
export const planTotalPaise = (plan: Plan, interval: BillingInterval, seats: number) =>
  (interval === 'YEAR' ? plan.yearlyPaise : plan.monthlyPaise) * seats;

/** Share of a limit used, 0-100; null when there is no limit. */
export const usagePercent = (used: number, limit: number | null): number | null =>
  limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100));

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return '< 1 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** 15-character GSTIN: 2-digit state code, PAN, entity number, Z, check character. */
export const isValidGstin = (v: string) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.trim().toUpperCase());

/** Operator-side plan input (POST/PATCH /operator/plans); limits blank = unlimited. */
export interface PlanInput {
  code: string;
  name: string;
  tier: string;
  seatLimit: number | null;
  courseLimit: number | null;
  storageGb: number | null;
  monthlyPaise: number;
  yearlyPaise: number;
}

/** A date as the reader's browser writes it ("24 October 2026"); empty for a missing or unreadable value. */
export function formatDay(iso: string | null | undefined, style: 'long' | 'medium' = 'long'): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { dateStyle: style });
}

/** The limits the API accepts for a plan (operator-billing planFields). */
export const PLAN_LIMIT_MAX = 10_000_000;
export const PLAN_CODE = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const MONTHLY_PAISE = { min: 100, max: 100_000_000 };
export const YEARLY_PAISE = { min: 100, max: 1_000_000_000 };

/** Blank means unlimited (null); otherwise a whole number from 1 to PLAN_LIMIT_MAX. `undefined` when the text is not one. */
export function parseLimit(v: string): number | null | undefined {
  if (v.trim() === '') return null;
  if (!/^\d+$/.test(v.trim())) return undefined;
  const n = Number(v);
  return n >= 1 && n <= PLAN_LIMIT_MAX ? n : undefined;
}

/** Rupees typed with up to two decimals to whole paise, within [min, max] paise; `undefined` otherwise. No float arithmetic. */
export function parseRupees(v: string, range: { min: number; max: number }): number | undefined {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return undefined;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return paise >= range.min && paise <= range.max ? paise : undefined;
}

/** Paise as an editable rupee string: 19900 -> "199", 19950 -> "199.50". */
export const rupeesText = (paise: number) => {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
};

/** Only Razorpay's own https pages (razorpay.com, and rzp.io for short links) may take the customer's payment: the API's answer is not followed anywhere else. */
export function isRazorpayUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['razorpay.com', 'rzp.io'].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

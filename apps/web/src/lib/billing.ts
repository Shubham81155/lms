// Billing as the API returns it (GET /api/v1/billing and friends). Prices are in paise.

export type BillingStatus = "NONE" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
export type BillingInterval = "MONTH" | "YEAR";

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
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);
}

/** What `seats` seats of `plan` cost for one interval, in paise (prices are per seat). */
export const planTotalPaise = (plan: Plan, interval: BillingInterval, seats: number) => (interval === "YEAR" ? plan.yearlyPaise : plan.monthlyPaise) * seats;

/** Share of a limit used, 0-100; null when there is no limit. */
export const usagePercent = (used: number, limit: number | null): number | null => (limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100)));

export function formatBytes(bytes: number): string {
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

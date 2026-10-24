// Data-subject requests and data retention (API: /api/v1/privacy/requests, /api/v1/privacy/retention).

export const REQUEST_KINDS = ['ACCESS', 'ERASURE', 'CORRECTION', 'RESTRICTION', 'OBJECTION', 'FERPA_OPT_OUT', 'OTHER'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = 'OPEN' | 'IN_PROGRESS' | 'FULFILLED' | 'REJECTED' | 'CANCELLED';

export const KIND_LABEL: Record<RequestKind, string> = {
  ACCESS: 'Get a copy of my data',
  ERASURE: 'Erase my data',
  CORRECTION: 'Correct my data',
  RESTRICTION: 'Restrict how my data is used',
  OBJECTION: 'Object to how my data is used',
  FERPA_OPT_OUT: 'Hide my name from classmates',
  OTHER: 'Something else',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'Being handled',
  FULFILLED: 'Done',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
};

/** A request as its requester sees it. */
export interface MyRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  details: string | null;
  receivedAt: string;
  dueAt: string;
  /** Whole days to the deadline (negative once overdue); null for a closed request. */
  daysLeft: number | null;
  overdue: boolean;
  resolution: string | null;
  exportAttached: boolean;
  closedAt: string | null;
}

/** The administrators' view: who filed it, and the internal fields. */
export interface QueueRequest extends MyRequest {
  requesterId: string;
  requester: { name: string; email: string | null } | null;
  assignedToId: string | null;
  notes: string | null;
  closedById: string | null;
}

export const isOpen = (r: { status: RequestStatus }) => r.status === 'OPEN' || r.status === 'IN_PROGRESS';

export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Due in 3 days", "Due today", "2 days overdue". */
export function dueText(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`;
  if (daysLeft === 0) return 'Due today';
  return `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}

/** Administrators are warned this many days ahead; the badge turns amber at the same point. */
export const DUE_SOON_DAYS = 5;

export interface RetentionClassInfo {
  key: string;
  label: string;
  /** Fewest days the class may be kept for. */
  min: number;
  /** The policy field holding its days. */
  field: 'notificationsDays' | 'tokensDays' | 'proctoringDays' | 'supportAccessDays' | 'infectedFilesDays';
  what: string;
}

export interface RetentionRun {
  at: string;
  dryRun: boolean;
  counts: Record<string, number>;
  remaining: Record<string, number>;
}

export interface RetentionPolicy {
  enabled: boolean;
  dryRun: boolean;
  notificationsDays: number | null;
  tokensDays: number | null;
  proctoringDays: number | null;
  supportAccessDays: number | null;
  infectedFilesDays: number | null;
  lastRun: RetentionRun | null;
  rowCap: number;
  classes: RetentionClassInfo[];
}

/** Whole days from the text of a field: "" is "keep" (null), anything not a whole number of at least `min` is invalid (undefined). */
export function parseDays(text: string, min: number): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,4}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= 3650 ? n : undefined;
}

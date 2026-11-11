import type { BadgeTone } from '@/components/ui';
import type { Translator } from '@/lib/i18n';

export const ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR'] as const;
export const STATUSES = ['ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED'] as const;
export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];

export interface Person {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: Status;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  enrollmentCount: number;
  teachingCourseCount: number;
}

export interface PersonEnrollment {
  id: string;
  status: string;
  progressPercent: number;
  course?: { code: string; title: string };
}

export interface MinorStatus {
  isMinor: boolean;
  guardianEmail: string | null;
  guardianConsentAt: string | null;
  pendingRequestExpiresAt: string | null;
}

export type Notice = { kind: 'ok' | 'error'; text: string };

export const STATUS_TONE: Record<Status, BadgeTone> = {
  ACTIVE: 'success',
  INVITED: 'brand',
  LOCKED: 'warning',
  SUSPENDED: 'danger',
};

/** "MULTI_SELECT" -> "multi select" */
export const formatEnumLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/** The browser's own short date, in whatever time zone the administrator is in. */
export const shortDate = (t: Translator, v: string) => t.date(v, { timeZone: undefined, day: 'numeric', month: 'short', year: 'numeric' });

/** What to tell an administrator after an invitation was (or was not) emailed. */
export const invitationNotice = (
  t: Translator,
  email: string,
  r: { invitationSent: boolean; emailConfigured: boolean },
  fresh: boolean
): Notice => {
  if (r.invitationSent) return { kind: 'ok', text: t(fresh ? 'people.invite.sentFresh' : 'people.invite.sentAgain', { email }) };
  if (!r.emailConfigured) return { kind: 'error', text: t(fresh ? 'people.invite.noEmailFresh' : 'people.invite.noEmailAgain', { email }) };
  return { kind: 'error', text: t(fresh ? 'people.invite.failFresh' : 'people.invite.failAgain', { email }) };
};

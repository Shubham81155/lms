import { describe, it, expect } from 'vitest';
import {
  holdText,
  invitationMessage,
  isValidSlug,
  orgNameProblem,
  personNameProblem,
  suggestSlug,
  summarise,
  type Org,
  type OrgRequest,
} from '../src/lib/platform';
import { setupComplete, setupSteps, type SetupFacts } from '../src/lib/setup-checklist';
import { NAVIGATION, visibleSections } from '../src/lib/navigation';
import { canAccess, canView, homeFor, routeForRole } from '../src/lib/roles';

describe('organisation addresses', () => {
  it('follows the API rule', () => {
    for (const ok of ['abc', 'st-marys-college', 'mit', 'a1b', 'x'.repeat(40)]) expect(isValidSlug(ok), ok).toBe(true);
    for (const bad of ['ab', '-abc', 'abc-', 'ABC', 'a_b', 'a b c', 'x'.repeat(41), '', 'xn--80ak6aa92e', 'ab--cd'])
      expect(isValidSlug(bad), bad).toBe(false);
  });

  it('suggests one from a name', () => {
    expect(suggestSlug("St. Mary's College")).toBe('st-marys-college');
    expect(suggestSlug('  École  Polytechnique  ')).toBe('ecole-polytechnique');
    expect(suggestSlug('IIT — Delhi (Main Campus)')).toBe('iit-delhi-main-campus');
    expect(suggestSlug('A'.repeat(39) + ' B')).toBe('a'.repeat(39));
    expect(isValidSlug(suggestSlug('University of the Very Long Name of Somewhere Far Away'))).toBe(true);
  });
});

describe('names on a registration request', () => {
  it('takes letters in any script, digits and common punctuation', () => {
    for (const ok of ["St. Mary's College", 'École Supérieure (Lyon) & Co., No. 2', 'दिल्ली विद्यालय', 'IIT-Delhi'])
      expect(orgNameProblem(ok), ok).toBeNull();
    for (const ok of ['Zoë', "O'Brien-Núñez", 'J. R.']) expect(personNameProblem(ok), ok).toBeNull();
  });

  it('refuses web addresses and other characters, like the API', () => {
    for (const bad of ['Visit www.example.com', 'See https://spam.example', 'Win $1000!', 'A <b>', 'x'])
      expect(orgNameProblem(bad), bad).not.toBeNull();
    expect(orgNameProblem('www.spam.example')).toContain('web addresses');
    for (const bad of ['www.spam.example', 'Ann2', '']) expect(personNameProblem(bad), bad).not.toBeNull();
  });
});

describe("a pending request's hold on its address", () => {
  it('says until when it reserves the address, flags an expired one, and says nothing once decided', () => {
    expect(holdText({ status: 'PENDING', expired: false, holdExpiresAt: '2026-11-20T10:00:00.000Z' })).toMatch(
      /^Reserves its address until /
    );
    expect(holdText({ status: 'PENDING', expired: true, holdExpiresAt: '2026-09-01T10:00:00.000Z' })).toMatch(/^Expired/);
    expect(holdText({ status: 'APPROVED', expired: false, holdExpiresAt: null })).toBeNull();
  });
});

describe('platform summary', () => {
  const org = (status: Org['status'], seatsUsed: number): Org => ({
    id: status + seatsUsed,
    slug: 's',
    name: 'n',
    customDomain: null,
    pendingCustomDomain: null,
    tier: 'STARTER',
    status,
    seatQuota: null,
    seatsUsed,
    features: {},
    overrides: {},
  });
  it('counts organisations by status, seats and pending requests', () => {
    const s = summarise(
      [org('ACTIVE', 10), org('ACTIVE', 5), org('TRIAL', 1), org('SUSPENDED', 3)],
      [{ status: 'PENDING' } as OrgRequest, { status: 'PENDING' } as OrgRequest]
    );
    expect(s).toEqual({ organisations: 4, byStatus: { ACTIVE: 2, TRIAL: 1, SUSPENDED: 1, ARCHIVED: 0 }, seatsUsed: 19, pending: 2 });
  });

  it('counts every pending request when the list is paged', () => {
    expect(summarise([], [{ status: 'PENDING' } as OrgRequest], 40).pending).toBe(40);
  });

  it('says what happened to the activation e-mail', () => {
    expect(invitationMessage('sent', 'a@x.edu')).toContain('was sent to a@x.edu');
    expect(invitationMessage('failed', 'a@x.edu')).toContain('could not be sent');
    expect(invitationMessage('not_configured', 'a@x.edu')).toContain('cannot send e-mail');
  });
});

describe('setup checklist', () => {
  const fresh: SetupFacts = {
    tenant: { name: 'newcollege', slug: 'newcollege', logoUrl: null },
    seatsUsed: 1,
    courses: 0,
    ssoAvailable: false,
    ssoConnected: false,
    terms: 0,
  };

  it('starts with nothing done for a brand-new organisation, without sign-in when the plan has no SSO', () => {
    const steps = setupSteps(fresh);
    expect(steps.map((s) => s.key)).toEqual(['branding', 'people', 'course', 'terms']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(setupComplete(steps)).toBe(false);
  });

  it('ticks steps off from what exists', () => {
    const steps = setupSteps({
      ...fresh,
      tenant: { name: 'New College', slug: 'newcollege', logoUrl: '/logo.png' },
      seatsUsed: 12,
      courses: 2,
      terms: 1,
    });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(setupComplete(steps)).toBe(true);
  });

  it('wants a logo for branding, not just a proper name', () => {
    expect(setupSteps({ ...fresh, tenant: { name: 'New College', slug: 'newcollege', logoUrl: null } })[0].done).toBe(false);
    expect(setupSteps({ ...fresh, tenant: { name: 'newcollege', slug: 'newcollege', logoUrl: '/logo.png' } })[0].done).toBe(true);
  });

  it('includes sign-in when the plan has SSO, done once a connection is on', () => {
    expect(setupSteps({ ...fresh, ssoAvailable: true }).find((s) => s.key === 'signin')?.done).toBe(false);
    expect(setupSteps({ ...fresh, ssoAvailable: true, ssoConnected: true }).find((s) => s.key === 'signin')?.done).toBe(true);
  });

  it('never claims a step before its facts have loaded', () => {
    const steps = setupSteps({ tenant: null, seatsUsed: null, courses: null, ssoAvailable: false, ssoConnected: false, terms: null });
    expect(steps.some((s) => s.done)).toBe(false);
  });
});

describe('platform area', () => {
  it('has its tabs, as links inside /platform', () => {
    const tabs = NAVIGATION.platform.flatMap((s) => s.items);
    expect(tabs.map((t) => t.href)).toEqual([
      '/platform',
      '/platform#requests',
      '/platform#organisations',
      '/platform#plans',
      '/platform#operators',
      '/platform#audit',
    ]);
  });

  it('is never reached from the college areas', () => {
    for (const role of ['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'STUDENT', 'AUDITOR']) {
      const keys = visibleSections('admin', { lrs: () => {}, platformAdmin: () => {} }, role).flatMap((s) => s.items.map((i) => i.key));
      expect(keys, role).not.toContain('platformAdmin');
    }
  });

  it('is only for platform operators, who use nothing else', () => {
    for (const role of ['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'STUDENT', 'AUDITOR']) {
      expect(canAccess(role, '/platform'), role).toBe(false);
      expect(canView({ role }, '/platform'), role).toBe(false);
    }
    const operator = { role: 'SUPER_ADMIN', platformOperator: true };
    expect(homeFor(operator)).toBe('/platform');
    expect(canView(operator, '/platform')).toBe(true);
    for (const area of ['/admin', '/teacher', '/student', '/audit']) expect(canView(operator, area), area).toBe(false);
    expect(homeFor({ role: 'SUPER_ADMIN' })).toBe(routeForRole('SUPER_ADMIN'));
    expect(routeForRole('SUPER_ADMIN')).toBe('/admin');
  });
});

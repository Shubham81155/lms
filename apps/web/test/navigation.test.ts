import { describe, it, expect } from 'vitest';
import { AREA_LABEL, NAVIGATION, areaForRole, currentTab, initialsOf, roleTitle, visibleSections, type Area } from '../src/lib/navigation';
import { routeForRole, type Role } from '../src/lib/roles';

const AREAS = Object.keys(NAVIGATION) as Area[];
const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR'];

describe('navigation config', () => {
  it.each(AREAS)('%s has unique keys, a label and at least one tab', (area) => {
    const items = NAVIGATION[area].flatMap((s) => s.items);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(AREA_LABEL[area]).toBeTruthy();
    expect(items.some((i) => i.kind === 'tab')).toBe(true);
    items.forEach((i) => expect(i.label.trim()).not.toBe(''));
  });

  it.each(AREAS)('%s tabs are real links inside their own area, actions are not', (area) => {
    for (const item of NAVIGATION[area].flatMap((s) => s.items)) {
      if (item.kind === 'tab') {
        // a link that opens in a new tab must land in the same area, never in another role's
        expect(item.href).toMatch(new RegExp(`^/${area}(#[a-z]+)?$`));
      } else {
        expect(item.href).toBeUndefined();
      }
    }
  });

  it('every role lands in the area its own route belongs to', () => {
    for (const role of ALL_ROLES) {
      expect(`/${areaForRole(role)}`).toBe(routeForRole(role));
    }
  });

  it('falls back to the student area for unknown or missing roles', () => {
    expect(areaForRole(undefined)).toBe('student');
    expect(areaForRole(null)).toBe('student');
    expect(areaForRole('SOMETHING_NEW')).toBe('student');
  });
});

describe('visibleSections', () => {
  it('always shows tabs and only the actions the page can handle', () => {
    const sections = visibleSections('student', { forum: () => {}, tutor: () => {} });
    const keys = sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toEqual(expect.arrayContaining(['courses', 'exams', 'forum', 'tutor']));
    expect(keys).not.toContain('catalog');
    expect(keys).not.toContain('calendar');
  });

  it('drops a section that would be empty, but never one that has tabs', () => {
    const none = visibleSections('student', {});
    expect(none.map((s) => s.id)).toEqual(['learn']);
    expect(visibleSections('admin', undefined).map((s) => s.id)).toEqual(['manage']);
    expect(visibleSections('admin', { lrs: () => {} }).map((s) => s.id)).toEqual(['manage', 'tools']);
  });

  it('ignores handlers that are not functions', () => {
    const keys = visibleSections('teacher', { builder: 'nope', grading: null }).flatMap((s) => s.items.map((i) => i.key));
    expect(keys).not.toContain('builder');
    expect(keys).not.toContain('grading');
  });
});

describe('role gating', () => {
  const all = { builder: () => {}, grading: () => {}, questionbank: () => {}, live: () => {}, forum: () => {}, analytics: () => {}, lrs: () => {} };
  const keys = (role?: string | null) => visibleSections('teacher', all, role).flatMap((s) => s.items.map((i) => i.key));

  it('hides tools the API would refuse from teaching assistants, keeps the course-level ones', () => {
    const ta = keys('TEACHING_ASSISTANT');
    expect(ta).not.toContain('builder');
    expect(ta).not.toContain('analytics');
    expect(ta).toEqual(expect.arrayContaining(['grading', 'questionbank', 'live', 'forum', 'lrs']));
  });

  it('shows everything to instructors and administrators', () => {
    for (const role of ['INSTRUCTOR', 'TENANT_ADMIN', 'SUPER_ADMIN']) {
      expect(keys(role)).toEqual(expect.arrayContaining(['builder', 'analytics']));
    }
  });

  it('keeps gated items out until the role is known (fail closed)', () => {
    expect(keys(undefined)).not.toContain('builder');
    expect(keys(null)).not.toContain('analytics');
    expect(keys('SOMETHING_NEW')).not.toContain('builder');
  });

  it('only ever gates actions, never the tabs a person navigates with', () => {
    for (const area of AREAS) {
      const gated = NAVIGATION[area].flatMap((s) => s.items).filter((i) => i.roles);
      gated.forEach((i) => expect(i.kind).toBe('action'));
    }
  });
});

describe('currentTab', () => {
  it('returns the active tab, else the area first tab', () => {
    expect(currentTab('teacher', 'gradebook').label).toBe('Gradebook & Rubrics');
    expect(currentTab('teacher', undefined).key).toBe('courses');
    expect(currentTab('admin', 'does-not-exist').key).toBe('overview');
  });

  it('never returns an action, even when its key is passed', () => {
    expect(currentTab('student', 'forum').kind).toBe('tab');
  });
});

describe('roleTitle and initialsOf', () => {
  it('has a title for every role', () => {
    for (const role of ALL_ROLES) expect(roleTitle(role)).not.toBe('Member');
    expect(roleTitle('MYSTERY')).toBe('Member');
    expect(roleTitle(undefined)).toBe('Member');
  });

  it('takes the first and last initial', () => {
    expect(initialsOf('Alex Chen')).toBe('AC');
    expect(initialsOf('  prof. david   malan ')).toBe('PM');
    expect(initialsOf('Cher')).toBe('CH');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

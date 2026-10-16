import { describe, it, expect } from 'vitest';
import { isOpenIntent, resolveDeepLink } from '../src/lib/deeplink';

describe('resolveDeepLink', () => {
  it('sends a learner to their own course, assignments and the forum', () => {
    expect(resolveDeepLink('/courses/c1', 'STUDENT')).toBe('/student?open=course&course=c1');
    expect(resolveDeepLink('/assignments/a1', 'STUDENT')).toBe('/student?open=assignments');
    expect(resolveDeepLink('/courses/c1/forum/t9', 'STUDENT')).toBe('/student?open=forum&course=c1');
    expect(resolveDeepLink('/courses/c1/appeals', 'STUDENT')).toBe('/student?open=assignments&course=c1');
  });

  it('sends staff to the matching tool', () => {
    expect(resolveDeepLink('/courses/c1/live', 'INSTRUCTOR')).toBe('/teacher?open=live&course=c1');
    expect(resolveDeepLink('/courses/c1/forum/moderation', 'TEACHING_ASSISTANT')).toBe('/teacher?open=forum&course=c1');
    expect(resolveDeepLink('/courses/c1/gradebook', 'INSTRUCTOR')).toBe('/teacher?open=gradebook&course=c1');
    expect(resolveDeepLink('/courses/c1/appeals', 'INSTRUCTOR')).toBe('/teacher?open=grading&course=c1');
    expect(resolveDeepLink('/assignments/a1/submissions/s1', 'INSTRUCTOR')).toBe('/teacher?open=grading');
    expect(resolveDeepLink('/quizzes/q1/submissions/s1', 'INSTRUCTOR')).toBe('/teacher?open=assessments');
    expect(resolveDeepLink('/courses/c1', 'INSTRUCTOR')).toBe('/teacher?open=learners&course=c1');
  });

  it('sends an administrator to grade approval for a course', () => {
    expect(resolveDeepLink('/courses/c1/gradebook', 'TENANT_ADMIN')).toBe('/admin?open=gradebook&course=c1');
    expect(resolveDeepLink('/courses/c1', 'SUPER_ADMIN')).toBe('/admin?open=gradebook&course=c1');
    expect(resolveDeepLink('/courses/c1/forum/moderation', 'TENANT_ADMIN')).toBe('/admin');
  });

  it('lands on the dashboard when there is nothing specific to open', () => {
    expect(resolveDeepLink('/quizzes/q1', 'STUDENT')).toBe('/student');
    expect(resolveDeepLink('/courses/c1/live', 'STUDENT')).toBe('/student');
    expect(resolveDeepLink('/courses/c1/gradebook', 'STUDENT')).toBe('/student');
    expect(resolveDeepLink('/somewhere/else', 'INSTRUCTOR')).toBe('/teacher');
    expect(resolveDeepLink('/courses', 'STUDENT')).toBe('/student');
    expect(resolveDeepLink('/', 'AUDITOR')).toBe('/audit');
  });

  it('ignores a query string and refuses odd ids', () => {
    expect(resolveDeepLink('/courses/c1/live?x=1', 'INSTRUCTOR')).toBe('/teacher?open=live&course=c1');
    expect(resolveDeepLink('/courses/<script>/live', 'INSTRUCTOR')).toBe('/teacher');
    expect(resolveDeepLink('/courses/' + 'a'.repeat(65), 'STUDENT')).toBe('/student');
  });
});

describe('isOpenIntent', () => {
  it('only accepts the known panels', () => {
    expect(isOpenIntent('forum')).toBe(true);
    expect(isOpenIntent('gradebook')).toBe(true);
    expect(isOpenIntent('rm -rf')).toBe(false);
    expect(isOpenIntent(null)).toBe(false);
  });
});

import { routeForRole } from '@/lib/roles';

/** What a dashboard should open when it is reached through a link. */
export type OpenIntent =
  'course' | 'forum' | 'live' | 'assignments' | 'grading' | 'assessments' | 'learners' | 'gradebook' | 'announcements';

const OPEN_INTENTS: readonly OpenIntent[] = [
  'course',
  'forum',
  'live',
  'assignments',
  'grading',
  'assessments',
  'learners',
  'gradebook',
  'announcements',
];

export const isOpenIntent = (v: string | null): v is OpenIntent => !!v && (OPEN_INTENTS as readonly string[]).includes(v);

const ID = /^[\w-]{1,64}$/;

/**
 * Notifications and emails link to places like /courses/:id/live or /quizzes/:id. Those are not pages:
 * everything lives in the dashboards. This turns such a path into the dashboard of the person's role
 * plus what to open there, as `/teacher?open=live&course=…`. Anything unknown lands on the dashboard.
 */
export function resolveDeepLink(path: string, role: string): string {
  const area = routeForRole(role);
  const staff = area === '/teacher';
  const admin = area === '/admin';
  const parts = path.split('?')[0].split('/').filter(Boolean);
  const [kind, id, ...rest] = parts;

  const go = (open?: OpenIntent, course?: string) => {
    if (!open) return area;
    const q = new URLSearchParams({ open });
    if (course && ID.test(course)) q.set('course', course);
    return `${area}?${q.toString()}`;
  };

  if (!kind || !id || !ID.test(id)) return area;

  if (kind === 'courses') {
    const section = rest[0];
    if (section === 'gradebook') return staff || admin ? go('gradebook', id) : area;
    if (section === 'appeals') return staff ? go('grading', id) : area === '/student' ? go('assignments', id) : area;
    if (section === 'forum') return admin ? area : go('forum', id);
    if (section === 'live') return staff ? go('live', id) : area;
    if (section === 'announcements') return go('announcements', id);
    if (section === 'assignments') return staff ? go('assessments', id) : area === '/student' ? go('assignments', id) : area;
    if (section === undefined) return area === '/student' ? go('course', id) : admin ? go('gradebook', id) : go('learners', id);
    return area;
  }
  if (kind === 'quizzes') return staff ? go('assessments') : area;
  if (kind === 'assignments') return staff ? go('grading') : area === '/student' ? go('assignments') : area;
  return area;
}

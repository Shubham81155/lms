import { describe, it, expect } from 'vitest';
import { scheduleProblem } from '../src/lib/live';

const now = new Date(2027, 0, 15, 12, 0).getTime();
const at = (h: number, m = 0) => `2027-01-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

describe('scheduleProblem', () => {
  it('accepts a class that starts soon or later', () => {
    expect(scheduleProblem({ title: 'Lecture', when: at(15), durationMins: 60 }, now)).toBeNull();
  });
  it('refuses a start time that has passed, unless the time is being left as it was', () => {
    expect(scheduleProblem({ title: 'Lecture', when: at(9), durationMins: 60 }, now)).toMatch(/past/);
    expect(scheduleProblem({ title: 'Lecture', when: at(9), durationMins: 60 }, now, true)).toBeNull();
  });
  it('still checks everything else when the past is allowed', () => {
    expect(scheduleProblem({ title: 'x', when: at(9), durationMins: 60 }, now, true)).toMatch(/title/);
    expect(scheduleProblem({ title: 'Lecture', when: at(9), durationMins: 2 }, now, true)).toMatch(/Duration/);
    expect(scheduleProblem({ title: 'Lecture', when: '', durationMins: 60 }, now, true)).toMatch(/date and time/);
  });
});

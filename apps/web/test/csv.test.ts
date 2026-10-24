import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from '../src/lib/csv';
import { activeShare, cohortReportCsv, cohortReportFilename, hasGpa } from '../src/lib/cohortReport';
import type { CohortAnalyticsResponse } from '../src/hooks/useAnalytics';

describe('csvCell', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Alex Chen')).toBe('Alex Chen');
    expect(csvCell(76.4)).toBe('76.4');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF, ending with one', () => {
    expect(toCsv([['a', 1], [], ['b,c', 'd']])).toBe('a,1\r\n\r\n"b,c",d\r\n');
  });
});

const sample: CohortAnalyticsResponse = {
  tenantId: 't',
  metrics: { totalEnrolled: 4, activeThisWeek: 3, averageProgress: 61.5, completionRate: 25, averageGpa: 3.2 },
  atRiskLearners: [
    {
      id: 'u1',
      name: '=cmd|evil',
      email: 'a@x.edu',
      course: 'CS-101',
      courseId: 'c1',
      riskFactor: 'HIGH',
      reasons: ['Inactive 6 days', 'Quiz 58%'],
      suggestedAction: 'Office hours',
    },
  ],
  itemAnalysis: [
    {
      questionId: 'q1',
      concept: 'Quorum',
      taxonomyLevel: 'EVALUATE',
      attempts: 9,
      averageScorePercent: 54,
      status: 'FLAGGED',
      recommendation: 'Review',
    },
  ],
  bloomsMastery: [{ level: 'APPLY', score: 82 }],
};

describe('cohortReportCsv', () => {
  const lines = cohortReportCsv(sample, new Date('2026-10-15T10:00:00Z')).split('\r\n');

  it('has a header, a summary and one section per table', () => {
    expect(lines[0]).toBe('Cohort analytics report');
    expect(lines[1]).toBe('Generated,2026-10-15T10:00:00.000Z');
    expect(lines).toContain('Learners enrolled,4');
    expect(lines).toContain('Average GPA (4.0 scale),3.2');
    expect(lines).toContain('Level,Cohort mastery (%)');
    expect(lines).toContain('APPLY,82');
  });

  it('writes one row per at-risk learner, escaping what users typed', () => {
    expect(lines).toContain(`'=cmd|evil,a@x.edu,CS-101,HIGH,Inactive 6 days; Quiz 58%,Office hours`);
    expect(lines).toContain('Quorum,EVALUATE,9,54,FLAGGED,Review');
  });

  it('leaves the GPA blank when no grade has been approved', () => {
    const csv = cohortReportCsv({ ...sample, metrics: { ...sample.metrics, averageGpa: 0 } });
    expect(csv.split('\r\n')).toContain('Average GPA (4.0 scale),');
  });

  it('still produces every heading for an empty cohort', () => {
    const csv = cohortReportCsv({ ...sample, atRiskLearners: [], itemAnalysis: [], bloomsMastery: [] });
    for (const h of ['At-risk learners', 'Assessment items', "Bloom's taxonomy mastery"]) expect(csv).toContain(h);
  });
});

describe('metric helpers', () => {
  it('activeShare is a capped percentage, or null with nobody enrolled', () => {
    expect(activeShare(sample.metrics)).toBe(75);
    expect(activeShare({ ...sample.metrics, totalEnrolled: 0, activeThisWeek: 0 })).toBeNull();
    expect(activeShare({ ...sample.metrics, totalEnrolled: 2, activeThisWeek: 5 })).toBe(100);
  });

  it('hasGpa treats 0 as no data', () => {
    expect(hasGpa(sample.metrics)).toBe(true);
    expect(hasGpa({ ...sample.metrics, averageGpa: 0 })).toBe(false);
  });

  it('names the file by date', () => {
    expect(cohortReportFilename(new Date('2026-10-15T23:59:00Z'))).toBe('cohort-analytics-2026-10-15.csv');
  });
});

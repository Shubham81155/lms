import { describe, it, expect } from 'vitest';
import { csvCell, csvRow, parseCsv } from '../src/lib/csv';

describe('csvCell', () => {
  it('quotes cells with separators and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvRow(['a', 1, null])).toBe('a,1,\r\n');
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF and LF, and skips blank lines', () => {
    expect(parseCsv('﻿email,first name\r\n"a@x.edu","Ann, Jr."\n\nb@x.edu,"Bo ""B"""\n')).toEqual([
      ['email', 'first name'],
      ['a@x.edu', 'Ann, Jr.'],
      ['b@x.edu', 'Bo "B"'],
    ]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
    expect(parseCsv('a,"multi\nline"')).toEqual([['a', 'multi\nline']]);
  });

  it('round-trips what csvRow writes', () => {
    const cells = ['x,y', 'q"q', 'plain', 'line\r\nbreak'];
    expect(parseCsv(csvRow(cells))).toEqual([cells]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('"open,b')).toThrow(/not closed/);
  });
});

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { JsonObjectStream } from '../src/lib/json-stream';

function fakeRes(backpressure = false) {
  const res: any = new EventEmitter();
  res.chunks = [] as string[];
  res.ended = false;
  res.write = (c: string) => {
    res.chunks.push(c);
    if (backpressure) setImmediate(() => res.emit('drain'));
    return !backpressure;
  };
  res.end = () => (res.ended = true);
  return res;
}

const pager = (rows: { id: string }[], size: number) => async (cursor: string | undefined) => {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  return rows.slice(start, start + size);
};

describe('JsonObjectStream', () => {
  it.each([0, 1, 3, 4, 7])('produces valid JSON for %i rows across pages', async (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: `x"${i}` }));
    for (const backpressure of [false, true]) {
      const res = fakeRes(backpressure);
      const out = new JsonObjectStream(res);
      await out.start();
      await out.value('meta', { a: 1 });
      await out.value('missing', undefined);
      const count = await out.array('rows', pager(rows, 3), 3);
      await out.array('empty', pager([], 3), 3);
      await out.end();

      expect(count).toBe(n);
      expect(res.ended).toBe(true);
      expect(JSON.parse(res.chunks.join(''))).toEqual({ meta: { a: 1 }, missing: null, rows, empty: [] });
    }
  });
});

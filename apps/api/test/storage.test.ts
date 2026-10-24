import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { ALLOWED_TYPES, contentDisposition, localDriver, newStorageKey } from '../src/lib/storage';

describe('contentDisposition', () => {
  it('gives an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('résumé "final".pdf', true)).toBe(
      `inline; filename="r_sum_ _final_.pdf"; filename*=UTF-8''${encodeURIComponent('résumé "final".pdf')}`
    );
    expect(contentDisposition('notes.txt', false)).toMatch(/^attachment; filename="notes.txt"/);
  });
});

describe('allowed types', () => {
  it('never accepts types a browser would run', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript', 'text/xml'])
      expect(ALLOWED_TYPES[t]).toBeUndefined();
  });
});

describe('local driver', () => {
  it('stores, reads and deletes by generated key, and refuses any other key', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lms-store-'));
    try {
      const d = localDriver(root);
      const src = path.join(root, 'incoming');
      await writeFile(src, 'hello');
      const key = newStorageKey('t-h');
      await d.putFile(key, src, 'text/plain');
      const chunks: Buffer[] = [];
      for await (const c of await d.open(key)) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('hello');
      expect(await readFile(path.join(root, ...key.split('/')), 'utf8')).toBe('hello');
      expect(await d.signedDownloadUrl(key, { filename: 'a.txt', contentType: 'text/plain', inline: false })).toBeNull();
      await d.delete(key);
      await expect(d.open(key)).rejects.toThrow();
      await expect(d.open('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
      await expect(d.delete('t-h/../../x')).rejects.toThrow(/Invalid storage key/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

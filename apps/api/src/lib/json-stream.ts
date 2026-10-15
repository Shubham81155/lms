import type { Response } from 'express';

/**
 * Writes a JSON document to the response piece by piece, so exporting a large tenant never holds
 * every row in memory. Each array is read in pages by id cursor and honours backpressure.
 */
export class JsonObjectStream {
  private first = true;

  constructor(private res: Response) {}

  private async write(chunk: string): Promise<void> {
    if (!this.res.write(chunk)) await new Promise<void>((resolve) => this.res.once('drain', resolve));
  }

  async start(): Promise<void> {
    await this.write('{');
  }

  private async key(name: string): Promise<void> {
    await this.write(`${this.first ? '' : ','}${JSON.stringify(name)}:`);
    this.first = false;
  }

  async value(name: string, value: unknown): Promise<void> {
    await this.key(name);
    await this.write(JSON.stringify(value ?? null));
  }

  /** `page(cursor)` returns the next rows after the id `cursor` (or the first rows), at most `pageSize`. */
  async array<T extends { id: string }>(name: string, page: (cursor: string | undefined) => Promise<T[]>, pageSize = 1000): Promise<number> {
    await this.key(name);
    await this.write('[');
    let cursor: string | undefined;
    let count = 0;
    for (;;) {
      const rows = await page(cursor);
      if (rows.length > 0) await this.write((count > 0 ? ',' : '') + rows.map((r) => JSON.stringify(r)).join(','));
      count += rows.length;
      if (rows.length < pageSize) break;
      cursor = rows[rows.length - 1].id;
    }
    await this.write(']');
    return count;
  }

  async end(): Promise<void> {
    await this.write('}');
    this.res.end();
  }
}

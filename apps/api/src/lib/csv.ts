/**
 * CSV for downloads (audit log, gradebook). Cells with a comma, quote or line break are quoted. A text cell
 * that starts with = + - @ (or a tab / carriage return) would run as a formula in Excel or Sheets, and names
 * and e-mail addresses are typed by users, so such cells get a leading apostrophe. Numbers are left alone.
 * Mirrors apps/web/src/lib/csv.ts.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;

/**
 * Parses CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF). Returns rows of raw strings; blank
 * lines are skipped. Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // byte-order mark from Excel
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('A quoted field is not closed');
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

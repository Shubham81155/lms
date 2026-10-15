/**
 * One CSV cell. Cells with a comma, quote or line break are quoted. A text cell that starts with = + - or @
 * (or a tab / carriage return) would be run as a formula by Excel and Sheets, and names and e-mail addresses
 * are typed by users, so such cells get a leading apostrophe. Real numbers are left alone (-5 stays -5).
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text with CRLF line ends, as spreadsheet programs expect. */
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

import { config } from '../config';
import { basePrisma } from './prisma';

// GST tax invoices: the tax split, the numbering, and a small PDF. Plan prices include GST (18%), so an invoice
// works backwards from what was charged. Same state as the seller: CGST + SGST (half each); otherwise IGST.

export const GST_RATE_PERCENT = 18;

export interface GstSplit {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** Splits a GST-inclusive amount. A buyer without a known state is treated as in the seller's state. */
export function computeGst(
  totalPaise: number,
  buyerStateCode: string | null | undefined,
  sellerStateCode = config.SELLER_STATE_CODE
): GstSplit {
  const taxablePaise = Math.round((totalPaise * 100) / (100 + GST_RATE_PERCENT));
  const tax = totalPaise - taxablePaise;
  if (!buyerStateCode || buyerStateCode === sellerStateCode) {
    const cgstPaise = Math.floor(tax / 2);
    return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0, totalPaise };
  }
  return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise };
}

/** The Indian financial year (1 April to 31 March, by India time) a date falls in: "2026-27". */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 3_600_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const formatInvoiceNumber = (fy: string, seq: number) => `INV/${fy}/${String(seq).padStart(6, '0')}`;

/**
 * The next invoice number of the financial year. One atomic upsert, so concurrent invoices get distinct, gapless
 * numbers; when the surrounding transaction rolls back, so does the number. Pass the transaction's client.
 */
export async function nextInvoiceNumber(
  tx: { $queryRaw: typeof basePrisma.$queryRaw },
  date: Date
): Promise<{ number: string; financialYear: string }> {
  const fy = financialYear(date);
  const [row] = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "InvoiceCounter" ("financialYear", "lastSeq") VALUES (${fy}, 1)
    ON CONFLICT ("financialYear") DO UPDATE SET "lastSeq" = "InvoiceCounter"."lastSeq" + 1
    RETURNING "lastSeq"`;
  return { number: formatInvoiceNumber(fy, row.lastSeq), financialYear: fy };
}

export interface Party {
  legalName: string;
  gstin?: string | null;
  address: string;
  stateCode: string;
}

export const sellerParty = (): Party => ({
  legalName: config.SELLER_LEGAL_NAME,
  gstin: config.SELLER_GSTIN || null,
  address: config.SELLER_ADDRESS,
  stateCode: config.SELLER_STATE_CODE,
});

export const rupees = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface InvoiceForPdf extends GstSplit {
  number: string;
  issuedAt: Date;
  description: string;
  buyer: Party;
  seller: Party;
}

// ---------------------------------------------------------------- PDF (one page of Helvetica text, no dependency)

const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

/** A one-page PDF of text lines: `size` and `y` per line, left margin 50. */
export function textPdf(lines: { text: string; size?: number; bold?: boolean }[]): Buffer {
  let y = 800;
  let content = '';
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= size + 5;
    content += `BT /${l.bold ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${pdfText(l.text)}) Tj ET\n`;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const partyLines = (p: Party) => [
  p.legalName,
  ...p.address.split('\n').filter(Boolean),
  p.gstin ? `GSTIN: ${p.gstin}` : 'GSTIN: unregistered',
  `State code: ${p.stateCode}`,
];

export function invoicePdf(inv: InvoiceForPdf): Buffer {
  const date = inv.issuedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const lines: { text: string; size?: number; bold?: boolean }[] = [
    { text: 'TAX INVOICE', size: 18, bold: true },
    { text: `Invoice number: ${inv.number}` },
    { text: `Date: ${date}` },
    { text: '' },
    { text: 'From', bold: true },
    ...partyLines(inv.seller).map((text) => ({ text })),
    { text: '' },
    { text: 'Billed to', bold: true },
    ...partyLines(inv.buyer).map((text) => ({ text })),
    { text: '' },
    { text: 'Description', bold: true },
    { text: inv.description },
    { text: '' },
    { text: `Taxable value: ${rupees(inv.taxablePaise)}` },
  ];
  if (inv.igstPaise) lines.push({ text: `IGST @ ${GST_RATE_PERCENT}%: ${rupees(inv.igstPaise)}` });
  else
    lines.push(
      { text: `CGST @ ${GST_RATE_PERCENT / 2}%: ${rupees(inv.cgstPaise)}` },
      { text: `SGST @ ${GST_RATE_PERCENT / 2}%: ${rupees(inv.sgstPaise)}` }
    );
  lines.push(
    { text: `Total (paid): ${rupees(inv.totalPaise)}`, size: 12, bold: true },
    { text: '' },
    { text: 'Amounts are in Indian rupees and include GST. This is a computer-generated invoice.', size: 8 }
  );
  return textPdf(lines);
}

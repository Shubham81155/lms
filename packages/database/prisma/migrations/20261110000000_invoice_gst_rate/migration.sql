-- The GST rate an invoice was issued at, so a later change of rate never alters an old invoice. Existing invoices were all 18%.
ALTER TABLE "Invoice" ADD COLUMN "gstRatePercent" INTEGER NOT NULL DEFAULT 18;

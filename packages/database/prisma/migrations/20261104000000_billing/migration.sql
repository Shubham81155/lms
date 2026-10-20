-- Billing (apps/api/src/lib/billing.ts): plans, subscriptions, GST invoices. Prices are in paise, per seat, GST included.

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "TenantTier" NOT NULL DEFAULT 'PROFESSIONAL',
    "seatLimit" INTEGER NOT NULL,
    "courseLimit" INTEGER,
    "storageGb" INTEGER,
    "monthlyPaise" INTEGER NOT NULL,
    "yearlyPaise" INTEGER NOT NULL,
    "razorpayMonthlyPlanId" TEXT,
    "razorpayYearlyPlanId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- Placeholder plans for the operator to edit (prices per seat per month, GST included; yearly = ten months).
INSERT INTO "Plan" ("id", "code", "name", "tier", "seatLimit", "courseLimit", "storageGb", "monthlyPaise", "yearlyPaise", "sortOrder", "updatedAt") VALUES
  ('plan-starter', 'starter', 'Starter', 'STARTER', 100, 25, 10, 99900, 999000, 1, CURRENT_TIMESTAMP),
  ('plan-growth', 'growth', 'Growth', 'PROFESSIONAL', 1000, 250, 100, 299900, 2999000, 2, CURRENT_TIMESTAMP),
  ('plan-enterprise', 'enterprise', 'Enterprise', 'ENTERPRISE', 100000, NULL, NULL, 999900, 9999000, 3, CURRENT_TIMESTAMP);

CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingProfile_tenantId_key" ON "BillingProfile"("tenantId");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "razorpaySubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE UNIQUE INDEX "Subscription_razorpaySubscriptionId_key" ON "Subscription"("razorpaySubscriptionId");
CREATE INDEX "Subscription_status_pastDueSince_idx" ON "Subscription"("status", "pastDueSince");

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "razorpayPaymentId" TEXT,
    "description" TEXT NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "buyerJson" JSONB NOT NULL,
    "sellerJson" JSONB NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX "Invoice_razorpayPaymentId_key" ON "Invoice"("razorpayPaymentId");
CREATE INDEX "Invoice_tenantId_issuedAt_idx" ON "Invoice"("tenantId", "issuedAt");

CREATE TABLE "InvoiceCounter" (
    "financialYear" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("financialYear")
);

CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- Row-level security on the organisation's own records (no foreign key to "Tenant", like "SupportPass").
ALTER TABLE "BillingProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingProfile" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Named tables only: AuditLog must keep its revoked UPDATE/DELETE (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Plan", "BillingProfile", "Subscription", "Invoice", "InvoiceCounter", "BillingEvent" TO lms_app;
  END IF;
END $$;

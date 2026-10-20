-- Only organisations created from now on (registration approval or the operator) get the setup checklist.
ALTER TABLE "Tenant" ADD COLUMN "setupChecklist" BOOLEAN NOT NULL DEFAULT false;

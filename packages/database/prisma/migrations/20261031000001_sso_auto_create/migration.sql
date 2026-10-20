-- Single sign-on can create a learner account the first time someone from one of the organisation's
-- allowed e-mail domains signs in. Off by default.

ALTER TABLE "SsoConnection" ADD COLUMN "autoCreateAccounts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SamlConnection" ADD COLUMN "autoCreateAccounts" BOOLEAN NOT NULL DEFAULT false;

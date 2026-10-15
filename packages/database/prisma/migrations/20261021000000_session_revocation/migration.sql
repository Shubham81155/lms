-- Server-side session revocation: tokens carry the version they were issued under.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

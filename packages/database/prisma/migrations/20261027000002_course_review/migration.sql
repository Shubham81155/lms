-- Course publishing review. Off by default: until an administrator turns it on, instructors publish as before.

ALTER TABLE "Tenant" ADD COLUMN "requireCourseApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Course" ADD COLUMN "reviewStatus" TEXT,
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewSubmittedById" TEXT,
ADD COLUMN "reviewSubmittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Course_tenantId_reviewStatus_idx" ON "Course"("tenantId", "reviewStatus");

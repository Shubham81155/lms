-- Gradebook (weighted categories, curve, approval workflow) and question bank.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "gradeCurveMethod" TEXT NOT NULL DEFAULT 'NONE', ADD COLUMN "gradeCurveValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quiz" ADD COLUMN "gradeCategoryId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "gradeCategoryId" TEXT;
ALTER TABLE "QuizQuestion" ADD COLUMN "bloomLevel" TEXT;

-- CreateTable
CREATE TABLE "GradeCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GradeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseGrade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawPercent" DOUBLE PRECISION NOT NULL,
    "curvedPercent" DOUBLE PRECISION NOT NULL,
    "letter" TEXT NOT NULL,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "breakdownJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT,
    "ownerId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "points" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "optionsJson" JSONB,
    "correctAnswer" TEXT,
    "explanation" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bloomLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeCategory_tenantId_courseId_idx" ON "GradeCategory"("tenantId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCategory_courseId_name_key" ON "GradeCategory"("courseId", "name");

-- CreateIndex
CREATE INDEX "CourseGrade_tenantId_courseId_status_idx" ON "CourseGrade"("tenantId", "courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseGrade_courseId_userId_key" ON "CourseGrade"("courseId", "userId");

-- CreateIndex
CREATE INDEX "QuestionBankItem_tenantId_courseId_idx" ON "QuestionBankItem"("tenantId", "courseId");

-- AddForeignKey
ALTER TABLE "GradeCategory" ADD CONSTRAINT "GradeCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCategory" ADD CONSTRAINT "GradeCategory_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseGrade" ADD CONSTRAINT "CourseGrade_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseGrade" ADD CONSTRAINT "CourseGrade_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseGrade" ADD CONSTRAINT "CourseGrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankItem" ADD CONSTRAINT "QuestionBankItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_gradeCategoryId_fkey" FOREIGN KEY ("gradeCategoryId") REFERENCES "GradeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_gradeCategoryId_fkey" FOREIGN KEY ("gradeCategoryId") REFERENCES "GradeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security (same model as 20261012000001_row_level_security).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GradeCategory', 'CourseGrade', 'QuestionBankItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
    REVOKE ALL ON TABLE "_prisma_migrations" FROM lms_app;
  END IF;
END $$;

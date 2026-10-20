-- The provider's id for the similarity check of a submission (Copyleaks scan id). It is chosen before the first
-- attempt and kept across retries, so a retry of a request that did arrive is recognised as a duplicate, and a
-- result for an older version of the submission can be told apart from the current one.

ALTER TABLE "AssignmentSubmission" ADD COLUMN "plagiarismScanId" TEXT;

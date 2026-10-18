-- Camera and microphone proctoring for quizzes (with requireProctoring). Detection runs in the learner's
-- browser; only events are stored (ProctoringLog), never images or audio.

ALTER TABLE "Quiz" ADD COLUMN "proctorCamera" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "proctorMicrophone" BOOLEAN NOT NULL DEFAULT false;

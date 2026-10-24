import { prisma } from './prisma';
import { eraseUploadsOf } from './stored-files';
import { revokeSessions } from './session';
import { consentHistory } from './consent';

// Per-person data rights: a portable export of everything held about a user (GDPR Art. 15/20) and
// erasure (Art. 17). Erasure anonymises rather than deletes the user row: grades, audit entries and
// foreign keys stay intact, but nothing that identifies the person is kept. The append-only audit
// trail cannot be edited, so entries keep the user id, IP address and user agent recorded at the
// time (retained under the legal-obligation / legitimate-interest exceptions). The consent history (ConsentRecord)
// is kept too, as the organisation's evidence of what the person agreed to and withdrew (DPDP Act s.6, GDPR Art.
// 7(1)): it holds no contact details, only the anonymised user id, the purpose wording and the dates. A minor's
// guardian address is removed.

export const ERASED_NAME = 'Erased';
export const erasedEmail = (userId: string) => `erased-${userId}@erased.invalid`;

export async function buildUserExport(userId: string, tenantId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      role: true,
      status: true,
      emailVerified: true,
      idpProvider: true,
      mfaEnabled: true,
      directoryOptOut: true,
      lastLoginAt: true,
      createdAt: true,
      isMinor: true,
      guardianEmail: true,
      guardianConsentAt: true,
    },
  });
  if (!user) return null;

  const [
    enrollments,
    quizAttempts,
    assignments,
    notifications,
    preferences,
    threads,
    posts,
    grades,
    attendance,
    xapi,
    activity,
    guardians,
    scorm,
    consents,
  ] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId, tenantId },
      select: {
        courseId: true,
        status: true,
        progressPercent: true,
        finalGrade: true,
        enrolledAt: true,
        completedAt: true,
        certificate: { select: { certificateNumber: true, issuedAt: true, expiresAt: true } },
      },
    }),
    prisma.quizSubmission.findMany({
      where: { userId, quiz: { tenantId } },
      select: {
        id: true,
        quizId: true,
        attemptNumber: true,
        score: true,
        maxScore: true,
        passed: true,
        submittedAt: true,
        answersJson: true,
        proctoringLogs: { select: { eventType: true, severity: true, timestamp: true } },
      },
    }),
    prisma.assignmentSubmission.findMany({
      where: { userId, assignment: { tenantId } },
      select: {
        id: true,
        assignmentId: true,
        fileUrl: true,
        submissionText: true,
        grade: true,
        feedback: true,
        plagiarismScore: true,
        submittedAt: true,
        gradedAt: true,
        appeal: { select: { reason: true, status: true, response: true, createdAt: true } },
        versions: {
          orderBy: { version: 'asc' },
          select: { version: true, fileUrl: true, submissionText: true, submittedAt: true, isLate: true },
        },
      },
    }),
    prisma.notification.findMany({
      where: { userId, tenantId },
      select: { category: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notificationPreference.findFirst({ where: { userId } }),
    prisma.forumThread.findMany({
      where: { authorId: userId, tenantId },
      select: { id: true, courseId: true, title: true, body: true, createdAt: true },
    }),
    prisma.forumPost.findMany({ where: { authorId: userId, tenantId }, select: { id: true, threadId: true, body: true, createdAt: true } }),
    prisma.courseGrade.findMany({
      where: { userId, tenantId },
      select: { courseId: true, rawPercent: true, curvedPercent: true, letter: true, status: true, updatedAt: true },
    }),
    prisma.liveAttendance.findMany({ where: { userId, tenantId } }),
    prisma.xapiStatement.findMany({ where: { actorUserId: userId, tenantId }, select: { statementJson: true } }),
    prisma.auditLog.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { action: true, resourceType: true, resourceId: true, ipAddress: true, userAgent: true, createdAt: true },
    }),
    prisma.userGuardian.findMany({
      where: { OR: [{ studentId: userId }, { guardianId: userId }] },
      select: { studentId: true, guardianId: true, relation: true },
    }),
    prisma.scormAttempt.findMany({
      where: { userId, tenantId },
      select: { packageId: true, status: true, scorePercent: true, completedAt: true, cmiJson: true, updatedAt: true },
    }),
    consentHistory(tenantId, userId),
  ]);

  return {
    exportMetadata: {
      format: 'LMS_PERSONAL_DATA_EXPORT_V1',
      generatedAt: new Date().toISOString(),
      subjectId: userId,
      regulation: 'GDPR Art. 15/20; DPDP Act s.11; FERPA 34 CFR 99.10',
    },
    profile: user,
    enrollments,
    quizAttempts,
    assignmentSubmissions: assignments,
    scormAttempts: scorm,
    courseGrades: grades,
    notifications,
    notificationPreferences: preferences,
    forum: { threads, posts },
    liveAttendance: attendance,
    learningActivity: xapi.map((x) => x.statementJson),
    guardianLinks: guardians,
    consents,
    accountActivity: activity,
  };
}

/** Why an account may not be erased right now, or null. */
export async function erasureBlocker(userId: string, tenantId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { role: true } });
  if (!user) return 'User not found';
  if (user.role === 'TENANT_ADMIN' || user.role === 'SUPER_ADMIN') {
    const others = await prisma.user.count({
      where: { tenantId, id: { not: userId }, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', erasedAt: null },
    });
    if (others === 0) return 'This is the only active administrator; appoint another before erasing it';
  }
  return null;
}

/** Idempotent: running it again on an erased account finishes any scrubbing that was interrupted. */
export async function eraseUser(userId: string, tenantId: string): Promise<void> {
  // Lock the account first so nothing can sign in while the rest is scrubbed.
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: erasedEmail(userId),
      firstName: ERASED_NAME,
      lastName: 'User',
      avatarUrl: null,
      passwordHash: null,
      emailVerified: false,
      idpProvider: null,
      idpSubjectId: null,
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryHashes: [],
      lockedUntil: null,
      directoryOptOut: true,
      status: 'SUSPENDED',
      erasedAt: new Date(),
      guardianEmail: null,
    },
  });
  await revokeSessions(userId);

  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId, tenantId } });
  await prisma.notificationPreference.deleteMany({ where: { userId } });
  await prisma.userGuardian.deleteMany({ where: { OR: [{ studentId: userId }, { guardianId: userId }] } });
  await prisma.guardianConsentRequest.deleteMany({ where: { tenantId, userId } });

  // Free text the person wrote can contain anything; scores and grades are kept for the record.
  await prisma.assignmentSubmission.updateMany({
    where: { userId, assignment: { tenantId } },
    data: { submissionText: null, fileUrl: null },
  });
  await prisma.assignmentSubmissionVersion.updateMany({
    where: { tenantId, submission: { userId } },
    data: { submissionText: null, fileUrl: null },
  });
  await eraseUploadsOf(userId, tenantId);
  // SCORM run-time data can hold anything the package stored (names, answers); status and score are kept.
  await prisma.scormAttempt.updateMany({ where: { userId, tenantId }, data: { cmiJson: {} } });
  await prisma.proctoringLog.updateMany({ where: { submission: { userId } }, data: { snapshotUrl: null } });
  await prisma.forumThread.updateMany({
    where: { authorId: userId, tenantId },
    data: { title: '[removed]', body: '[removed]', hidden: true },
  });
  await prisma.forumPost.updateMany({ where: { authorId: userId, tenantId }, data: { body: '[removed]', hidden: true } });

  // xAPI statements embed the actor's name and e-mail; keep the verb and object, drop the actor.
  const statements = await prisma.xapiStatement.findMany({
    where: { actorUserId: userId, tenantId },
    select: { id: true, statementJson: true },
  });
  for (const st of statements) {
    const json = {
      ...((st.statementJson as Record<string, unknown>) ?? {}),
      actor: { objectType: 'Agent', name: 'Erased user', account: { homePage: 'urn:lms:erased', name: userId } },
    };
    await prisma.xapiStatement.update({ where: { id: st.id }, data: { statementJson: json as any } });
  }
}

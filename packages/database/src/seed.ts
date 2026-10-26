import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Single .env at the monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// The seed writes across tenants, so it needs the privileged connection (DIRECT_URL, a role that
// bypasses row-level security). The runtime role (DATABASE_URL = lms_app) is deliberately unable to.
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the demo seed with NODE_ENV=production');
  }
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword || seedPassword.length < 10 || seedPassword.startsWith('CHANGE_ME')) {
    throw new Error('Set SEED_PASSWORD (min 10 characters, not the CHANGE_ME placeholder) in .env');
  }
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  console.log('[Enterprise LMS Seeder] Seeding PostgreSQL Database...');

  // 1. Create Enterprise Tenant: Harvard University
  const harvard = await prisma.tenant.upsert({
    where: { slug: 'harvard' },
    update: {
      name: 'GuruGyan Learning Management System',
    },
    create: {
      id: 'ten_harvard_01',
      slug: 'harvard',
      name: 'GuruGyan Learning Management System',
      customDomain: 'learn.harvard.edu',
      customDomainVerifiedAt: new Date(),
      tier: 'ENTERPRISE',
      primaryColor: '#a51c30',
      secondaryColor: '#1e1e1e',
      dataRegion: 'us-east-1',
      ferpaCompliant: true,
      coppaCompliant: false,
    },
  });
  console.log(`✓ Tenant created: ${harvard.name} (${harvard.id})`);

  // 2. Create Campus
  const mainCampus = await prisma.campus.upsert({
    where: {
      tenantId_code: {
        tenantId: harvard.id,
        code: 'CAM-CAMBRIDGE',
      },
    },
    update: {},
    create: {
      tenantId: harvard.id,
      name: 'Cambridge Main Campus',
      code: 'CAM-CAMBRIDGE',
    },
  });

  // 3. Create Department
  let csDept = await prisma.department.findFirst({
    where: { campusId: mainCampus.id, code: 'CS' },
  });
  if (!csDept) {
    csDept = await prisma.department.create({
      data: {
        campusId: mainCampus.id,
        name: 'Department of Computer Science',
        code: 'CS',
      },
    });
  }
  console.log(`✓ Campus & Department created: ${csDept.name}`);

  // 4. Create Users for all 3 Roles
  // Student: Alex Chen
  const student = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: harvard.id,
        email: 'alex.chen@harvard.edu',
      },
    },
    update: { passwordHash },
    create: {
      passwordHash,
      id: 'usr_student_01',
      tenantId: harvard.id,
      email: 'alex.chen@harvard.edu',
      firstName: 'Alex',
      lastName: 'Chen',
      role: 'STUDENT',
      emailVerified: true,
    },
  });

  // Instructor: Prof. David Malan
  const instructor = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: harvard.id,
        email: 'david.malan@harvard.edu',
      },
    },
    update: { passwordHash },
    create: {
      passwordHash,
      id: 'usr_instructor_01',
      tenantId: harvard.id,
      email: 'david.malan@harvard.edu',
      firstName: 'David',
      lastName: 'Malan',
      role: 'INSTRUCTOR',
      emailVerified: true,
    },
  });

  // Admin: Sarah Connor
  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: harvard.id,
        email: 'admin@harvard.edu',
      },
    },
    update: { passwordHash },
    create: {
      passwordHash,
      id: 'usr_admin_01',
      tenantId: harvard.id,
      email: 'admin@harvard.edu',
      firstName: 'Sarah',
      lastName: 'Connor',
      role: 'TENANT_ADMIN',
      emailVerified: true,
    },
  });

  // Teaching assistant: Marcus Brody, assigned to CS-101 below. Assistants can grade and review but
  // cannot create or change courses, so they are the account to test those limits with.
  const assistant = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: harvard.id,
        email: 'marcus.brody@harvard.edu',
      },
    },
    update: { passwordHash },
    create: {
      passwordHash,
      id: 'usr_assistant_01',
      tenantId: harvard.id,
      email: 'marcus.brody@harvard.edu',
      firstName: 'Marcus',
      lastName: 'Brody',
      role: 'TEACHING_ASSISTANT',
      emailVerified: true,
    },
  });

  // GuruGyan Institutional Accounts
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: harvard.id, email: 'admin@gurugyan.edu' } },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: {
      passwordHash,
      id: 'usr_admin_gg',
      tenantId: harvard.id,
      email: 'admin@gurugyan.edu',
      firstName: 'GuruGyan',
      lastName: 'Administrator',
      role: 'TENANT_ADMIN',
      emailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: harvard.id, email: 'teacher@gurugyan.edu' } },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: {
      passwordHash,
      id: 'usr_teacher_gg',
      tenantId: harvard.id,
      email: 'teacher@gurugyan.edu',
      firstName: 'GuruGyan',
      lastName: 'Professor',
      role: 'INSTRUCTOR',
      emailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: harvard.id, email: 'student@gurugyan.edu' } },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: {
      passwordHash,
      id: 'usr_student_gg',
      tenantId: harvard.id,
      email: 'student@gurugyan.edu',
      firstName: 'GuruGyan',
      lastName: 'Student',
      role: 'STUDENT',
      emailVerified: true,
    },
  });

  // Platform Operator Tenant & Platform Admins
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: { name: 'Platform operator' },
    create: {
      id: '0ebd88c5-e607-44c1-be9e-cc6ba7ee8950',
      slug: 'platform',
      name: 'Platform operator',
      tier: 'ENTERPRISE',
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'platform@gurugyan.com' } },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: {
      passwordHash,
      id: 'usr_platform_gg',
      tenantId: platformTenant.id,
      email: 'platform@gurugyan.com',
      firstName: 'Platform',
      lastName: 'Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'operator@platform.test' } },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: {
      passwordHash,
      id: 'a45cabfd-3163-41e2-a729-2fdbd24b1961',
      tenantId: platformTenant.id,
      email: 'operator@platform.test',
      firstName: 'Platform',
      lastName: 'Operator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    },
  });
  console.log(
    `✓ Users created: Student (${student.email}), Instructor (${instructor.email}), Assistant (${assistant.email}), Admin (${admin.email})`
  );

  // 5. Create Courses
  const course1 = await prisma.course.upsert({
    where: {
      tenantId_code: {
        tenantId: harvard.id,
        code: 'CS-101',
      },
    },
    update: {},
    create: {
      id: 'crs_cs101',
      tenantId: harvard.id,
      departmentId: csDept.id,
      code: 'CS-101',
      title: 'Advanced Distributed Systems & Microservices',
      status: 'PUBLISHED',
      passingGradePercent: 70.0,
    },
  });

  const course2 = await prisma.course.upsert({
    where: {
      tenantId_code: {
        tenantId: harvard.id,
        code: 'DS-201',
      },
    },
    update: {},
    create: {
      id: 'crs_ds201',
      tenantId: harvard.id,
      departmentId: csDept.id,
      code: 'DS-201',
      title: 'Enterprise Data Governance & FERPA Compliance',
      status: 'PUBLISHED',
      passingGradePercent: 75.0,
    },
  });
  console.log(`✓ Courses created: ${course1.code}, ${course2.code}`);

  // 6. Assign Instructor to Course
  await prisma.courseInstructor.upsert({
    where: {
      courseId_userId: {
        courseId: course1.id,
        userId: instructor.id,
      },
    },
    update: {},
    create: {
      courseId: course1.id,
      userId: instructor.id,
      isPrimary: true,
    },
  });

  await prisma.courseInstructor.upsert({
    where: {
      courseId_userId: {
        courseId: course1.id,
        userId: assistant.id,
      },
    },
    update: {},
    create: {
      courseId: course1.id,
      userId: assistant.id,
      isPrimary: false,
    },
  });

  // 7. Course content: three modules, six lessons.
  const curriculum = [
    {
      id: 'mod_cs101_1',
      title: 'Module 1: Foundations of Distributed Consensus',
      lessons: [
        {
          id: 'les_cs101_1_1',
          title: '1.1 The Byzantine Generals Problem & Fault Tolerance',
          contentType: 'VIDEO',
          minutes: 18,
          body: 'In distributed computing, achieving consensus among independent nodes in the presence of arbitrary failures (Byzantine faults) requires at least 3f + 1 nodes to tolerate f faulty or malicious actors.',
        },
        {
          id: 'les_cs101_1_2',
          title: '1.2 Safety vs. Liveness Properties in Asynchronous Networks',
          contentType: 'RICHTEXT',
          minutes: 25,
          body: 'The FLP Impossibility Theorem (Fischer, Lynch, Paterson, 1985) establishes that no deterministic asynchronous algorithm can guarantee consensus if even a single node is subject to unannounced crash failure.\n\nIt does not mean distributed algorithms cannot make progress in practice: partial synchrony assumptions or randomized consensus (as in Paxos and Raft) are what make termination possible.',
        },
      ],
    },
    {
      id: 'mod_cs101_2',
      title: 'Module 2: Raft Consensus Protocol in Production',
      lessons: [
        {
          id: 'les_cs101_2_1',
          title: '2.1 Leader Election, Randomized Timers & Heartbeats',
          contentType: 'VIDEO',
          minutes: 30,
          body: 'Raft structures consensus around an elected leader. Nodes move between Follower, Candidate and Leader states, and randomized election timeouts (150-300ms) prevent split votes.',
        },
        {
          id: 'les_cs101_2_2',
          title: '2.2 Log Replication & Quorum Commitment',
          contentType: 'INTERACTIVE_CODE',
          minutes: 40,
          body: 'A log entry is committed once it is replicated across a strict majority (quorum) of nodes. The leader tracks matchIndex and nextIndex for every follower.\n\nExercise: write a function hasMajorityQuorum(clusterSize, respondingNodes) that returns true when a majority of the cluster has responded.',
        },
      ],
    },
    {
      id: 'mod_cs101_3',
      title: 'Module 3: Zero-Trust Network Policies & Data Security',
      lessons: [
        {
          id: 'les_cs101_3_1',
          title: '3.1 Field-Level Encryption & Mutual TLS Handshakes',
          contentType: 'RICHTEXT',
          minutes: 35,
          body: 'Enterprise architectures enforce mTLS using ephemeral elliptic-curve Diffie-Hellman keys and AES-256-GCM authenticated encryption for student personal data held under FERPA.',
        },
        {
          id: 'les_cs101_3_2',
          title: '3.2 Dynamic Forensic Watermarking & Screen Capture Protection',
          contentType: 'RICHTEXT',
          minutes: 20,
          body: 'To deter lecture sharing, videos can embed a floating forensic watermark containing the identity of the viewer and a timestamp.',
        },
      ],
    },
  ] as const;

  for (const [mi, mod] of curriculum.entries()) {
    await prisma.module.upsert({
      where: { id: mod.id },
      update: {},
      create: { id: mod.id, courseId: course1.id, title: mod.title, orderIndex: mi },
    });
    for (const [li, les] of mod.lessons.entries()) {
      await prisma.lesson.upsert({
        where: { id: les.id },
        update: {},
        create: {
          id: les.id,
          moduleId: mod.id,
          title: les.title,
          orderIndex: li,
          contentType: les.contentType,
          bodyContent: les.body,
          estimatedMinutes: les.minutes,
        },
      });
    }
  }
  console.log(`✓ ${curriculum.length} modules seeded in ${course1.code}`);

  // 8. Enroll the student, with the first three lessons finished. Progress is derived from those
  // rows (3 of 6 lessons = 50%), the same way the API derives it.
  const finished = ['les_cs101_1_1', 'les_cs101_1_2', 'les_cs101_2_1'];
  const totalLessons = curriculum.reduce((n, m) => n + m.lessons.length, 0);
  const enrollment = await prisma.enrollment.upsert({
    where: {
      courseId_userId: {
        courseId: course1.id,
        userId: student.id,
      },
    },
    update: {},
    create: {
      tenantId: harvard.id,
      courseId: course1.id,
      userId: student.id,
      status: 'IN_PROGRESS',
      progressPercent: Math.round((finished.length / totalLessons) * 100),
    },
  });
  for (const lessonId of finished) {
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: student.id, lessonId } },
      update: {},
      create: { tenantId: harvard.id, courseId: course1.id, userId: student.id, lessonId },
    });
  }
  console.log(`✓ Student ${student.email} enrolled in ${course1.code} (${enrollment.progressPercent}% complete)`);

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeder Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

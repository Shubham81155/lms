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
    update: {},
    create: {
      id: 'ten_harvard_01',
      slug: 'harvard',
      name: 'Harvard University',
      customDomain: 'learn.harvard.edu',
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
  console.log(`✓ Users created: Student (${student.email}), Instructor (${instructor.email}), Admin (${admin.email})`);

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
      enableProctoring: true,
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
      enableProctoring: false,
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

  // 7. Enroll Student in Course
  await prisma.enrollment.upsert({
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
      progressPercent: 78.0,
    },
  });
  console.log(`✓ Student ${student.email} enrolled in ${course1.code}`);

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

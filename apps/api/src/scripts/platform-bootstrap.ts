import crypto from 'crypto';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma, runInTenantTransaction } from '../lib/prisma';
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/password';
import { sendInvitation } from '../lib/invitations';

// Creates the platform operator's organisation (slug PLATFORM_OPERATOR_TENANT) and a super administrator in
// it, who then sees the platform admin page: organisation requests, organisations, plans. Safe to run again.
//
//   npm run platform:bootstrap -w @enterprise-lms/api -- --email ops@example.com --first Ada --last Lovelace
//     [--password '...']  set the password now (otherwise an invitation e-mail is sent)
//     [--name 'Example Platform']  the organisation's name (default "Platform operator")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = config.PLATFORM_OPERATOR_TENANT;
  if (!slug) throw new Error('Set PLATFORM_OPERATOR_TENANT (the operator organisation\'s address, e.g. "platform") first.');
  const email = arg('email')?.trim().toLowerCase();
  const firstName = arg('first')?.trim();
  const lastName = arg('last')?.trim();
  const password = arg('password');
  const name = arg('name')?.trim() || 'Platform operator';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !firstName || !lastName) {
    throw new Error(
      'Usage: --email <address> --first <first name> --last <last name> [--password <password>] [--name <organisation name>]'
    );
  }
  if (password !== undefined && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
    throw new Error(`The password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
  }

  let tenant = await basePrisma.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!tenant) {
    tenant = await basePrisma.tenant.create({
      data: { id: crypto.randomUUID(), slug, name, tier: 'ENTERPRISE', status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    console.log(`Created the operator organisation "${slug}".`);
  } else {
    console.log(`The operator organisation "${slug}" already exists.`);
    if (tenant.status !== 'ACTIVE') await basePrisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
  }
  const tenantId = tenant.id;

  const passwordHash = password ? await hashPassword(password) : null;
  const user = await runInTenantTransaction(tenantId, async (tx) => {
    const existing = await tx.user.findFirst({ where: { tenantId, email }, select: { id: true, status: true } });
    const data = {
      firstName,
      lastName,
      role: 'SUPER_ADMIN' as const,
      ...(passwordHash ? { passwordHash, status: 'ACTIVE' as const, emailVerified: true } : {}),
    };
    return existing
      ? tx.user.update({
          where: { id: existing.id },
          data,
          select: { id: true, email: true, firstName: true, tenantId: true, status: true },
        })
      : tx.user.create({
          data: {
            tenantId,
            email,
            ...data,
            ...(passwordHash ? {} : { status: 'INVITED' as const, passwordHash: null, emailVerified: false }),
          },
          select: { id: true, email: true, firstName: true, tenantId: true, status: true },
        });
  });

  if (user.status === 'ACTIVE') {
    console.log(`${email} is a platform operator. Sign in with organisation "${slug}".`);
  } else {
    const result = await runWithTenant(tenantId, () => sendInvitation(user, { newOrganization: name }));
    console.log(
      result === 'sent'
        ? `Invitation e-mailed to ${email}. Following its link activates the account.`
        : `${email} is invited, but the invitation could not be e-mailed (${result}). Run again with --password, or configure SMTP_URL.`
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

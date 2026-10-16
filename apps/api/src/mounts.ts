import type { Router } from 'express';
import authRoutes from './routes/auth.routes';
import coursesRoutes from './routes/courses.routes';
import enrollmentsRoutes from './routes/enrollments.routes';
import usersRoutes from './routes/users.routes';
import privacyRoutes from './routes/privacy.routes';
import assessmentsRoutes from './routes/assessments.routes';
import adminRoutes from './routes/admin.routes';
import analyticsRoutes from './routes/analytics.routes';
import certificatesRoutes from './routes/certificates.routes';
import notificationsRoutes from './routes/notifications.routes';
import forumRoutes from './routes/forum.routes';
import calendarRoutes from './routes/calendar.routes';
import intelligenceRoutes from './routes/intelligence.routes';
import mfaRoutes from './routes/mfa.routes';
import platformRoutes from './routes/platform.routes';
import scimRoutes from './routes/scim.routes';
import ltiRoutes from './routes/lti.routes';
import gradebookRoutes from './routes/gradebook.routes';
import questionBankRoutes from './routes/questionbank.routes';
import integrationsRoutes from './routes/integrations.routes';
import ssoRoutes from './routes/sso.routes';
import samlRoutes from './routes/saml.routes';
import gradingRoutes from './routes/grading.routes';
import orgRoutes from './routes/org.routes';
import liveRoutes from './routes/live.routes';
import aiRoutes from './routes/ai.routes';
import operatorRoutes from './routes/operator.routes';
import deadlinesRoutes from './routes/deadlines.routes';

/** Where each router is mounted, in mounting order (order matters: see the notes in server.ts). */
export interface Mount {
  prefix: string;
  router: Router;
}

/** Mounted before the JSON body parser: signed provider callbacks need the raw request bytes. */
export const rawBodyMounts: Mount[] = [{ prefix: '/api/v1/integrations', router: integrationsRoutes }];

export const apiMounts: Mount[] = [
  { prefix: '/api/v1/auth/mfa', router: mfaRoutes },
  { prefix: '/api/v1/auth/sso', router: ssoRoutes },
  { prefix: '/api/v1/auth/saml', router: samlRoutes },
  { prefix: '/api/v1/auth', router: authRoutes },
  { prefix: '/api/v1/courses', router: coursesRoutes },
  { prefix: '/api/v1/enrollments', router: enrollmentsRoutes },
  { prefix: '/api/v1/users', router: usersRoutes },
  { prefix: '/api/v1/privacy', router: privacyRoutes },
  { prefix: '/api/v1', router: assessmentsRoutes },
  { prefix: '/api/v1/admin', router: adminRoutes },
  { prefix: '/api/v1/analytics', router: analyticsRoutes },
  { prefix: '/api/v1/ai', router: aiRoutes },
  { prefix: '/api/v1/operator', router: operatorRoutes },
  { prefix: '/api/v1/certificates', router: certificatesRoutes },
  { prefix: '/api/v1/admin', router: platformRoutes },
  { prefix: '/api/v1/admin', router: orgRoutes },
  { prefix: '/api/v1/notifications', router: notificationsRoutes },
  { prefix: '/api/v1/calendar', router: calendarRoutes },
  { prefix: '/api/v1/scim/v2', router: scimRoutes },
  { prefix: '/api/v1/lti', router: ltiRoutes },
  { prefix: '/api/v1', router: forumRoutes },
  { prefix: '/api/v1', router: gradebookRoutes },
  { prefix: '/api/v1', router: gradingRoutes },
  { prefix: '/api/v1', router: liveRoutes },
  { prefix: '/api/v1', router: questionBankRoutes },
  { prefix: '/api/v1', router: intelligenceRoutes },
  { prefix: '/api/v1', router: deadlinesRoutes },
];

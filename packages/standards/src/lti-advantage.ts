import { Lti13Claims } from './index';

/**
 * Enterprise LTI 1.3 Advantage Engine
 * Implements 1EdTech OIDC Authorization, Deep Linking, and Assignment & Grade Services (AGS)
 */

export interface LtiLaunchContext {
  userId: string;
  userRole: string;
  courseId: string;
  courseTitle: string;
  tenantId: string;
  resourceLinkId: string;
  targetLinkUri: string;
}

export class LtiAdvantageToolEngine {
  /**
   * Generates standard LTI 1.3 Advantage Claim payload for an authenticated launch
   */
  public static createLaunchClaims(context: LtiLaunchContext): Lti13Claims {
    return {
      'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
      'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
      'https://purl.imsglobal.org/spec/lti/claim/deployment_id': `dep_${context.tenantId}_001`,
      'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': context.targetLinkUri,
      'https://purl.imsglobal.org/spec/lti/claim/resource_link': {
        id: context.resourceLinkId,
        title: context.courseTitle,
        description: `Enterprise LTI Launch for ${context.courseTitle}`,
      },
      'https://purl.imsglobal.org/spec/lti/claim/roles': [
        context.userRole === 'INSTRUCTOR'
          ? 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'
          : 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
      ],
      'https://purl.imsglobal.org/spec/lti/claim/context': {
        id: context.courseId,
        title: context.courseTitle,
        type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
      },
      'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': {
        scope: [
          'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
          'https://purl.imsglobal.org/spec/lti-ags/scope/score',
        ],
        lineitems: `https://lms.enterprise.com/api/v1/lti/courses/${context.courseId}/lineitems`,
      },
      'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice': {
        context_memberships_url: `https://lms.enterprise.com/api/v1/lti/courses/${context.courseId}/memberships`,
        service_versions: ['2.0'],
      },
    };
  }

  /**
   * Builds OIDC Third-Party Login Redirection URL
   */
  public static buildOidcLoginUrl(
    authLoginUrl: string,
    iss: string,
    targetLinkUri: string,
    loginHint: string,
    clientId: string
  ): string {
    const url = new URL(authLoginUrl);
    url.searchParams.set('iss', iss);
    url.searchParams.set('target_link_uri', targetLinkUri);
    url.searchParams.set('login_hint', loginHint);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('lti_message_hint', `hint_${Date.now()}`);
    return url.toString();
  }
}

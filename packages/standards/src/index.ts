/**
 * Enterprise LMS Educational Standards Specifications
 * Implements SCORM 1.2/2004, xAPI (Tin Can), and LTI 1.3 Advantage interfaces
 */

// =========================================================
// 1. SCORM 1.2 & 2004 RUNTIME DATA MODEL
// =========================================================

export interface Scorm12CmiData {
  'cmi.core.student_id': string;
  'cmi.core.student_name': string;
  'cmi.core.lesson_location': string;
  'cmi.core.credit': 'credit' | 'no-credit';
  'cmi.core.lesson_status': 'passed' | 'completed' | 'failed' | 'incomplete' | 'browsed' | 'not attempted';
  'cmi.core.entry': 'ab-initio' | 'resume' | '';
  'cmi.core.score.raw'?: string;
  'cmi.core.score.min'?: string;
  'cmi.core.score.max'?: string;
  'cmi.core.total_time'?: string;
  'cmi.core.lesson_mode': 'browse' | 'normal' | 'review';
  'cmi.core.exit': 'time-out' | 'suspend' | 'logout' | '';
  'cmi.core.session_time'?: string;
  'cmi.suspend_data'?: string;
  'cmi.launch_data'?: string;
  'cmi.comments'?: string;
}

export interface Scorm2004CmiData {
  'cmi.completion_status': 'completed' | 'incomplete' | 'not attempted' | 'unknown';
  'cmi.success_status': 'passed' | 'failed' | 'unknown';
  'cmi.score.scaled'?: string; // -1 to 1
  'cmi.score.raw'?: string;
  'cmi.score.min'?: string;
  'cmi.score.max'?: string;
  'cmi.location'?: string;
  'cmi.progress_measure'?: string; // 0.0 to 1.0
  'cmi.session_time'?: string;
  'cmi.suspend_data'?: string;
}

// =========================================================
// 2. xAPI (TIN CAN) SPECIFICATION
// =========================================================

export interface XApiActor {
  objectType?: 'Agent' | 'Group';
  name: string;
  mbox?: string; // mailto:student@university.edu
  account?: {
    homePage: string;
    name: string;
  };
}

export interface XApiVerb {
  id: string; // e.g. "http://adlnet.gov/expapi/verbs/completed"
  display: Record<string, string>; // { "en-US": "completed" }
}

export interface XApiObject {
  objectType?: 'Activity' | 'Agent' | 'StatementRef' | 'SubStatement';
  id: string; // URI
  definition?: {
    name?: Record<string, string>;
    description?: Record<string, string>;
    type?: string;
  };
}

export interface XApiResult {
  score?: {
    scaled?: number;
    raw?: number;
    min?: number;
    max?: number;
  };
  success?: boolean;
  completion?: boolean;
  response?: string;
  duration?: string; // ISO 8601 duration
}

export interface XApiStatement {
  id?: string;
  actor: XApiActor;
  verb: XApiVerb;
  object: XApiObject;
  result?: XApiResult;
  timestamp?: string;
  stored?: string;
  authority?: XApiActor;
}

// =========================================================
// 3. LTI 1.3 ADVANTAGE (1EdTech) SPECIFICATION
// =========================================================

export interface Lti13Claims {
  'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest' | 'LtiDeepLinkingRequest';
  'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0';
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id': string;
  'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': string;
  'https://purl.imsglobal.org/spec/lti/claim/resource_link': {
    id: string;
    title?: string;
    description?: string;
  };
  'https://purl.imsglobal.org/spec/lti/claim/roles': string[]; // e.g., "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
  'https://purl.imsglobal.org/spec/lti/claim/context': {
    id: string;
    label?: string;
    title?: string;
    type?: string[];
  };
  // LTI Advantage: Assignment and Grade Services (AGS)
  'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint'?: {
    scope: string[];
    lineitems: string;
    lineitem?: string;
  };
  // LTI Advantage: Names and Role Provisioning Services (NRPS)
  'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice'?: {
    context_memberships_url: string;
    service_versions: string[];
  };
}

// Submodule exports
export * from './scorm-player';
export * from './lti-advantage';
export * from './virtual-classroom';
export * from './oneroster';
export * from './open-badges';

/**
 * IMS OneRoster 1.2 Enterprise SIS Data Exchange Specification
 * Standardizes Student Information System (SIS) sync for PowerSchool, Banner, Infinite Campus.
 */

export interface OneRosterOrg {
  sourcedId: string;
  status: 'active' | 'tobedeleted';
  dateLastModified: string;
  name: string;
  type: 'department' | 'school' | 'district' | 'local' | 'state' | 'national';
  identifier?: string;
}

export interface OneRosterUser {
  sourcedId: string;
  status: 'active' | 'tobedeleted';
  dateLastModified: string;
  enabledUser: boolean;
  username: string;
  userIds?: { type: string; identifier: string }[];
  givenName: string;
  familyName: string;
  role: 'administrator' | 'faculty' | 'guardian' | 'parent' | 'proctor' | 'student' | 'teacher';
  email?: string;
  orgs: { sourcedId: string; href: string }[];
}

export interface OneRosterEnrollment {
  sourcedId: string;
  status: 'active' | 'tobedeleted';
  dateLastModified: string;
  user: { sourcedId: string; href: string };
  class: { sourcedId: string; href: string };
  role: 'administrator' | 'faculty' | 'guardian' | 'parent' | 'proctor' | 'student' | 'teacher';
  primary?: boolean;
  beginDate?: string;
  endDate?: string;
}

export class OneRosterSyncAdapter {
  /**
   * Transforms OneRoster user payload into LMS User Entity structure
   */
  public static mapOneRosterUser(onerosterUser: OneRosterUser, tenantId: string) {
    return {
      tenantId,
      idpSubjectId: onerosterUser.sourcedId,
      email: onerosterUser.email || `${onerosterUser.username}@school.edu`,
      firstName: onerosterUser.givenName,
      lastName: onerosterUser.familyName,
      role: onerosterUser.role === 'teacher' || onerosterUser.role === 'faculty'
        ? 'INSTRUCTOR'
        : onerosterUser.role === 'administrator'
        ? 'TENANT_ADMIN'
        : 'STUDENT',
      status: onerosterUser.enabledUser && onerosterUser.status === 'active' ? 'ACTIVE' : 'SUSPENDED',
    };
  }
}

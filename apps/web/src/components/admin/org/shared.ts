export interface Department {
  id: string;
  name: string;
  code: string;
  courseCount: number;
}

export interface Campus {
  id: string;
  name: string;
  code: string;
  courseCount: number;
  departments: Department[];
}

export interface TenantSettings {
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  ferpaCompliant: boolean;
  coppaCompliant: boolean;
  dataRegion: string;
}

export interface Term {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  courseCount: number;
}

export interface ComplianceCheck {
  id: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'INFO';
  detail: string;
}

export interface Compliance {
  checks: ComplianceCheck[];
  declarations: { ferpa: boolean; coppa: boolean; dataRegion: string | null };
  note: string;
}

export const isoDay = (iso: string) => iso.slice(0, 10);

export const isValidTermRange = (name: string, starts: string, ends: string) =>
  name.trim().length >= 2 && Boolean(starts) && Boolean(ends) && ends > starts;

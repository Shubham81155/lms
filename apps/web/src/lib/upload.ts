/**
 * Uploads to the API's file store (POST /api/v1/files). The body is the file itself; the API streams it into
 * storage and answers with a link (/api/v1/files/<id>) to put in a submission's fileUrl or a lesson's mediaUrl.
 */

/** Matches the API's default UPLOAD_MAX_MB; the API enforces its own setting either way. */
export const MAX_UPLOAD_MB = 100;

/** The types the API accepts (lib/storage.ts ALLOWED_TYPES), for the file picker. */
export const UPLOAD_ACCEPT = {
  document:
    '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.zip,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/png,image/jpeg,image/gif,image/webp',
  video: '.mp4,.webm,video/mp4,video/webm',
  scorm: '.zip,application/zip',
} as const;

export type UploadPurpose = 'ASSIGNMENT_SUBMISSION' | 'LESSON_MEDIA' | 'SCORM_PACKAGE';

export interface UploadedFile {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

const UPLOAD_LINK = /^\/api\/v1\/files\/[0-9a-f-]{36}$/i;
/** A link to a file uploaded here, as opposed to an external address. */
export const isUploadLink = (v: string) => UPLOAD_LINK.test(v.trim());

export async function uploadFile(file: File, purpose: UploadPurpose, courseId: string): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`Files can be at most ${MAX_UPLOAD_MB} MB.`);
  if (file.size === 0) throw new Error('That file is empty.');
  const qs = new URLSearchParams({ purpose, courseId, filename: file.name });
  // Browsers name zips inconsistently (Windows: x-zip-compressed, sometimes nothing at all).
  const zipish = /\.zip$/i.test(file.name) && ['', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.type);
  const contentType = zipish ? 'application/zip' : file.type || 'application/octet-stream';
  const res = await fetch(`/api/v1/files?${qs}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(res.status === 415 ? 'This kind of file cannot be uploaded.' : (json?.error ?? 'The upload failed.'));
  }
  return json.data as UploadedFile;
}

export const formatBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

import pino from 'pino';
import { config } from '../config';

/**
 * Structured JSON logger. Secrets are redacted by path, and request bodies are never logged
 * unless LOG_REQUEST_BODIES=true (and then only after AuditSanitizer masking).
 */
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
});

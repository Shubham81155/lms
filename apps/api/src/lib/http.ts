import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { Prisma } from '@enterprise-lms/database';
import { logger } from './logger';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, also returned in the x-request-id header and in every error body. */
      id?: string;
    }
  }
}

/** Throw from a handler to produce a specific client error. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Accepts a well-formed client-supplied id (for tracing across services), otherwise makes one. */
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

export function sendError(req: Request, res: Response, status: number, message: string, details?: unknown) {
  return res.status(status).json({
    error: message,
    ...(details !== undefined ? { details } : {}),
    requestId: req.id,
  });
}

/**
 * Single place that turns a thrown value into a response. Known failures map to 4xx; anything else
 * is logged with the request id and answered with a generic message, so internals (stack traces,
 * SQL, Prisma messages) never reach the client.
 */
export function handleError(req: Request, res: Response, err: unknown, fallbackMessage: string) {
  if (err instanceof HttpError) return sendError(req, res, err.status, err.message, err.details);

  if (err instanceof ZodError) {
    return sendError(req, res, 400, 'Validation failed', err.format());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return sendError(req, res, 409, 'A record with these values already exists');
    if (err.code === 'P2025') return sendError(req, res, 404, 'Record not found');
    if (err.code === 'P2003') return sendError(req, res, 400, 'A referenced record does not exist');
  }

  logger.error({ err, requestId: req.id, method: req.method, path: req.originalUrl, userId: req.user?.id }, fallbackMessage);
  return sendError(req, res, 500, fallbackMessage);
}

/** Wraps an async handler so any throw reaches handleError instead of crashing or hanging. */
export const route =
  (fallbackMessage: string, handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      handleError(req, res, err, fallbackMessage);
    }
  };

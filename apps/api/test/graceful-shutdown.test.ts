import http from 'http';
import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { gracefulShutdown } from '../src/server';
import { startAllWorkers } from '../src/worker';
import { startEmailDispatcher, stopEmailDispatcher } from '../src/lib/email-dispatch';
import { startWebhookRetryWorker, stopWebhookRetryWorker } from '../src/lib/webhooks';
import { stopPeriodicJobs } from '../src/lib/job-lock';

const baseEnv = () => ({
  JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
  PII_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
});

describe('WORKERS_ENABLED config parsing', () => {
  it('defaults to true and parses string booleans safely', () => {
    expect(loadConfig(baseEnv() as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(true);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: '' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(true);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: 'true' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(true);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: '1' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(true);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: 'false' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(false);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: 'FALSE' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(false);
    expect(loadConfig({ ...baseEnv(), WORKERS_ENABLED: '0' } as NodeJS.ProcessEnv).WORKERS_ENABLED).toBe(false);
    expect(() => loadConfig({ ...baseEnv(), WORKERS_ENABLED: 'maybe' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('worker lifecycle & gracefulShutdown', () => {
  afterEach(() => {
    stopEmailDispatcher();
    stopWebhookRetryWorker();
    stopPeriodicJobs();
    vi.restoreAllMocks();
  });

  it('startAllWorkers returns a stop callback that clears interval timers', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const stopAll = startAllWorkers();
    expect(typeof stopAll).toBe('function');

    stopAll();
    expect(clearSpy).toHaveBeenCalled();

    // Individual start helpers also return callable stop functions.
    const stopEmail = startEmailDispatcher();
    const stopWebhook = startWebhookRetryWorker();
    stopEmail();
    stopWebhook();
  });

  it('closes HTTP server, stops workers, disconnects Prisma, and closes Redis', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const events: string[] = [];
    const closeSpy = vi.spyOn(server, 'close');
    const stopWorkers = vi.fn(() => events.push('workers'));
    const disconnectPrisma = vi.fn(async () => {
      events.push('prisma');
    });
    const closeRedis = vi.fn(async () => {
      events.push('redis');
    });

    await gracefulShutdown('SIGTERM', {
      server,
      stopWorkers,
      disconnectPrisma,
      closeRedis,
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(stopWorkers).toHaveBeenCalledTimes(1);
    expect(disconnectPrisma).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
    expect(events).toContain('workers');
    expect(events).toContain('prisma');
    expect(events).toContain('redis');
    expect(events[0]).toBe('workers');
    expect(server.listening).toBe(false);
  });

  it('completes shutdown even if Prisma or Redis cleanup rejects', async () => {
    const fakeServer = {
      close: (cb?: (err?: Error) => void) => {
        cb?.();
        return fakeServer as unknown as http.Server;
      },
    };
    const stopWorkers = vi.fn();
    const disconnectPrisma = vi.fn(async () => {
      throw new Error('db already closed');
    });
    const closeRedis = vi.fn(async () => {
      throw new Error('redis already closed');
    });

    await expect(
      gracefulShutdown('SIGINT', {
        server: fakeServer,
        stopWorkers,
        disconnectPrisma,
        closeRedis,
      })
    ).resolves.toBeUndefined();

    expect(stopWorkers).toHaveBeenCalledTimes(1);
    expect(disconnectPrisma).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
  });
});

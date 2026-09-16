/**
 * Redis helper for publishing audit log messages to a stream.
 *
 * Ported from please-scan-verify's lib/redis.ts (same on-prem fix, see x075):
 * the C# side (onix-v2-api's AuditLogMiddleware) already reads audit logs
 * from a Redis stream keyed "AuditLog:{Environment}" — this mirrors that
 * write side for the register app's own request logging.
 */

import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis';

let redisClient: RedisClient | null = null;

function getRedisClient(): RedisClient | null {
  // Return the existing client even while it's still connecting - creating a
  // second client here on every call until the first one reaches "ready"
  // just stacks up redundant connection attempts. With enableOfflineQueue
  // true (see below), commands issued on a not-yet-ready client are queued
  // and flushed automatically once the connection completes.
  if (redisClient) {
    return redisClient;
  }

  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;

  if (!redisHost || !redisPort) {
    return null;
  }

  try {
    const redisPassword = process.env.REDIS_PASSWORD;
    const redisTls = process.env.REDIS_TLS === 'true';

    const redisOptions: RedisOptions = {
      host: redisHost,
      port: parseInt(redisPort, 10),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      // Queue commands issued before the connection is ready instead of
      // throwing "Stream isn't writeable" - the first request right after a
      // pod restart can otherwise silently drop its audit log publish.
      // Found and fixed for please-scan-verify's identical bug, see x075.
      enableOfflineQueue: true,
      lazyConnect: false,
    };

    if (redisPassword) {
      redisOptions.password = redisPassword;
    }
    if (redisTls) {
      redisOptions.tls = { rejectUnauthorized: false };
    }

    redisClient = new Redis(redisOptions);

    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });

    return redisClient;
  } catch (error) {
    console.error('Failed to create Redis client:', error);
    return null;
  }
}

/**
 * Publishes a message to a Redis stream (XADD with a single "message" field).
 */
export async function publishMessageAsync(stream: string, message: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) {
    console.warn('Redis not available. Skipping message publish.');
    return null;
  }

  try {
    return await client.xadd(stream, '*', 'message', message);
  } catch (error) {
    console.error('Redis publishMessageAsync error:', error);
    return null;
  }
}

export function isRedisAvailable(): boolean {
  return redisClient !== null && redisClient.status === 'ready';
}

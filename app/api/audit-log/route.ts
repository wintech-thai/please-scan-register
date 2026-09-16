/**
 * Audit log ingestion endpoint
 *
 * Receives the audit log payload built by proxy.ts and publishes it to
 * Redis (same "AuditLog:{Environment}" stream key onix-v2-api's
 * AuditLogMiddleware writes to — see x075). This exists as its own
 * Node.js-runtime route because proxy.ts runs on the Edge runtime, which
 * can't use ioredis (needs Node's net/tls modules).
 */

import { NextRequest, NextResponse } from 'next/server';
import { publishMessageAsync } from '@/lib/redis';

function resolveEnvironment(): string {
  const runtimeEnv = process.env.RUNTIME_ENV || process.env.NODE_ENV || 'development';
  if (runtimeEnv === 'production') return 'Production';
  if (runtimeEnv === 'test') return 'Test';
  return 'Development';
}

export async function POST(req: NextRequest) {
  try {
    const auditLog = await req.json();
    const streamKey = `AuditLog:${resolveEnvironment()}`;

    await publishMessageAsync(streamKey, JSON.stringify(auditLog));

    return NextResponse.json({ status: 'OK' });
  } catch (error) {
    console.error('Failed to publish audit log to Redis:', error instanceof Error ? error.message : error);
    return NextResponse.json({ status: 'ERROR' }, { status: 500 });
  }
}

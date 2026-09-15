/**
 * Proxy for ONIX v2 Registration Microservice
 *
 * Features:
 * 1. Audit logging for all requests
 * 2. Security headers
 *
 * Note: Next.js 16 proxy runs in Edge Runtime by default
 * Renamed from middleware.ts to proxy.ts per Next.js 16 convention
 *
 * i18n is now handled via searchParams (?lang=en or ?lang=th) instead of path segments
 */

import { NextRequest, NextResponse } from 'next/server';

// Log version info on first load
let versionLogged = false;
if (!versionLogged) {
  const commitId = process.env.NEXT_PUBLIC_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown';
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || 'unknown';

  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 ONIX v2 Registration - Application Started');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📦 Version:    ${version}`);
  console.log(`🔖 Commit ID:  ${commitId}`);
  console.log(`🕐 Build Time: ${buildTime}`);
  console.log(`🌍 Environment: ${process.env.RUNTIME_ENV || 'development'}`);
  console.log('═══════════════════════════════════════════════════');

  versionLogged = true;
}

// Audit log structure
interface AuditLog {
  Host: string;
  HttpMethod: string;
  StatusCode: number;
  Path: string;
  QueryString: string;
  UserAgent: string;
  RequestSize: number;
  ResponseSize: number;
  LatencyMs: number;
  Scheme: string;
  ClientIp: string;
  CfClientIp: string;
  CustomStatus: string;
  CustomDesc: string;
  Environment: string | undefined;
  Locale: string;
  userInfo: UserInfo;
}

interface UserInfo {
  userId?: string;
  sessionId?: string;
}

/**
 * Main proxy function
 */
export async function proxy(request: NextRequest) {
  const startTime = Date.now();
  const { pathname, search, searchParams } = request.nextUrl;

  // Skip proxy for:
  // - Health endpoints
  // - API routes
  // - Static files (_next/static, _next/image)
  // - Public files (favicon, images, etc.)
  if (
    pathname === '/health' ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|eot|otf)$/)
  ) {
    return NextResponse.next();
  }

  // ============================================
  // 1. SECURITY HEADERS
  // ============================================

  const response = NextResponse.next();

  // Add security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ============================================
  // 2. AUDIT LOGGING
  // ============================================

  const method = request.method;
  const scheme = request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const userAgent = request.headers.get('user-agent') || '';

  // Extract client IP
  let clientIp = '';
  const xForwardedFor =
    request.headers.get('x-original-forwarded-for') || request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    clientIp = xForwardedFor.split(',')[0].trim();
  }

  const cfClientIp = request.headers.get('cf-connecting-ip') || '';
  const requestSize = parseInt(request.headers.get('content-length') || '0', 10);

  // Get locale from searchParams for logging
  const locale = searchParams.get('lang') || 'en';

  // Calculate response time
  const endTime = Date.now();
  const latencyMs = endTime - startTime;

  // Build audit log object
  const auditLog: AuditLog = {
    Host: host,
    HttpMethod: method,
    StatusCode: response.status,
    Path: pathname,
    QueryString: search,
    UserAgent: userAgent,
    RequestSize: requestSize,
    ResponseSize: 0,
    LatencyMs: latencyMs,
    Scheme: scheme,
    ClientIp: clientIp,
    CfClientIp: cfClientIp,
    CustomStatus: response.headers.get('CUST_STATUS') || '',
    CustomDesc: response.status !== 200 ? response.statusText : '',
    Environment: process.env.RUNTIME_ENV || 'development',
    Locale: locale,
    userInfo: {},
  };

  // Log to console (structured JSON)
  console.log(JSON.stringify(auditLog));

  // Send to Redis (via the /api/audit-log route — proxy.ts runs on the Edge
  // runtime and can't use ioredis directly, see that route for why)
  await sendAuditLog(auditLog, request.nextUrl.origin);

  return response;
}

/**
 * Publishes the audit log to Redis via the internal /api/audit-log route.
 */
async function sendAuditLog(auditLog: AuditLog, origin: string): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/audit-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditLog),
    });

    if (!response.ok) {
      console.warn(`Failed to send audit log, status code = [${response.status}]`);
    }
  } catch (error) {
    console.error(
      'Error sending audit log:',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

// Configure which paths the proxy should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (handled separately)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, images, fonts
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|otf)$).*)',
  ],
};

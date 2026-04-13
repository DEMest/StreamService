import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/dashboard', '/admin'];

export function middleware(req: NextRequest) {
  const token = req.cookies.get('access_token');
  if (PROTECTED_PATHS.some((p) => req.nextUrl.pathname.startsWith(p)) && !token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };

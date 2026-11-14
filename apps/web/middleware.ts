// Cookie presence gate. A value continues even when it is unknown or expired.
// The Node handler still calls currentUserId(); this file does not open Postgres.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

const UNAUTHORIZED = {
  error: { code: "unauthorized", message: "A signed-in user is required" },
} as const;

function isStaticFile(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  const segment = pathname.split("/").pop() ?? "";
  return segment.includes(".");
}

function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login" || pathname === "/api/health") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/_next" || pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return isStaticFile(pathname);
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => {
    const value = request.cookies.get(name)?.value;
    return typeof value === "string" && value.length > 0;
  });
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || hasSessionCookie(request)) return NextResponse.next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login, 307);
}

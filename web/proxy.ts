// Runs before every page (Next.js 16's "proxy", formerly middleware).
// Handles Auth0's /auth/* routes and makes the host screen require signing in.
import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function proxy(request: NextRequest) {
  if (!auth0) return NextResponse.next(); // Auth0 isn't set up: no sign-in anywhere

  const response = await auth0.middleware(request);

  // Only the host screen needs an account. Players join with just a name.
  if (request.nextUrl.pathname.startsWith("/host") && !(await auth0.getSession(request))) {
    // First our own sign-in page (app/signin), which continues to Auth0.
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/signin";
    signIn.search = "";
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};

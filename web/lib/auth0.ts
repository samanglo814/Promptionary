import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Host sign-in with Auth0. Only on when the Auth0 settings are in web/.env (see .env.example);
// without them the host screen works with no sign-in, like before. Players never sign in.
export const auth0 =
  process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && process.env.AUTH0_SECRET
    ? new Auth0Client({
        // Back to the host screen after signing in.
        signInReturnToPath: "/host",
        // The /v2 logout endpoint accepts wildcard Allowed Logout URLs (*.trycloudflare.com).
        logoutStrategy: "v2",
      })
    : null;

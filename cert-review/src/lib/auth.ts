/**
 * Okta OIDC authentication via next-auth.
 * Authenticates against the Org Authorization Server to get a token
 * with okta.governance.reviewer.read/manage scopes.
 * Includes automatic token refresh when the access token expires.
 */

import type { NextAuthOptions } from 'next-auth';

const OKTA_DOMAIN = process.env.OKTA_DOMAIN || 'taskvantage.okta.com';

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: 'okta',
      name: 'Okta',
      type: 'oauth',
      wellKnown: `https://${OKTA_DOMAIN}/.well-known/openid-configuration`,
      clientId: process.env.OKTA_CLIENT_ID!,
      clientSecret: process.env.OKTA_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid profile email offline_access okta.governance.reviewer.read okta.governance.reviewer.manage',
        },
      },
      idToken: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: null,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account }) {
      // On initial sign-in, persist the tokens
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        return token;
      }

      // If token hasn't expired, return as-is
      if (token.expiresAt && (token.expiresAt as number) > Math.floor(Date.now() / 1000) + 60) {
        return token;
      }

      // Token expired — try to refresh
      if (token.refreshToken) {
        console.log('[Auth] Access token expired, refreshing...');
        try {
          const response = await fetch(`https://${OKTA_DOMAIN}/oauth2/v1/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: token.refreshToken as string,
              client_id: process.env.OKTA_CLIENT_ID!,
              client_secret: process.env.OKTA_CLIENT_SECRET!,
            }),
          });

          const data = await response.json();

          if (data.access_token) {
            console.log('[Auth] Token refreshed successfully');
            token.accessToken = data.access_token;
            token.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
            if (data.refresh_token) {
              token.refreshToken = data.refresh_token;
            }
            return token;
          }

          console.error('[Auth] Refresh failed:', data);
        } catch (error) {
          console.error('[Auth] Refresh error:', error);
        }
      }

      // Refresh failed — mark as expired so the UI can redirect to login
      console.log('[Auth] Token expired and refresh failed');
      token.error = 'TokenExpired';
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

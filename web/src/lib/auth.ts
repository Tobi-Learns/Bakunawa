// 5c: Auth.js (NextAuth v5) + Google — the profile binder's identity layer.
// Locked decisions (Phase 5): Auth.js NOT Supabase Auth; JWT sessions (no DB
// session tables); Google is an organizational binder — no wallet is created
// here (Freighter attach-on-signup; the Google-based wallet is D13).
// Ported from the InvoiceFi pattern minus wallet generation.

import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "./db";

declare module "next-auth" {
  interface Session {
    user: {
      userId?: string;
      googleSub?: string;
      displayName?: string | null;
    } & DefaultSession["user"];
  }
}

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

/** True when Google OAuth is configured — the UI hides sign-in otherwise. */
export const authConfigured = Boolean(googleClientId && googleClientSecret);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  providers: authConfigured
    ? [Google({ clientId: googleClientId, clientSecret: googleClientSecret })]
    : [],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) return false;
      try {
        await db.user.upsert({
          where: { googleSub: account.providerAccountId },
          update: { email: user.email, name: user.name ?? null, image: user.image ?? null },
          create: {
            googleSub: account.providerAccountId,
            email: user.email,
            name: user.name ?? null,
            image: user.image ?? null,
          },
        });
        return true;
      } catch (err) {
        console.error("sign-in user upsert failed:", err);
        return false;
      }
    },
    async jwt({ token, account }) {
      // account is present only on the initial sign-in
      if (account?.provider === "google") {
        token.googleSub = account.providerAccountId;
        const u = await db.user.findUnique({
          where: { googleSub: account.providerAccountId },
        });
        if (u) token.userId = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.userId = token.userId as string;
      if (token.googleSub) session.user.googleSub = token.googleSub as string;
      return session;
    },
  },
});

/** Resolve the signed-in DB user from a route handler; null when signed out. */
export async function currentUser() {
  const session = await auth();
  const userId = session?.user?.userId;
  if (!userId) return null;
  return db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
}

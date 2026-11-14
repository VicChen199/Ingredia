import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@project/db";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const prismaAdapter = PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]);

const nextAuth = NextAuth({
  adapter: {
    ...prismaAdapter,
    linkAccount(account) {
      // Google is an OIDC provider. The stored Account type is oauth.
      return prismaAdapter.linkAccount?.({ ...account, type: "oauth" });
    },
  },
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      const rawExpires = session.expires as Date | string;
      const expires = rawExpires instanceof Date ? rawExpires.toISOString() : rawExpires;
      return {
        expires,
        user: {
          id: session.user.id,
          name: user.name ?? null,
          email: user.email ?? null,
          image: user.image ?? null,
        },
      };
    },
  },
});

export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

export async function auth(): Promise<{
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
} | null> {
  const session = await nextAuth.auth();
  const id = session?.user?.id;
  if (!id) return null;
  return {
    user: {
      id,
      name: session.user?.name ?? null,
      email: session.user?.email ?? null,
      image: session.user?.image ?? null,
    },
  };
}

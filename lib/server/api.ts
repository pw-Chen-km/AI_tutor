import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';

export type AuthenticatedSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
} & Record<string, unknown>;

export async function requireUserSession() {
  const session = await getServerSession(authOptions) as AuthenticatedSession | null;
  if (!session?.user?.id) {
    return { session: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { session: session as AuthenticatedSession, response: null };
}

export async function requireAdminSession() {
  const auth = await requireUserSession();
  if (auth.response || !auth.session) return auth;

  const user = await prisma.user.findUnique({
    where: { id: auth.session.user.id },
    select: { isAdmin: true, isSuperUser: true },
  });

  if (!user?.isAdmin && !user?.isSuperUser) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }),
    };
  }

  return { session: auth.session, response: null };
}

export function publicErrorMessage(error: unknown, fallback = 'Request failed') {
  if (error instanceof Error && error.message && process.env.NODE_ENV !== 'production') {
    return error.message;
  }
  return fallback;
}

export function logServerError(label: string, error: unknown) {
  if (process.env.NODE_ENV === 'production') {
    const message = error instanceof Error ? error.message : String(error);
    console.error(label, message);
    return;
  }
  console.error(label, error);
}

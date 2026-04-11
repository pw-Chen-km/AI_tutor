import prisma from '../client';
import { PLAN_CONFIG } from '../schema';
import type { User, Subscription } from '@prisma/client';

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
  });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserWithSubscription(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
    },
  });
}

export async function createUser(data: {
  email: string;
  name?: string;
  image?: string;
  passwordHash?: string;
}): Promise<User> {
  return prisma.user.create({
    data: {
      ...data,
      // Create a free subscription by default
      subscription: {
        create: {
          plan: 'free',
          status: 'active',
          tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
        },
      },
    },
  });
}

export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'name' | 'image' | 'emailVerified'>>
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({
    where: { id },
  });
}

// Called by NextAuth when a new OAuth user signs up
export async function createUserWithOAuth(data: {
  email: string;
  name?: string;
  image?: string;
  emailVerified?: Date;
}): Promise<User> {
  return prisma.user.create({
    data: {
      ...data,
      subscription: {
        create: {
          plan: 'free',
          status: 'active',
          tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
        },
      },
    },
  });
}

export async function verifyEmail(userId: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      emailVerified: new Date(),
    },
  });
}

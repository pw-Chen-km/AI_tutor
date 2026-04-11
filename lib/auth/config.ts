import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { compare } from 'bcryptjs';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  
  providers: [
    // Google OAuth Provider
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    
    // Email/Password Credentials Provider
    CredentialsProvider({
      id: 'credentials',
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Please enter your email and password');
        }
        
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { subscription: true },
        });
        
        if (!user) {
          throw new Error('No user found with this email');
        }
        
        if (!user.passwordHash) {
          throw new Error('Please sign in with Google');
        }
        
        const isValid = await compare(credentials.password, user.passwordHash);
        
        if (!isValid) {
          throw new Error('Invalid password');
        }
        
        if (!user.emailVerified) {
          throw new Error('Please verify your email before signing in');
        }
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  
  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login',
    verifyRequest: '/verify-email',
    newUser: '/dashboard',
  },
  
  callbacks: {
    async signIn({ user, account }) {
      // For OAuth sign-ins, check if we need to create a subscription
      if (account?.provider === 'google') {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
          include: { subscription: true },
        });
        
        // If user exists but has no subscription, create one
        if (existingUser && !existingUser.subscription) {
          await prisma.subscription.create({
            data: {
              userId: existingUser.id,
              plan: 'free',
              status: 'active',
              tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
            },
          });
        }
      }
      return true;
    },
    
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
      }
      
      // Handle session updates
      if (trigger === 'update' && session) {
        return { ...token, ...session };
      }
      
      // Always fetch latest user info to ensure admin status is up to date
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isAdmin: true, isSuperUser: true },
        });
        if (dbUser) {
          token.isAdmin = dbUser.isAdmin;
          token.isSuperUser = dbUser.isSuperUser;
        }
      }
      
      return token;
    },
    
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = token.isAdmin || false;
        session.user.isSuperUser = token.isSuperUser || false;
        
        // Fetch subscription info
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: { subscription: true },
        });
        
        if (user?.subscription) {
          session.user.subscription = {
            plan: user.subscription.plan,
            status: user.subscription.status,
            tokensUsed: Number(user.subscription.tokensUsed),
            tokensLimit: Number(user.subscription.tokensLimit),
          };
        }
      }
      return session;
    },
  },
  
  events: {
    async createUser({ user }) {
      // Create a free subscription for new users
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: 'free',
          status: 'active',
          tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
        },
      });
    },
  },
  
  debug: process.env.NODE_ENV === 'development',
};

// Extend NextAuth types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isAdmin?: boolean;
      isSuperUser?: boolean;
      subscription?: {
        plan: string;
        status: string;
        tokensUsed: number;
        tokensLimit: number;
      };
    };
  }
  
  interface User {
    id: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    isAdmin?: boolean;
    isSuperUser?: boolean;
  }
}

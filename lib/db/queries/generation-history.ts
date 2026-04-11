import prisma from '../client';
import { PLAN_CONFIG } from '../schema';
import { sendGeneratedFileEmail } from '@/lib/auth/email';
import type { GenerationHistory } from '@prisma/client';

const MAX_HISTORY_FILES = 50;

export interface CreateGenerationHistoryInput {
  userId: string;
  module: string;
  title: string;
  format: string;
  fileUrl: string;
  fileSize: number;
  metadata?: Record<string, any>;
}

/**
 * Get user's generation history
 */
export async function getGenerationHistory(
  userId: string,
  limit: number = 50
): Promise<GenerationHistory[]> {
  return prisma.generationHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get count of user's generation history files
 */
export async function getGenerationHistoryCount(userId: string): Promise<number> {
  return prisma.generationHistory.count({
    where: { userId },
  });
}

/**
 * Check if user has generation history feature (Premium only)
 */
export async function hasGenerationHistoryFeature(userId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true },
  });
  
  if (!subscription) return false;
  
  const planConfig = PLAN_CONFIG[subscription.plan as keyof typeof PLAN_CONFIG];
  return planConfig?.features?.generationHistory ?? false;
}

/**
 * Create a new generation history entry
 * If user exceeds 50 files, delete oldest and send to email
 */
export async function createGenerationHistory(
  input: CreateGenerationHistoryInput
): Promise<{ created: GenerationHistory; deletedFile?: GenerationHistory; emailSent?: boolean }> {
  // Check if user has the feature
  const hasFeature = await hasGenerationHistoryFeature(input.userId);
  if (!hasFeature) {
    throw new Error('Generation history is only available for Premium users');
  }
  
  // Get current count
  const currentCount = await getGenerationHistoryCount(input.userId);
  
  let deletedFile: GenerationHistory | undefined;
  let emailSent = false;
  
  // If at limit, delete oldest file and send to email
  if (currentCount >= MAX_HISTORY_FILES) {
    const oldestFile = await prisma.generationHistory.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: 'asc' },
    });
    
    if (oldestFile) {
      // Get user email for sending the archived file
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true },
      });
      
      // Send email with the file before deletion
      if (user?.email) {
        try {
          await sendGeneratedFileEmail(user.email, {
            userName: user.name || undefined,
            fileName: oldestFile.title,
            module: oldestFile.module,
            format: oldestFile.format,
            fileUrl: oldestFile.fileUrl,
            createdAt: oldestFile.createdAt,
          });
          emailSent = true;
        } catch (error) {
          console.error('Failed to send archived file email:', error);
        }
      }
      
      // Mark as sent to email before deletion
      deletedFile = await prisma.generationHistory.update({
        where: { id: oldestFile.id },
        data: { sentToEmail: emailSent },
      });
      
      // Delete the file from history
      await prisma.generationHistory.delete({
        where: { id: oldestFile.id },
      });
    }
  }
  
  // Create new entry
  const created = await prisma.generationHistory.create({
    data: {
      userId: input.userId,
      module: input.module,
      title: input.title,
      format: input.format,
      fileUrl: input.fileUrl,
      fileSize: input.fileSize,
      metadata: input.metadata,
    },
  });
  
  return { created, deletedFile, emailSent };
}

/**
 * Delete a specific generation history entry
 */
export async function deleteGenerationHistory(
  userId: string,
  historyId: string
): Promise<GenerationHistory | null> {
  // Verify ownership
  const history = await prisma.generationHistory.findFirst({
    where: { id: historyId, userId },
  });
  
  if (!history) return null;
  
  return prisma.generationHistory.delete({
    where: { id: historyId },
  });
}

/**
 * Delete all generation history for a user
 */
export async function clearAllGenerationHistory(userId: string): Promise<number> {
  const result = await prisma.generationHistory.deleteMany({
    where: { userId },
  });
  
  return result.count;
}

/**
 * Get a single generation history entry by ID
 */
export async function getGenerationHistoryById(
  userId: string,
  historyId: string
): Promise<GenerationHistory | null> {
  return prisma.generationHistory.findFirst({
    where: { id: historyId, userId },
  });
}

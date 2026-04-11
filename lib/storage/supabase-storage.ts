import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for storage operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Use service role key for server-side operations (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const BUCKET_NAME = 'generation-history';

export interface UploadResult {
  success: boolean;
  fileUrl?: string;
  error?: string;
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  userId: string,
  filename: string,
  fileData: Buffer | Blob | ArrayBuffer | Uint8Array,
  contentType: string
): Promise<UploadResult> {
  try {
    // Generate unique file path: userId/timestamp-filename
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${userId}/${timestamp}-${safeName}`;
    
    // Convert to Uint8Array for consistent handling
    let uploadData: Uint8Array;
    if (fileData instanceof ArrayBuffer) {
      uploadData = new Uint8Array(fileData);
    } else if (fileData instanceof Uint8Array) {
      uploadData = fileData;
    } else if (Buffer.isBuffer(fileData)) {
      uploadData = new Uint8Array(fileData);
    } else if (fileData instanceof Blob) {
      uploadData = new Uint8Array(await fileData.arrayBuffer());
    } else {
      uploadData = new Uint8Array(fileData as ArrayBuffer);
    }
    
    // Upload file
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, uploadData, {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });
    
    if (error) {
      console.error('Upload error:', error);
      return { success: false, error: error.message };
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);
    
    return {
      success: true,
      fileUrl: urlData.publicUrl,
    };
  } catch (error: any) {
    console.error('Upload exception:', error);
    return { success: false, error: error.message || 'Upload failed' };
  }
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(fileUrl: string): Promise<boolean> {
  try {
    // Extract file path from URL
    const url = new URL(fileUrl);
    const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/generation-history\/(.+)/);
    
    if (!pathMatch) {
      console.error('Invalid file URL format');
      return false;
    }
    
    const filePath = decodeURIComponent(pathMatch[1]);
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);
    
    if (error) {
      console.error('Delete error:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Delete exception:', error);
    return false;
  }
}

/**
 * Get content type from file extension
 */
export function getContentType(format: string): string {
  const contentTypes: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    json: 'application/json',
    zip: 'application/zip',
  };
  
  return contentTypes[format.toLowerCase()] || 'application/octet-stream';
}

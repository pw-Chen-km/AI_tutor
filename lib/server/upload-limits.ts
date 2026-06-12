export const UPLOAD_LIMITS = {
  maxSingleFileBytes: 30 * 1024 * 1024,
  maxZipBytes: 60 * 1024 * 1024,
  maxZipEntries: 200,
  maxExtractedFileBytes: 20 * 1024 * 1024,
  maxExtractedTotalBytes: 120 * 1024 * 1024,
};

export const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'xlsx',
  'xls',
  'csv',
  'txt',
  'md',
  'json',
  'tsv',
  'xml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'cpp',
  'c',
  'h',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'zip',
]);

export function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || 'unknown';
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function validateUploadFile(fileName: string, size: number, options?: { archive?: boolean }) {
  const ext = getFileExtension(fileName);
  if (!SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) {
    return `Unsupported file type: ${ext}`;
  }
  const limit = options?.archive ? UPLOAD_LIMITS.maxZipBytes : UPLOAD_LIMITS.maxSingleFileBytes;
  if (size > limit) {
    return `File is too large (${formatBytes(size)}). Maximum allowed is ${formatBytes(limit)}.`;
  }
  return '';
}


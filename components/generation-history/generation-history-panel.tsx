'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  History,
  Download,
  Trash2,
  FileText,
  FileSpreadsheet,
  File,
  Loader2,
  AlertCircle,
  Crown,
  X,
} from 'lucide-react';

interface GenerationHistoryItem {
  id: string;
  module: string;
  title: string;
  format: string;
  fileUrl: string;
  fileSize: number;
  metadata: any;
  sentToEmail: boolean;
  createdAt: string;
}

interface GenerationHistoryResponse {
  hasFeature: boolean;
  message?: string;
  history: GenerationHistoryItem[];
  count: number;
  limit: number;
}

const MODULE_NAMES: Record<string, string> = {
  drills: 'In-Class Drills',
  labs: 'Lab Practices',
  homework: 'Homework',
  exams: 'Exam Generator',
  lecture_rehearsal: 'Lecture Rehearsal',
  exam_evaluation: 'Exam Evaluation',
};

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  docx: <FileText className="w-5 h-5 text-blue-500" />,
  pptx: <FileSpreadsheet className="w-5 h-5 text-orange-500" />,
  pdf: <File className="w-5 h-5 text-red-500" />,
  json: <File className="w-5 h-5 text-green-500" />,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GenerationHistoryPanel({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<GenerationHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/generation-history');
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch generation history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this file from history?')) return;
    
    setDeleting(id);
    try {
      const response = await fetch(`/api/generation-history?id=${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchHistory();
      }
    } catch (error) {
      console.error('Failed to delete history item:', error);
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL files from your history? This action cannot be undone.')) return;
    
    setClearingAll(true);
    try {
      const response = await fetch('/api/generation-history?clearAll=true', {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchHistory();
      }
    } catch (error) {
      console.error('Failed to clear history:', error);
    } finally {
      setClearingAll(false);
    }
  };

  const handleDownload = (item: GenerationHistoryItem) => {
    window.open(item.fileUrl, '_blank');
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.hasFeature) {
    return (
      <Card className="w-full">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Generation History
            </CardTitle>
            <CardDescription>Premium Feature</CardDescription>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <Crown className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Premium Feature</h3>
            <p className="text-muted-foreground max-w-sm">
              Generation History is available for Premium users. Upgrade to save up to 50 generated files for easy re-download.
            </p>
            <Button className="mt-6" onClick={() => window.location.href = '/billing'}>
              Upgrade to Premium
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Generation History
          </CardTitle>
          <CardDescription>
            {data.count} / {data.limit} files stored
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {data.count > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              disabled={clearingAll}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              {clearingAll ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Clear All
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.count === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <History className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No files yet</h3>
            <p className="text-muted-foreground max-w-sm">
              Your generated files will appear here after you export them. Files are automatically saved when you export content.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {data.history.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <div className="flex-shrink-0">
                  {FORMAT_ICONS[item.format.toLowerCase()] || <File className="w-5 h-5 text-gray-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {MODULE_NAMES[item.module] || item.module} • {item.format.toUpperCase()} • {formatFileSize(item.fileSize)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(item)}
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(item.id)}
                    disabled={deleting === item.id}
                    title="Delete"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    {deleting === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {data.count >= data.limit && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Your history is full. When you export new files, the oldest ones will be automatically sent to your email before being removed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

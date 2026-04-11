'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

/**
 * 組件：自動刷新 session 以獲取最新的用戶資訊
 * 當用戶權限變更時，需要重新登入或刷新 session
 */
export function SessionRefresh() {
  const { data: session, update } = useSession();

  useEffect(() => {
    // 每 30 秒檢查一次並更新 session（僅在開發環境）
    if (process.env.NODE_ENV === 'development') {
      const interval = setInterval(() => {
        update();
      }, 30000); // 30 秒

      return () => clearInterval(interval);
    }
  }, [update]);

  return null;
}

# Google OAuth 設定指南

## 🔴 錯誤：redirect_uri_mismatch

這個錯誤表示 Google Cloud Console 中配置的重定向 URI 與應用程式實際使用的 URI 不匹配。

## ✅ 解決步驟

### 步驟 1：確認環境變數

確保 `.env` 檔案中有以下設定：

```env
# 開發環境
NEXTAUTH_URL="http://localhost:3000"

# 生產環境（部署後）
NEXTAUTH_URL="https://yourdomain.com"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
NEXTAUTH_SECRET="your-secret-key-here-minimum-32-characters-long"
```

### 步驟 2：在 Google Cloud Console 設定重定向 URI

1. **前往 Google Cloud Console**
   - 訪問：https://console.cloud.google.com/apis/credentials
   - 選擇您的專案

2. **找到您的 OAuth 2.0 客戶端 ID**
   - 點擊您建立的 OAuth 2.0 客戶端 ID（用於 Web 應用程式）

3. **設定授權的重新導向 URI**
   
   在「已授權的重新導向 URI」區塊中，**必須**添加以下 URI：

   **開發環境：**
   ```
   http://localhost:3000/api/auth/callback/google
   ```

   **生產環境：**
   ```
   https://yourdomain.com/api/auth/callback/google
   ```

   ⚠️ **重要注意事項：**
   - URI 必須**完全匹配**，包括：
     - 協議（http:// 或 https://）
     - 主機名稱（localhost:3000 或 yourdomain.com）
     - 路徑（/api/auth/callback/google）
   - 不能有多餘的斜線或空格
   - 如果使用自訂端口，必須包含端口號

4. **儲存變更**
   - 點擊「儲存」
   - 等待幾分鐘讓變更生效（通常立即生效，但有時需要 1-2 分鐘）

### 步驟 3：驗證設定

1. **確認 URI 格式正確**
   - NextAuth 的 callback URL 格式：`{NEXTAUTH_URL}/api/auth/callback/google`
   - 如果 `NEXTAUTH_URL="http://localhost:3000"`
   - 則 callback URL 應該是：`http://localhost:3000/api/auth/callback/google`

2. **檢查應用程式類型**
   - 確保您建立的是「Web 應用程式」類型的 OAuth 2.0 客戶端 ID
   - 不是「桌面應用程式」或「行動應用程式」

3. **重新啟動開發伺服器**
   ```bash
   # 停止目前的伺服器（Ctrl+C）
   # 然後重新啟動
   npm run dev
   ```

### 步驟 4：常見問題排查

#### 問題 1：仍然出現 redirect_uri_mismatch

**可能原因：**
- Google Cloud Console 中的 URI 與 `NEXTAUTH_URL` 不匹配
- 環境變數沒有正確載入
- 快取問題

**解決方法：**
1. 檢查 `.env` 檔案中的 `NEXTAUTH_URL` 是否正確
2. 確認 Google Cloud Console 中的 URI 與 `NEXTAUTH_URL/api/auth/callback/google` 完全一致
3. 清除瀏覽器快取和 cookies
4. 重新啟動開發伺服器

#### 問題 2：本地開發使用不同端口

如果您使用非 3000 的端口（例如 3001），需要：

1. 更新 `.env`：
   ```env
   NEXTAUTH_URL="http://localhost:3001"
   ```

2. 在 Google Cloud Console 中添加對應的 URI：
   ```
   http://localhost:3001/api/auth/callback/google
   ```

#### 問題 3：生產環境部署

部署到生產環境時：

1. 更新 `.env` 或環境變數：
   ```env
   NEXTAUTH_URL="https://yourdomain.com"
   ```

2. 在 Google Cloud Console 中添加生產環境 URI：
   ```
   https://yourdomain.com/api/auth/callback/google
   ```

3. 可以同時保留開發和生產環境的 URI：
   ```
   http://localhost:3000/api/auth/callback/google
   https://yourdomain.com/api/auth/callback/google
   ```

## 📋 完整檢查清單

- [ ] `.env` 檔案中有 `NEXTAUTH_URL` 設定
- [ ] `.env` 檔案中有 `GOOGLE_CLIENT_ID` 設定
- [ ] `.env` 檔案中有 `GOOGLE_CLIENT_SECRET` 設定
- [ ] `.env` 檔案中有 `NEXTAUTH_SECRET` 設定（至少 32 個字元）
- [ ] Google Cloud Console 中已建立「Web 應用程式」類型的 OAuth 2.0 客戶端 ID
- [ ] Google Cloud Console 中的重定向 URI 與 `{NEXTAUTH_URL}/api/auth/callback/google` 完全匹配
- [ ] 已重新啟動開發伺服器
- [ ] 已清除瀏覽器快取

## 🔍 驗證設定是否正確

執行以下命令檢查環境變數：

```bash
npm run check:env
```

或手動檢查：

```bash
# Windows PowerShell
$env:NEXTAUTH_URL
$env:GOOGLE_CLIENT_ID

# Linux/Mac
echo $NEXTAUTH_URL
echo $GOOGLE_CLIENT_ID
```

## 📞 需要幫助？

如果問題仍然存在，請檢查：

1. **瀏覽器控制台**：查看是否有其他錯誤訊息
2. **終端機輸出**：查看 NextAuth 的 debug 訊息（如果啟用）
3. **Google Cloud Console**：確認 OAuth 同意畫面已設定完成

---

**最後更新：** 2025-01-03

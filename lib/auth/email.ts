import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Brand name constant
const BRAND_NAME = 'AsKura, Your Educational Tutor';
const BRAND_SHORT = 'AsKura';

// Module display names
const MODULE_NAMES: Record<string, string> = {
  drills: 'In-Class Drills',
  labs: 'Lab Practices',
  homework: 'Homework',
  exams: 'Exam Generator',
  lecture_rehearsal: 'Lecture Rehearsal',
  exam_evaluation: 'Exam Evaluation',
};

export async function sendVerificationEmail(email: string, token: string) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;
  
  await resend.emails.send({
    from: process.env.EMAIL_FROM || `${BRAND_SHORT} <noreply@example.com>`,
    to: email,
    subject: `Verify your email - ${BRAND_SHORT}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Verify your email</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; }
            .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
            .content { background: #f9fafb; border-radius: 8px; padding: 30px; margin: 20px 0; }
            .button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .button:hover { background: #4f46e5; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🎓 ${BRAND_NAME}</div>
            </div>
            <div class="content">
              <h2>Verify your email address</h2>
              <p>Thank you for signing up! Please click the button below to verify your email address and activate your account.</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" class="button">Verify Email</a>
              </p>
              <p style="font-size: 14px; color: #6b7280;">
                If you didn't create an account, you can safely ignore this email.
              </p>
              <p style="font-size: 14px; color: #6b7280;">
                This link will expire in 24 hours.
              </p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${BRAND_SHORT}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  
  await resend.emails.send({
    from: process.env.EMAIL_FROM || `${BRAND_SHORT} <noreply@example.com>`,
    to: email,
    subject: `Reset your password - ${BRAND_SHORT}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Reset your password</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; }
            .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
            .content { background: #f9fafb; border-radius: 8px; padding: 30px; margin: 20px 0; }
            .button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🎓 ${BRAND_NAME}</div>
            </div>
            <div class="content">
              <h2>Reset your password</h2>
              <p>We received a request to reset your password. Click the button below to create a new password.</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              <p style="font-size: 14px; color: #6b7280;">
                If you didn't request a password reset, you can safely ignore this email.
              </p>
              <p style="font-size: 14px; color: #6b7280;">
                This link will expire in 1 hour.
              </p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${BRAND_SHORT}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

export async function sendTrialAccountSetupEmail(
  email: string, 
  token: string, 
  options: {
    name?: string;
    plan: string;
    trialDays: number;
    trialEndsAt: Date;
  }
) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const setupUrl = `${baseUrl}/setup-password?token=${token}&email=${encodeURIComponent(email)}`;
  
  const planDisplayName = options.plan === 'pro' ? 'Pro' : 'Plus';
  const greeting = options.name ? `Hi ${options.name},` : 'Hi there,';
  const trialEndDate = options.trialEndsAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  
  await resend.emails.send({
    from: process.env.EMAIL_FROM || `${BRAND_SHORT} <noreply@example.com>`,
    to: email,
    subject: `🎁 Your ${BRAND_SHORT} ${planDisplayName} Trial Account is Ready!`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to ${BRAND_SHORT}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px 12px 0 0; }
            .logo { font-size: 24px; font-weight: bold; color: white; }
            .content { background: #f9fafb; border-radius: 0 0 12px 12px; padding: 30px; margin: 0; }
            .highlight-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .plan-badge { display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 600; }
            .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
            .info-row:last-child { border-bottom: none; }
            .info-label { color: #6b7280; }
            .info-value { font-weight: 500; color: #111827; }
            .button { display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; }
            .button:hover { opacity: 0.9; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
            .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-top: 20px; color: #92400e; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🎓 ${BRAND_NAME}</div>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Welcome to Your Trial Account</p>
            </div>
            <div class="content">
              <p style="font-size: 18px;">${greeting}</p>
              <p>Thank you for your interest in ${BRAND_SHORT}! We've set up a <span class="plan-badge">${planDisplayName}</span> trial account for you.</p>
              
              <div class="highlight-box">
                <h3 style="margin-top: 0; color: #6366f1;">📋 Your Trial Details</h3>
                <div class="info-row">
                  <span class="info-label">Trial Plan:</span>
                  <span class="info-value">${planDisplayName} Plan</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Trial Duration:</span>
                  <span class="info-value">${options.trialDays} days</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Expires On:</span>
                  <span class="info-value">${trialEndDate}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Login Email:</span>
                  <span class="info-value">${email}</span>
                </div>
              </div>
              
              <p>Click the button below to set up your password and start using ${BRAND_SHORT}:</p>
              
              <p style="text-align: center; margin: 30px 0;">
                <a href="${setupUrl}" class="button">Set Password & Get Started</a>
              </p>
              
              <div class="warning">
                ⏰ <strong>Important:</strong> This link will expire in 48 hours. Please complete your password setup as soon as possible.
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                If you have any questions, feel free to reach out to our support team.
              </p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${BRAND_SHORT}. All rights reserved.</p>
              <p style="font-size: 12px;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${setupUrl}" style="color: #6366f1; word-break: break-all;">${setupUrl}</a></p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

/**
 * Send generated file to user's email when it's auto-deleted from history
 * (Premium feature: files are auto-sent when history exceeds 50 files)
 */
export async function sendGeneratedFileEmail(
  email: string,
  options: {
    userName?: string;
    fileName: string;
    module: string;
    format: string;
    fileUrl: string;
    createdAt: Date;
  }
) {
  const greeting = options.userName ? `Hi ${options.userName},` : 'Hi there,';
  const moduleName = MODULE_NAMES[options.module] || options.module;
  const createdDate = options.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  await resend.emails.send({
    from: process.env.EMAIL_FROM || `${BRAND_SHORT} <noreply@example.com>`,
    to: email,
    subject: `📁 Your ${moduleName} file has been archived - ${BRAND_SHORT}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Your file has been archived</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; background: linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%); border-radius: 12px 12px 0 0; }
            .logo { font-size: 24px; font-weight: bold; color: white; }
            .content { background: #f9fafb; border-radius: 0 0 12px 12px; padding: 30px; margin: 0; }
            .file-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .file-icon { font-size: 48px; text-align: center; margin-bottom: 10px; }
            .file-name { font-size: 18px; font-weight: 600; color: #111827; text-align: center; word-break: break-word; }
            .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
            .info-row:last-child { border-bottom: none; }
            .info-label { color: #6b7280; }
            .info-value { font-weight: 500; color: #111827; }
            .button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; }
            .button:hover { opacity: 0.9; }
            .notice { background: #dbeafe; border: 1px solid #3b82f6; border-radius: 8px; padding: 12px; margin-top: 20px; color: #1e40af; font-size: 14px; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🎓 ${BRAND_NAME}</div>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">File Archive Notification</p>
            </div>
            <div class="content">
              <p style="font-size: 18px;">${greeting}</p>
              <p>Your generation history has reached the 50-file limit. The following file has been automatically archived and removed from your history:</p>
              
              <div class="file-box">
                <div class="file-icon">${getFileIcon(options.format)}</div>
                <div class="file-name">${options.fileName}</div>
                <div style="margin-top: 15px;">
                  <div class="info-row">
                    <span class="info-label">Module:</span>
                    <span class="info-value">${moduleName}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Format:</span>
                    <span class="info-value">${options.format.toUpperCase()}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Created:</span>
                    <span class="info-value">${createdDate}</span>
                  </div>
                </div>
              </div>
              
              <p style="text-align: center; margin: 30px 0;">
                <a href="${options.fileUrl}" class="button">Download File</a>
              </p>
              
              <div class="notice">
                💡 <strong>Tip:</strong> This download link will remain valid for 30 days. After that, the file will be permanently deleted from our servers.
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                To manage your generation history and prevent auto-archiving, you can manually delete files from your history in the dashboard.
              </p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${BRAND_SHORT}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

// Helper function to get file icon based on format
function getFileIcon(format: string): string {
  const icons: Record<string, string> = {
    docx: '📝',
    pptx: '📊',
    pdf: '📄',
    json: '📋',
  };
  return icons[format.toLowerCase()] || '📁';
}

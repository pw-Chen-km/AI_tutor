# AI Teaching Assistant Platform - Startup Script (Windows PowerShell)
Write-Host "🚀 AI Teaching Assistant Platform - Starting..." -ForegroundColor Cyan
Write-Host ""

# Refresh environment variables
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Check if node_modules exists
if (-Not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Host "✅ Dependencies ready!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Starting development server..." -ForegroundColor Cyan
Write-Host "📍 The application will open at: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Instructions:" -ForegroundColor Yellow
Write-Host "   1. Configure your API key in the LLM Settings" -ForegroundColor White
Write-Host "   2. Upload course materials (PDF, DOCX, XLSX, etc.)" -ForegroundColor White
Write-Host "   3. Select a module (Drills, Labs, Homework, or Exams)" -ForegroundColor White
Write-Host "   4. Generate educational content!" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the development server
npm run dev

# Clean and Restart Script for Next.js
Write-Host "🧹 Cleaning Next.js cache..." -ForegroundColor Cyan

# Kill any Node.js processes that might be blocking (especially on ports 3000-3001)
Write-Host "Checking for processes using ports 3000-3001..." -ForegroundColor Yellow
try {
    $ports3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    $ports3001 = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    $portProcesses = ($ports3000 + $ports3001) | Select-Object -Unique
    
    if ($portProcesses) {
        Write-Host "Found processes using ports 3000-3001: $($portProcesses -join ', ')" -ForegroundColor Yellow
        foreach ($procId in $portProcesses) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq "node") {
                Write-Host "Stopping Node.js process $procId..." -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Seconds 2
    }
} catch {
    Write-Host "Could not check ports (may require admin): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Stop all Node.js processes as fallback
Write-Host "Stopping remaining Node.js processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node.js processes. Stopping them..." -ForegroundColor Yellow
    $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Remove lock file first
if (Test-Path ".next\dev\lock") {
    Write-Host "Removing lock file..." -ForegroundColor Yellow
    Remove-Item -Force ".next\dev\lock" -ErrorAction SilentlyContinue
}

# Remove .next directory
if (Test-Path ".next") {
    Write-Host "Removing .next directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
    Write-Host "✅ .next directory removed" -ForegroundColor Green
}

# Clear npm cache (optional)
# npm cache clean --force

Write-Host ""
Write-Host "🚀 Starting fresh development server..." -ForegroundColor Cyan
Write-Host ""

# Start dev server
npm run dev

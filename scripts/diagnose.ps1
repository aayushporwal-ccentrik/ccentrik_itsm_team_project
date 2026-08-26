<#
.SYNOPSIS
    10-minute environment diagnostic for the ITSM CAP + UI5 app.
    Run before asking a teammate for help with a "works on their laptop, not mine" issue.
    Prints only presence/shape of secrets, never their values.
.USAGE
    powershell -ExecutionPolicy Bypass -File .\scripts\diagnose.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Section($title) {
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Cyan
}

Section "Versions"
Write-Host "node:   $(node -v)"
Write-Host "npm:    $(npm -v)"
Write-Host "cds:    $(cds -v)"
Write-Host "OS:     $([Environment]::OSVersion.VersionString)"
Write-Host "PWSH:   $($PSVersionTable.PSVersion)"

Section "Git state"
Write-Host "Branch: $(git branch --show-current)"
Write-Host "HEAD:   $(git rev-parse HEAD)"
Write-Host "Status:"
git status --short
Write-Host "Ahead/behind origin/main:"
git rev-list --left-right --count origin/main...HEAD 2>$null

Section "Dependency state"
if (Test-Path node_modules) {
    Write-Host "node_modules: present"
} else {
    Write-Host "node_modules: MISSING - run npm ci" -ForegroundColor Yellow
}
$lockDiff = git diff --stat origin/main -- package-lock.json 2>$null
if ($lockDiff) {
    Write-Host "package-lock.json differs from origin/main:" -ForegroundColor Yellow
    Write-Host $lockDiff
} else {
    Write-Host "package-lock.json: matches origin/main"
}

Section ".env (keys only, no values)"
if (Test-Path .env) {
    $required = @('JWT_SECRET','JWT_ISSUER','JWT_AUDIENCE','JWT_ACCESS_TOKEN_EXPIRY','APP_URL','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM')
    $envKeys = (Get-Content .env | Select-String '^\s*([A-Z_]+)\s*=\s*(.*)$') | ForEach-Object {
        $_.Matches[0].Groups[1].Value
    }
    foreach ($key in $required) {
        if ($envKeys -contains $key) {
            $hasValue = (Get-Content .env | Select-String "^\s*$key\s*=\s*\S").Count -gt 0
            if ($hasValue) {
                Write-Host "  $key : set"
            } else {
                Write-Host "  $key : present but EMPTY" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  $key : MISSING" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host ".env file MISSING - copy .env.example to .env and fill it in" -ForegroundColor Yellow
    Write-Host "Without JWT_SECRET, tokens use a random per-process secret and die on every restart." -ForegroundColor Yellow
}

Section "Local SQLite DB"
if (Test-Path db\itsm.sqlite) {
    $dbTime = (Get-Item db\itsm.sqlite).LastWriteTime
    $schemaTime = (Get-Item db\schema.cds).LastWriteTime
    Write-Host "db\itsm.sqlite last written: $dbTime"
    Write-Host "db\schema.cds last written:  $schemaTime"
    if ($dbTime -lt $schemaTime) {
        Write-Host "  DB is OLDER than schema.cds - run: npx cds deploy --to sqlite:db/itsm.sqlite" -ForegroundColor Yellow
    } else {
        Write-Host "  DB is up to date relative to schema.cds"
    }
} else {
    Write-Host "db\itsm.sqlite MISSING - run: npx cds deploy --to sqlite:db/itsm.sqlite" -ForegroundColor Yellow
}

Section "Port 4004"
$portInUse = Get-NetTCPConnection -LocalPort 4004 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    $pid4004 = $portInUse[0].OwningProcess
    $proc = Get-Process -Id $pid4004 -ErrorAction SilentlyContinue
    Write-Host "Port 4004 already LISTENING - PID $pid4004 ($($proc.ProcessName))" -ForegroundColor Yellow
    Write-Host "  Check with a teammate before killing this - it may be their own cds watch." -ForegroundColor Yellow
} else {
    Write-Host "Port 4004 free"
}

Section "Hybrid / HANA binding (informational only)"
if (Test-Path .cdsrc-private.json) {
    Write-Host ".cdsrc-private.json present (per-machine, gitignored)"
} else {
    Write-Host ".cdsrc-private.json MISSING - hybrid profile (cds watch --profile hybrid) will not resolve HANA credentials until you run 'cds bind'" -ForegroundColor Yellow
}
$cfTarget = cf target 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "cf target:"
    Write-Host $cfTarget
} else {
    Write-Host "cf CLI not logged in / not installed (only relevant if you're using --profile hybrid)"
}

Write-Host ""
Write-Host "Done. Paste this full output when asking for help." -ForegroundColor Cyan

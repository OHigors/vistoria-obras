# Backup the linked Supabase database (schema + data + roles) to ./backups.
# Requires the Supabase CLI on PATH and a prior `supabase login` + `supabase link`.
# Usage:
#   ./scripts/backup.ps1            # full backup (schema + data + roles)
#   ./scripts/backup.ps1 -SchemaOnly
#   ./scripts/backup.ps1 -DataOnly
#   ./scripts/backup.ps1 -OutDir D:\backups

[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot '..\backups'),
    [switch]$SchemaOnly,
    [switch]$DataOnly
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Error "Supabase CLI not found on PATH. Install with: scoop install supabase  (or)  npm i -g supabase"
}

$OutDir = (Resolve-Path -LiteralPath (New-Item -ItemType Directory -Force -Path $OutDir)).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$prefix = Join-Path $OutDir "vistoria-obras-$stamp"

$ranAnything = $false

if (-not $DataOnly) {
    $schemaFile = "$prefix-schema.sql"
    Write-Host "→ Dumping schema  → $schemaFile"
    supabase db dump -f $schemaFile
    if ($LASTEXITCODE -ne 0) { throw "supabase db dump (schema) failed with exit code $LASTEXITCODE" }
    $ranAnything = $true
}

if (-not $SchemaOnly) {
    $dataFile = "$prefix-data.sql"
    Write-Host "→ Dumping data    → $dataFile"
    supabase db dump -f $dataFile --data-only
    if ($LASTEXITCODE -ne 0) { throw "supabase db dump (data) failed with exit code $LASTEXITCODE" }
    $ranAnything = $true
}

if (-not $SchemaOnly -and -not $DataOnly) {
    $rolesFile = "$prefix-roles.sql"
    Write-Host "→ Dumping roles   → $rolesFile"
    supabase db dump -f $rolesFile --role-only
    if ($LASTEXITCODE -ne 0) { throw "supabase db dump (roles) failed with exit code $LASTEXITCODE" }
}

if ($ranAnything) {
    Write-Host ""
    Write-Host "Done. Files saved to $OutDir"
}

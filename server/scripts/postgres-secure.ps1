param(
  [ValidateSet("check", "migrate", "verify")]
  [string]$Action = "check",
  [string]$User = "miwaadmin",
  [string]$HostName = "miwa-postgres-prod.postgres.database.azure.com",
  [string]$Database = "miwa",
  [switch]$WipeTarget
)

$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringPlainText {
  param([securestring]$SecureString)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$securePassword = Read-Host "Azure PostgreSQL password for $User" -AsSecureString
$password = ConvertFrom-SecureStringPlainText $securePassword
$encodedPassword = [uri]::EscapeDataString($password)

$env:PGSSLMODE = "require"
$env:DATABASE_URL = "postgresql://${User}:${encodedPassword}@${HostName}:5432/${Database}?sslmode=require"

try {
  if ($Action -eq "check") {
    npm run postgres:check
    exit $LASTEXITCODE
  }

  if ($Action -eq "verify") {
    npm run postgres:verify
    exit $LASTEXITCODE
  }

  if ($Action -eq "migrate") {
    $env:MIGRATION_CONFIRM = "copy-miwa-sqlite-to-postgres"
    if ($WipeTarget) {
      npm run postgres:migrate -- --wipe-target
    } else {
      npm run postgres:migrate
    }
    exit $LASTEXITCODE
  }
} finally {
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\MIGRATION_CONFIRM -ErrorAction SilentlyContinue
}

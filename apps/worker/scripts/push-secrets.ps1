# Envoie les secrets locaux vers le Worker Cloudflare sans les afficher.
#_usage: .\scripts\push-secrets.ps1
# Le fichier .dev.vars est ignoré par Git et doit contenir toutes les valeurs réelles,
# y compris SUPABASE_SERVICE_ROLE_KEY, R2_*, GOOGLE_CLIENT_* et VPS_SYNC_SECRET.

param(
  [string] $EnvFile = '.dev.vars',
  [string] $WorkerName = 'stream24-api'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
  throw "Fichier introuvable : $EnvFile"
}

$lines = Get-Content $EnvFile
$count = 0

foreach ($line in $lines) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }

  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) { continue }

  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim()

  if ($name -notmatch '^[A-Z0-9_]+$' -or -not $value) { continue }

  Write-Host "Envoi de $name..."
  $value | npx wrangler secret put $name --name $WorkerName
  if ($LASTEXITCODE -ne 0) {
    throw "Échec de l'envoi du secret $name"
  }
  $count++
}

Write-Host "$count secret(s) envoyé(s). Vérifiez avec : npx wrangler secret list --name $WorkerName"

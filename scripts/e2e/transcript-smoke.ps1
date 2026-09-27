<# Commento didattico:
 # Scopo del file: smoke test transcript limitato alla fixture DEV autorizzata.
 # Moduli richiamati: Invoke-RestMethod verso il solo endpoint cron DEV.
 # Flusso: legge CRON_SECRET e TRANSCRIPT_E2E_VIDEO_ID dal percorso DEV approvato,
 # invoca la fixture sincrona e stampa esclusivamente conteggi/esito sintetico.
 # Mai leggere Supabase, transcript_text, error_details o payload diagnostici.
 #>

$ErrorActionPreference = 'Stop'
$TargetUrl = 'https://dev.utraya.com'
$DevEnvPath = 'C:\Users\darde\.config\utraya-dev\dev.env'

function Fail([string]$message) {
  Write-Output ("ESITO: fallito (" + $message + ").")
  exit 1
}

if (-not (Test-Path -LiteralPath $DevEnvPath -PathType Leaf)) {
  Fail 'credenziali DEV non disponibili nel percorso approvato'
}

$envMap = @{}
try {
  Get-Content -LiteralPath $DevEnvPath | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $parts = $_ -split '=', 2
    $envMap[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
} catch {
  Fail 'configurazione DEV non leggibile'
}

$cronSecret = $envMap['CRON_SECRET']
$fixtureVideoId = $envMap['TRANSCRIPT_E2E_VIDEO_ID']
if ([string]::IsNullOrWhiteSpace($cronSecret) -or [string]::IsNullOrWhiteSpace($fixtureVideoId)) {
  Fail 'variabili DEV richieste mancanti'
}
if ($envMap['NEXT_PUBLIC_SITE_URL'] -cne $TargetUrl) {
  Fail 'URL applicativo non corrispondente a DEV'
}
if ($fixtureVideoId -notmatch '^[A-Za-z0-9_-]{11}$') {
  Fail 'fixture DEV non valida'
}

$uri = $TargetUrl + '/api/cron/transcripts?fixture_video_id=' + $fixtureVideoId + '&limit=1'
try {
  $cronOut = Invoke-RestMethod `
    -Method Get `
    -Uri $uri `
    -Headers @{ Authorization = ('Bearer ' + $cronSecret) } `
    -TimeoutSec 300 `
    -ErrorAction Stop
} catch {
  $cleanupFailed = $false
  try {
    $cleanupFailed = $_.Exception.Response.Headers['X-Transcript-Fixture-Cleanup'] -eq 'failed'
  } catch {
    $cleanupFailed = $false
  }
  if ($cleanupFailed) {
    Fail 'cleanup fixture DEV non riuscito; intervento richiesto'
  }
  Fail 'richiesta cron DEV non riuscita; payload non esposto'
}

if ($null -eq $cronOut -or $cronOut.ok -ne $true -or $null -eq $cronOut.data) {
  Fail 'risposta cron DEV non valida; payload non esposto'
}
$result = $cronOut.data
if ($result.cleanup -ne 'completed') {
  Fail 'cleanup fixture DEV non confermato'
}

$summary = 'checked=' + $result.checked + ' fetched=' + $result.fetched + ' missing=' + $result.missing +
  ' failed=' + $result.failed + ' skipped=' + $result.skipped + ' cleanup=' + $result.cleanup
if ($result.checked -eq 1 -and $result.fetched -eq 1 -and $result.failed -eq 0) {
  Write-Output ('ESITO: superato (' + $summary + ')')
  exit 0
}

Write-Output ('ESITO: fallito (' + $summary + ')')
exit 1

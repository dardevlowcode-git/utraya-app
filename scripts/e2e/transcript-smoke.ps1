<# Commento didattico:
 # Scopo del file: smoke test E2E trascrizioni in preview AD USO MANUALE di Dario (ha i segreti, li compila in .env.local).
 # Gli agenti NON usano questo script: usano il workflow GitHub Actions `.github/workflows/e2e-transcripts.yml`
 # (segreti solo in GitHub Secrets, mai in locale — vedi OPERATIONS.md Sez.15 e vincolo zero-esportazione in AGENTS.md).
 # Uso manuale: .\scripts\e2e\transcript-smoke.ps1 -VideoId "rHshDCGPzdk" -BaseUrl "https://preview.utraya.com"
 #>
param(
  [Parameter(Mandatory = $true)][string]$VideoId,
  [string]$BaseUrl = "https://preview.utraya.com",
  [string]$EnvFile = ".env.local",
  [int]$Limit = 10,
  [int]$PollSeconds = 180,
  [int]$PollIntervalSeconds = 15
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Output ("ERRORE: " + $msg); exit 2 }

if (-not (Test-Path -LiteralPath $EnvFile)) { Fail ("file env non trovato: " + $EnvFile + " (crearlo con 'vercel env pull .env.local' e compilarne i valori)") }
$envMap = @{}
Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "=" -and $_ -notmatch "^#" } | ForEach-Object {
  $parts = $_ -split "=", 2
  $envMap[$parts[0]] = $parts[1].Trim('"').Trim("'")
}
foreach ($k in @("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET")) {
  if ([string]::IsNullOrEmpty($envMap[$k]) -or ($envMap[$k] -match "SENSITIVE") -or ($envMap[$k] -match "^YOUR_")) {
    Fail ("env mancante o placeholder: " + $k)
  }
}
$sbUrl = $envMap["NEXT_PUBLIC_SUPABASE_URL"]
$sbKey = $envMap["SUPABASE_SERVICE_ROLE_KEY"]
$cronSecret = $envMap["CRON_SECRET"]
$sbHeaders = @{ apikey = $sbKey; Authorization = ("Bearer " + $sbKey) }
$browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

function Get-Row() {
  $u = $sbUrl + "/rest/v1/video_transcripts?youtube_video_id=eq." + $VideoId + "&select=transcript_status,language_code,kind,error_details,transcript_text"
  return Invoke-RestMethod -Uri $u -Headers $sbHeaders -TimeoutSec 20
}

Write-Output ("[1/4] Stato iniziale riga " + $VideoId)
$before = Get-Row
if ($null -eq $before) { Fail "nessuna riga video_transcripts per questo video (migrazione 008 applicata?)" }
Write-Output ("stato iniziale: " + $before.transcript_status)

Write-Output "[2/4] Reset a pending via Supabase REST"
$patchHeaders = @{ apikey = $sbKey; Authorization = ("Bearer " + $sbKey); Prefer = "return=representation"; "Content-Type" = "application/json" }
$patchBody = '{"transcript_status":"pending","error_details":null}'
Invoke-RestMethod -Uri ($sbUrl + "/rest/v1/video_transcripts?youtube_video_id=eq." + $VideoId) -Method Patch -Headers $patchHeaders -Body $patchBody -TimeoutSec 20 | Out-Null
Write-Output "reset ok"

Write-Output "[3/4] Trigger cron trascrizioni"
$cronHeaders = @{ Authorization = ("Bearer " + $cronSecret); "User-Agent" = $browserUA }
try {
  $cronOut = Invoke-RestMethod -Uri ($BaseUrl + "/api/cron/transcripts?limit=" + $Limit) -Headers $cronHeaders -TimeoutSec 120
  Write-Output ("risposta cron: checked=" + $cronOut.data.checked + " fetched=" + $cronOut.data.fetched + " missing=" + $cronOut.data.missing + " failed=" + $cronOut.data.failed)
}
catch {
  $code = $null
  try { $code = [int]$_.Exception.Response.StatusCode } catch { $code = "sconosciuto" }
  if ($code -eq 429) { Fail "cron risponde 429 (firewall bot-protection su traffico script): lanciare da console browser o aggiungere regola firewall, vedi runbook OPERATIONS.md Sez.15" }
  if ($code -eq 401) { Fail "cron risponde 401 (CRON_SECRET errato per questo ambiente)" }
  Fail ("trigger cron fallito, status: " + $code + " - " + $_.Exception.Message)
}

Write-Output "[4/4] Poll esito"
$elapsed = 0
$final = $null
while ($elapsed -lt $PollSeconds) {
  Start-Sleep -Seconds $PollIntervalSeconds
  $elapsed = $elapsed + $PollIntervalSeconds
  $final = Get-Row
  if ($final.transcript_status -ne "pending") { break }
}
if ($null -eq $final) { Fail "riga sparita dopo il trigger" }
$textLen = 0
if ($null -ne $final.transcript_text) { $textLen = $final.transcript_text.Length }
Write-Output ("ESITO: status=" + $final.transcript_status + " lang=" + $final.language_code + " kind=" + $final.kind + " testo_len=" + $textLen)
if (-not [string]::IsNullOrEmpty($final.error_details)) { Write-Output ("diagnostica: " + $final.error_details) }
if ($null -ne $final.transcript_text -and $final.transcript_text.Length -gt 0) {
  $prevLen = [Math]::Min(200, $final.transcript_text.Length)
  Write-Output ("anteprima: " + $final.transcript_text.Substring(0, $prevLen))
}
if ($final.transcript_status -eq "fetched") { exit 0 }
if ($final.transcript_status -eq "missing") { exit 1 }
exit 2

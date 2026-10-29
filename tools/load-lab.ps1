param(
  [ValidateSet('before', 'after')][string]$Phase = 'before',
  [ValidateSet('/', '/api/services')][string]$Endpoint = '/api/services',
  [ValidateRange(10, 30)][int]$Seconds = 30,
  [ValidateRange(1, 200)][int]$Connections = 200,
  [ValidateRange(1, 1000)][int]$Qps = 1000
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$binaryPath = Join-Path $projectDirectory '.scratch\load-lab\oha-windows-amd64.exe'
$expectedHash = 'd692d392e958e7e8e1b16810287e74a835a62255b079ba2766a4b3b04499f267'
if (!(Test-Path -LiteralPath $binaryPath) -or (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
  throw 'Download the official oha v1.16.0 binary and verify the SHA-256 documented in docs/LOAD_TEST_LAB.md.'
}

# Intentionally fixed to the local application: no remote targets, fragments or redirects.
$targetUrl = 'http://127.0.0.1:3001' + $Endpoint
$listener = @(Get-NetTCPConnection -LocalPort 3001 -State Listen | Where-Object LocalAddress -eq '127.0.0.1')
if ($listener.Count -ne 1) { throw 'Expected exactly one VELVETHOUR listener on 127.0.0.1:3001.' }
$targetPid = $listener[0].OwningProcess
$targetInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $targetPid)
if ($targetInfo.Name -ne 'node.exe' -or $targetInfo.CommandLine -notmatch 'server[/\\]server\.js') {
  throw 'The listener is not the expected Node application.'
}
$probe = Invoke-WebRequest -Uri $targetUrl -NoProxy -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
if ($probe.StatusCode -ne 200) { throw 'The endpoint must return HTTP 200 before starting.' }

$outputDirectory = Join-Path $projectDirectory 'docs\load-lab'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$label = if ($Endpoint -eq '/') { 'static' } else { 'services' }
$outputBase = Join-Path $outputDirectory ($Phase + '-' + $label)
$logicalCores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$arguments = @('--no-tui', '--output-format', 'json', '-z', ($Seconds.ToString() + 's'), '-w', '-c', $Connections, '-q', $Qps, '-t', '5s', '--redirect', '0', $targetUrl)
$target = Get-Process -Id $targetPid
$previousCpu = $target.CPU
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$previousSeconds = 0.0
$samples = [System.Collections.Generic.List[object]]::new()
$generator = Start-Process -FilePath $binaryPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput ($outputBase + '.json') -RedirectStandardError ($outputBase + '-stderr.log')
try {
  while (!$generator.HasExited) {
    Start-Sleep -Milliseconds 800
    $target.Refresh()
    if ($target.HasExited) { throw 'The target exited during the test.' }
    $elapsed = $clock.Elapsed.TotalSeconds
    $cpuSeconds = $target.CPU
    $established = @(Get-NetTCPConnection -LocalPort 3001 -State Established -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $targetPid).Count
    $samples.Add([pscustomobject]@{
      Elapsed_s = [math]::Round($elapsed, 3)
      Time = (Get-Date).ToString('o')
      CPU_machine_pct = [math]::Round(100 * ($cpuSeconds - $previousCpu) / (($elapsed - $previousSeconds) * $logicalCores), 3)
      CPU_one_core_pct = [math]::Round(100 * ($cpuSeconds - $previousCpu) / ($elapsed - $previousSeconds), 3)
      RAM_MB = [math]::Round($target.WorkingSet64 / 1MB, 2)
      Established_connections = $established
    })
    $previousCpu = $cpuSeconds
    $previousSeconds = $elapsed
    if ($elapsed -gt ($Seconds + 10)) { throw 'Load generator exceeded its time budget.' }
  }
  if ($generator.ExitCode -ne 0) { throw ('oha exited with code ' + $generator.ExitCode) }
} finally {
  if (!$generator.HasExited) { Stop-Process -Id $generator.Id -ErrorAction SilentlyContinue }
  $samples | Export-Csv -LiteralPath ($outputBase + '-monitor.csv') -NoTypeInformation -Encoding utf8
  [pscustomobject]@{
    Phase = $Phase; Endpoint = $Endpoint; Url = $targetUrl; TargetPID = $targetPid
    Node = (& node --version); Tool = 'oha 1.16.0'; ToolSHA256 = $expectedHash
    LogicalCores = $logicalCores; Seconds = $Seconds; MaxConnections = $Connections; MaxQps = $Qps
    Command = 'oha ' + ($arguments -join ' '); FinishedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath ($outputBase + '-metadata.json') -Encoding utf8
}
Write-Output ('Saved ' + $outputBase + '.json and monitor CSV (' + $samples.Count + ' samples).')

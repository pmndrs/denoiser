# Golden pipeline, one GPU job at a time: per item, capture (unless a VALID one exists) -> validate -> native + ours + score.
# A capture that fails validation stops that item (logged), the pipeline moves on.
# Usage: pipeline.ps1 -Items g34|holds|g25|all  [-HandOver]  (HandOver: wait for capture-chain's G3 orbit, then stop the chain)
param([string]$Items = 'g34', [switch]$HandOver)
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\denni\Documents\GitHub\pmndrs\denoiser\denoiser'
$root = 'C:\dev\nrd-reference'
$env:RT_CAPTURE_DIR = $root
$log = "$root\golden\pipeline.log"
function Log($m) { $l = "$(Get-Date -Format s) $m"; Add-Content $log $l; Write-Output $l }
$all = [ordered]@{
  g34   = @(@('G3','orbit',64,4096,'golden-G3-orbit',0),
            @('G4','pan-light-on',64,4096,'golden-G4-pan-light-on',0),
            @('G4','pan-light-colour',64,4096,'golden-G4-pan-light-colour',0),
            @('G4','pan-light-fade',64,4096,'golden-G4-pan-light-fade',0),
            @('G4','pan-lamp-switch',64,4096,'golden-G4-pan-lamp-switch',0))
  holds = @(@('G3','hold',32,16384,'golden-G3-hold',0),
            @('G4','hold-light-on',32,16384,'golden-G4-hold-light-on',0))
  g25   = @(@('G2','occluder',64,4096,'golden-G2-occluder',1),
            @('G5','turntable',64,4096,'golden-G5-turntable',0))
}
$jobs = if ($Items -eq 'all') { $all.Values | ForEach-Object { $_ } } else { $all[$Items] }

if ($HandOver) {
  Log "hand-over: waiting for capture-chain to finish golden-G3-orbit"
  while (-not (Select-String -Path "$root\golden\capture-g34.log" -Pattern 'done golden-G3-orbit' -Quiet -ErrorAction SilentlyContinue)) { Start-Sleep 20 }
  $chain = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'capture-chain\.ps1' }
  foreach ($p in $chain) { Log "stopping chain pid $($p.ProcessId)"; Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'driver\.mjs capture|nvidia-smi.*smi-golden' } | ForEach-Object { Log "stopping $($_.Name) $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '--headless' -and $_.CommandLine -match 'golden\.html' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  foreach ($j in $all['g34'][1..4]) { $d = "$root\captures\$($j[4])"; if ((Test-Path $d) -and -not (Test-Path "$d\capture.json")) { Log "removing partial $d"; Remove-Item -Recurse -Force $d } }
}

foreach ($j in $jobs) {
  $scene, $path, $frames, $spp, $name, $sh = $j
  $valid = $false
  if (Test-Path "$root\captures\$name\capture.json") {
    $v = & node "$repo\tools\rt-capture\validate.mjs" $name 2>&1 | Select-String -Pattern '^(VALID|INVALID)' | Select-Object -Last 1
    $valid = ("$v" -eq 'VALID')
    if (-not $valid) { Log "$name exists but is not VALID ($v): recapturing"; Remove-Item -Recurse -Force "$root\captures\$name" }
  } elseif (Test-Path "$root\captures\$name") { Log "removing partial $name"; Remove-Item -Recurse -Force "$root\captures\$name" }
  if (-not $valid) {
    $smi = Start-Process -PassThru -WindowStyle Hidden nvidia-smi -ArgumentList '--query-gpu=timestamp,temperature.gpu,clocks.gr,clocks.mem,utilization.gpu,power.draw,clocks_throttle_reasons.active','--format=csv,noheader','-l','10','-f',"$root\golden\smi-$name.csv"
    Log "capture $name ($scene $path, $frames frames, $spp spp)"
    Push-Location "$repo\examples\three-temporal"
    $out = & node src/golden/driver.mjs capture --scene=$scene --path=$path --frames=$frames --referenceSpp=$spp --referenceSppSpec=$spp --name=$name 2>&1
    Pop-Location
    Stop-Process -Id $smi.Id -ErrorAction SilentlyContinue
    $out | Out-File -Append $log
    $val = & node "$repo\tools\rt-capture\validate.mjs" $name 2>&1
    $val | Out-File "$root\golden\validate-$name.txt"
    $verdict = "$($val | Select-String -Pattern '^(VALID|INVALID)' | Select-Object -Last 1)"
    Log "captured $name -> $verdict"
    if ($verdict -ne 'VALID') { Log "STOP item ${name}: capture not VALID"; continue }
  } else { Log "$name VALID, using it" }
  & "$root\golden\process-capture.ps1" -Capture $name -Shadows:($sh -eq 1) | ForEach-Object { Log "  $_" }
}
Log "pipeline $Items finished"

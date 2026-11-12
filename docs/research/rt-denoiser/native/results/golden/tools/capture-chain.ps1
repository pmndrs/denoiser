# Golden captures on the RTX laptop, one GPU job at a time, each validated (GOLDEN-BRIEF step 2).
# Usage: capture-chain.ps1 -Group g34 | holds | g25
param([string]$Group = 'g34')
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\denni\Documents\GitHub\pmndrs\denoiser\denoiser'
$env:RT_CAPTURE_DIR = 'C:\dev\nrd-reference'
$log = "C:\dev\nrd-reference\golden\capture-$Group.log"
$jobs = @{
  g34   = @(@('G3','orbit',64,4096,'golden-G3-orbit'),
            @('G4','pan-light-on',64,4096,'golden-G4-pan-light-on'),
            @('G4','pan-light-colour',64,4096,'golden-G4-pan-light-colour'),
            @('G4','pan-light-fade',64,4096,'golden-G4-pan-light-fade'),
            @('G4','pan-lamp-switch',64,4096,'golden-G4-pan-lamp-switch'))
  holds = @(@('G3','hold',32,16384,'golden-G3-hold'),
            @('G4','hold-light-on',32,16384,'golden-G4-hold-light-on'))
  g25   = @(@('G2','occluder',64,4096,'golden-G2-occluder'),
            @('G5','turntable',64,4096,'golden-G5-turntable'))
}[$Group]
function Log($m) { $l = "$(Get-Date -Format s) $m"; Add-Content $log $l; Write-Output $l }
foreach ($j in $jobs) {
  $scene, $path, $frames, $spp, $name = $j
  if (Test-Path "C:\dev\nrd-reference\captures\$name\capture.json") {
    $v = & node "$repo\tools\rt-capture\validate.mjs" $name 2>&1 | Select-String -Pattern '^(VALID|INVALID)' | Select-Object -Last 1
    if ("$v" -eq 'VALID') { Log "$name exists and is VALID, skipped"; continue }
    Log "$name exists but is not VALID ($v): recapturing"; Remove-Item -Recurse -Force "C:\dev\nrd-reference\captures\$name"
  }
  $smi = Start-Process -PassThru -WindowStyle Hidden nvidia-smi -ArgumentList '--query-gpu=timestamp,temperature.gpu,clocks.gr,clocks.mem,utilization.gpu,power.draw,clocks_throttle_reasons.active','--format=csv,noheader','-l','10','-f',"C:\dev\nrd-reference\golden\smi-$name.csv"
  Log "start $name ($scene $path, $frames frames, $spp spp)"
  Push-Location "$repo\examples\three-temporal"
  $out = & node src/golden/driver.mjs capture --scene=$scene --path=$path --frames=$frames --referenceSpp=$spp --referenceSppSpec=$spp --name=$name 2>&1
  Pop-Location
  Stop-Process -Id $smi.Id -ErrorAction SilentlyContinue
  $out | Out-File -Append $log
  $val = & node "$repo\tools\rt-capture\validate.mjs" $name 2>&1
  $val | Out-File "C:\dev\nrd-reference\golden\validate-$name.txt"
  $verdict = $val | Select-String -Pattern '^(VALID|INVALID)' | Select-Object -Last 1
  Log "done $name -> $verdict"
}
Log "group $Group finished"

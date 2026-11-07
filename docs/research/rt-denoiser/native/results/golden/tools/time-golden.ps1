# Same-GPU cost (GOLDEN-BRIEF step 4). Run when nothing else uses the GPU; clocks should be locked first (admin shell):
#   nvidia-smi -lgc 1200,1200 ; nvidia-smi -lmc 7001,7001      (reset: nvidia-smi -rgc ; nvidia-smi -rmc)
# 1. 1080p timing captures (8 frames, 16-spp references: inputs only matter), G3 orbit 0-7 and G4 pan-light-on 28-35
# 2. native: harness --loops 8 (REBLUR, REBLUR tuned D, RELAX, REBLUR occlusion), 3 runs each, alternating with ours
# 3. ours / ffx / raw: golden driver `time` (1080p, lean, n=120 after 10 warm-up), 3 rounds in alternating order
# 4. track D's bench pages (test bed, wt-d worktree) with timestamps on / off, empty submit, tiny dispatch: bench-win.mjs
# Every run waits for a quiet, cool GPU (util <= 5 %, temp <= $Gate C, at most 5 min) and logs clocks every 200 ms.
param([int]$Gate = 80, [string]$Parts = 'captures,native,golden,bench', [int]$Rounds = 3)
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\denni\Documents\GitHub\pmndrs\denoiser\denoiser'
$root = 'C:\dev\nrd-reference'
$env:RT_CAPTURE_DIR = $root
$T = "$root\golden\timing"; New-Item -ItemType Directory -Force $T | Out-Null
$log = "$T\timing.log"
$todo = $Parts.Split(',')
function Log($m) { $l = "$(Get-Date -Format s) $m"; Add-Content $log $l; Write-Output $l }
function Smi { (nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.gr,clocks.mem,clocks_throttle_reasons.active --format=csv,noheader,nounits) -split ',\s*' }
function WaitCool {
  for ($w = 0; $w -lt 300; $w += 5) { $s = Smi; if ([int]$s[0] -le 5 -and [int]$s[1] -le $Gate) { return "$w s, $($s[1]) C" }; Start-Sleep 5 }
  $s = Smi; return "timeout, $($s[1]) C"
}
function SmiLog($name) { Start-Process -PassThru -WindowStyle Hidden nvidia-smi -ArgumentList '--query-gpu=timestamp,temperature.gpu,clocks.gr,clocks.mem,utilization.gpu,power.draw,clocks_throttle_reasons.active','--format=csv,noheader','-lms','200','-f',"$T\smi-$name.csv" }
$caps = @(@('G3','orbit',0,'golden-G3-orbit-1080t'), @('G4','pan-light-on',28,'golden-G4-pan-light-on-1080t'))
$s = Smi; Log "start: gr $($s[2]) MHz, mem $($s[3]) MHz, $($s[1]) C (locked clocks expected 1200 / 7001)"

if ($todo -contains 'captures') {
  foreach ($c in $caps) {
    $scene, $path, $start, $name = $c
    if (Test-Path "$root\captures\$name\capture.json") { Log "$name exists"; continue }
    Push-Location "$repo\examples\three-temporal"
    node src/golden/driver.mjs capture --scene=$scene --path=$path --res=1080p --start=$start --frames=8 --referenceSpp=16 --referenceSppSpec=16 --name=$name 2>&1 | Out-File -Append $log
    Pop-Location
    $v = node "$repo\tools\rt-capture\validate.mjs" $name 2>&1 | Select-String -Pattern '^(VALID|INVALID)' | Select-Object -Last 1
    Log "captured $name -> $v"
  }
}
for ($r = 0; $r -lt $Rounds; $r++) {
  $order = if ($r % 2) { @('golden','native') } else { @('native','golden') }
  foreach ($part in $order) {
    if (-not ($todo -contains $part)) { continue }
    foreach ($c in $caps) {
      $scene, $path, $start, $name = $c
      if ($part -eq 'native') {
        foreach ($cfg in @(@('reblur,relax,reblur-occlusion', @()), @('reblur', @('--hit-params','0.01,0.1,20','--suffix','-tunedD')))) {
          $q = WaitCool; $p = SmiLog "native-$name-r$r"
          $sfx = if ($cfg[1].Count) { 'tunedD' } else { 'defaults' }
          Log "native $name $($cfg[0]) $sfx round $r (waited $q)"
          & "$root\harness\_build\Release\nrd-harness.exe" --capture "$root\captures\$name" --out "$T\native-r$r" --denoisers $cfg[0] --loops 8 @($cfg[1]) 2>&1 | Select-String 'wrote|rror' | ForEach-Object { Log "  $_" }
          Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
        }
      } else {
        $dens = if ($r % 2) { @('raw','ffx','ours') } else { @('ours','ffx','raw') }
        foreach ($d in $dens) {
          $q = WaitCool; $p = SmiLog "golden-$scene-$d-r$r"
          Log "golden time $scene/$path $d round $r (waited $q)"
          Push-Location "$repo\examples\three-temporal"
          node src/golden/driver.mjs time --scene=$scene --path=$path --res=1080p --denoiser=$d --n=120 2>&1 | Out-File "$T\golden-$scene-$d-r$r.json"
          Pop-Location
          Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
        }
      }
    }
  }
}
if ($todo -contains 'bench') {
  $vite = Start-Process -PassThru -WindowStyle Hidden node -ArgumentList "$repo\node_modules\vite\bin\vite.js",'examples/realtime-denoiser','--port','5305','--strictPort','--host','127.0.0.1' -WorkingDirectory "$root\golden\wt-d"
  Start-Sleep 8
  $env:BASE = 'http://127.0.0.1:5305/'
  $p = SmiLog 'bench'
  Log "bench: track D pages (Windows-reproducible subset), $Rounds rounds"
  node "$root\golden\tools\bench-win.mjs" "$root\golden\tools\cost-pages-win.json" ($Rounds * 2) "$T\bench-1080p.jsonl" 200 2>&1 | ForEach-Object { Log "  $_" }
  Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
  Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
}
$s = Smi; Log "end: gr $($s[2]) MHz, mem $($s[3]) MHz, $($s[1]) C"

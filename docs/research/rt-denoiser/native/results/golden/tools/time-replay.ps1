# Ours on the same 1080p timing captures as native (GOLDEN-BRIEF step 4, like-for-like cost): test-bed mode=replay,
# which runs no path tracer, so the GPU stays cool and at the locked clocks (the golden driver's `time` throttles, see
# timing.log / smi-golden-*.csv). Arms: svgf-auto (diffuse+specular) and occlusion-svgf-auto (ao), replay GPU warm-up
# 50 ms (default) and 0 ms, $Rounds rounds in alternating order, cool-down gate, clocks logged every 200 ms.
# Outputs are overwritten per arm and deleted at the end; run.json + timings.csv are kept in timing\replay-r<k>\.
param([int]$Gate = 72, [int]$Rounds = 5)
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\denni\Documents\GitHub\pmndrs\denoiser\denoiser'
$root = 'C:\dev\nrd-reference'
$env:RT_CAPTURE_DIR = $root
$out = "$root\outputs"
$T = "$root\golden\timing"
$log = "$T\timing.log"
function Log($m) { $l = "$(Get-Date -Format s) $m"; Add-Content $log $l; Write-Output $l }
function Smi { (nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.gr,clocks.mem --format=csv,noheader,nounits) -split ',\s*' }
function WaitCool {
  for ($w = 0; $w -lt 300; $w += 5) { $s = Smi; if ([int]$s[0] -le 5 -and [int]$s[1] -le $Gate) { return "$w s, $($s[1]) C" }; Start-Sleep 5 }
  $s = Smi; return "timeout, $($s[1]) C"
}
$caps = @('golden-G3-orbit-1080t', 'golden-G4-pan-light-on-1080t')
$arms = @(@('ours-auto', 'svgf-auto', 'diffuse,specular'), @('ours-occ', 'occlusion-svgf-auto', 'ao'))
$s = Smi; Log "replay timing start: gr $($s[2]) MHz, mem $($s[3]) MHz, $($s[1]) C"
for ($r = 0; $r -lt $Rounds; $r++) {
  $warms = if ($r % 2) { @(0, 50) } else { @(50, 0) }
  foreach ($cap in $caps) {
    foreach ($a in $arms) {
      $name, $den, $sig = $a
      foreach ($w in $warms) {
        $tag = "time-$name-w$w"
        $q = WaitCool
        $p = Start-Process -PassThru -WindowStyle Hidden nvidia-smi -ArgumentList '--query-gpu=timestamp,temperature.gpu,clocks.gr,clocks.mem,utilization.gpu,power.draw,clocks_throttle_reasons.active','--format=csv,noheader','-lms','200','-f',"$T\smi-replay-$cap-$tag-r$r.csv"
        Log "replay $cap $den warm $w round $r (waited $q)"
        if (Test-Path "$out\$cap\$tag") { Remove-Item -Recurse -Force "$out\$cap\$tag" }
        Push-Location "$repo\examples\realtime-denoiser"
        $res = & node run-headless.mjs --serve "mode=replay&capture=$cap&denoiser=$den&output=$tag&signals=$sig&warm=$w" 2>&1
        Pop-Location
        Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
        $dst = "$T\replay-r$r\$cap\$tag"; New-Item -ItemType Directory -Force $dst | Out-Null
        foreach ($f in 'run.json', 'timings.csv') { if (Test-Path "$out\$cap\$tag\$f") { Copy-Item "$out\$cap\$tag\$f" $dst } }
        if (-not (Test-Path "$dst\timings.csv")) { Log "  FAILED: $($res | Select-Object -Last 3)" }
      }
    }
  }
}
foreach ($cap in $caps) { Get-ChildItem "$out\$cap" -Directory -Filter 'time-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force }
$s = Smi; Log "replay timing end: gr $($s[2]) MHz, mem $($s[3]) MHz, $($s[1]) C"

# One golden capture through native NRD (harness) and ours (test-bed replay of the same bytes), then scoring.
# GPU jobs run strictly one after the other. Outputs: C:\dev\nrd-reference\outputs\<capture>\<denoiser>\frame_NNNN\*.f32
# Usage: process-capture.ps1 -Capture golden-G3-orbit [-Shadows] [-Steps native,ours,score]
param([string]$Capture, [switch]$Shadows, [string]$Steps = 'native,ours,score')
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\denni\Documents\GitHub\pmndrs\denoiser\denoiser'
$root = 'C:\dev\nrd-reference'
$env:RT_CAPTURE_DIR = $root
$h = "$root\harness\_build\Release\nrd-harness.exe"
$capDir = "$root\captures\$Capture"
$out = "$root\outputs"
$log = "$root\golden\process-$Capture.log"
$todo = $Steps.Split(',')
function Log($m) { $l = "$(Get-Date -Format s) $m"; Add-Content $log $l; Write-Output $l }
function Harness($argsList) {
  Log "harness $($argsList -join ' ')"
  & $h --capture $capDir --out $out @argsList 2>&1 | Select-String -Pattern 'wrote|error|Error|FAIL|lost' | ForEach-Object { Log "  $_" }
}
if ($todo -contains 'native') {
  # defaults: REFERENCE (sanity), REBLUR, RELAX, REBLUR occlusion (+ SIGMA on shadow scenes)
  $d = 'reference,reblur,relax,reblur-occlusion'; if ($Shadows) { $d += ',sigma' }
  Harness @('--denoisers', $d)
  # tuned REBLUR hit-distance parameters (ROUND3): diffuse A = 0.01; specular (A, B, C) = (0.1, 0.1, 1)
  Harness @('--denoisers', 'reblur,reblur-occlusion', '--hit-params', '0.01,0.1,20', '--suffix', '-tunedD')
  Harness @('--denoisers', 'reblur', '--hit-params', '0.1,0.1,1', '--suffix', '-tunedS')
}
if ($todo -contains 'ours') {
  # ours = the package defaults (svgf-auto = golden 'ours' diffuse+specular), occlusion-svgf-auto for AO; shadows on shadow scenes
  $arms = @(@('ours-auto', 'svgf-auto', 'diffuse,specular'), @('ours-occ', 'occlusion-svgf-auto', 'ao'))
  if ($Shadows) { $arms += ,@('ours-shadows', 'shadows', 'visibility'); $arms += ,@('ffx-shadows', 'ffx-shadows', 'visibility') }
  foreach ($a in $arms) {
    $name, $den, $sig = $a
    for ($try = 1; $try -le 2; $try++) {
      if (Test-Path "$out\$Capture\$name") { Remove-Item -Recurse -Force "$out\$Capture\$name" }
      Push-Location "$repo\examples\realtime-denoiser"
      $r = & node run-headless.mjs --serve "mode=replay&capture=$Capture&denoiser=$den&output=$name&signals=$sig" 2>&1
      Pop-Location
      if (Test-Path "$out\$Capture\$name\run.json") { break }
      Log "retry $name ($den): $($r | Select-Object -Last 3)"
    }
    $n = (Get-ChildItem "$out\$Capture\$name" -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
    Log "ours $name ($den, $sig): $n frames"
  }
}
if ($todo -contains 'score') {
  Push-Location $repo
  & node tools/rt-capture/compare.mjs $capDir --outputs $out 2>&1 | Out-File "$root\golden\compare-$Capture.txt"
  Pop-Location
  $dens = (Get-ChildItem "$out\$Capture" -Directory | Where-Object { $_.Name -notmatch 'occlusion|-occ$|reference' } | ForEach-Object Name) -join ','
  Push-Location "$root\golden\wt-d"
  & node docs/research/rt-denoiser/results/data/d/calm.mjs $Capture --den $dens --signals diffuse,specular --outputs $out --json "$out\$Capture\calm.json" 2>&1 | Out-File "$root\golden\calm-$Capture.txt"
  & node docs/research/rt-denoiser/results/data/d/calm.mjs $Capture --den 'ours-occ' --signals ao --outputs $out --json "$out\$Capture\calm-ao.json" 2>&1 | Out-File "$root\golden\calm-ao-$Capture.txt"
  Pop-Location
  Log "scored $Capture"
}
Log "done $Capture ($Steps)"

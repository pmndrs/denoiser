# Copies one capture's metrics, run.json / timings.csv per denoiser and crop strips into the results worktree
# (docs/research/rt-denoiser/native/results/golden/<capture>/). Raw frames stay in C:\dev\nrd-reference\outputs\.
# Usage: collect.ps1 -Capture golden-G4-pan-light-on [-Event 32] [-CropFrames 40,34]
param([string]$Capture, [int]$Event = -1, [string]$CropFrames = '40')
$root = 'C:\dev\nrd-reference'
$src = "$root\outputs\$Capture"
$dst = "$root\golden\wt-results\docs\research\rt-denoiser\native\results\golden\$Capture"
New-Item -ItemType Directory -Force $dst | Out-Null
foreach ($f in 'compare.md','compare.json','calm.json','calm-ao.json','calm-vis.json') { if (Test-Path "$src\$f") { Copy-Item "$src\$f" $dst } }
Copy-Item "$root\golden\validate-$Capture.txt" "$dst\validate.txt" -ErrorAction SilentlyContinue
$cj = Get-Content "$root\captures\$Capture\capture.json" -Raw | ConvertFrom-Json
$cj | Select-Object * -ExcludeProperty frames | ConvertTo-Json -Depth 6 | Out-File "$dst\capture-manifest.json" -Encoding utf8
$dens = Get-ChildItem $src -Directory | ForEach-Object Name
foreach ($d in $dens) {
  New-Item -ItemType Directory -Force "$dst\$d" | Out-Null
  foreach ($f in 'run.json','timings.csv') { if (Test-Path "$src\$d\$f") { Copy-Item "$src\$d\$f" "$dst\$d\" } }
}
Push-Location "$root\golden\wt-d"
$t = "docs/research/rt-denoiser/results/data/d/calm-table.mjs"
$md = @("# $Capture`: calm (track D's calm.mjs, motion-compensated boil per region)", '')
foreach ($s in 'diffuse','specular') { $md += (node $t "$src\calm.json" --signal $s) ; $md += '' }
if (Test-Path "$src\calm-ao.json") { $md += (node $t "$src\calm-ao.json" --signal ao); $md += '' }
if (Test-Path "$src\calm-vis.json") { $md += (node $t "$src\calm-vis.json" --signal visibility); $md += '' }
Pop-Location
$md | Out-File "$dst\calm.md" -Encoding utf8
if ($Event -ge 0) {
  $l = @("# $Capture`: lag after the event at frame $Event", '')
  $l += (node "$root\golden\tools\lag.mjs" "$src\calm.json" --event $Event --json "$dst\lag.json")
  if (Test-Path "$src\calm-ao.json") { $l += ''; $l += (node "$root\golden\tools\lag.mjs" "$src\calm-ao.json" --event $Event --signals ao) }
  $l | Out-File "$dst\lag.md" -Encoding utf8
}
$cropDens = ($dens | Where-Object { $_ -match '^(nrd-reblur|nrd-reblur-tunedD|nrd-relax|nrd-sigma|ours-auto|ours-shadows|ffx-shadows)$' }) -join ','
$crops = @()
foreach ($fr in $CropFrames.Split(',')) {
  foreach ($s in 'diffuse','specular') {
    $dsDens = (($cropDens.Split(',')) | Where-Object { $_ -notmatch 'sigma|shadows' }) -join ','
    $crops += (node "$root\golden\tools\crops.mjs" "$root\captures\$Capture" $src --frame $fr --signal $s --den $dsDens --x auto --out "$dst\crop_f$($fr)_$s.png")
  }
  $visDens = (($cropDens.Split(',')) | Where-Object { $_ -match 'sigma|shadows' }) -join ','
  if ($visDens) { $crops += (node "$root\golden\tools\crops.mjs" "$root\captures\$Capture" $src --frame $fr --signal visibility --den $visDens --x auto --out "$dst\crop_f$($fr)_visibility.png") }
}
$crops | Out-File "$dst\crops.txt" -Encoding utf8
"collected $Capture -> $dst"

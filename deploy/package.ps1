param(
  [string]$OutputRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'seqora-deployment')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $OutputRoot 'source'
$runtimeStage = Join-Path $OutputRoot 'runtime'
$sourceArchive = Join-Path $OutputRoot 'seqora-source.tgz'
$runtimeArchive = Join-Path $OutputRoot 'seqora-runtime.tgz'

if (-not (Test-Path -LiteralPath (Join-Path $repo 'deploy\demo.env') -PathType Leaf)) {
  throw 'deploy/demo.env is required. Create it from deploy/demo.env.example first.'
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
if (Test-Path -LiteralPath $stage) {
  $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
  if ($resolvedStage -ne (Join-Path $OutputRoot 'source')) {
    throw 'Refusing to remove an unexpected staging path.'
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null
if (Test-Path -LiteralPath $runtimeStage) {
  $resolvedRuntimeStage = (Resolve-Path -LiteralPath $runtimeStage).Path
  if ($resolvedRuntimeStage -ne (Join-Path $OutputRoot 'runtime')) {
    throw 'Refusing to remove an unexpected runtime staging path.'
  }
  Remove-Item -LiteralPath $resolvedRuntimeStage -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeStage -Force | Out-Null

$paths = @(git -C $repo ls-files --cached --others --exclude-standard)
$copiedFiles = 0
foreach ($relativePath in $paths) {
  if ($relativePath -eq 'deploy/bootstrap-gce.sh') {
    continue
  }
  $sourcePath = Join-Path $repo $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    continue
  }
  $targetPath = Join-Path $stage $relativePath
  $targetParent = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
  $copiedFiles++
}

$deployEnvTarget = Join-Path $stage 'deploy\demo.env'
New-Item -ItemType Directory -Path (Split-Path -Parent $deployEnvTarget) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'deploy\demo.env') -Destination $deployEnvTarget -Force

$buildInfo = @(
  "BuiltAt=$(Get-Date -Format o)",
  "SourceBranch=$(git -C $repo branch --show-current)",
  "SourceCommit=$(git -C $repo rev-parse HEAD)",
  "IncludedFiles=$copiedFiles"
)
[System.IO.File]::WriteAllLines(
  (Join-Path $stage 'DEPLOY_BUILD.txt'),
  [string[]]$buildInfo,
  [System.Text.UTF8Encoding]::new($false)
)

foreach ($archive in @($sourceArchive, $runtimeArchive)) {
  if (Test-Path -LiteralPath $archive -PathType Leaf) {
    Remove-Item -LiteralPath $archive -Force
  }
}

tar -czf $sourceArchive -C $stage .
if ($LASTEXITCODE -ne 0) {
  throw 'Source archive failed.'
}

$runtimeSource = Join-Path $repo 'apps\api\data'
Copy-Item -LiteralPath (Join-Path $runtimeSource 'app.json') -Destination $runtimeStage -Force
Copy-Item -LiteralPath (Join-Path $runtimeSource 'uploads') -Destination (Join-Path $runtimeStage 'uploads') -Recurse -Force
tar -czf $runtimeArchive -C $runtimeStage .
if ($LASTEXITCODE -ne 0) {
  throw 'Runtime archive failed.'
}

@($sourceArchive, $runtimeArchive) | ForEach-Object {
  $file = Get-Item -LiteralPath $_
  $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
  [pscustomobject]@{
    Path = $file.FullName
    Bytes = $file.Length
    SHA256 = $hash.Hash
  }
}

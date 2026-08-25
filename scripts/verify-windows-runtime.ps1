param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [Parameter(Mandatory = $true)]
  [string]$RedistInstaller
)

$resolvedInstaller = Resolve-Path -LiteralPath $Installer -ErrorAction Stop
$resolvedRedistInstaller = Resolve-Path -LiteralPath $RedistInstaller -ErrorAction Stop
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "Visual Studio locator is unavailable; cannot verify Windows runtime dependencies."
}

$visualStudioPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudioPath) {
  throw "Visual Studio C++ tools are unavailable; cannot verify Windows runtime dependencies."
}

$dumpbin = Get-ChildItem -Path (Join-Path $visualStudioPath "VC\Tools\MSVC") -Filter dumpbin.exe -Recurse |
  Where-Object { $_.FullName -match "Hostx64\\x64\\dumpbin\.exe$" } |
  Select-Object -First 1
if (-not $dumpbin) {
  throw "dumpbin.exe is unavailable; cannot verify Windows runtime dependencies."
}

$extractRoot = Join-Path $env:RUNNER_TEMP "xiangqi-studio-runtime-check-$([guid]::NewGuid())"
$sevenZipCandidates = @(
  (Get-Command 7z.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
  (Join-Path $env:ProgramFiles "7-Zip\7z.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$sevenZip = $sevenZipCandidates | Select-Object -First 1
if (-not $sevenZip) {
  throw "7-Zip is unavailable; cannot inspect the Windows NSIS installer payload."
}

function Require-PayloadFile([string]$Name) {
  $match = Get-ChildItem -Path $extractRoot -Recurse -File -Filter $Name | Select-Object -First 1
  if (-not $match) {
    throw "The NSIS installer is missing required payload: $Name"
  }
  return $match
}

try {
  & $sevenZip x $resolvedInstaller "-o$extractRoot" -y | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip failed to extract the NSIS installer with exit code $LASTEXITCODE"
  }

  $binaries = @(Get-ChildItem -Path $extractRoot -Recurse -File -Include *.exe, *.dll)
  if ($binaries.Count -eq 0) {
    throw "The NSIS installer does not contain any executable or DLL payload."
  }

  Require-PayloadFile "xiangqi-desktop.exe" | Out-Null
  $redistPayload = Require-PayloadFile "VC_redist.x64.exe"
  $expectedRedistHash = (Get-FileHash -LiteralPath $resolvedRedistInstaller -Algorithm SHA256).Hash
  $bundledRedistHash = (Get-FileHash -LiteralPath $redistPayload.FullName -Algorithm SHA256).Hash
  if ($bundledRedistHash -ne $expectedRedistHash) {
    throw "The NSIS installer contains a VC_redist.x64.exe that does not match the verified download."
  }

  Require-PayloadFile "pikafish.exe" | Out-Null
  Require-PayloadFile "pikafish.nnue" | Out-Null
  Require-PayloadFile "fairy-stockfish.exe" | Out-Null
  Require-PayloadFile "xiangqi-c07e94a5c7cb.nnue" | Out-Null
  Require-PayloadFile "yolov11.onnx" | Out-Null
  Require-PayloadFile "LICENSE-GPL-3.0.txt" | Out-Null
  Require-PayloadFile "THIRD_PARTY_NOTICES.md" | Out-Null

  $forbiddenUnixEngines = @(Get-ChildItem -Path $extractRoot -Recurse -File | Where-Object {
    $_.Name -ceq "pikafish" -or $_.Name -ceq "fairy-stockfish"
  })
  if ($forbiddenUnixEngines.Count -gt 0) {
    throw "The Windows installer contains non-Windows engine binaries: $($forbiddenUnixEngines.FullName -join ', ')"
  }

  $runtimeImports = [System.Collections.Generic.List[string]]::new()
  foreach ($binary in $binaries) {
    if ($binary.Name -eq "VC_redist.x64.exe") { continue }
    $dependencies = & $dumpbin.FullName /DEPENDENTS $binary.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "dumpbin failed while inspecting $($binary.FullName)`n$dependencies"
    }
    $dynamicRuntime = $dependencies | Select-String -Pattern "^\s*(MSVCP140(?:_[A-Z0-9]+)?|VCRUNTIME140(?:_\d+)?|CONCRT140(?:_\d+)?)\.dll\s*$"
    foreach ($dependency in $dynamicRuntime) {
      $runtimeImports.Add("$($binary.Name) -> $($dependency.Line.Trim())")
    }
  }

  if ($runtimeImports.Count -gt 0) {
    Write-Host "Verified bundled VC++ runtime for: $($runtimeImports -join '; ')"
  } else {
    Write-Host "Verified a static Windows runtime across the NSIS payload."
  }
  Write-Host "Verified Windows engines, independent NNUE files, and link-vision model."
} finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}

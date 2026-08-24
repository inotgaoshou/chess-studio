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

$installRoot = Join-Path $env:RUNNER_TEMP "xiangqi-studio-runtime-check-$([guid]::NewGuid())"
try {
  & $resolvedInstaller /S "/D=$installRoot"
  if ($LASTEXITCODE -notin @(0, 3010)) {
    throw "NSIS installer failed with exit code $LASTEXITCODE"
  }

  $binaries = Get-ChildItem -Path $installRoot -Recurse -File -Include *.exe, *.dll
  if ($binaries.Count -eq 0) {
    throw "The NSIS installer did not install any executable or DLL payload."
  }

  $runtimeImports = [System.Collections.Generic.List[string]]::new()
  foreach ($binary in $binaries) {
    $dependencies = & $dumpbin.FullName /DEPENDENTS $binary.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "dumpbin failed while inspecting $($binary.FullName)`n$dependencies"
    }
    $dynamicRuntime = $dependencies | Select-String -Pattern "^\s*(MSVCP140(?:_[A-Z0-9]+)?|VCRUNTIME140(?:_\d+)?|CONCRT140(?:_\d+)?)\.dll\s*$"
    foreach ($dependency in $dynamicRuntime) {
      $runtimeImports.Add("$($binary.Name) -> $($dependency.Line.Trim())")
    }
  }

  if ($runtimeImports.Count -gt 0 -and -not (Test-Path -LiteralPath $resolvedRedistInstaller)) {
    throw "The packaged payload needs the Visual C++ runtime but VC_redist.x64.exe is not available."
  }
  if ($runtimeImports.Count -gt 0) {
    Write-Host "Verified bundled VC++ runtime for: $($runtimeImports -join '; ')"
  } else {
    Write-Host "Verified a static Windows runtime across the installed payload."
  }
} finally {
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

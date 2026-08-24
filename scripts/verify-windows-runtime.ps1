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

try {
  # NSIS command-line install directories are not reliable in a non-interactive
  # GitHub runner. Inspect the actual bundled archive instead of assuming a
  # silent install created a particular directory.
  & $sevenZip x $resolvedInstaller "-o$extractRoot" -y | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip failed to extract the NSIS installer with exit code $LASTEXITCODE"
  }

  $binaries = Get-ChildItem -Path $extractRoot -Recurse -File -Include *.exe, *.dll
  if ($binaries.Count -eq 0) {
    throw "The NSIS installer does not contain any executable or DLL payload."
  }

  $redistPayload = Get-ChildItem -Path $extractRoot -Recurse -File -Filter VC_redist.x64.exe |
    Select-Object -First 1
  if (-not $redistPayload) {
    throw "The NSIS installer does not include VC_redist.x64.exe for clean Windows installations."
  }
  $expectedRedistHash = (Get-FileHash -LiteralPath $resolvedRedistInstaller -Algorithm SHA256).Hash
  $bundledRedistHash = (Get-FileHash -LiteralPath $redistPayload.FullName -Algorithm SHA256).Hash
  if ($bundledRedistHash -ne $expectedRedistHash) {
    throw "The NSIS installer contains a VC_redist.x64.exe that does not match the verified download."
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
    throw "The packaged payload needs the Visual C++ runtime but the verified redistributable source is unavailable."
  }
  if ($runtimeImports.Count -gt 0) {
    Write-Host "Verified bundled VC++ runtime ($($redistPayload.FullName)) for: $($runtimeImports -join '; ')"
  } else {
    Write-Host "Verified a static Windows runtime across the NSIS payload."
  }
} finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}

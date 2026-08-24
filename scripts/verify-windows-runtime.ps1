param(
  [Parameter(Mandatory = $true)]
  [string]$Executable
)

$resolvedExecutable = Resolve-Path -LiteralPath $Executable -ErrorAction Stop
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

$dependencies = & $dumpbin.FullName /DEPENDENTS $resolvedExecutable 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "dumpbin failed while inspecting $resolvedExecutable`n$dependencies"
}

$dynamicRuntime = $dependencies | Select-String -Pattern "^\s*(MSVCP140(?:_\d+)?|VCRUNTIME140(?:_\d+)?)\.dll\s*$"
if ($dynamicRuntime) {
  throw "The packaged executable still requires the Visual C++ runtime: $($dynamicRuntime.Line -join ', ')"
}

Write-Host "Verified static Windows runtime: $resolvedExecutable"

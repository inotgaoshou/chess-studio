param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [Parameter(Mandatory = $true)]
  [string]$RedistInstaller,
  [string]$SizeReportJson,
  [string]$SizeReportMarkdown
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
  $pikafishManifest = Require-PayloadFile "RESOURCE-MANIFEST.txt"
  Require-PayloadFile "Pikafish-README.md" | Out-Null
  Require-PayloadFile "yolov11.onnx" | Out-Null
  Require-PayloadFile "Copying.txt" | Out-Null
  Require-PayloadFile "LICENSE-GPL-3.0.txt" | Out-Null
  $noticePayloads = @(Get-ChildItem -Path $extractRoot -Recurse -File -Filter "THIRD_PARTY_NOTICES.md")
  $pikafishNotice = $noticePayloads | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw) -match "桌面包随应用分发.*pikafish"
  } | Select-Object -First 1
  if (-not $pikafishNotice) {
    throw "The installer is missing the application-level Pikafish third-party notice."
  }
  $manifestText = Get-Content -LiteralPath $pikafishManifest.FullName -Raw
  if ($manifestText -notmatch "Pikafish NNUE source label: pikafish权重260720" -or
      $manifestText -notmatch "Pikafish NNUE SHA256: 3cd15292bf8c979884262f57fc723959fc0dea43b4d8d544f88db5ceb2479e24") {
    throw "The packaged Pikafish resource manifest does not retain the pinned NNUE source and hash."
  }

  $allFiles = @(Get-ChildItem -Path $extractRoot -Recurse -File)
  $forbiddenPayload = @($allFiles | Where-Object {
    $normalizedPath = $_.FullName -replace '\\', '/'
    $isUnixPikafish = -not $_.Extension -and $_.BaseName -match "(?i)^pikafish(?:$|[-_])"
    $isFairyResource = $normalizedPath -match "(?i)fairy[-_ ]?stockfish|fairystockfish|fairy[^/]*\.nnue(?:$|/)|/fairy(?:[-_][^/]*)?/"
    $isUnixPikafish -or $isFairyResource
  })
  if ($forbiddenPayload.Count -gt 0) {
    throw "The Windows installer contains a removed or non-Windows engine resource: $($forbiddenPayload.FullName -join ', ')"
  }

  foreach ($uniqueName in @("xiangqi-desktop.exe", "VC_redist.x64.exe", "pikafish.exe", "pikafish.nnue", "yolov11.onnx")) {
    $matches = @($allFiles | Where-Object { $_.Name -ceq $uniqueName })
    if ($matches.Count -ne 1) {
      throw "Expected exactly one $uniqueName in the installer, found $($matches.Count)."
    }
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
  Write-Host "Verified Pikafish, its pinned NNUE, and the link-vision model."

  if ($SizeReportJson -or $SizeReportMarkdown) {
    $classified = foreach ($file in $allFiles) {
      $relative = $file.FullName.Substring($extractRoot.Length).TrimStart('\')
      $category = switch -Regex ($relative) {
        '(?i)pikafish\.nnue$' { "pikafish-nnue"; break }
        '(?i)pikafish\.exe$' { "pikafish-engine"; break }
        '(?i)VC_redist\.x64\.exe$' { "vc-runtime"; break }
        '(?i)yolov11\.onnx$' { "link-vision-model"; break }
        '(?i)xiangqi-desktop\.exe$|\.dll$' { "application"; break }
        '(?i)flyknife|book-topics|master-style|opening' { "business-data"; break }
        '(?i)\.ttf$|OFL\.txt$' { "fonts"; break }
        '(?i)license|copying|notice|readme' { "licenses-and-notices"; break }
        default { "other" }
      }
      [pscustomobject]@{ path = $relative; bytes = [int64]$file.Length; category = $category }
    }
    $categories = @($classified | Group-Object category | ForEach-Object {
      [pscustomobject]@{
        name = $_.Name
        bytes = [int64](($_.Group | Measure-Object bytes -Sum).Sum)
        files = $_.Count
      }
    } | Sort-Object bytes -Descending)
    $largestFiles = @($classified | Sort-Object bytes -Descending | Select-Object -First 20)
    $baselineBytes = [int64]134MB
    $installerBytes = [int64](Get-Item -LiteralPath $resolvedInstaller).Length
    $report = [ordered]@{
      baselineArtifactBytes = $baselineBytes
      installerBytes = $installerBytes
      deltaBytes = $installerBytes - $baselineBytes
      changePercent = [math]::Round((($installerBytes - $baselineBytes) / $baselineBytes) * 100, 2)
      extractedBytes = [int64](($classified | Measure-Object bytes -Sum).Sum)
      categories = $categories
      largestFiles = $largestFiles
      slimmingDecisions = @(
        "Removed Fairy-Stockfish executable and NNUE",
        "Rejected non-Windows engine binaries and duplicate core payloads",
        "Preserved Pikafish, pinned NNUE, link-vision model, business data, licenses, and notices"
      )
    }
    if ($SizeReportJson) {
      $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $SizeReportJson -Encoding utf8
    }
    if ($SizeReportMarkdown) {
      $lines = @(
        "# Windows package size report",
        "",
        "- Baseline Artifact: 134 MiB",
        "- NSIS installer: $([math]::Round($report.installerBytes / 1MB, 2)) MiB",
        "- Change from baseline: $([math]::Round($report.deltaBytes / 1MB, 2)) MiB ($($report.changePercent)%)",
        "- Extracted payload: $([math]::Round($report.extractedBytes / 1MB, 2)) MiB",
        "",
        "## Safe slimming decisions",
        "",
        "- Removed Fairy-Stockfish executable and NNUE.",
        "- Rejected non-Windows engine binaries and duplicate core payloads.",
        "- Preserved Pikafish, pinned NNUE, link-vision model, business data, licenses, and notices.",
        "",
        "## Categories",
        "",
        "| Category | Size (MiB) | Files |",
        "| --- | ---: | ---: |"
      )
      foreach ($category in $categories) {
        $lines += "| $($category.name) | $([math]::Round($category.bytes / 1MB, 2)) | $($category.files) |"
      }
      $lines += @("", "## Largest files", "", "| Path | Size (MiB) |", "| --- | ---: |")
      foreach ($file in $largestFiles) {
        $lines += "| ``$($file.path)`` | $([math]::Round($file.bytes / 1MB, 2)) |"
      }
      $lines | Set-Content -LiteralPath $SizeReportMarkdown -Encoding utf8
    }
  }
} finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}

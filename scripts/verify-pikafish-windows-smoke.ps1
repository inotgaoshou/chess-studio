param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceDirectory
)

$source = Resolve-Path -LiteralPath $ResourceDirectory -ErrorAction Stop
$smokeRoot = Join-Path $env:RUNNER_TEMP "Xiangqi Studio Pikafish smoke"
$engine = Join-Path $smokeRoot "pikafish.exe"
$nnue = Join-Path $smokeRoot "pikafish.nnue"

Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $smokeRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $source "pikafish.exe") -Destination $engine
Copy-Item -LiteralPath (Join-Path $source "pikafish.nnue") -Destination $nnue

$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = $engine
$process.StartInfo.WorkingDirectory = $smokeRoot
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardInput = $true
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$outputLines = [System.Collections.Generic.List[string]]::new()

function Read-Until([string]$Pattern, [int]$TimeoutSeconds, [string]$Description) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $remainingMs = [math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    $lineTask = $process.StandardOutput.ReadLineAsync()
    if (-not $lineTask.Wait($remainingMs)) {
      throw "Timed out waiting for $Description.`n$($outputLines -join "`n")"
    }
    $line = $lineTask.Result
    if ($null -eq $line) {
      throw "Pikafish exited while waiting for $Description.`n$($outputLines -join "`n")"
    }
    $outputLines.Add($line)
    if ($line -match $Pattern) { return $line }
  }
  throw "Timed out waiting for $Description.`n$($outputLines -join "`n")"
}

try {
  if (-not $process.Start()) { throw "Failed to start Pikafish." }
  $process.StandardInput.WriteLine("uci")
  $process.StandardInput.Flush()
  Read-Until "^uciok\s*$" 10 "uciok" | Out-Null

  $process.StandardInput.WriteLine("setoption name EvalFile value $nnue")
  $process.StandardInput.WriteLine("isready")
  $process.StandardInput.Flush()
  Read-Until "^readyok\s*$" 20 "NNUE readyok" | Out-Null

  $process.StandardInput.WriteLine("position startpos")
  $process.StandardInput.WriteLine("go depth 1")
  $process.StandardInput.Flush()
  $bestMoveLine = Read-Until "^bestmove\s+[a-i][0-9][a-i][0-9](?:\s|$)" 20 "a Xiangqi bestmove"
  $bestMove = ($bestMoveLine -split '\s+')[1]
  $legalStartMoves = @(
    "a0a1", "i0i1", "b0a2", "b0c2", "h0g2", "h0i2",
    "c0a2", "c0e2", "g0e2", "g0i2", "d0e1", "f0e1", "e0e1",
    "a3a4", "c3c4", "e3e4", "g3g4", "i3i4",
    "b2a2", "b2c2", "b2d2", "b2e2", "b2f2", "b2g2",
    "h2i2", "h2g2", "h2f2", "h2e2", "h2d2", "h2c2",
    "b2b3", "b2b4", "b2b5", "b2b6", "h2h3", "h2h4", "h2h5", "h2h6"
  )
  if ($legalStartMoves -notcontains $bestMove) {
    throw "Pikafish returned a move that is not legal in the Xiangqi start position: $bestMove"
  }
  $searchOutput = $outputLines -join "`n"
  if ($searchOutput -notmatch "NNUE evaluation using .*pikafish\.nnue") {
    throw "Pikafish did not report loading pikafish.nnue during search.`n$searchOutput"
  }
  $process.StandardInput.WriteLine("quit")
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(10000)) {
    $process.Kill()
    throw "Pikafish smoke test timed out."
  }
  $stdout = $outputLines -join "`n"
  $stderr = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0) {
    throw "Pikafish exited with code $($process.ExitCode).`nstdout:`n$stdout`nstderr:`n$stderr"
  }
  Write-Host "Verified Pikafish NNUE readiness and a depth-1 Xiangqi search."
} finally {
  if (-not $process.HasExited) { $process.Kill() }
  $process.Dispose()
  Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}

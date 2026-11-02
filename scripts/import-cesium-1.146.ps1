# Clone an exact, verified CesiumJS 1.146 upstream snapshot to a SEPARATE directory.
# This script never overwrites or replaces the user's current repository.
param([string]$Destination = '../cesium-official-1.146')
$ErrorActionPreference = 'Stop'
if (Test-Path $Destination) { throw "Target directory already exists: $Destination" }
git clone --depth 1 --single-branch --branch 1.146 https://github.com/CesiumGS/cesium.git $Destination
if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
Push-Location $Destination
try {
  $actual = (& git rev-parse HEAD).Trim()
  $expected = 'b8d3a36fe98a3e432eb89253c95d5f20e605e0f1'
  if ($actual -ne $expected) { throw "Unexpected upstream revision: $actual" }
  Write-Host "Official CesiumJS 1.146 is checked out at $actual"
  Write-Host 'Source is already imported into the project root on GitHub. This separate checkout is for auditing only.'
} finally {
  Pop-Location
}

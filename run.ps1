#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Setup,
    [string]$Urls = $env:ASPNETCORE_URLS
)

$ErrorActionPreference = 'Stop'
if (-not $Urls) { $Urls = 'http://127.0.0.1:5080' }
$environment = if ($Dev) { 'Development' } else { 'Production' }
$configuration = if ($Dev) { 'Debug' } else { 'Release' }
$previousAspNetEnvironment = $env:ASPNETCORE_ENVIRONMENT
$previousDotNetEnvironment = $env:DOTNET_ENVIRONMENT

Push-Location -LiteralPath $PSScriptRoot
try {
    $env:ASPNETCORE_ENVIRONMENT = $environment
    $env:DOTNET_ENVIRONMENT = $environment
    if ($Setup) {
        & dotnet run --project src/Nami.Api --configuration $configuration --no-launch-profile -- --setup
        exit $LASTEXITCODE
    }

    # npm.cmd works with Windows installations that also ship an npm.ps1 shim.
    $npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
    $vite = if ($env:OS -eq 'Windows_NT') { 'vite.cmd' } else { 'vite' }
    $installedLock = Get-Item 'frontend/node_modules/.package-lock.json' -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path "frontend/node_modules/.bin/$vite") -or
        -not $installedLock -or
        (Get-Item 'frontend/package-lock.json').LastWriteTimeUtc -gt $installedLock.LastWriteTimeUtc) {
        & $npm --prefix frontend ci
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    & $npm --prefix frontend run build -- --outDir ../src/Nami.Api/wwwroot --emptyOutDir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & dotnet run --project src/Nami.Api --configuration $configuration --no-launch-profile -- --urls $Urls
    exit $LASTEXITCODE
}
finally {
    $env:ASPNETCORE_ENVIRONMENT = $previousAspNetEnvironment
    $env:DOTNET_ENVIRONMENT = $previousDotNetEnvironment
    Pop-Location
}

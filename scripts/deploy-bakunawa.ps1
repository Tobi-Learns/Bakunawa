# Build, deploy, and initialize the Bakunawa contract on testnet.
# Identities (shared with StellarPay, ~/.config/stellar/identity):
#   platform  = admin (curator)      bakunawa-treasury = rake destination
# Dedicated Bakunawa treasury (Phase 2, 2026-07-14): GAABUAA3...W76I2B — its own
# account so Bakunawa rake doesn't mix with StellarPay's shared `stellarpay`.
# Stake asset: the StellarPay test USDC SAC (issuer = platform).
# Usage: .\scripts\deploy-bakunawa.ps1

$ErrorActionPreference = "Stop"
$USDC_SAC = "CAKBCKBUE3ZRSNH6CDYAB62ZFWL7U7OX6NBZ6EUDFID22PRLICFJXHGS"

Push-Location "$PSScriptRoot\..\contracts"
try {
    Write-Host "== build =="
    stellar contract build
    if ($LASTEXITCODE -ne 0) { throw "build failed" }

    Write-Host "== deploy =="
    $contractId = stellar contract deploy `
        --wasm target/wasm32v1-none/release/bakunawa.wasm `
        --network testnet --source-account platform
    if ($LASTEXITCODE -ne 0) { throw "deploy failed" }
    Write-Host "contract: $contractId"

    Write-Host "== initialize =="
    $admin = stellar keys address platform
    $treasury = stellar keys address bakunawa-treasury
    stellar contract invoke --network testnet --source-account platform `
        --id $contractId -- initialize `
        --admin $admin --token $USDC_SAC --treasury $treasury
    if ($LASTEXITCODE -ne 0) { throw "initialize failed" }

    Write-Host ""
    Write-Host "Bakunawa deployed + initialized."
    Write-Host "  contract  : $contractId"
    Write-Host "  admin     : $admin"
    Write-Host "  treasury  : $treasury"
    Write-Host "  stake SAC : $USDC_SAC"
    Write-Host "Record the contract id in docs/handoff.md and web env."
} finally {
    Pop-Location
}

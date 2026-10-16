param(
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Установите Node.js 22 или новее, затем повторите запуск.'
    }
    $majorVersion = & node -p 'parseInt(process.versions.node)'
    if ($LASTEXITCODE -ne 0 -or [int]$majorVersion -lt 22) {
        throw 'Для запуска нужен Node.js 22 или новее.'
    }

    if (-not (Test-Path -LiteralPath 'node_modules/ajv/package.json') -or
        -not (Test-Path -LiteralPath 'tools/ast-index/node_modules/.bin/ast-index.cmd')) {
        Write-Host 'Устанавливаем зависимости проекта...'
        & npm.cmd ci --cache .analysis/npm-cache
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости.' }
    }

    Write-Host 'Для остановки нажмите Ctrl+C.'
    $browserOpened = $false
    & npm.cmd start | ForEach-Object {
        Write-Host $_
        # Open only after the server reports its actual listening address.
        if ($OpenBrowser -and -not $browserOpened -and
            "$_" -match 'http://127\.0\.0\.1:(\d+)\s*$') {
            $browserOpened = $true
            try { Start-Process "http://127.0.0.1:$($Matches[1])" }
            catch { Write-Warning 'Не удалось открыть браузер. Откройте адрес выше вручную.' }
        }
    }
    $launchExitCode = $LASTEXITCODE
}
catch {
    Write-Host "Ошибка запуска: $($_.Exception.Message)" -ForegroundColor Red
    $launchExitCode = 1
}
finally {
    Pop-Location
}
exit $launchExitCode

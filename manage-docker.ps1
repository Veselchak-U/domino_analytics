param(
    [ValidateSet('Start', 'Stop', 'Update', 'Restart', 'Status', 'Logs', 'Backup')]
    [string]$Action = 'Start'
)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
    $dockerExe = if ($dockerCommand) { $dockerCommand.Source } else { $null }
    if (-not $dockerExe) {
        foreach ($candidate in @("$env:LOCALAPPDATA/Programs/DockerDesktop/resources/bin/docker.exe", "$env:ProgramFiles/Docker/Docker/resources/bin/docker.exe")) {
            if (Test-Path -LiteralPath $candidate) { $dockerExe = $candidate; break }
        }
    }
    if (-not $dockerExe) { throw 'Docker Desktop не найден. Установите его и откройте новое окно терминала.' }
    & $dockerExe info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Движок Docker недоступен. Запустите Docker Desktop в режиме Linux containers.' }
    $composeArguments = @('compose', '-p', 'domino-local', '-f', 'deploy/desktop/compose.yaml')
    function Invoke-Docker {
        param([string[]]$DockerArguments)
        & $dockerExe @DockerArguments
        if ($LASTEXITCODE -ne 0) { throw "Команда Docker завершилась с кодом $LASTEXITCODE" }
    }
    function Save-DatabaseBackup {
        $backendId = & $dockerExe @composeArguments ps -q backend
        if ($LASTEXITCODE -ne 0 -or -not $backendId) { throw 'Для резервной копии сначала запустите бэкенд через start-docker.cmd.' }
        $name = 'domino-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.sqlite'
        New-Item -ItemType Directory -Path '.analysis/backups' -Force | Out-Null
        Invoke-Docker -DockerArguments ($composeArguments + @('exec', '-T', 'backend', 'node', 'src/backup.js', "/data/backups/$name"))
        $backupPath = Join-Path $PSScriptRoot ".analysis/backups/$name"
        Invoke-Docker -DockerArguments @('cp', "${backendId}:/data/backups/$name", $backupPath)
        Write-Host "Резервная копия сохранена: $backupPath"
    }
    New-Item -ItemType Directory -Path '.analysis/docker-data/examples' -Force | Out-Null
    switch ($Action) {
        'Start' { Invoke-Docker -DockerArguments ($composeArguments + @('up', '-d', '--build', '--remove-orphans', '--wait', '--wait-timeout', '120')) }
        'Stop' { Invoke-Docker -DockerArguments ($composeArguments + @('stop')) }
        'Update' {
            $runningBackend = & $dockerExe @composeArguments ps -q backend
            if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить состояние бэкенда' }
            if ($runningBackend) { Save-DatabaseBackup }
            Invoke-Docker -DockerArguments ($composeArguments + @('build'))
            Invoke-Docker -DockerArguments ($composeArguments + @('up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '120'))
        }
        'Restart' {
            Invoke-Docker -DockerArguments ($composeArguments + @('restart'))
            Invoke-Docker -DockerArguments ($composeArguments + @('up', '-d', '--no-build', '--wait', '--wait-timeout', '120'))
        }
        'Status' { Invoke-Docker -DockerArguments ($composeArguments + @('ps', '-a')) }
        'Logs' { Invoke-Docker -DockerArguments ($composeArguments + @('logs', '--tail', '100')) }
        'Backup' { Save-DatabaseBackup }
    }
    if ($Action -in @('Start', 'Update', 'Restart')) { Write-Host 'Сайт: http://127.0.0.1:3210' }
    $operationExit = 0
} catch {
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
    $operationExit = 1
} finally { Pop-Location }
exit $operationExit

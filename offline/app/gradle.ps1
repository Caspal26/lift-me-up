# Run a Gradle task for the Android project with JDK 17 and a short temp
# folder (Java's local sockets fail on this machine when TEMP is long).
# Usage: powershell -File offline/app/gradle.ps1 assembleRelease
param([string[]]$Tasks = @('assembleRelease'))
$ErrorActionPreference = 'Stop'
$tmp = 'C:\gtmp'
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot'
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$tmp -Djava.io.tmpdir=$tmp"
$android = Join-Path $PSScriptRoot 'android'
$log = Join-Path $PSScriptRoot 'gradle.log'
$p = Start-Process -FilePath (Join-Path $android 'gradlew.bat') -ArgumentList ($Tasks + '--console=plain') `
  -WorkingDirectory $android -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -Wait -PassThru
Get-Content $log -Tail 8
if (Test-Path "$log.err") { Get-Content "$log.err" | Select-String -Pattern 'error|wrong|FAILED' -Context 0,6 | Select-Object -First 10 }
exit $p.ExitCode

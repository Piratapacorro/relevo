# Instalador de Relevo para Windows.
#
#   irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.ps1 | iex
#
# Comprueba lo que hace falta y PREGUNTA antes de instalar nada:
#   1. Node.js 18+ y git   (con winget, si faltan)
#   2. Antigravity CLI (agy), con el instalador oficial de Google
#   3. Relevo dentro de Claude Code (añade el plugin a ~/.claude/settings.json, con copia de seguridad)
#   4. Inicio de sesión de agy con tu cuenta de Google (solo si hace falta)
# Nunca pide ni guarda contraseñas: el inicio de sesión lo haces tú en el navegador.

& {
  # 'Continue': en PowerShell 5.1, con 'Stop', cualquier texto que un programa escriba en stderr aborta el script.
  $ErrorActionPreference = 'Continue'
  $raw = 'https://raw.githubusercontent.com/Piratapacorro/relevo/main'
  $dry = $env:RELEVO_DRY_RUN -eq '1'
  $fake = @()
  if ($env:RELEVO_FAKE_MISSING) { $fake = $env:RELEVO_FAKE_MISSING -split ',' }

  function Titulo([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
  function Ok([string]$t) { Write-Host "  [OK] $t" -ForegroundColor Green }
  function Aviso([string]$t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
  function Fallo([string]$t) { Write-Host "  [X]  $t" -ForegroundColor Red }
  function Pregunta([string]$t) {
    if ($env:RELEVO_YES -eq '1') { return $true }
    $r = Read-Host "  $t [S/n]"
    return ($r -eq '' -or $r -match '^(s|si|sí|y|yes)$')
  }
  function Ejecuta([string]$desc, [scriptblock]$accion) {
    if ($dry) { Write-Host "  (simulación) $desc" -ForegroundColor DarkGray; return }
    & $accion
  }
  function Recarga-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
  function Tiene([string]$cmd) {
    if ($fake -contains $cmd) { return $null }
    return Get-Command $cmd -ErrorAction SilentlyContinue
  }
  function Instala-Winget([string]$nombre, [string]$id) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Fallo "No encuentro winget para instalar $nombre. Instálalo a mano y vuelve a ejecutar este instalador."
      return $false
    }
    if (-not (Pregunta "Falta $nombre. ¿Lo instalo ahora con winget?")) { return $false }
    Ejecuta "winget install $id" { winget install -e --id $id --accept-source-agreements --accept-package-agreements | Out-Host }
    Recarga-Path
    return $true
  }

  Write-Host ''
  Write-Host '  Relevo · Claude Code + Gemini como un equipo' -ForegroundColor White
  Write-Host '  -------------------------------------------'

  # 1. Node.js y git ---------------------------------------------------------
  Titulo '1/4  Node.js y git'
  $node = Tiene 'node'
  if ($node) {
    $v = (& node -v).TrimStart('v')
    if ([int]($v.Split('.')[0]) -lt 18) { Aviso "Tienes Node.js $v y hace falta 18 o superior."; $node = $null }
    else { Ok "Node.js $v" }
  }
  if (-not $node) {
    $done = Instala-Winget 'Node.js' 'OpenJS.NodeJS.LTS'
    if (-not $done -or (-not $dry -and -not (Get-Command node -ErrorAction SilentlyContinue))) {
      Fallo 'Relevo necesita Node.js 18+. Descárgalo de https://nodejs.org (versión LTS), cierra esta ventana y vuelve a empezar.'
      return
    }
    Ok 'Node.js instalado'
  }
  if (Tiene 'git') { Ok ((& git --version) -replace '^git version ', 'git ') }
  else {
    $done = Instala-Winget 'git' 'Git.Git'
    if (-not $done -or (-not $dry -and -not (Get-Command git -ErrorAction SilentlyContinue))) {
      Fallo 'Relevo necesita git. Descárgalo de https://git-scm.com, cierra esta ventana y vuelve a empezar.'
      return
    }
    Ok 'git instalado'
  }

  # 2. Antigravity CLI (agy) ---------------------------------------------------
  Titulo '2/4  Gemini: Antigravity CLI (agy)'
  $agy = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
  if ($fake -contains 'agy' -or -not (Test-Path $agy)) {
    $g = Get-Command agy.exe -ErrorAction SilentlyContinue
    if ($g -and -not ($fake -contains 'agy')) { $agy = $g.Source }
    else {
      if (-not (Pregunta 'Falta la Antigravity CLI (agy), la herramienta oficial de Google. ¿La instalo ahora?')) {
        Fallo 'Sin agy, Gemini no puede trabajar. Instálala cuando quieras: irm https://antigravity.google/cli/install.ps1 | iex'
        return
      }
      # En otro proceso: el instalador oficial termina con "exit".
      Ejecuta 'instalador oficial de agy' { powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://antigravity.google/cli/install.ps1 | iex' | Out-Host }
      if (-not $dry -and -not (Test-Path $agy)) { Fallo 'La instalación de agy no terminó bien. Revisa el mensaje de arriba.'; return }
    }
  }
  Ok "agy en $agy"

  # 3. Relevo en Claude Code -----------------------------------------------------
  Titulo '3/4  Relevo en Claude Code'
  $tmp = Join-Path $env:TEMP 'relevo-install.cjs'
  if ($env:RELEVO_SOURCE) { Copy-Item (Join-Path $env:RELEVO_SOURCE 'install.cjs') $tmp -Force }  # pruebas locales
  else {
    try { Invoke-WebRequest "$raw/install.cjs" -OutFile $tmp -UseBasicParsing } catch { Fallo "No pude descargar Relevo de GitHub: $($_.Exception.Message)"; return }
  }
  $env:RELEVO_QUIET = '1'
  $global:LASTEXITCODE = 0
  # stderr llega como ErrorRecord en PowerShell 5.1: mostramos solo su texto, sin líneas vacías.
  Ejecuta 'activar Relevo en ~/.claude/settings.json' {
    & node $tmp 2>&1 | ForEach-Object {
      $t = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.TargetObject } else { $_ }
      if ("$t".Trim()) { "  $("$t".Trim())" }
    } | Out-Host
  }
  $codigo = $LASTEXITCODE
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Remove-Item Env:RELEVO_QUIET -ErrorAction SilentlyContinue
  if ($codigo -ne 0) { Fallo 'No se pudo activar Relevo en Claude Code (mira el mensaje de arriba).'; return }

  # 4. Sesión de Google en agy ----------------------------------------------------
  Titulo '4/4  Tu cuenta de Google en agy'
  $sesion = $false
  if (-not $dry -and (Test-Path $agy)) {
    Push-Location $env:TEMP
    $models = (& $agy models 2>$null) -join "`n"
    Pop-Location
    $sesion = $models -match '(?m)^gemini-'
  }
  if ($sesion) { Ok 'Sesión iniciada' }
  else {
    Aviso 'Falta iniciar sesión en agy con tu cuenta de Google (AI Pro o Ultra).'
    Write-Host '       Se abrirá agy y tu navegador: entra con tu cuenta de Google.'
    Write-Host '       Cuando en esta ventana aparezca el chat de agy, escribe /exit y pulsa Enter.'
    if (Pregunta '¿Abrimos agy para iniciar sesión ahora?') {
      Ejecuta 'abrir agy para iniciar sesión' {
        Push-Location $env:TEMP
        try { & $agy } finally { Pop-Location }
      }
    } else {
      Aviso "Cuando quieras, abre una terminal y ejecuta: & `"$agy`""
    }
  }

  Write-Host ''
  Write-Host '  ¡Listo! Ahora:' -ForegroundColor Green
  Write-Host '    1. Cierra y vuelve a abrir la app de Claude (o Claude Code en la terminal).'
  Write-Host '    2. Abre una sesión en la carpeta de tu proyecto y escribe:  /relevo:iniciar'
  Write-Host '    3. Después pide trabajo al equipo, por ejemplo:  /relevo:equipo añade un formulario de contacto'
  Write-Host ''
}

$ErrorActionPreference = "Continue"

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "Second Brain runtime dependency check"

if (-not (Test-Command "python") -and -not (Test-Command "py")) {
  if (Test-Command "winget") {
    Write-Host "Installing Python 3.12 with winget..."
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  } else {
    Write-Host "winget is unavailable. Install Python 3.10+ manually if Second Brain reports a missing runtime."
  }
}

if (-not (Test-Command "uv")) {
  Write-Host "Installing uv..."
  powershell -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
}

$env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:Path"

if (Test-Command "uv") {
  Write-Host "Installing Graphify with file support..."
  uv tool install --upgrade "graphifyy[all]"
  uv tool ensurepath
} else {
  Write-Host "uv was not found after install attempt."
}

if (Test-Command "py") {
  py -3.10 -m pip install --user --upgrade fpdf2
} elseif (Test-Command "python") {
  python -m pip install --user --upgrade fpdf2
}

Write-Host "Second Brain runtime dependency check complete."

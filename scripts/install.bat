@echo off
setlocal EnableDelayedExpansion

set "INSTALL_DIR=%LOCALAPPDATA%\STT-Popup"
set "SOURCE_DIR=%~dp0."
set "EXE_NAME=STT-Popup.exe"
set "SHORTCUT=%USERPROFILE%\Desktop\STT Popup.lnk"

echo STT Popup Installer
echo.

if exist "%INSTALL_DIR%" (
  echo Removing previous install at %INSTALL_DIR% ...
  rmdir /s /q "%INSTALL_DIR%"
  if errorlevel 1 (
    echo ERROR: Could not remove old install. Close STT Popup and try again.
    pause
    exit /b 1
  )
)

echo Installing to %INSTALL_DIR% ...
xcopy /e /i /q "%SOURCE_DIR%" "%INSTALL_DIR%\" >/dev/null
if errorlevel 1 (
  echo ERROR: Copy failed.
  pause
  exit /b 1
)

echo Creating desktop shortcut...
powershell -NoProfile -Command " = New-Object -ComObject WScript.Shell;  = .CreateShortcut('%SHORTCUT%'); .TargetPath = '%INSTALL_DIR%\%EXE_NAME%'; .WorkingDirectory = '%INSTALL_DIR%'; .Save()"

echo.
echo Done. STT Popup installed to %INSTALL_DIR%
echo Shortcut created on Desktop.
pause

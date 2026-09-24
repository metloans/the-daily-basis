@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==============================================
echo The Daily Basis - Netlify server data deploy
echo ==============================================
echo.

where netlify >nul 2>nul
if errorlevel 1 (
  echo Netlify CLI is not installed.
  echo First install Node.js from https://nodejs.org if needed, then run:
  echo   npm install -g netlify-cli
  echo.
  pause
  exit /b 1
)

echo Step 1 - Sign in to Netlify if prompted.
netlify login
if errorlevel 1 goto :fail

echo.
echo Step 2 - Link this folder to your EXISTING thedailybasis project.
echo Choose: Use current git remote or Search by project name, then select thedailybasis.
netlify link
if errorlevel 1 goto :fail

echo.
echo Step 3 - Create a DRAFT deploy first.
netlify deploy --dir=public --functions=netlify/functions
if errorlevel 1 goto :fail

echo.
echo Open the draft URL printed above and test both:
echo   /api/market-data
echo   /
echo.
set /p GO=If the draft looks correct, type YES to publish to production: 
if /I not "%GO%"=="YES" (
  echo Production deploy cancelled. Nothing changed on your live site.
  pause
  exit /b 0
)

echo.
echo Publishing to https://thedailybasis.netlify.app ...
netlify deploy --prod --dir=public --functions=netlify/functions
if errorlevel 1 goto :fail

echo.
echo DEPLOY COMPLETE.
echo Verify:
echo   https://thedailybasis.netlify.app/api/market-data
echo   https://thedailybasis.netlify.app/
echo.
pause
exit /b 0

:fail
echo.
echo Deployment stopped because a Netlify command returned an error.
echo Your current production site was not intentionally replaced unless the --prod step had already completed.
pause
exit /b 1

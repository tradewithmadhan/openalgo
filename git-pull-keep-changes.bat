@echo off
echo --------------------------------------
echo Pulling latest changes while keeping local changes...
echo --------------------------------------

REM Step 1: Check Git status
git status --porcelain > tmp_status.txt
setlocal enabledelayedexpansion
set CHANGES=false
for /f %%i in (tmp_status.txt) do (
    set CHANGES=true
)
del tmp_status.txt

REM Step 2: If changes exist, stash them
if "%CHANGES%"=="true" (
    echo Local changes detected. Stashing before pull...
    git stash push -m "Auto-stash before pull"
) else (
    echo No local changes detected.
)

REM Step 3: Pull latest changes
echo Pulling from remote...
git pull
if errorlevel 1 (
    echo ❌ Pull failed. Resolve issues manually.
    exit /b 1
)

REM Step 4: Reapply local changes if any were stashed
if "%CHANGES%"=="true" (
    echo Reapplying local changes...
    git stash pop
    if errorlevel 1 (
        echo ⚠️ Conflicts detected! Please resolve them manually.
        exit /b 1
    )
)

echo ✅ Pull completed. Local changes restored if any.
pause
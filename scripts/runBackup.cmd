@echo off
REM CashFlow — Scheduled Turso Backup wrapper (Windows Task Scheduler).
REM Memastikan working directory benar + safety guard BACKUP_TURSO=1,
REM lalu menjalankan scripts\backupTurso.mjs dengan log ke backups\backup-scheduler.log.
REM
REM Registrasi task (sekali saja):
REM   schtasks /create /tn "CashFlowTursoBackup" /tr "D:\Workspace\cashflow\scripts\runBackup.cmd" /sc daily /st 02:00 /f
REM
REM Test manual:
REM   schtasks /run /tn "CashFlowTursoBackup"

cd /d "%~dp0.."
set BACKUP_TURSO=1
if not exist backups mkdir backups
node scripts\backupTurso.mjs >> backups\backup-scheduler.log 2>&1
exit /b %ERRORLEVEL%

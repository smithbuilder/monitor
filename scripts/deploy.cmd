@echo off
REM Deploy monitor bot on HP laptop (Windows Docker Desktop)
cd /d C:\Users\olive\Projects\monitor
docker compose -f docker-compose.hp.yml up -d --build

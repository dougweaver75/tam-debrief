@echo off
cd /d "%~dp0"
python -m pip install --user -r requirements.txt --quiet
python app.py
pause

@echo off
echo ============================================
echo   FinancesPro - Iniciando servidor local...
echo ============================================
echo.

REM Tenta Python 3
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Servidor rodando em: http://localhost:8080
    echo Pressione Ctrl+C para encerrar.
    echo.
    start "" "http://localhost:8080/gestao-financeira.html"
    python -m http.server 8080
    goto :end
)

REM Tenta py launcher
py --version >nul 2>&1
if %errorlevel% == 0 (
    echo Servidor rodando em: http://localhost:8080
    echo Pressione Ctrl+C para encerrar.
    echo.
    start "" "http://localhost:8080/gestao-financeira.html"
    py -m http.server 8080
    goto :end
)

echo ERRO: Python nao encontrado.
echo Instale o Python em https://python.org e tente novamente.
echo.
pause

:end

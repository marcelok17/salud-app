# Salud — la app

Esta carpeta es **solo la interfaz**: HTML, service worker, manifest e iconos.

**No contiene ningún dato de salud.** El tablero, los registros y la bitácora viven
en un repositorio privado aparte; la app los pide a la API de GitHub con un token
personal que se guarda únicamente en el navegador de su dueño. Quien abra esta
página sin ese token solo ve la pantalla de conectar.

Se publica así, en un repo público aparte, porque GitHub Pages no funciona sobre
repositorios privados en cuentas Free — y el repositorio con los datos debe
seguir siendo privado.

Para probarla localmente con service worker (hace falta http, no `file://`):

    python3 herramientas/servir_app.py

La corrección de código principal ya parece resuelta, pero todavía no puede declararse “todo corregido” porque el smoke test de instalación no está bien preparado y la ejecución global continúa roja.
Revisé el commit actual c8cb315d44daf7f1b81add59ad0bc00b6a15753b.
Correcciones verificadas
Estas pruebas ahora pasan realmente en Windows:
Ejecución de un .cmd real.
Conservación exacta de A&B.
Conservación exacta de %PATH%.
Conservación exacta de !value!.
Ejecución de npm.cmd.
Resolución de rutas Windows.
Suite completa en Windows con Node 20.
Suite completa en Windows con Node 24.
Compilación en ambas versiones.
Probé además npm.cmd con metacaracteres y el proceso recibió correctamente:
A&B %PATH% !value!
Por tanto, el problema crítico del quoting y la resolución de shims Windows está corregido.
Estado de GitHub Actions
Última ejecución: GitHub Actions #31260890187.
Etapa	Windows 20	Windows 24
Instalar dependencias	Correcto	Correcto
Ejecutar 62 pruebas	Correcto	Correcto
Compilar	Correcto	Correcto
Smoke test Salesforce CLI	Falló	Falló


El fallo actual es del entorno CI
El smoke test falla antes de instalar MetaDelta:
The term 'sf' is not recognized
El runner windows-latest no tiene Salesforce CLI instalado. El workflow ejecuta directamente:
sf plugins install ".\$tarball"
pero nunca instala @salesforce/cli.
Esto no demuestra un defecto actual de MetaDelta, pero impide comprobar los dos puntos finales:
Instalación real del tarball en Salesforce CLI Windows.
Confirmación definitiva de que desapareció Class extends value undefined.
La matriz necesita instalar Salesforce CLI antes del smoke test, por ejemplo con npm, validar sf --version y luego instalar el tarball. También deberá contemplar cualquier confirmación requerida para instalar un plugin local/no firmado en CI.
Estado final
Área	Estado
Resolución de .cmd	Corregido
Quoting/escaping de argumentos	Corregido y probado
SOQL como argumento separado	Corregido
Rutas Windows	Corregido
Wrapper oclif	Simplificado y corregido en código
Tests Windows Node 20/24	Correctos
Compilación Windows	Correcta
Instalación real del tarball	No verificada
Carga de security users --help	No verificada
Workflow global	Rojo por ausencia de sf


Veredicto: el código de compatibilidad Windows ya supera los bloqueos encontrados, pero falta corregir el setup del smoke test y obtener una ejecución completamente verde antes de fusionar o publicar
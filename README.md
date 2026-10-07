# CMMS Optimus

Aplicación estática de Víctor A. Cortés M. para explorar datasets CMMS/GMAO en el navegador. Los CSV de los grupos A–D vienen incluidos como archivos de la aplicación, pero no se cargan automáticamente; el usuario inicia cada sesión vacía y selecciona los datasets que desea analizar. Los archivos se procesan localmente y no se envían a un servidor.

## Probar en local

Al abrir `index.html`, la sesión comienza sin datasets y muestra una bienvenida para invitar al usuario a cargar archivos CSV. Las muestras A–D figuran como opciones en la barra lateral, pero ni sus datos ni los gráficos se muestran hasta que se elige una muestra o se carga un CSV. Después de una carga válida, el recuadro y la notificación confirman **«Tus datasets se encuentran listos para analizar»**. Pulsa **Seleccionar dataset CSV** (o arrastra los archivos) para empezar; **Restaurar grupos A–D** carga los archivos de ejemplo incluidos. La página identifica a su autor como **Víctor A. Cortés M.** Las bibliotecas del panel se descargan desde CDN, así que necesitas conexión a Internet. Para desarrollo también puedes servir la carpeta por HTTP desde PowerShell:

```powershell
Set-Location .\webapp
py -m http.server 8000
```

Abre `http://localhost:8000`. También puedes usar una extensión de servidor local de VS Code.

## Cargar datasets

Selecciona o arrastra uno o más archivos CSV. La aplicación admite internamente hasta 10 datasets diferentes por sesión. La barra lateral muestra los grupos A–D como muestras disponibles y permite cargarlos opcionalmente; también lista los datasets ya cargados y ofrece **Todos** cuando existe más de uno. El selector **Grupo / Dataset** contiene los análisis cargados. Si se alcanza el límite, la aplicación informa cuáles archivos no pudo agregar. Los datasets cargados se conservan temporalmente en memoria mientras la página permanezca abierta; al recargar o cerrar, se inicia una sesión vacía. Los datos no se envían ni se guardan en un servidor. Los archivos de muestra A–D también están disponibles en `Data/` y se pueden cargar juntos con **Restaurar grupos A–D**. Se requieren las columnas `OT`, `Tipo_mantenimiento`, `Estado`, `Fecha_inicio`, `Fecha_fin`, `Equipo`, `Modo_falla`, `Downtime_h`, `Horas_mano_obra` y `Costo_total_CLP`. Se aceptan fechas `d-m-Y` y `Y-m-d`, valores numéricos decimales con punto o coma y separadores de miles habituales (por ejemplo, `1.234,56` o `1,234.56`). Si aparece un solo separador seguido de exactamente tres dígitos, se interpreta como separador de miles salvo que el entero sea `0`. El nombre del archivo determina el grupo cuando contiene `grupo_A`, `grupo_B`, etc.

El panel calcula indicadores, MTTR, diagramas Pareto y Jack-Knife. Los gráficos e indicadores visibles responden al filtro de grupo. El informe PDF se genera para la selección activa; el CSV de resumen incluye todos los datasets cargados.

## Publicar en GitHub Pages

El flujo [`../.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) publica el contenido de `webapp` al hacer push a la rama `main` o al ejecutarlo manualmente.

1. Sube la carpeta `webapp` y el flujo de trabajo al repositorio.
2. En GitHub, abre **Settings → Pages** y selecciona **GitHub Actions** como fuente de publicación.
3. Envía un cambio a `main` o ejecuta manualmente **Deploy CMMS webapp to GitHub Pages** desde **Actions**.

Las bibliotecas de CSV, gráficos y PDF, además de las fuentes, se obtienen de CDN; la aplicación requiere conexión a Internet para cargarlas.

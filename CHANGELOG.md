# Changelog

## 1.0.0

The first publishable release: the aardio folder is a setting, and the skills ship inside the package.

- **The installation folder is configurable.** `Config.aardioRoot` is declared volatile, which is what makes DSH project a settings form for it, and a save applies in place without restarting the plugin. The form renders on the bundle's own page and on the row page, with a typed path, a native folder picker, save, and an auto-detect reset. No hard-coded path remains.
- **Auto-detection and environment fallback.** `AARDIO_ROOT`/`AARDIO_HOME` and a probe of the usual install folders keep a fresh install working without any configuration.
- **New tool `aardio_env`.** Reports the resolved folder, its source, whether `aardio.exe` is present, and every probed folder, so a wrong path is diagnosable without guessing.
- **The bundled skills are installation-independent.** They no longer name an absolute aardio path; they send the model to `aardio_env` and `aardio_docs` instead. The `aardio` skill also gained the project-first procedure.
- **Publishable packaging.** MIT license, English and Chinese READMEs, a Plugins-page detail image, localized display metadata, exported `./client` and `./locale/*.json`, an explicit `files` list, and an offline `node --test` suite covering installation resolution, search, skills, tools, and packaging.
- **Robust loading.** Host code imports only Node built-ins; the schemastery peer is resolved through the running installation when a linked checkout has no `node_modules`, and its absence degrades to environment detection instead of failing activation.

## 0.1.0

- Initial knowledge-layer plugin: three bundled aardio skills, `aardio_docs`, and `aardio_open`, with the installation path taken from the row config or a hard-coded default.

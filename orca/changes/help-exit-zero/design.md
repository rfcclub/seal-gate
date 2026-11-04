# Design

`usage(code = 2)` takes its exit code. `run()` calls `usage(0)` for `help` and `-h` as the command, and for `--help`, which `parseArgs` stores as `parsed.help`. A missing command and every other misuse keep `usage()` with exit 2. The test runs the built `dist/cli.js` with `spawnSync`, under Bun and under Vitest; `vitest.config.mjs` includes `tests/cli/**` for Orca's evidence.

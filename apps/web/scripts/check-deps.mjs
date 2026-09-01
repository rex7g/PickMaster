/**
 * Guarda de dependencias: convierte el críptico
 * "Module not found: Can't resolve 'viem'" de webpack en una instrucción
 * accionable. Se ejecuta como predev/prebuild.
 *
 * Causa habitual: se instaló node_modules antes de que una dependencia se
 * añadiera al package.json y luego se hizo `git pull` sin reinstalar.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(appDir, "package.json"));
const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));

const missing = [];
for (const name of Object.keys(pkg.dependencies ?? {})) {
  try {
    require.resolve(name);
  } catch {
    missing.push(name);
  }
}

if (missing.length > 0) {
  const list = missing.map((m) => `  · ${m}`).join("\n");
  console.error(
    `\n\x1b[31m✖ Faltan dependencias instaladas:\x1b[0m\n${list}\n\n` +
      `\x1b[33mSolución:\x1b[0m ejecuta \x1b[1mnpm install\x1b[0m en la RAÍZ del repositorio\n` +
      `(este es un monorepo con workspaces; instalar dentro de apps/web no basta\n` +
      `si node_modules quedó desactualizado tras un git pull).\n\n` +
      `    cd $(git rev-parse --show-toplevel 2>/dev/null || echo "<raiz-del-repo>")\n` +
      `    npm install\n    npm run dev\n`,
  );
  process.exit(1);
}

// Copies Church Ops' shared rules (shared/ops) into the ops Edge Function (Deno wants ".ts" on
// relative imports). Run before deploying: node supabase/build-ops.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "shared", "ops");
const to = path.join(root, "supabase", "functions", "ops", "lib");
fs.mkdirSync(to, { recursive: true });
for (const f of ["rbac.ts", "workflow.ts", "state-machine.ts", "math.ts", "types.ts", "billing.ts", "checkin.ts", "jobs.ts", "crm.ts", "estimating.ts", "projects.ts", "purchasing.ts", "invoicing.ts"]) {
  const src = fs.readFileSync(path.join(from, f), "utf8").replace(/from "(\.\/[\w-]+)"/g, 'from "$1.ts"');
  fs.writeFileSync(path.join(to, f), `// Generated from shared/ops/${f} by supabase/build-ops.mjs — edit that file instead.\n${src}`);
}
console.log(`ops lib → ${path.relative(root, to)}`);

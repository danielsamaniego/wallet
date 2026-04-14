#!/usr/bin/env node

/**
 * Layer Violation Checker — Wallet Service (Hexagonal Architecture)
 *
 * Enforces the dependency rule:
 *   domain → application → infrastructure
 *   (inner layers must NOT import from outer layers)
 *
 * Rules:
 * - domain/ must NOT import from application/, infrastructure/, middleware/
 * - application/ must NOT import from infrastructure/, middleware/
 * - utils/kernel/ must NOT import from utils/infrastructure/, middleware/
 * - utils/application/ must NOT import from utils/infrastructure/, middleware/
 *
 * Usage: node scripts/check-layer-violations.cjs <file1> <file2> ...
 * Exit code 0 = pass, 1 = violations found
 */

const fs = require("fs");
const path = require("path");

/**
 * Returns forbidden import segments for a given file path.
 * If the file is in domain/, it cannot import infrastructure/ or middleware/.
 * If the file is in application/, it cannot import infrastructure/ or middleware/.
 */
function getForbiddenImports(filePath) {
  const normalized = filePath.replace(/\\/g, "/");

  // domain layer — purest, cannot import application, infrastructure, or middleware
  if (normalized.includes("/domain/")) {
    return ["application", "infrastructure", "middleware"];
  }

  // application layer — no infra dependencies
  if (normalized.includes("/application/")) {
    return ["infrastructure", "middleware"];
  }

  // utils/kernel — domain-safe, no app or infra
  if (normalized.includes("/utils/kernel/")) {
    return ["application", "infrastructure", "middleware"];
  }

  // utils/application — no infra
  if (normalized.includes("/utils/application/")) {
    return ["infrastructure", "middleware"];
  }

  return [];
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];
  const forbidden = getForbiddenImports(filePath);

  if (forbidden.length === 0) return violations;

  const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmed = line.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Allow "import type" — type-only imports are erased at compile time
    // and don't create a runtime dependency.
    if (/^import\s+type\b/.test(trimmed)) continue;

    let match;
    importRegex.lastIndex = 0;

    while ((match = importRegex.exec(line)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;

      // Only check relative imports and alias imports
      if (!importPath.startsWith(".") && !importPath.startsWith("@/")) continue;

      for (const layer of forbidden) {
        if (importPath.includes(`/${layer}/`) || importPath.includes(`${layer}/`)) {
          violations.push({
            file: filePath,
            line: lineNum + 1,
            importLayer: layer,
            importPath,
            context: trimmed.substring(0, 120),
          });
        }
      }
    }
  }

  return violations;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.exit(0);
}

let allViolations = [];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  if (path.extname(file) !== ".ts") continue;
  allViolations = allViolations.concat(checkFile(file));
}

if (allViolations.length > 0) {
  console.log("\n=== Layer Violation Check ===\n");

  for (const v of allViolations) {
    console.log(`[ERROR] ${v.file}:${v.line}`);
    console.log(`  Inner layer must not import from ${v.importLayer}/`);
    console.log(`  Import: ${v.importPath}`);
    console.log(`  > ${v.context}\n`);
  }

  console.log(`Found ${allViolations.length} layer violation(s). Fix before committing.\n`);
  console.log("domain/ and application/ must not import from infrastructure/ or middleware/.");
  console.log("See AGENTS.md and docs/architecture/backend-architecture.md.");
  process.exit(1);
}

process.exit(0);

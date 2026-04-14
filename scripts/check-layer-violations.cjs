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
 * - use cases must NOT import from other use cases (each is independent)
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

  // ── Use case isolation: a use case must not import from another use case ──
  //
  // Each command/query folder under application/ is independent.
  // For example, application/command/deposit/usecase.ts must NOT import
  // from application/command/transfer/ or application/query/getWallet/.
  // This prevents hidden coupling between use cases.
  // "import type" is allowed (DTOs, result types shared via ports).

  const usecaseMatch = filePath.replace(/\\/g, "/").match(
    /\/application\/(?:command|query)\/([^/]+)\//
  );

  if (usecaseMatch) {
    const ownFolder = usecaseMatch[1]; // e.g. "deposit", "transfer", "getWallet"
    const usecaseImportRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      const trimmed = line.trim();

      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (/^import\s+type\b/.test(trimmed)) continue;

      let match;
      usecaseImportRegex.lastIndex = 0;

      while ((match = usecaseImportRegex.exec(line)) !== null) {
        const importPath = match[1];
        if (!importPath) continue;
        if (!importPath.startsWith(".") && !importPath.startsWith("@/")) continue;

        // Check if importing from a sibling use case folder.
        // Two detection strategies:
        //   1. Absolute alias: @/wallet/application/command/<other>/...
        //   2. Relative: ../otherFolder/... (navigates to a sibling folder)

        // Strategy 1: alias imports with explicit command/ or query/ segment
        const absMatch = importPath.match(/\/(?:command|query)\/([^/]+)\//);
        if (absMatch && absMatch[1] !== ownFolder) {
          violations.push({
            file: filePath,
            line: lineNum + 1,
            importLayer: absMatch[1],
            importPath,
            context: trimmed.substring(0, 120),
          });
          continue;
        }

        // Strategy 2: relative imports like "../otherFolder/usecase.js"
        // Only match exactly one "../" (direct sibling), not "../../" (parent traversal).
        const relMatch = importPath.match(/^\.\.\/([^./][^/]*)\//);
        if (relMatch && !importPath.startsWith("../../") && relMatch[1] !== ownFolder) {
          violations.push({
            file: filePath,
            line: lineNum + 1,
            importLayer: relMatch[1],
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

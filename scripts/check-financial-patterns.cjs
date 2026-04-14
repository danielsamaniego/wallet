#!/usr/bin/env node

/**
 * Financial Safety Pattern Checker — Wallet Service
 *
 * Detects anti-patterns that could cause financial bugs in BigInt-based code:
 * - Floating-point operations on money (parseFloat, Number, toFixed)
 * - Math.round/floor/ceil on money fields
 * - Direct arithmetic on money fields with JS operators instead of BigInt
 *
 * Usage: node scripts/check-financial-patterns.cjs <file1> <file2> ...
 * Exit code 0 = pass, 1 = violations found
 */

const fs = require("fs");
const path = require("path");

const PATTERNS = [
  {
    id: "PARSE_FLOAT_MONEY",
    severity: "error",
    regex: /parseFloat\s*\([^)]*(?:amount|balance|cents|price|fee)/gi,
    message: "parseFloat on money field — all money is BigInt cents. Never use floats.",
  },
  {
    id: "TO_FIXED_MONEY",
    severity: "error",
    regex: /(?:amount|balance|cents|price|fee)\S*\.toFixed\s*\(/gi,
    message: ".toFixed() on money field — money is BigInt cents, not floating-point.",
  },
  {
    id: "MATH_ROUND_MONEY",
    severity: "error",
    regex: /Math\.(?:round|floor|ceil)\s*\([^)]*(?:amount|balance|cents|price|fee)/gi,
    message: "Math rounding on money field — BigInt cents don't need rounding.",
  },
  {
    id: "FLOAT_ARITHMETIC_MONEY",
    severity: "error",
    regex: /(?:parseFloat|Number)\s*\([^)]*(?:amount|balance|cents)[^)]*\)\s*[\+\-\*\/]/gi,
    message: "Float arithmetic on money — convert to BigInt first, never compute with Number/parseFloat.",
  },
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (const pattern of PATTERNS) {
    let match;
    pattern.regex.lastIndex = 0;

    while ((match = pattern.regex.exec(content)) !== null) {
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const line = lines[lineNumber - 1]?.trim() || "";

      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("import ")) {
        continue;
      }

      violations.push({
        file: filePath,
        line: lineNumber,
        pattern: pattern.id,
        severity: pattern.severity,
        message: pattern.message,
        context: line.substring(0, 120),
      });
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
  console.log("\n=== Financial Safety Pattern Check ===\n");

  let errorCount = 0;
  for (const v of allViolations) {
    console.log(`[ERROR] ${v.file}:${v.line}`);
    console.log(`  ${v.message}`);
    console.log(`  > ${v.context}\n`);
    errorCount++;
  }

  console.log(`Found ${errorCount} financial safety violation(s). Fix before committing.\n`);
  console.log("All money must be BigInt cents. See AGENTS.md conventions.");
  process.exit(1);
}

process.exit(0);

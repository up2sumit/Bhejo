import fs from "node:fs";
import path from "node:path";

const exts = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const skipDirs = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage"]);

const root = process.argv[2] || process.cwd();
const dryRun = process.argv.includes("--dry");

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      walk(p);
      continue;
    }
    const ext = path.extname(ent.name);
    if (!exts.has(ext)) continue;

    const original = fs.readFileSync(p, "utf8");
    let updated = original;

    // Fix patterns where "...X" got corrupted into ".X"
    // Examples:
    //   { ...obj }      -> { ...obj }
    //   [a, ...rest]    -> [a, ...rest]
    //   fn(...args)     -> fn(...args)
    //   push(...list)   -> push(...list)
    //
    // IMPORTANT: this targets ONLY delimiter + optional spaces + "." + identifier-start.
    updated = updated
      // "{ ...foo" -> "{ ...foo"
      .replace(/\{\s*\.(?=[A-Za-z_$])/g, "{ ...")
      // "[ ...foo" -> "[ ...foo"
      .replace(/\[\s*\.(?=[A-Za-z_$])/g, "[ ...")
      // "(...foo" -> "(...foo"
      .replace(/\(\s*\.(?=[A-Za-z_$])/g, "(...")
      // ", ...foo" -> ", ...foo"
      .replace(/,\s*\.(?=[A-Za-z_$])/g, ", ...");

    if (updated !== original) {
      // Print a small summary
      const changedLines = [];
      const oLines = original.split("\n");
      const uLines = updated.split("\n");
      const max = Math.max(oLines.length, uLines.length);
      for (let i = 0; i < max; i++) {
        if (oLines[i] !== uLines[i]) {
          changedLines.push(i + 1);
          if (changedLines.length >= 8) break;
        }
      }

      console.log(
        `${dryRun ? "[DRY]" : "[FIX]"} ${p}  changed lines (first few): ${changedLines.join(", ")}`
      );

      if (!dryRun) {
        fs.writeFileSync(p, updated, "utf8");
      }
    }
  }
}

console.log(`Scanning: ${root}`);
walk(root);
console.log(dryRun ? "Dry run complete (no files written)." : "Fix complete (files updated).");

#!/usr/bin/env bash
# grep-sinks.sh — Inventory dangerous sinks in a JS/TS codebase.
# Output is a raw list per category; each hit needs a context read.
# Called by the security-audit skill during Phase 1 (attack-surface mapping).
#
# Usage:
#   ./grep-sinks.sh [target-dir]
#
# Requires ripgrep (rg). Safe to run on any directory.

set -euo pipefail
DIR="${1:-.}"
RG_BASE="rg --no-messages --hidden -n --type-add 'js:*.{js,cjs,mjs,jsx}' --type-add 'ts:*.{ts,tsx,mts,cts}' --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!coverage'"

section() {
  echo
  echo "================================================================"
  echo "# $1"
  echo "================================================================"
}

section "Code execution primitives"
$RG_BASE -e '\beval\s*\(' -e '\bnew\s+Function\s*\(' --type ts --type js "$DIR" || true
$RG_BASE -e '\bvm\.(runInThisContext|runInNewContext|runInContext|createContext|compileFunction|Script)\b' --type ts --type js "$DIR" || true

section "Shell / subprocess"
$RG_BASE -e '\bchild_process\b' -e '\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(' --type ts --type js "$DIR" || true

section "Dynamic imports / requires"
$RG_BASE -e '\brequire\s*\(\s*[^\x27\x22]' -e '\bimport\s*\(' --type ts --type js "$DIR" || true

section "Filesystem"
$RG_BASE -e '\bfs\.(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|rm|rmdir|rename|symlink|createWriteStream|readdir|realpath)\b' --type ts --type js "$DIR" || true

section "HTTP / network"
$RG_BASE -e '\b(fetch|axios|got|undici|node-fetch)\b' -e '\bhttp\.request\b' -e '\bhttps\.request\b' -e '\bnet\.(connect|createConnection|Socket)\b' --type ts --type js "$DIR" || true

section "Crypto"
$RG_BASE -e '\bcrypto\.(createHash|createHmac|createCipher|createCipheriv|randomBytes|randomFillSync|randomUUID|pbkdf2|scrypt|timingSafeEqual)\b' -e '\bMath\.random\s*\(' --type ts --type js "$DIR" || true

section "Deserialization"
$RG_BASE -e '\bJSON\.parse\s*\([^)]+,\s*\w' -e '\b(YAML|yaml)\.load\s*\(' -e '\b(serialize|deserialize|unserialize)\b' --type ts --type js "$DIR" || true

section "Prototype / property access from input"
$RG_BASE -e '__proto__' -e '\bconstructor\.prototype\b' -e '\bprototype\s*\[' --type ts --type js "$DIR" || true

section "Regex from input / ambiguous quantifiers"
$RG_BASE -e '\bnew\s+RegExp\s*\(' --type ts --type js "$DIR" || true
$RG_BASE -e '\([^)]*[+*][^)]*\)[+*]' --type ts --type js "$DIR" || true

section "DOM sinks"
$RG_BASE -e '\.innerHTML\s*=' -e '\.outerHTML\s*=' -e '\bdocument\.write\b' -e '\binsertAdjacentHTML\b' -e '\bdangerouslySetInnerHTML\b' --type ts --type js "$DIR" || true

section "Browser URL / navigation sinks"
$RG_BASE -e '\blocation\.(href|replace|assign)\s*=' -e '\bwindow\.open\b' -e '\b(postMessage|addEventListener\s*\(\s*[\x27\x22]message)\b' --type ts --type js "$DIR" || true

section "Browser storage / cookies"
$RG_BASE -e '\bdocument\.cookie\b' -e '\blocalStorage\b' -e '\bsessionStorage\b' -e '\bcookieStore\b' --type ts --type js "$DIR" || true

section "Process / env"
$RG_BASE -e '\bprocess\.(env|argv|exit|kill|dlopen|binding)\b' --type ts --type js "$DIR" || true

section "Unsafe Buffer"
$RG_BASE -e '\bBuffer\.(allocUnsafe|allocUnsafeSlow)\b' --type ts --type js "$DIR" || true

section "Install scripts (package.json)"
$RG_BASE --type json -e '"(preinstall|install|postinstall|preuninstall|uninstall)"' "$DIR" || true

echo
echo "================================================================"
echo "Done. Every line above is a candidate, not a finding — read context."
echo "================================================================"

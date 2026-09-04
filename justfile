# Defuddler — common tasks
# Run `just` with no arguments to list recipes.

vault := "/Users/box/Vaults/Sanctum"
plugin_dir := vault / ".obsidian/plugins/defuddler"

default:
    @just --list --unsorted

# --- setup -------------------------------------------------------------

# One-time setup on a fresh clone: submodule, npm deps, dev symlinks.
setup: submodules deps link

# Fetch/refresh the pinned obsidian-clipper checkout.
submodules:
    git submodule update --init --recursive

# Install npm dependencies.
deps:
    npm install

# Symlink the build output into the vault so a rebuild is the whole dev loop.
link:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ plugin_dir }}"
    for f in main.js manifest.json styles.css; do
        ln -sf "$PWD/$f" "{{ plugin_dir }}/$f"
    done
    echo "linked -> {{ plugin_dir }}"

# Check the toolchain and sources are wired up.
doctor:
    #!/usr/bin/env bash
    ok() { printf '  ok    %s\n' "$1"; }
    bad() { printf '  FAIL  %s\n' "$1"; fail=1; }
    fail=0
    command -v node >/dev/null && ok "node $(node --version)" || bad "node not found"
    [ -f vendor/obsidian-clipper/package.json ] && ok "submodule checked out" || bad "submodule empty (just submodules)"
    [ -d node_modules ] && ok "deps installed" || bad "deps missing (just deps)"
    [ -L "{{ plugin_dir }}/main.js" ] && ok "linked into the vault" || bad "not linked (just link)"
    [ -f main.js ] && ok "main.js built ($(du -h main.js | cut -f1))" || bad "main.js missing (just build)"
    echo
    [ "$fail" -eq 0 ] && echo "all good" || { echo "see failures above"; exit 1; }

# --- build & check -----------------------------------------------------

# Production build: minified, what a release ships.
build:
    npm run build

# Unminified build with inline sourcemaps, for the dev symlink.
build-debug:
    node esbuild.config.mjs

# Rebuild on every change.
dev:
    npm run dev

# Extraction regression harness — runs before every submodule or Defuddle bump.
test:
    npm test

# As `test`, plus the two tests that call YouTube's transcript API. Kept out of the default run and
# out of CI: they can go red for reasons that are not ours, and a release must not fail on that.
test-network:
    DEFUDDLER_NETWORK_TESTS=1 npm test

# Typecheck our code (vendor/ diagnostics are upstream's, and are counted, not reported).
check:
    npm run typecheck

# Everything CI runs.
ci: check test build

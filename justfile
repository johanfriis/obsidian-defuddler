# Obsidian clipper plugin — common tasks
# Run `just` with no arguments to list recipes.

default:
    @just --list --unsorted

# --- setup -------------------------------------------------------------

# One-time setup on a fresh clone: submodule, npm deps.
setup: submodules
    cd jsbridge && npm install

# Fetch/refresh the pinned obsidian-clipper checkout.
submodules:
    git submodule update --init --recursive

# Check that the toolchain and sources are wired up correctly.
doctor:
    #!/usr/bin/env bash
    ok() { printf '  ok    %s\n' "$1"; }
    bad() { printf '  FAIL  %s\n' "$1"; fail=1; }
    fail=0
    echo "toolchain"
    command -v node >/dev/null && ok "node $(node --version)" || bad "node not found"
    echo "sources"
    [ -f jsbridge/vendor/obsidian-clipper/package.json ] && ok "submodule checked out" || bad "submodule empty (run 'just submodules')"
    [ -d jsbridge/node_modules ] && ok "deps installed" || bad "deps missing (run 'just jsdeps')"
    echo
    [ "$fail" -eq 0 ] && echo "all good" || { echo "see failures above"; exit 1; }

# --- jsbridge ----------------------------------------------------------
# Carried over from the Android build. The extraction tests and fixtures are
# worth keeping; the bundle entry points are not. Both get restructured when
# the plugin scaffold lands.

# Run the TypeScript test suite (extraction fixtures live here).
[working-directory('jsbridge')]
jstest:
    npm test

# Install npm dependencies.
[working-directory('jsbridge')]
jsdeps:
    npm install

# Typecheck the TypeScript.
[working-directory('jsbridge')]
jscheck:
    npm run typecheck

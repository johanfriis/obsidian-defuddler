# Android Web Clipper for Obsidian — common tasks
# Run `just` with no arguments to list recipes.

android_home := env('ANDROID_HOME', home_directory() / "Library/Android/sdk")
adb         := android_home / "platform-tools/adb"
pkg         := "it.slowmail.obsidianreader"
activity    := pkg + "/.MainActivity"

default:
    @just --list --unsorted

# --- setup -------------------------------------------------------------

# One-time setup on a fresh clone: submodule, local.properties, npm deps.
setup: submodules
    @echo "sdk.dir={{ android_home }}" > android/local.properties
    @echo "wrote android/local.properties -> {{ android_home }}"
    cd jsbridge && npm install

# Fetch/refresh the pinned obsidian-clipper checkout.
submodules:
    git submodule update --init --recursive

# Check that the toolchain and SDK are wired up correctly.
doctor:
    #!/usr/bin/env bash
    ok() { printf '  ok    %s\n' "$1"; }
    bad() { printf '  FAIL  %s\n' "$1"; fail=1; }
    fail=0
    echo "toolchain"
    command -v java >/dev/null && ok "java $(java -version 2>&1 | head -1 | sed 's/.*version //;s/"//g')" || bad "java not found"
    command -v node >/dev/null && ok "node $(node --version)" || bad "node not found"
    echo "android sdk"
    [ -d "{{ android_home }}" ] && ok "sdk at {{ android_home }}" || bad "no sdk at {{ android_home }}"
    [ -x "{{ adb }}" ] && ok "adb $({{ adb }} --version | head -1 | sed 's/.*version //')" || bad "adb missing"
    [ -f android/local.properties ] && ok "android/local.properties" || bad "android/local.properties missing (run 'just setup')"
    echo "sources"
    [ -f jsbridge/vendor/obsidian-clipper/package.json ] && ok "submodule checked out" || bad "submodule empty (run 'just submodules')"
    [ -d jsbridge/node_modules ] && ok "jsbridge deps installed" || bad "jsbridge deps missing (run 'just jsdeps')"
    echo "device"
    n=$({{ adb }} devices | tail -n +2 | grep -c "device$" || true)
    [ "$n" -gt 0 ] && ok "$n device(s) attached" || echo "  --    no device attached (fine unless installing)"
    echo
    [ "$fail" -eq 0 ] && echo "all good — try 'just build'" || { echo "see failures above"; exit 1; }

# --- android -----------------------------------------------------------

# Assemble the debug APK.
[working-directory('android')]
build:
    ./gradlew assembleDebug

# Build and install the debug APK on the connected device.
[working-directory('android')]
install:
    ./gradlew installDebug

# Install and launch the app.
run: install
    {{ adb }} shell am start -n {{ activity }}

# Force-stop the app on the device.
stop:
    {{ adb }} shell am force-stop {{ pkg }}

# Remove the app from the device.
uninstall:
    {{ adb }} uninstall {{ pkg }}

# Tail logcat for this app only (app must be running).
log:
    #!/usr/bin/env bash
    set -euo pipefail
    pid=$({{ adb }} shell pidof -s {{ pkg }} || true)
    if [ -z "$pid" ]; then
        echo "{{ pkg }} is not running — start it with 'just run'." >&2
        exit 1
    fi
    {{ adb }} logcat --pid="$pid"

# Tail logcat for everything, unfiltered.
log-all:
    {{ adb }} logcat

# Run the Android unit tests.
[working-directory('android')]
test:
    ./gradlew testDebugUnitTest

# Wipe Gradle build output.
[working-directory('android')]
clean:
    ./gradlew clean

# Show the built APK path and size.
apk:
    @ls -lh android/app/build/outputs/apk/debug/app-debug.apk

# --- jsbridge ----------------------------------------------------------

# Run the jsbridge (TypeScript) test suite.
[working-directory('jsbridge')]
jstest:
    npm test

# Install jsbridge npm dependencies.
[working-directory('jsbridge')]
jsdeps:
    npm install

# Rebuild the committed clipper-bundle.js — minified, DEBUG_MODE off, as shipped (D28).
[working-directory('jsbridge')]
jsbuild:
    npm run build

# Local unminified build for chrome://inspect — never commit it ('just jsverify' will object).
[working-directory('jsbridge')]
jsbuild-debug:
    npm run build:debug

# As jsbuild-debug, plus inline sourcemaps back to the .ts files (~3x larger).
[working-directory('jsbridge')]
jsbuild-debug-map:
    npm run build:debug-sourcemap

# Typecheck the jsbridge TypeScript.
[working-directory('jsbridge')]
jscheck:
    npm run typecheck

# Prove the committed bundle matches its sources (playbook §14).
[working-directory('jsbridge')]
jsverify:
    npm run verify

# --- device ------------------------------------------------------------

# List connected devices.
devices:
    {{ adb }} devices -l

# Drive the share target from here instead of sharing by hand in a browser (playbook §14).
share url="https://stephango.com/vault":
    {{ adb }} shell am start -a android.intent.action.SEND -t text/plain \
        --es android.intent.extra.TEXT "{{ url }}" \
        -n {{ pkg }}/.share.ShareReceiverActivity

# How to attach Chrome DevTools to the app's WebView.
inspect:
    @echo "1. Connect the device over USB with USB debugging enabled ('just devices' to verify)."
    @echo "2. Launch the app and open a page in the reader ('just run')."
    @echo "3. In desktop Chrome, open  chrome://inspect/#devices  and click 'inspect'"
    @echo "   under the {{ pkg }} WebView entry."

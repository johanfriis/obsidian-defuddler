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

# --- device ------------------------------------------------------------

# List connected devices.
devices:
    {{ adb }} devices -l

# How to attach Chrome DevTools to the app's WebView.
inspect:
    @echo "1. Connect the device over USB with USB debugging enabled ('just devices' to verify)."
    @echo "2. Launch the app and open a page in the reader ('just run')."
    @echo "3. In desktop Chrome, open  chrome://inspect/#devices  and click 'inspect'"
    @echo "   under the {{ pkg }} WebView entry."

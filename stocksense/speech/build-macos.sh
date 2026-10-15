#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RUNTIME="$ROOT/speech/runtime"
FRAMEWORK="$RUNTIME/Frameworks/whisper.framework"
HEADER="$FRAMEWORK/Versions/A/Headers"

mkdir -p "$RUNTIME/bin"
xcrun clang++ -std=c++17 -O3 \
  -I "$HEADER" \
  -F "$RUNTIME/Frameworks" \
  -framework whisper \
  -Wl,-rpath,@executable_path/../Frameworks \
  "$ROOT/speech/src/stocksense-stt.cpp" \
  -o "$RUNTIME/bin/stocksense-stt"
chmod 755 "$RUNTIME/bin/stocksense-stt"

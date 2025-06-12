# WASM
# TODO: currently chromabuild submodule points to a fork with fixes CMake paths, update it if/when https://github.com/acoustid/chromaprint/pull/151 lands

if [[ -z "${EMSDK}" ]]; then
    echo "You need to setup emsdk before calling this script"
    echo "See more information here: https://github.com/emscripten-core/emsdk"
    exit 1
fi

echo -e "\nCompiling WASM\n"

pushd chromaprint

mkdir -p build-wasm
pushd build-wasm

emcmake cmake \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TESTS="OFF" \
    -DFFT_LIB="kissfft" \
    -DKISSFFT_SOURCE_DIR="../../kissfft" \
    -DBUILD_TOOLS=OFF \
    -DCMAKE_CXX_FLAGS='-stdlib=libc++' ..

emmake make VERBOSE=1

emcc -O3 \
    -s MODULARIZE=1 \
    -s ENVIRONMENT="web" \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME="createChromaprintModule" \
    -s ASSERTIONS=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_FUNCTIONS='["_chromaprint_new", "_chromaprint_start", "_chromaprint_feed", "_chromaprint_finish", "_chromaprint_get_fingerprint", "_chromaprint_get_raw_fingerprint", "_chromaprint_free", "_chromaprint_get_raw_fingerprint_size", "_chromaprint_get_delay", "_chromaprint_get_delay_ms", "_chromaprint_clear_fingerprint", "_malloc", "_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["cwrap", "ccall", "UTF8ToString", "getValue", "HEAP16", "HEAP32"]' \
    -o chromaprint.js \
    --emit-tsd chromaprint.d.ts \
    src/libchromaprint.a

BUILT_FILES="./chromaprint.js ./chromaprint.wasm ./chromaprint.d.ts"
cp $BUILT_FILES ../../src
mkdir ../../dist
cp $BUILT_FILES ../../dist

popd # build-wasm

popd # chromaprint

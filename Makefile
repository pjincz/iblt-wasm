.DEFAULT_GOAL := all
.DELETE_ON_ERROR:

# Requires GNU Make 4.3+ for grouped JS/WASM output targets.
SDK_VERSION := 4.0.23
SDK_DIR := $(CURDIR)/emsdk
SDK_READY := emsdk/.ready-$(SDK_VERSION)
EMXX := $(SDK_DIR)/upstream/emscripten/em++
# Ignore any SDK configuration/cache inherited from the user's shell.
export EM_CONFIG := $(SDK_DIR)/.emscripten
export EM_CACHE := $(SDK_DIR)/upstream/emscripten/cache

CXXFLAGS ?= -O3 -DNDEBUG -std=c++17
EXPORTS := _malloc,_free,_iblt_create,_iblt_destroy,_iblt_clone,_iblt_fold,_iblt_update,_iblt_wire_size,_iblt_serialize,_iblt_serialize_folded,_iblt_deserialize,_iblt_decode,_iblt_result_count,_iblt_result_keys,_iblt_result_sides
EMFLAGS := -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node,web,worker \
           -sALLOW_MEMORY_GROWTH=1 -sWASM_BIGINT=1 -sASSERTIONS=1 \
           -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=$(EXPORTS)

.PHONY: all test clean sdk
all: dist/index.mjs dist/iblt.mjs dist/iblt.wasm

sdk: $(SDK_READY)

emsdk/emsdk:
	@test -f "$@" || git clone --depth 1 https://github.com/emscripten-core/emsdk.git emsdk

$(SDK_READY): emsdk/emsdk
	"$(SDK_DIR)/emsdk" install $(SDK_VERSION)
	"$(SDK_DIR)/emsdk" activate $(SDK_VERSION)
	@test "$$('$(EMXX)' -dumpversion)" = "$(SDK_VERSION)"
	touch "$@"

dist:
	mkdir -p "$@"

# One compiler invocation produces both files, including under make -j.
dist/iblt.mjs dist/iblt.wasm &: src/cpp/iblt-wrapper.cpp src/cpp/iblt.h Makefile $(SDK_READY) | dist
	"$(EMXX)" $(CXXFLAGS) src/cpp/iblt-wrapper.cpp $(EMFLAGS) -o dist/iblt.mjs

dist/index.mjs: src/index.mjs Makefile | dist
	cp "$<" "$@"

test: all
	node --test test/*.test.mjs

clean:
	rm -rf dist

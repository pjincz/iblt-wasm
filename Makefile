.DEFAULT_GOAL := all
.DELETE_ON_ERROR:

# Requires GNU Make 4.3+ for grouped JS/WASM output targets.
ifneq ($(strip $(EMSDK)),)
EMXX ?= $(EMSDK)/upstream/emscripten/em++
else
EMXX ?= em++
endif

CXXFLAGS ?= -O3 -DNDEBUG -std=c++17
EXPORTS := _malloc,_free,_iblt_create,_iblt_destroy,_iblt_clone,_iblt_fold,_iblt_update,_iblt_wire_size,_iblt_serialize,_iblt_deserialize,_iblt_decode,_iblt_result_count,_iblt_result_keys,_iblt_result_sides
EMFLAGS := -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node,web,worker \
           -sALLOW_MEMORY_GROWTH=1 -sWASM_BIGINT=1 -sASSERTIONS=1 \
           -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=$(EXPORTS)

.PHONY: all test clean check-emxx
all: dist/index.mjs dist/iblt.mjs dist/iblt.wasm

check-emxx:
	@version=$$("$(EMXX)" -dumpversion) || { echo "Error: cannot run $(EMXX). Install Emscripten 4+ and set EMSDK or EMXX." >&2; exit 1; }; \
	major=$${version%%.*}; \
	case "$$major" in ''|*[!0-9]*) echo "Error: unrecognized Emscripten version: $$version" >&2; exit 1;; esac; \
	if [ "$$major" -lt 4 ]; then \
		echo "Error: Emscripten 4+ required; $(EMXX) reports $$version. Set EMSDK or EMXX to a newer SDK." >&2; \
		exit 1; \
	fi

dist:
	mkdir -p "$@"

# One compiler invocation produces both files, including under make -j.
dist/iblt.mjs dist/iblt.wasm &: src/cpp/iblt-wrapper.cpp src/cpp/iblt.h Makefile | dist check-emxx
	"$(EMXX)" $(CXXFLAGS) src/cpp/iblt-wrapper.cpp $(EMFLAGS) -o dist/iblt.mjs

dist/index.mjs: src/index.mjs Makefile | dist check-emxx
	cp "$<" "$@"

test: all
	node --test test/*.test.mjs

clean:
	rm -rf dist

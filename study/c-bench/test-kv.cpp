// Behavior probe against unmodified upstream IBLT_Cplusplus, not the wide-key fork.
#include <cassert>
#include <iostream>
#include <set>
#include <string>
#include <utility>
#include <vector>
#include "iblt.h"

using Bytes = std::vector<uint8_t>;
using Entries = std::set<std::pair<uint64_t, Bytes>>;
static Bytes bytes(const std::string &s) { return Bytes(s.begin(), s.end()); }
static void print(const Entries &entries) {
    std::cout << '[';
    bool first = true;
    for (const auto &entry : entries) {
        if (!first) std::cout << ", ";
        first = false;
        std::cout << '(' << entry.first << ", "
                  << std::string(entry.second.begin(), entry.second.end()) << ')';
    }
    std::cout << ']';
}
static void diff(const char *label, const IBLT &a, const IBLT &b,
                 const Entries &expectedPositive, const Entries &expectedNegative) {
    Entries positive, negative;
    const auto difference = a - b;
    const bool success = difference.listEntries(positive, negative);
    std::cout << label << ": success=" << std::boolalpha << success << " A-only=";
    print(positive); std::cout << " B-only="; print(negative); std::cout << '\n';
    assert(success);
    assert(positive == expectedPositive);
    assert(negative == expectedNegative);
}

int main() {
    const auto oldValue = bytes("old!"), newValue = bytes("new!");
    IBLT a(100, 4), same(100, 4), changed(100, 4), differentKey(100, 4), empty(100, 4);
    a.insert(42, oldValue);
    same.insert(42, oldValue);
    changed.insert(42, newValue);
    differentKey.insert(43, newValue);

    Bytes result;
    assert(a.get(42, result) && result == oldValue);
    std::cout << "get A[42]=" << std::string(result.begin(), result.end()) << '\n';
    assert(changed.get(42, result) && result == newValue);
    std::cout << "get changed[42]=" << std::string(result.begin(), result.end()) << '\n';

    diff("same key, same value", a, same, {}, {});
    // Observed limitation: this reports a successful EMPTY difference.
    diff("same key, DIFFERENT value", a, changed, {}, {});
    assert((a - changed).DumpTable() == empty.DumpTable());
    diff("different keys", a, differentKey, {{42, oldValue}}, {{43, newValue}});
    diff("entry exists on only one side", a, empty, {{42, oldValue}}, {});

    // A local replacement works when explicitly removing the old pair first.
    IBLT updated(a);
    updated.erase(42, oldValue);
    updated.insert(42, newValue);
    assert(updated.get(42, result) && result == newValue);
    std::cout << "erase old pair + insert new pair: get[42]="
              << std::string(result.begin(), result.end()) << '\n';
    diff("old snapshot vs updated snapshot", a, updated, {}, {});
    std::cout << "All behavior assertions passed. Value-only changes are NOT detected in this example.\n";
}

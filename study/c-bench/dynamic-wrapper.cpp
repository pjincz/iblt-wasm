#include "dynamic-iblt.h"
using dynamic_iblt::IBLT;
struct Handle {
    IBLT table;
    std::vector<uint8_t> keys;
    std::vector<int32_t> sides;
    Handle(unsigned cells,unsigned keyBytes,unsigned checkBytes):table(cells,keyBytes,checkBytes){}
};
extern "C" {
Handle *dynamic_create(unsigned cells,unsigned keyBytes,unsigned checkBytes) {
    if (!IBLT::valid(cells,keyBytes,checkBytes)) return nullptr;
    return new Handle(cells,keyBytes,checkBytes);
}
void dynamic_destroy(Handle *h) { delete h; }
Handle *dynamic_clone(Handle *h) { auto *copy=new Handle(h->table.cellCount(),h->table.keyBytes(),h->table.checkBytes());copy->table=h->table;return copy; }
unsigned dynamic_wire_size(Handle *h) { return h->table.wireBytes(); }
void dynamic_serialize(Handle *h,uint8_t *out) { h->table.serialize(out); }
void dynamic_deserialize(Handle *h,const uint8_t *in) { h->table.deserialize(in); }
int dynamic_update(Handle *h,const uint8_t *keys,unsigned count,int remove) {
    for(unsigned i=0;i<count;++i) if(!h->table.update(keys+size_t(i)*h->table.keyBytes(),remove?-1:1)) return 0;
    return 1;
}
int dynamic_decode(Handle *a,Handle *b) {
    a->keys.clear();a->sides.clear();
    auto diff=a->table;
    return diff.subtract(b->table) && diff.peel(a->keys,a->sides);
}
unsigned dynamic_result_count(Handle *h) { return h->sides.size(); }
const uint8_t *dynamic_result_keys(Handle *h) { return h->keys.data(); }
const int32_t *dynamic_result_sides(Handle *h) { return h->sides.data(); }
}

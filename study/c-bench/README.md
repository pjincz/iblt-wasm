# C/C++ → WASM 集合差分 benchmark

**128/160 位 key 的改造与测量**见 [README-wide.md](README-wide.md)，运行 `npm run bench:wide`。

## 原版 key/value 行为验证

运行 `npm run test:kv`。`test-kv.cpp` 直接链接固定 commit 的原版 `iblt.cpp` / `murmurhash3.cpp`，
没有使用宽 key 改造版，也没有改动上游源码；这是原生 C++ 功能测试，不是性能测试。
输出保存在 `results-kv.txt`。

验证结果：A 包含 `(42, old!)`，B 包含 `(42, new!)`，各自 `get(42)` 能读出正确 value，
但 `(A-B).listEntries(...)` 返回成功且双方差集为空。
如果 B 改为 `(43, new!)`，则正确返回 A-only `(42, old!)` 和 B-only `(43, new!)`。
只有 A 有的条目也能连同 value 一起恢复。

value 的作用是随 key 携带可恢复的数据，不是独立参与差异判定的版本标识。
这个实现不能当作通用可变 value 的 Map 同步器：上游 `empty()` 只检查 count/keySum/keyCheck，
相减在这三项抵消时会清空 valueSum。局部删除旧条目再插入新条目可以更新本地 value，
但更新前后快照的相减仍会漏掉本测试中的 value-only 变化。
以上证明了一个最小反例，没有声称所有含冲突 value 的复杂集合都只会表现为空差集。

测试 **GNUnet IBF、IBLT_Cplusplus、minisketch**。加入已安装的 `@peerbit/riblt@1.2.0` 作为相同数据的参考。
全部由 Node.js 调用 WASM；不是原生 C/C++ 耗时，也没有实际运行浏览器。

## 运行

本工作区已经完成下载与构建：

```sh
npm run bench:c:check
npm run bench:c
CELLS=400 OUTPUT=c-bench/results-400.json npm run bench:c
```

默认预热 2 次、正式测试 10 次；每轮数据不同，执行顺序轮换。默认参数：

```sh
N=10000 DIFF=100 CELLS=200 CAPACITY=100 TRIALS=10 WARMUPS=2 npm run bench:c
```

- 两端各 10,000 个唯一 key，共享 9,950 个，各自独有 50 个，总对称差 100。
- 每个 key 是两个 **32 位、非负、秒级 Unix timestamp** 拼接的 uint64。
  第一个时间戳按秒递增，第二个是第一个加上确定性的 0～86,399 秒间隔。
  这是测试数据假设；尚未确认业务时间戳单位。没有 SHA-1、截断或预哈希。
- GNUnet / C++ IBLT 使用 200 个桶和 4 个哈希。额外跑了 400 桶。
- minisketch 使用 64 位元素、容量 100、通用实现 0；不是启用 x86 CLMUL 的原生优化版本。
  容量刚好等于本测试已知的差异数量，没有额外容量裕量。
- RIBLT 不预设桶数，收到每个编码块后尝试解码，成功即停止，最多 `max(1000, DIFF * 20)` 块。

输出原始数据和中位数至 `results.json`，含 CPU、Node 版本、编译命令、源码版本。
出现解码失败或库报告成功但输出错误时，写完报告后退出码为 1；不是 benchmark 中途崩溃。
`wrongResults` 单独记录“报告成功但差集错误”的次数，不能只依赖库自己的成功标志。

## 两种工作负载

**fresh**：两端分别从全部 10,000 条记录构建结构，发送端序列化到 JS 字节数组，接收端反序列化，
相减/合并并解码，返回双方差异。RIBLT 包含完整编码流生成及解码成本。

**maintained**：每个库只在循环开始前构建两张表，随后持续保留。
每一轮，每端删除上一轮的 50 条独有记录、插入新的 50 条独有记录，再同步。
两端总计 **100 次删除 + 100 次插入**，每端仍有 10,000 条、总差异仍是 100。
初次构建不计入这一阶段。RIBLT 的现成 JS 接口没有删除操作，因此未给它伪造增量结果。

每轮增量后，另行从完整集合重建并逐字节比较摘要，确认复用状态与重新构建一致；这项断言不计时。
序列化往返也逐字节校验。所有报告成功的差集与真实集合精确比较，包括方向和重复元素。

## 计时边界与比较限制

- `senderBuildMs` / `receiverBuildMs`：创建结构并批量插入全部 key。
- `senderUpdateMs` / `receiverUpdateMs`：持续维护时删除并插入 key。
- `wireCodecMs`：发送端序列化并复制到 JS，复制到接收端 WASM 内存、创建接收结构及反序列化。
- `decodeMs`：相减/合并、解码、把结果读取回 JS；minisketch 额外使用本地 Set 判断差异属于哪一侧。
- `syncMs`：传输编解码 + 差分解码；对 RIBLT 还包含按需生成编码块。
- `totalMs`：对应场景的双方构建或更新 + `syncMs`。没有把失败后的重试成本计入。
- 各列独立取中位数，不能直接把显示值相加。10 次的 P95 是最大样本，不能据此估计尾延迟分布。

数据生成、输入 key 拷贝到 WASM、本地集合索引构造、模块加载/初始化、正确性断言与对象销毁不计时。
C/C++ 封装采用一次跨 JS/WASM 边界传一批 key；`@peerbit/riblt` 只有逐条 `add_symbol` 接口。
因此比较的是这些实现及当前封装，不是隔离变量的语言性能实验。

无真实网络、RTT、协议握手、重传、压缩、快照锁或浏览器页面调度。
RIBLT 假设接收端完成后发送端能立即停，真实批量传输可能多发送一些块。
本次原始 key 与之前 SHA-1 benchmark 不同，不能直接拿旧表的绝对时间拼接比较。

## 传输格式和源码适配

测试将三个库封装在一个 WASM 模块中，逻辑上每个端点有独立的表。

| 库 | Payload 格式 | 200 桶/容量 100 时 |
|---|---|---:|
| GNUnet IBF | 每桶 i64 count + u64 keySum + u32 check，小端 | 4,000 B |
| IBLT_Cplusplus | 每桶 i32 count + u64 keySum + u32 check，小端；value 为空 | 3,200 B |
| minisketch | 上游序列化格式 | 800 B |
| RIBLT | 每编码块 u64 symbol + u64 hash + i64 count，小端 | 24 B / 块 |

参数假定事先协商，以上不包含桶数、协议版本等头信息。
GNUnet 用自定义固定宽度格式，未使用它自带的压缩计数器格式，所以其网络 payload 不是最小可能值。

- **GNUnet 0.25.0**：直接编译发布包的 `src/service/setu/ibf.c` 和 `src/lib/util/crypto_crc.c`。
  `compat/` 仅替代 GNUnet 的平台、内存分配和断言函数。CRC 和 IBF 算法未改。
  来源是 AGPL-3.0-or-later 文件，原始版权头和 COPYING 保留在 vendor 中。
- **IBLT_Cplusplus**：编译原始实现，value 长度设置为 0，仅对比 key 集合。
  构建时给复制到 build 的头文件增加一个 `friend`，仅供序列化访问桶；不改算法。
  上游构造函数会按预计条目数乘 1.5 再凑到 4 的倍数，封装会反算参数并确认实际桶数。
- **minisketch**：直接编译上游核心和 generic field 实现，只启用 64 位字段。
  加入已有元素即删除该元素，因此支持持续维护。返回无方向的对称差，方向通过本地 Set 恢复。

确切 commit 与发布包 SHA-256 见 `sources.json`。

## 本机结果

Node.js v24.21.0，Linux x64，Intel Core Ultra 7 258V，Emscripten 4.0.23，`-O3`。
时间单位 ms；中位数包含失败尝试，本次没有观察到“成功但结果错误”。

| 库 | 首次构建并同步 | 首次成功 | 保留表后更新并同步 | 增量成功 | Payload |
|---|---:|---:|---:|---:|---:|
| GNUnet，200 桶 | 3.7212 | 4/10 | 0.3345 | 8/10 | 4,000 B |
| IBLT_Cplusplus，200 桶 | 3.4593 | 10/10 | 0.2814 | 10/10 | 3,200 B |
| minisketch，容量 100 | 40.8374 | 10/10 | 25.5773 | 10/10 | 800 B |
| RIBLT，参考 | 18.9896 | 10/10 | 不支持相同删除接口 | — | 3,432 B（中位数） |

400 桶复测：GNUnet 首次 10/10、增量 9/10；IBLT_Cplusplus 两项均 10/10。
详细时间见 `results-400.json`。第二次运行 minisketch 等未变配置也有明显计时差异，
说明本机短测受 JIT、GC、CPU 调度/频率等因素影响；不要把小于毫秒的差异理解为稳定排名。
这些样本不足以估计生产环境的失败概率，也没有将 GNUnet 的失败进一步定位到具体原因。

## 从零复现构建

需要 Python 3、Git、Node.js，以及 Emscripten SDK。下载目录均在本地，不安装系统包：

```sh
npm ci --ignore-scripts
npm run bench:c:fetch
git clone --depth 1 https://github.com/emscripten-core/emsdk.git /tmp/iblt-emsdk
/tmp/iblt-emsdk/emsdk install 4.0.23
/tmp/iblt-emsdk/emsdk activate 4.0.23
npm run bench:c:build
npm run bench:c:check
npm run bench:c
```

已有其他 SDK 时，设置 `EMSDK=/path/to/emsdk` 后运行构建。
生成的 `build/libraries.mjs` 和 `build/libraries.wasm` 支持 node/web/worker 环境；
`bridge.mjs` 也没有 Node 专用依赖，但本次没有将它们部署到浏览器进行验证。
`vendor/` 与 `build/` 不纳入 Git；下载脚本会按固定版本重新获取源码。

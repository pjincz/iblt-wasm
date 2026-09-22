# IBLT benchmark

新增的 C/C++ → WASM 对比（GNUnet、IBLT_Cplusplus、minisketch，含增量维护）见 [c-bench/README.md](c-bench/README.md)。运行 `npm run bench:c`。

128/160 位 IBLT key 的改造与 benchmark 见 [c-bench/README-wide.md](c-bench/README-wide.md)。运行 `npm run bench:wide`。

对比固定版本 `bloom-filters@3.0.4`（JS）和 `@peerbit/riblt@1.2.0`（Rust/WASM）。

```sh
npm ci --ignore-scripts
npm run bench
```

默认两端各 10,000 条记录，共享 9,950 条，各自独有 50 条，**对称差为 100 条**。
key 为确定性生成的 SHA-1 摘要；每轮数据不同，两个库在同一轮使用相同数据。
预热 2 轮，正式测量 10 轮，交替执行顺序。输出中位数、总耗时 P95、成功次数；
每次成功解码都会精确核对双方差集，错误结果抛异常，解码失败使进程非零退出。
完整配置、环境和每轮原始结果写入 `results.json`。

可调整参数：

```sh
N=10000 DIFF=100 CELLS=200 TRIALS=20 WARMUPS=3 npm run bench
CELLS=400 OUTPUT=results-400.json npm run bench
```

`DIFF` 是总对称差，必须为偶数。普通 IBLT 默认 200 个桶、3 个哈希函数，两端使用库的相同默认 seed。
这相当于预先知道差异规模，并给普通 IBLT 分配 2 倍桶数；没有计入估计差异规模的成本。
Rateless IBLT 持续发送 coded symbols，每个 symbol 后尝试解码，成功立即停止；
最多发送 `max(1000, DIFF * 20)` 个 symbols，不无限重试。

## SHA-1 的限制与处理

- `bloom-filters SHA1-160` 使用完整的 20 字节 SHA-1。
- `@peerbit/riblt` 发布包的 JS/WASM 接口只支持 `u64`，**不能直接使用完整 SHA-1**。
  因此另外两行对比使用同一个 SHA-1 的前 8 字节；RIBLT 按大端读取为 BigInt。
  64 位截断不是完整 SHA-1 的等价替代；本测试会检查输入集合是否存在截断碰撞。
- `bloom-filters` 的 XOR 实现会移除前导零，直接插入任意二进制 SHA-1 可能无法还原。
  为保留原始 key，插入前统一增加 `0x01` 前缀，实际输入分别是 21 / 9 字节。
  核对差集时也检查该前缀，未丢弃任何 SHA-1 字节。
- `bloom-filters` 的默认 `saveAsJSON()` 会以 UTF-8 导出桶内二进制字段，无法无损传输这些 key。
  本测试使用自定义二进制格式，接收端通过 `fromJSON()` 支持的 Buffer 字段恢复，未修改依赖源码。
- `@peerbit/riblt` 初始化时会覆盖全局 fetch；脚本在初始化结束后恢复它。

## 计时和传输口径

当前结果是 **Node.js 上模拟发送端和接收端的单进程测试**，没有运行浏览器，不能当作浏览器耗时。
没有真实网络、RTT、HTTP/WebSocket 帧、确认消息、压缩或丢包。
Rateless 的立即停止假设接收方反馈没有延迟，实际批量发送可能增加传输量。

| 输出字段 | 含义 |
|---|---|
| senderBuildMs | 创建发送端结构并插入全部 key |
| receiverBuildMs | 创建接收端结构并插入全部 key |
| encodeMs | Rateless 按需生成 coded symbols；普通 IBLT 编码已包含在构建中 |
| wireCodecMs | 序列化、反序列化以及普通 IBLT 接收端表恢复 |
| decodeMs | 普通 IBLT 相减和解码；Rateless 累计接收 symbol 和尝试解码 |
| totalMs | 两端构建和整个差分处理总耗时，包括小量循环/计时开销 |
| wireBytes | 发送端传给接收端的实际二进制 payload 字节数 |
| symbols | 普通 IBLT 桶数或 Rateless coded symbol 数 |

SHA-1 生成、输入转换、模块加载、WASM 初始化、结果正确性断言不计入耗时。
WASM 对象每轮显式释放；不强制 GC，GC 波动计入测量。每列独立取中位数，因此列相加未必等于总耗时。
P95 基于 10 次测量时等于最大样本，不代表充分的尾延迟统计。

两种传输格式均未压缩，均可在浏览器中用 ArrayBuffer/DataView 实现：

- 普通 IBLT：16 字节表头（u32 桶数、u32 哈希数、f64 seed），
  每桶 i32 count、u16 idSum 长度、u16 hashSum 长度以及两段原始字节。所有字段为大端。
  保留该库实际 hashSum 表示，未另做位宽优化；这不是跨库标准协议。
- Rateless：每 symbol 24 字节，分别为 u64 symbol、u64 hash、i64 count，全部大端。

这是两个不同算法和具体实现的对比，**不能将速度差直接归因于 JS 与 WASM 的区别**。

## 本次测量发现

Node.js v24.21.0，Linux x64，Intel Core Ultra 7 258V：

| 配置 | 完整 SHA-1 的 bloom-filters | SHA-1 前 64 位的 bloom-filters | SHA-1 前 64 位的 RIBLT |
|---|---|---|---|
| 200 桶，10 组数据 | 7/10 成功 | 8/10 成功 | 10/10 成功 |
| 400 桶，相同 10 组数据 | 9/10 成功 | 9/10 成功 | 10/10 成功 |

400 桶失败的那组数据，两种 bloom-filters 测试都只恢复了 98/100 个差异。
脚本断言了二进制往返后表完全一致，并在失败时额外检查不经过传输也同样解码失败。
没有进一步将失败归因于具体哈希问题或图结构；不能把失败当成成功对比性能。
计时统计包含失败尝试，不含失败后的重建/重试成本。
由于有解码失败，以上 benchmark 命令返回退出码 1 是预期报告行为，并非脚本未完成。
详细时间和所有原始样本见 `results.json`、`results-400.json`；10 组数据不足以估计生产环境失败概率。

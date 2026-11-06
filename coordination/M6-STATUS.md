# M6 全球海洋状态

最后更新：2026-11-06 · 技术路线 v2.0 · 本次文档修订基线：`e91ae8c4e9070f5abca3674eee05483c976d5562`

## 当前执行入口

- **下一项：O0-R01 — 固定精细岸线源、许可与海洋语义。** 读取 [O0-R 任务](../tasks/M6/O0-R.md)，只做当前小项。
- 默认只读 `AGENTS.md`、本文件、当前任务；再按需查 [总体路线](../docs/OCEAN_PLAN.md)、[合同](../docs/M6_OCEAN_CONTRACTS.md) 和 [验收](../docs/M6_ACCEPTANCE.md) 的相关标题。
- 路线已调整为 **OSM 精细岸线主源 + 同源、稀疏、多级分类掩膜**。本次只修改文档与计划清单，未获取全球源数据、生成掩膜或实现海洋运行时。
- 新数据入口为 `packages/engine/Source/Assets/Textures/WebGPU/Ocean/coverage-manifest.json`：`SOURCE_NOT_ACQUIRED` / `NOT_GENERATED`。不要把计划参数当成实测结果。
- 原 O0 的 Natural Earth 文档/数据核查保留 **TECHNICAL_PASS（历史限定）**；新路线 O0-R 的数据门槛为 **NOT_RUN**。M6 runtime 为 **NOT_STARTED**，GPU/视觉/性能验收为 **NOT_RUN**。
- O1-01 的 CPU 时间/地理框架可在明确分工后独立推进；**O1-02 须等 O0-R 数据门槛通过**。小岛/陆地排除属于 O1；O5 才增加高程、海底与动态淹没。

## 阶段表

| 子阶段 | 状态 | 当前边界 / 下一步 |
| --- | --- | --- |
| O0 原基线与合同审计 | TECHNICAL_PASS（历史） | 仅对应原 Natural Earth 源与旧合同；见下方原始证据 |
| O0-R 精细岸线修订 | NOT_STARTED | **O0-R01 → O0-R02 样例掩膜验证 → O0-R03 实际数据清单与交接** |
| O1 全球基础 | NOT_STARTED | 时间/地理框架、精细海陆排除、曲面、深度与生命周期 |
| O2 近景效果 | NOT_STARTED | O1 后实现多尺度 FFT、环境反射与泡沫 |
| O3 全球探索 | NOT_STARTED | 分类 LOD/加载/回退连续性；第一版视觉与性能验收 |
| O4 潮汐/时间 | NOT_STARTED | 展示型潮汐；跳时/倒播的有界历史重建 |
| O5 近岸/海底基础 | NOT_STARTED | 垂直基准、海底、潮间带与实际连通淹没 |
| O6 近岸效果 | NOT_STARTED | 第二版视觉与性能验收 |
| O7 完整水下 | NOT_STARTED | 最后功能阶段与最终验收 |

阶段状态由集成负责人依据实际证据更新；技术通过、用户视觉接受与发布授权分别记录。路线文件替换不改变任何阶段的运行时完成状态。

## 保留事项

- 单主相机、Cesium 唯一时间轴、地理锚定/RTC、相机附近曲面、多尺度 FFT、既有 HDR/深度/大气顺序维持原方向；完整设计只维护在总体路线和合同中。
- M5 任务 1/2 保留原记录；运动稳定性、资源生命周期、profiling、最终回归仍开放。只修复直接阻塞当前海洋任务的问题；旧 GPU 结果不重标为本次结果。
- M7 是原 M6 3D Tiles/BIM；可选太阳工作和 M7 均不抢占当前优先级。

## 历史证据（按需读取）

[原 O0 审计](evidence/M6/O0/README.md) 与其哈希、许可、26 个分类样本原样保留。它记录的是旧源的处理一致性，也记录了 Alcatraz 漏岛及约 4.89 km 赤道采样的限制；不证明全球小岛正确或新源已通过。

原 `Ocean/manifest.json` 仅供该历史审计复现；新任务使用 `coverage-manifest.json`。历史 JSON 中的旧规划/任务路径与哈希属于当时的 Git 版本记录，不是当前必读文件；不为清理文档而改写历史证据。

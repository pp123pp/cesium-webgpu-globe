# M6 Global Ocean Implementation Plan

> **For agentic workers:** 可用时使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。未安装这些技能时，直接遵守仓库 `AGENTS.md`、本计划和阶段检查清单；本交付不依赖特定 AI 插件。所有实际步骤使用 `- [ ]` 跟踪。

**Goal:** 在当前 Cesium WebGPU 中分阶段交付全球开阔海、展示型潮汐与近岸，最后完整水下。

**Architecture:** 共享多尺度 FFT 波浪与主相机附近的分层曲面网格，使用全球海洋分类和统一海面高度。环境反射复用现有天空/云和太阳，所有动画来自 Cesium 时间轴，高空保留卫星影像海色。

**Tech Stack:** 现有 CesiumJS 1.146.0 分支、JavaScript ES modules、WebGPU/WGSL、现有测试与物理 GPU 验证工具。保持 WebGL 路径。

**Spec:** [2026-11-06-m6-global-ocean-design.md](../specs/2026-11-06-m6-global-ocean-design.md)

## Global Constraints

以下约束来自设计说明，适用于全部任务：

- 最终继续使用当前 Cesium WebGPU 引擎。其他引擎、语言只作为参考。
- 全球任意海域可到达；首个完整交付保证开阔海近景。一个主相机，支持太空到海面及跨区域移动。
- 高空保留现有卫星影像海色；进入近景时允许细节短暂渐入。
- 先只做海洋，排除湖泊、河流、水库；基础全球海洋分类必须进入第一版。
- 方向性天空/云辐亮度与太阳高光是主路径，SSR 为后续可选增强。
- 使用展示型潮汐：幅度、周期、相位可调。当前不做真实全球潮汐预测、潮流或风暴潮。
- Cesium 时间轴是全部场景动画的唯一逻辑时间来源。
- 跳时、倒放后，波形与潮位立即对应目标时间；累积泡沫、近岸湿润等历史效果允许有界重建并渐入。
- 完整水下效果放在最后的 O7。O1 只验证出入水、深度、介质和遮挡通路，不提前实现完整水下光学。
- 只考虑桌面端 WebGPU；效果优先，O3/O6/O7 正式性能验收，前面持续记录新增成本。
- 保持原 WebGL 行为及已接受的地球、地形、天空、太阳、云、云影和 HDR 能力。
- 沿用最小充分验证策略；物理 GPU 验证，禁止 SwiftShader；不自动反复跑 Full，不降低现有功能断言。
- 保留第三方实现版权与归属；不引入 Tidewater 的游戏、角色、音频和场景资产。
- 每次实现一个可审查任务；区分实现、技术验证、视觉接受和发布状态。

完整范围还包括设计说明 R01—R18，不能因本节精简而取消其他要求。

## Review Focus

| 输入或失败模式 | 用户应看到的行为 | 归属检查 |
| --- | --- | --- |
| 时间反向、跳跃、循环回绕和极高倍速 | 波形/潮位对应目标时间；历史有界重建，无 NaN 或长时间追赶 | O1 时间合同、O4；M6-A05/A14 |
| 日期变更线、高纬和局部坐标重定位 | 地平线、波形与网格连续，细节不粘在相机上 | O1/O3；M6-A03/A10 |
| 海陆数据未知、失败、内陆负高程 | 已知基础覆盖可用，不把未知/内陆直接画成海洋 | O1/O5；M6-A02/A11/A16 |
| resize、切换 Provider、销毁后异步请求返回 | 资源有界，旧请求不写已销毁设备或新区域 | O3；M6-A11 |
| 波谷、零高程海域盖板、相机在海面以下 | 保留陆地遮挡，海洋深度与空气/水体正确衔接 | O1/O7；M6-A04/A19/A20 |

上述风险在对应阶段文件中必须落实为最少量有判别力的检查；不为每次小改重复整套矩阵。

## 1. 文件职责与所有权

| 范围 | 实际/拟新增路径 | 责任 |
| --- | --- | --- |
| 场景与渲染接入 | `packages/engine/Source/Scene/WebGPUScene.js`；`packages/engine/Source/Renderer/WebGPUContext.js` | 单一集成负责人，处理启动/帧顺序/销毁。 |
| 地形与海洋分类 | `WebGPUGlobeRenderer.js`、`WebGPUGlobeTileProvider.js`；拟新增 `WebGPUOceanCoverage.js` | 保持地形行为，只增加有边界的海洋分支。 |
| 表面光照与介质 | `WebGPUAtmosphereRenderer.js`、`WebGPUAtmosphereShader.js`、`WebGPUPlanetShader.js` | 单一集成负责人，维护线性 HDR、深度与遮挡。 |
| 海洋协调/时间/网格 | 拟新增 `WebGPUOcean.js`、`WebGPUOceanTime.js`、`WebGPUOceanMesh.js` | O1。 |
| 频谱与近景材质 | 拟新增 `WebGPUOceanSpectrum.js`、`WebGPUOceanFFT.js`、`WebGPUOceanShader.js` | O2。 |
| 后续能力 | 拟新增 `WebGPUOceanTide.js`、`WebGPUOceanBathymetry.js`、`WebGPUOceanShore.js`、`WebGPUOceanUnderwater.js` | 分别在 O4/O5/O6/O7 按需创建。 |
| 演示与证据 | 拟新增 `Apps/WebGPUOcean.html`、`coordination/evidence/M6/` 下阶段目录 | 随功能建立，禁止空证据或虚构通过结果。 |

表中未写目录的模块均位于 `packages/engine/Source/Scene/`。新测试沿用当前仓库已有组织；先核对真实 runner，再选文件级命令。具体新增测试路径写入当前任务，不先建立通用测试框架。

## 2. 接口冻结的执行规则

O0 已创建 [M6_OCEAN_CONTRACTS.md](../../M6_OCEAN_CONTRACTS.md) v1.0，为设计中的 OceanTimeSample、OceanCoverageSample、OceanSurfaceState、OceanEnvironment、OceanRenderInputs 写出精确字段、单位、生命周期和调用签名。合同明确已有接点与拟新增接口，不能把后者当成当前可用 API。

冻结时读取真实接点而非猜测符号；把未来 API 与已有 API 分栏标明。下游任务先读合同，只用已冻结名称。若源码演变需要变更，先同步合同和受影响任务，再实现调用方。公开参数入口在 O0 决定，内部实验符号不自动成为稳定 Cesium API。

## 3. 可执行任务链

任务详情保存在阶段文件中，避免总计划与阶段清单双份漂移。

### Task 0 — M6.O0 基线、接口与数据选择

**Files:** [tasks/M6/O0.md](../../../tasks/M6/O0.md)；产出 `docs/M6_OCEAN_CONTRACTS.md` 和 O0 证据。

**Consumes:** 当前源码、已确认设计、Tidewater 固定参考、M5 待办事实。

**Produces:** 可核对的接入合同、数据路线、场景和检查命令；不生成海洋 runtime。

- [x] O0-01—04文档/数据核查结项，见[O0证据](../../../coordination/evidence/M6/O0/README.md)。
- [x] 内容与差异审查、实际输出和O1-01接续写入M6状态；没有运行时通过结论。

### Task 1 — M6.O1 全球海洋基础

**Files:** [tasks/M6/O1.md](../../../tasks/M6/O1.md) 与其列出的真实接点/拟新增模块。

**Consumes:** O0 合同、海洋数据选择、基线。

**Produces:** 全球基础海洋、统一时间/高程、正确深度和最小出入水通路。

- [ ] 完成分类、曲面、时间与渲染接入任务。
- [ ] 用海域波谷、陆地/内陆水体、unknown 数据和简单上下水场景验证结构。

### Task 2 — M6.O2 开阔海目标效果

**Files:** [tasks/M6/O2.md](../../../tasks/M6/O2.md)。

**Consumes:** O1 表面身份、环境合同、时间和网格。

**Produces:** 多尺度 FFT、浪形/法线、白沫、海色、太阳/天空/云反射。

- [ ] 按参考配置建立可评审效果，并保留明确参数、种子和时刻。
- [ ] 技术检查与视觉接受分别记录；不能只以截图漂亮判定时序和数值正确。

### Task 3 — M6.O3 全球探索与第一版交付

**Files:** [tasks/M6/O3.md](../../../tasks/M6/O3.md)。

**Consumes:** O1 的全球基础与 O2 的近景效果。

**Produces:** 连续全球漫游、远近衔接、资源稳定与首个性能报告。

- [ ] 验证跨高度、跨经线、高纬、快速移动和重新定位。
- [ ] 通过第一版所需 M6-A01—A12 项；性能项没有设备/实际测量时保持未验收。

### Task 4 — M6.O4 展示型潮汐与时间行为

**Files:** [tasks/M6/O4.md](../../../tasks/M6/O4.md)。

**Consumes:** 同一时间样本、高度合同和历史 generation。

**Produces:** 可调展示型潮位、完整时间跳转/倒播/倍速策略。

- [ ] 潮位在全部消费者中一致。
- [ ] 历史效果重建有预算；暂停无墙钟动画，跳时无无界补算。

### Task 5 — M6.O5 近岸与海底数据

**Files:** [tasks/M6/O5.md](../../../tasks/M6/O5.md)。

**Consumes:** 海洋分类、潮位与高程合同。

**Produces:** 水深/岸线数据和回退、实际海底几何与水面前颜色/深度、浅海水色与从水上看的折射。优先复用现有地形入口，必要时在 O5 新增 `WebGPUOceanSeafloor.js`。

- [ ] 记录覆盖、许可、分辨率和垂直基准。
- [ ] 从有效 bathymetry 样本走通生产海底几何、颜色/深度和折射；不能仅交付数据采样函数。
- [ ] 潜在潮间带与海洋连通性成立；不把数据缺失包装成真实海底。

### Task 6 — M6.O6 近岸浪与第二版交付

**Files:** [tasks/M6/O6.md](../../../tasks/M6/O6.md)。

**Consumes:** O4 潮位和历史策略、O5 数据。

**Produces:** 代表性岸型的浅化/碎浪、泡沫、湿沙和潮间带。

- [ ] 按实际岸型适配参考算法，不复制固定沙滩阈值到所有海岸。
- [ ] 完成第二轮画质/性能验收和覆盖限制说明。

### Task 7 — M6.O7 完整水下与最终验收

**Files:** [tasks/M6/O7.md](../../../tasks/M6/O7.md)。

**Consumes:** 已完成的水上、潮汐、近岸以及 O1 预留的介质通路。

**Produces:** 完整水下视觉、海底浏览与最终综合证据。

- [ ] 验证半入水、不同姿态、向上天空、陆地与地球遮挡。
- [ ] 完成 M6-A19—A22；核对全部阶段证据、M5 欠项及原 WebGL 门槛的实际状态。

## 4. 每个任务的执行与交接

1. 读取状态、当前阶段与相关源码；声明本次任务和独占修改文件。
2. 按风险选择已有检查，只为新增关键行为补充最少缺失案例。
3. 实现当前最小可审查产出；只在实际需要时创建计划中的新模块。
4. 运行选定检查，记录实际输出和未验证范围；定位失败后只重跑受影响检查。
5. 更新 M6 状态与证据，交接准确下一项。共享 `coordination/STATUS.md` 只由集成负责人更新。

用户只说继续时，继续当前已进入阶段中第一项未完成任务。技术任务不需要重复确认已定需求；视觉评审、真实硬件缺失、数据权限或改变范围按实际情况处理。原 push/merge/Full 授权政策保持有效。

## 5. 计划自检

| 需求 | 任务覆盖 |
| --- | --- |
| R01/R15/R16/R17/R18：原架构、WebGL、验证、许可与交接 | O0 合同与所有阶段交接，O3/O6/O7 综合验收 |
| R02/R04/R05：全球、远近、海洋分类 | O1/O3 |
| R03/R06/R07：目标外观、人工海况、环境反射 | O2 |
| R08：展示型潮汐 | O4 |
| R09/R10：时间与历史 | O1/O2 接入，O4 完整验证，O6/O7 复用 |
| R11/R12：数据、近岸与质量范围 | O0 数据选择，O5/O6 |
| R13：水下最后 | O1 最小通路，O7 完整功能 |
| R14：性能策略 | 全程记录，O3/O6/O7 正式验收 |

**当前交付状态：O0合同/数据审计已完成，O1—O7 runtime未开始。** 本清单不得预先勾选运行时任务。后续实际执行使用 [AI 入口](../../../coordination/M6-AI-START.md) 和 [状态表](../../../coordination/M6-STATUS.md)，从O1-01继续。

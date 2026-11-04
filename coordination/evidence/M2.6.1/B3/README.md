# M2.6.1-B3 — B06 HDR Bloom Refinement

**B3 实现与专项验证完成，等待用户视觉验收。** 本轮仅 B06；发布提交与自动 CI 尚待最终 PR 记录，不授权合并、推送 main 或启动 B4/B5。机器可读摘要见 [result.json](result.json)。

## 先看这四张原始对照

同一 60° FOV、1920×1080、exposure 1、相机与时间；完整效果使用生产 Bloom **0.35**，Bloom-off 仅将该强度设为 0。Rays / softHalo / wideHalo / Corona / tint 均保持 **1**。

| 控制 | 原始 PNG |
| --- | --- |
| Before，完整效果 | [before/full](before/normal-60-center-exposure-1-full.png) |
| After，完整效果 | [after/full](after/normal-60-center-exposure-1-full.png) |
| Before，Bloom-off | [before/Bloom-off](before/normal-60-center-exposure-1-bloom-off.png) |
| After，Bloom-off | [after/Bloom-off](after/normal-60-center-exposure-1-bloom-off.png) |

派生查看图：[太阳细节](derived/solar-detail-comparison.png) · [exposure 0.5 / 1 / 2](derived/exposure-comparison.png) · [场景联系表](derived/scene-overview.png) · [运动联系表](derived/motion-overview.png)。派生图用于查看；原始 PNG 与报告中的状态/hash 为依据。[裁剪/缩放记录](derived/panels.json)与[120 帧逐项裁剪记录](derived/motion-overview.json)保留来源；未改变颜色、曝光或对比度。

120 帧原图全部保留：[before 目录](before/motion/) / [after 目录](after/motion/)，[before 播放页](before/motion/index.html) / [after 播放页](after/motion/index.html)，[before 序列与 hash](before/motion/sequence.json) / [after 序列与 hash](after/motion/sequence.json)。播放页须随同目录打开；播放速度不是实测 FPS。

## 实际执行版本与环境

| 项目 | Before | After |
| --- | --- | --- |
| 硬件捕获的运行代码提交 | `76faa2be8e0b0b9e4b49a74ba600d0d4eb775aba` | `4fde49bc63eb67c34816a424895d035b24efc2ea` |
| bundle SHA-256 | `eb724fba3ee9720711eb0c1afdc127c907878138fd480f695fb65c754c121ced` | `7c9880bf43281d762d8470e82070f96f6c81e09c19d6880fb571a5e496856953` |
| 原始报告 | [before/result.json](before/result.json) | [after/result.json](after/result.json) |

Before 使用上述 main 运行代码与本轮相同的修改/未提交捕获脚本；不是整棵工作树均处于干净 main。After 捕获时 tracked diff 为空，仅 evidence 目录未跟踪。最终发布提交待定，由最终 PR 记录代码树/hash 对应关系；发布提交不冒充硬件执行提交。[来源与配对审计](audit.json)

两侧均为 Windows、headed Chrome **156.0.8078.76**、Cesium **1.146.0**、Node **v22.20.0**；WebGPU adapter 为 **Intel / xe-lpg，non-fallback**。独立 OS 记录为 **Intel Arc 130T**、驱动 **32.0.101.8801**、Windows NT **10.0.26200.0**。设备名称中的容量文字不是驻留显存测量。[设备记录](environment/device.json) · [依赖记录](environment/dependencies.json)

175 对场景的 browser、adapter/features、provider、相机、时间、viewport/canvas、DPR、resolutionScale、exposure、Bloom 与各 solar strength 均匹配。两侧全部场景 tilesLoaded=true、solar assets 已加载，无 provider/render/GPU/browser/network 错误。影像是本地 NaturalEarthII；地形为 Ellipsoid 或可控 CustomHeightmap 实网格，不包含在线全球地形验收。[Before](before/result.json) · [After](after/result.json) · [审计](audit.json)

## 改动与捕获范围

仅修改生产 [Bloom WGSL](../../../../packages/engine/Source/Scene/WebGPUSolarBloomShader.js) 和 [renderer 中的 blur 标签](../../../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js)：阈值 1 周围采用半宽 0.5 的连续 soft knee；≤0.5 不提取，≥1.5 保持原提取量。原五点分离对角采样改为归一化 5×5 核、九次双线性采样，复用同一 quarter-resolution blur pass 与目标纹理。生产 Bloom 仍为 **0.35**；无新 pass/纹理、无 artwork/太阳几何/遮挡逻辑变化，顺序仍为 scene-linear HDR → Bloom → 单次 ACES → 单次 sRGB。

| 每侧阶段 | 原始 PNG 数量 |
| --- | ---: |
| 12 组完整效果 / Bloom-off：60°中心与偏轴的 0.5/1/2 exposure、边缘、720p→1080p、三种高度场景 | 24 |
| 7 个遮挡场景，每个 Sun on/off × Bloom 0.35/0 | 28 |
| motion-initial、lifecycle-reference、GPU timing state | 3 |
| 连续运动 | 120 |
| 三轮 create / resize / restore / destroy，每轮三个截图 | 9 |
| **每侧合计** | **184** |

前四行是报告的 **175 scene PNG**；另有 **9 lifecycle PNG**。每侧 15 条 compiled-shader 记录对应 6 个不同 WGSL 文件，审计合计校验 **190 个文件**；两侧总计 368 张原始 PNG。每侧 **206/206 自动 gate 通过**，配对审计状态仍为 `AUTOMATED_GATES_PASS_VISUAL_REVIEW_REQUIRED`。[审计](audit.json) · [before gates](before/b3-gates.json) · [after gates](after/b3-gates.json)

## 画面观察与界限

人工复核范围是代表性原始帧、派生裁剪/联系表及运动指标，未宣称逐张、逐帧穷尽视觉复核。观察为内侧 glow 更紧凑、过渡更平滑，B1/B2 Rays/Corona 主体保留，太空背景维持黑色；整体差异较细微。既有 Corona 云状感与 NaturalEarth 接缝仍保留。本轮记录不代替用户视觉验收。

三个中心 60°完整效果原图的像素对比中，exposure 0.5/1/2 分别改变 **1256 / 1159 / 1076** 个像素，全部在 **x=942…977、y=522…557（36×36）** 内；太阳中心为 (960,540)，180 px 半径外最大差为 **0**。以 RGB 三通道均 ≥250 计的白像素为 **96→112 / 180→180 / 192→192**。这仅说明这三组画面内，内侧光源范围之外的空间/星空像素未变；不能推广到全部场景，也不承诺所有 exposure 下减少 clipping。[逐项像素指标](derived/selected-pixel-metrics.json)

## 遮挡：部分可见与完全隐藏分别核验

主要画面与运动序列使用 60° FOV。`earth-hidden-normal-fov` 同样为 60°；其余精细 Earth / terrain 遮挡检查使用 12°，仅作几何与源贡献诊断，不替代正常视角验收。

每个遮挡案例保留四个控制。例如正常 60°全隐藏案例：[Sun on + Bloom 0.35](after/earth-hidden-normal-fov-fullOn.png) · [Sun off + Bloom 0.35](after/earth-hidden-normal-fov-fullOff.png) · [Sun on + Bloom 0](after/earth-hidden-normal-fov-zeroOn.png) · [Sun off + Bloom 0](after/earth-hidden-normal-fov-zeroOff.png)。相机/时间不变；比较的是太阳新增贡献，不要求大气本身变黑。

- 部分 Earth / terrain 场景的 113 个可见性样本隐藏比例分别为 **45.13% / 65.49%**，未遮挡部分仍有非零太阳贡献；terrain 案例中心 `centerEarth=false`、`centerMesh=true`，部分场景含 74 个仅网格遮挡样本。实际 Earth receiver 区域的 final-byte 差为 0。[部分地球](after/earth-partial-fullOn.png) · [部分实网格](after/terrain-partial-fullOn.png)
- `earth-hidden`、`earth-hidden-normal-fov`、`terrain-hidden` 两侧均为 113/113 样本隐藏，生产太阳采样最大 radiance **0**。全画面 **2,073,600 像素**的 full/source/blurred contribution 均为 **changed=0、max byte diff=0、RGB sum=0**；这是最终输出的精确零差。[After 遮挡记录](after/result.json)
- 移除实际 heightmap terrain 后，在相同相机/时间恢复太阳贡献，whole-frame 最大太阳差值为 before **25** / after **26**；Earth 仍自然遮住约 **24.78%** 的盘面，故此对照不被描述为完整无遮挡太阳。[网格完全遮挡](after/terrain-hidden-fullOn.png) · [移除网格](after/terrain-removed-fullOn.png)
- 原始 HDR 仅在 **49 个位置**读取 scene-linear、Bloom A、Bloom B；以上三个全隐藏案例、三张纹理的 **max/mean absolute RGB delta 均为 0**。这是 sampled HDR 验证，不是完整 HDR 纹理全量比较；结合全画面最终零差，区分源消失与仅最终遮罩。[Before 遮挡记录](before/result.json) · [After 遮挡记录](after/result.json)

## 120 帧连续运动

两侧每个实际 render 均保存，分别是 renderer frame **688…807 / 687…806**。固定 exposure 1、Bloom 0.35、1920×1080 与各 strength 1；每帧转动 0.015°、时间推进 10 s。PNG 编码会限制采集速度。

| 指标 | Before | After |
| --- | --- | --- |
| 全画面 mean luma 范围 | 0.002038636–0.002064957 | 0.002026216–0.002052431 |
| clipped-channel fraction 范围 | 0.000069927–0.000074267 | 0.000072820–0.000077160 |
| white fraction 范围 | 0.000084877–0.000089699 | 0.000086323–0.000089699 |
| 119 组相邻帧 mean absolute RGB byte diff | 0.022487783–0.023005401 | 0.022093943–0.022603684 |
| 相邻帧最大 channel-byte diff 范围 | 39–50 | 32–35 |
| 相邻帧 changed pixels 范围 | 16003–16302 | 16019–16312 |

mean luma 首尾增长约 **1.288% / 1.290%**；最大绝对相邻 luma 变化均在 frame 119，为 **7.43318e-7 / 6.00314e-7**。mean absolute RGB diff 的峰值在 before frame 117 / after frame 107，仍处于上表窄范围。上述是全画面 aggregate，不能当作太阳 ROI 质量或“无局部闪烁”证明。[Before 序列](before/motion/sequence.json) · [After 序列](after/motion/sequence.json) · [逐帧 photometry](after/result.json)

## 实测 GPU 时间与资源

同一硬件、1920×1080，每模式各 **30** 个 duration samples。以下是 **mean / p95，单位 ms**；all-enabled 有 5 个受测 pass，另两模式各 3 个。

| GPU pass sum | Before | After |
| --- | ---: | ---: |
| Baseline | 1.690829 / 2.031616 | 1.664614 / 1.835008 |
| Solar，Bloom-off | 1.636215 / 1.900544 | 1.786948 / 3.014656 |
| All enabled | **2.232593 / 2.490368** | **2.317790 / 2.490368** |

| All-enabled 分 pass | Before | After |
| --- | ---: | ---: |
| Opaque terrain | 0 / 0 | 0 / 0 |
| Atmosphere + Sun HDR | 1.234261 / 1.376256 | 1.282321 / 1.376256 |
| Threshold + downsample | 0.235930 / 0.262144 | 0.253406 / 0.262144 |
| Blur | 0.030583 / 0.065536 | 0.048060 / 0.065536 |
| Composition + ACES + sRGB | 0.731819 / 0.786432 | 0.734003 / 0.786432 |

All-enabled pass-sum mean 增加 **0.085197 ms（约3.8%）**，p95 不变；SD 为 **0.187616 / 0.149907 ms**。After Bloom-off 波动较大（范围 **1.507328–3.342336 ms**、SD **0.396816 ms**），因此相减得到的 incremental Bloom **0.596378→0.530842 ms** 不能证明提速。GPU frame-span mean/p95 为 **2.761250/3.538944→2.711006/3.407872 ms**，wall render-and-map 为 **5.696667/7.100000→5.856667/8.100000 ms**。

保存值是已换算的 duration samples，不是原始整数 query ticks。all-enabled 短 pass 的读数呈 **0.065536 ms** 量级台阶；blur 的零读数为 **16/30→8/30**，opaque 为两侧 **30/30**，均不能解释为零工作量/零开销。这些是单设备、有限样本观察。[before timing](before/gpu-timing-raw.json) · [after timing](after/gpu-timing-raw.json)

- 受记录纹理 payload 两侧均 **21,808,128 B（20.797852 MiB）**，含 HDR/Bloom targets 18,662,400 B 与 solar assets 3,145,728 B；驻留 VRAM 未测量。
- 计时期间 renderer 新增 textures/buffers 为 **0/0**；profiling query set **1/1**、buffers **2/2** 创建/销毁。
- 连续 120 帧的 solar 资源计数无增长。每轮 lifecycle 最终 renderer textures **20/20**、buffers **3/3**；每侧三轮原生 ledger 合计 **69 textures + 9 buffers = 78 objects**，全部仅销毁一次，live=0、重复销毁=0。[Before lifecycle](before/result.json) · [After lifecycle](after/result.json)

## 已执行验证与尚待完成项

| 已执行项目 | 实际结果与记录 |
| --- | --- |
| baseline / candidate build | 均 exit 0：[baseline](logs/baseline-build.log) / [candidate](logs/candidate-build.log) |
| 合并后的 focused Node batch | **11 pass、0 fail、0 skip**，604.2566 ms：[日志](logs/focused-units.log) |
| runtime/probe/capture/audit 定向 ESLint；harness lint | 均 exit 0：[candidate](logs/candidate-lint.log) / [harness](logs/harness-lint.log) |
| 生产 WGSL 小高光负/正控制 | [before error.json](probes/before/error.json)：轴向扩散不连续断言 **FAIL**，保留原失败；[after result.json](probes/after/result.json)：**PASS**；[before log](logs/probe-before.log) / [after log](logs/probe-after.log) |
| 两侧硬件 capture 与配对审计 | 每侧 206 gates 通过、190 文件校验；175 对匹配；[audit.json](audit.json) |

Focused batch 为 `m2-hdr`、`m2-solar-lifecycle`、`m2-atmosphere-lifecycle`、`m2-b1-round2`、`m2-b2-halo-corona`。build/unit/lint 与 probe 批次在候选提交前工作树执行；after probe 的 `source` 仍是 baseline，`sourceStatus` 含运行代码修改，其 bundle hash 与正式 After 完全一致。不要把这些历史运行改写为发布 HEAD 新执行的结果。源码/hash、命令适用性见 [verification-commands.json](verification-commands.json)；原报告及日志保留实际状态。

**待完成：用户视觉验收；最终发布 PR 的 tree/hash 映射及自动 Fast/Full 实际结果跟踪。** 当前不宣称完整 WebGL differential、广泛 types 或所有场景/设备验收。未手动执行、dispatch、rerun Full，也未为触发 Full 额外推送或切换 `ci:full`。自动 Full 若被正常发布事件选中，只按其实际非渲染范围报告；selector-only/skip 不算执行通过。[CI 规则](../../../../docs/CI.md)

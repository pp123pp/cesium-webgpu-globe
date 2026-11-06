# M6.O0 — 基线、数据与接口冻结

2026-11-06 · **文档/数据技术核查结项；没有海洋 runtime、渲染或性能通过结论。**

## 基线与产物

开始时已有的规划改动已在本地提交 `157a40eed3290b1abed82c64f4e428209b146958`（25个文件）；核对时工作区干净，无需再造空提交。O0 工作在 `codex/m6-o0-contracts`。设计 runtime 基线为 `8434abc1124fa5389b13f90816d8c2acf52a4382`；两者的 packages/core、engine、widgets 无差异。O0 只新增合同、数据元信息/许可/审计夹具及验收与状态文档，不修改运行时。

| 证据/交付 | 内容 |
| --- | --- |
| [baseline.json](baseline.json) | 入口 HEAD/分支、Cesium 1.146.0、engine 26.4.0、Node v22.20.0/npm 10.9.3、11个接点文件 SHA256、规划差异路径、未执行项。package-lock.json 不存在；本次未安装/修改依赖。 |
| [cesium-tag-remote.txt](cesium-tag-remote.txt) | 本次官方 `git ls-remote`：tag 1.146 对象 `b90bf5fa30c8f573072181165c9462d987e26580`，解引用提交 `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`；与导入记录一致。本地没有导入 upstream Git tag；REST 限流后改为此只读核验。 |
| [实施合同 v1.0](../../../../docs/M6_OCEAN_CONTRACTS.md) | 已有真实签名/源码位置；五个拟新增记录；唯一时间、地理框架、米制高度、海洋分类、附件所有权、合成与历史状态机。没有把未来类写成已有 API。 |
| [数据 manifest](../../../../packages/engine/Source/Assets/Textures/WebGPU/Ocean/manifest.json) / [数据审计](data/README.md) | Natural Earth v5.1.2 固定提交、21个实取文件哈希、许可、26个分类样本、连通性修正及128个512²瓦片的未来生成合同。runtime raster **NOT_GENERATED**。 |
| [scenarios.json](scenarios.json) / [验收矩阵](../../../../docs/M6_ACCEPTANCE.md) | O1 最小离线功能夹具、O3 全球/远近/性能场景、O6/O7复验边界、证据字段和阻塞出口。全部运行结果 NOT_RUN。 |
| [checks.json](checks.json) | 本次实际内容/哈希/数据/链接/diff核查及未执行范围。 |

## 已核对的接入约束

以下路径相对 `packages/engine/Source/`，行号属于入口检查点。

| 源码事实 | 接点/对后续任务的影响 |
| --- | --- |
| 同一活动相机和时钟 | `Scene/WebGPUScene.js:138,149,220–228,293–299,345–346`；不能另 tick 或另建 Camera。O1-01 消费最终 frame.time 和 planetState。 |
| 全部 sceneColor 目前被地形照明处理 | `Scene/WebGPUAtmosphereShader.js:380–393,421–428`；Globe 输出 linear albedo，影像 alpha 用于混合。O1-04 增独立 surface type，海洋已着色辐亮度不再乘 Lambert/月光。 |
| 默认海域/地表盖板真实存在 | `Core/EllipsoidTerrainProvider.js:138–151` 生成全零16×16高程；`Scene/WebGPUGlobeRenderer.js:592–610` 仍写地形/裙边深度。O1-03 只对确认 ocean 且已识别的无海底盖板作局部分支，不能删整 tile 或任意零米 terrain。 |
| 内部实心椭球与相机碰撞 | `Scene/WebGPUPlanetShader.js:95–102` 截空气光路；`Scene/WebGPUSunShader.js:7–9,93–96` 合并椭球/真实深度遮挡；`Scene/WebGPUScene.js:282–287` 的地下判定不是水；native controller `:2941–2956` 会推回地表。O1-03/05 局部处理海下视点并保留岛屿/陆地/背面遮挡，不改 WebGL controller。 |
| waterMask 未被消费且语义不足 | WebGPU*.js 无消费；`Core/HeightmapTerrainData.js:43–45,161–164` 只分水/陆。`Scene/WebGPUGlobeTileProvider.js:311–332` 仅 createMesh/upload。O1-02 采用独立海洋分类。 |
| 只有 terrain color/depth，没有 pre-water 或 surface target | `Renderer/WebGPUContext.js:185–209,258–261`；当前 depth 无 COPY_SRC。O1-03/04 明确 opaque只读→独立海面目标→大气/云，禁止读写同一纹理。 |
| GPU资源和恢复 | `Widget/WebGPUWidget.js:250–255` 先 Scene 后 Context；Context `:85–92,270–299` 在 loss 报错并释放，不自动重建。海洋必须先释放资源；显式重新创建 Viewer 才恢复。 |

这些是新功能必须适配的既有约束，**不是本次发现并修复了 M5 的 GPU 缺陷**；O0 无需运行修复或提前实现 O1。

## M5 关系、责任人与解除条件

| 项目 | 关系/当前事实 | 责任人、受影响任务与解除条件 |
| --- | --- | --- |
| M5任务1/2：参考视图、相机高度/时间连续性 | 保留原本地完成；`1a69ccd` 是当前 HEAD 祖先，但后来 shader 已变化，历史 GPU结果不重标为本次/当前完整验证。 | 集成负责人维护原证据；O1/O2 改共享深度/光照时选取相关回归。O0没有重拍、重测或重新判视觉接受。 |
| M5任务3：shimmer/ghosting/density popping，A16 | 可并行保留；O0 未证明新的既有阻塞。 | 原M5负责人；O2/O3 的海面/天空云反射若实际复现阻塞再最小修复，解除条件是对应固定运动路径、原始失败与修复证据。未全面关闭。 |
| M5任务3：资源/resize/device loss，A17 | 直接影响 O1-05/O3-03 的验证义务，尚非已确认代码失败；不在 O0 修复猜测竞态。 | 海洋集成负责人；新增资源的开关/resize/迟到请求/释放通过，并保留M5其余soak/recovery欠项。不能用资源分配计数冒充 resident VRAM。 |
| M5任务4：整体 profiling | 可并行保留；未测量。 | M5/海洋性能负责人；O3/O6/O7分别锁设备/预算并实测增量，旧功能全体 profiling 仍须独立覆盖。 |
| M5任务5/6：最终WebGL/A01—A18/V1.0 | 与O0文档执行无直接阻塞；最终回归/发布门保持未完。 | 集成负责人；适用最终源码、所需门槛与授权齐备后结项。历史通过不等于新HEAD通过。 |

**O0阻塞：无未解除的版本、许可或接口核查阻塞。下一项 O1-01 可开始。** O1 的盖板/照明/介质/碰撞适配是明确实现任务，不要求先完成所有M5清理。

## 数据与参考的实际结论

唯一一期源为 Natural Earth Vector v5.1.2，commit `f1890d9f152c896d250a77557a5751a93d494776`；ocean/land/lakes 层版本分别5.1.1/5.1.1/5.0.0，public domain。源 ocean 图层含里海/Garabogaz：按真实外环和开阔太平洋种子推导全球海洋组件后，其余封闭组件归 inland-water。不能靠名称、水色、waterMask、负高程或粗栅格 flood-fill 判断海洋。

26个样本与冻结处理规则一致；**Alcatraz 漏岛仍是地理偏差**，没有伪装为全球小岛正确。网格赤道采样约4.89km，源1:1000万比例尺不等于10米精度；不承诺绝对岸线误差。O1必须保留真实岛屿深度，实际 raster 边界/狭海峡尚未验证；受源缺漏影响的小岛用例不得直接记 M6-A02 通过。精细近岸数据/潜在潮间带和有效水深在O5另行冻结，不由粗掩膜虚构。

本次只读核验 Tidewater 固定 commit `4811ba48d795197de5621985f404e765c0b7c0ef` 的 [LICENSE](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/LICENSE)、[OceanFFT](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/ocean/OceanFFT.js)、[WaterMaterial](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/ocean/WaterMaterial.js)、[Sky](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/sky/Sky.js)：MIT，Copyright (c) 2026 DRG Software Solutions LLC；FFT尺寸256、默认4级，泡沫依赖前态；其累计 `time += dt*timeScale` 不能照搬为第二时钟。水材质先天空/云方向反射，SSR可选，GGX太阳项独立；没有导入其代码、素材或第二套天空。

## 实际检查与复核

- 远端tag核验、包/workspaces/导入身份/Apache许可断言：通过；11个相关runtime哈希与baseline一致。
- `python -B coordination/evidence/M6/O0/data/audit-natural-earth.py`：exit 0，21个源文件/许可哈希、26个冻结分类样本、缺失数据/日期变更线与组件检查；结果哈希 `a5efa5cf06df81ac7c01dfa4c04ee076a93b5c557b773a709b0528174e958f44`。源地理缺漏单独保留。
- 独立源码/合同审查后修正：Coverage调度入口、CPU区域→时间顺序、历史渐入的场景秒语义、长波重定位边界、显式恢复措辞。无运行时修改。
- JSON/路径/链接/勾选与任务依赖、manifest和场景一致性、`git diff --check` 的最终结果见 checks.json；不把计划命令写成已运行。

复核数据命令见 [data/README](data/README.md)。复核runtime哈希可在仓库根执行：

```powershell
@'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const b=JSON.parse(fs.readFileSync('coordination/evidence/M6/O0/baseline.json','utf8'));
for(const [p,h] of Object.entries(b.sourceSha256))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h,p);
console.log('11 source hashes match O0 baseline');
'@ | node --input-type=module
```

未执行：raster生成/海洋加载、单元/渲染运行验收、build/types、GPU适配器探测、截图/视频、计时/resident VRAM、WebGL回归、Fast/Full。原因是O0不改变运行时；O1需要的本地硬件检查仍必须执行，禁止SwiftShader。没有push、merge或手动触发Full。

## 下一任务

**O1-01 — 单时钟与稳定地理框架**，读取 [O1任务](../../../../tasks/M6/O1.md)、[合同§2/3/6](../../../../docs/M6_OCEAN_CONTRACTS.md)和 [M6状态](../../../M6-STATUS.md)。先实现 CPU 地理框架与 OceanTimeSample 的最少真实数值/状态检查；不在这一步实现整个FFT、反射或水下。M5开放项照实保留；O0关闭不代表海洋效果、性能或V1.0通过。

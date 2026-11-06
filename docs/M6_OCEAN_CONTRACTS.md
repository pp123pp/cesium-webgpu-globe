# M6 海洋实施合同

合同版本：**1.0，2026-11-06，O0 冻结**。适用源码检查点 `157a40eed3290b1abed82c64f4e428209b146958`；其 runtime 与设计基线 `8434abc1124fa5389b13f90816d8c2acf52a4382` 相同。

本文件中的“已有”已经核对源码；“拟新增”是后续实现必须消费的签名，**目前没有对应 runtime**。变更合同须同步受影响的阶段任务和调用方。原需求以[设计](superpowers/specs/2026-11-06-m6-global-ocean-design.md)为准；数据以 [manifest](../packages/engine/Source/Assets/Textures/WebGPU/Ocean/manifest.json) 为准；实际核查在 [O0 证据](../coordination/evidence/M6/O0/README.md)。

## 1. 已有接点，不能假定已有海洋 API

以下路径相对 `packages/engine/Source/`，行号属于上述检查点。

| 已有签名/字段 | 来源 | 语义与接入约束 |
| --- | --- | --- |
| `WebGPUScene.render(time)` / `_renderFrame(time)` | `Scene/WebGPUScene.js:293,309,345` | 仅未传 time 时才 `clock.tick()`；事件回调之后克隆为 `this._frameState.time`。海洋读取该帧 time，不再 tick。 |
| `scene.camera` / `scene.ellipsoid` / `scene.clock` | 同文件 `127,138,149,220` | 一个活动 Camera，`frame.camera` 是同一实例；仅 SCENE3D，未夸张的椭球高。 |
| `WebGPUPlanetState.update(camera, time, moon, stars)` | `Scene/WebGPUPlanetState.js:55–72,112–158` | 已有 ECEF 米制、椭球高、太阳 WC 单位方向、相机 high/low、有限反向深度参数；无 ocean/history 状态。 |
| `WebGPUGlobeRenderer.render(scene)` | `Scene/WebGPUGlobeRenderer.js:505–523` | atmosphere.update 后调用 Context.render。地形和影像 shader 在 `:42–44,70–71` 输出 linear albedo，影像 alpha 已用于混合。 |
| `WebGPUContext.render(draw, backgroundColor, composite)` | `Renderer/WebGPUContext.js:212–262` | terrain/imagery pass 完全结束才调用 composite；最后一次 submit。不是通用 RenderGraph。 |
| `context.sceneColorTexture` / `sceneDepthTexture` | 同文件 `185–209` | Context 持有 rgba16float 与 depth32float；resize 后需重新获取 view。已有 color 支持 COPY_SRC，depth 尚无 COPY_SRC。 |
| `WebGPUAtmosphereRenderer.update(state, parameters, sun, moon, stars, exposure, surfaceLighting, clouds)` / `composite(encoder,target,color,depth)` | `Scene/WebGPUAtmosphereRenderer.js:82,375,720–843` | 云影列→大气/太阳 linear HDR→云→Bloom→可选镜头测量→最终 ACES/sRGB。没有可调用的 ocean 环境辐亮度查询。 |
| `WebGPUDepth` / `reconstructEyeDistance(depth,near,far)` | `Renderer/WebGPUDepth.js:48–55,97–103` | depth32float、clear=0、greater；near=0.1m/far=500000000m。CPU 背景是 Infinity；WGSL ray-distance 背景是 -1，不能混用。 |
| `scene.cameraUnderground` | `Scene/WebGPUScene.js:282–287` | 只是相机高度与 globe.getHeight 比较，**不是入水状态**。默认 native 相机碰撞也会把相机推回地形以上。 |

地形 RTC 在 `Scene/WebGPUGlobeMath.js:25–38,53–74`，WGSL high/low 相减在 `Scene/WebGPUPlanetShader.js:31–33`。现有所有权：Widget 销毁 Scene 后销毁 Context/device；Scene 销毁 renderer/atmosphere/globe；tile.freeResources 取消请求并销毁 mesh。`waterMask` 在 native TerrainData 中只表示水/陆；WebGPU*.js 没有消费它，不能据此宣称已有海洋分类。

## 2. 拟新增入口与模块签名

公开实验入口选择 **WebGPUScene 的 `scene.ocean` 配置对象**，沿用 scene.clouds 风格，不增加 Viewer 参数或 WebGL 字段。O1 创建 `scene.ocean = { show: false, referenceSeaHeight: 0 }`；示例在 Viewer ready 后设 `show=true`。`referenceSeaHeight` 是有限的 WGS84 椭球高（米），默认 0 只是展示参考面，不是全球真实 MSL。

O2 才增加 `scene.ocean.seaState = { windSpeed: 10, windDirection: 0, fetch: 100000, seed: 1 }`（m/s、当地 East 朝 North 旋转的弧度、米、uint32）。O4 才增加 `scene.ocean.tide = { amplitude: 0, period: 43200, phase: 0 }`（米、正秒、弧度）。参数只在外部赋值被消费的入口校验一次；同值不使 generation 改变。这些默认值是可复现起点，未获视觉/性能验收。不开启 SSR，不添加船舶/业务高度查询 API。

| 拟新增模块/签名 | 首次实现 | 输入→输出/所有权 |
| --- | --- | --- |
| `new WebGPUOceanTime({ epoch, maxHistoryStepSeconds, maxHistorySteps, historyFadeSeconds })`；`update(time, { frameNumber, regionGeneration, seaStateGeneration, explicitSeek }, result)` | O1-01 | JulianDate → OceanTimeSample；CPU，无 GPU 资源；epoch 默认 `2000-01-01T12:00:00Z`，创建时 clone。result 可复用。 |
| `new WebGPUOceanCoverage(context, { manifestUrl })`；`initialize()`；`update(frame, surfaceState)`；`sample(cartographic, result)`；`destroy()` | O1-02 | update 按当前网格范围调度有限瓦片；sample 不启动网络，返回 OceanCoverageSample；initialize 加载 manifest，不阻塞到全部全球瓦片。 |
| `new WebGPUOceanMesh(context, ellipsoid)`；`updateFrame(camera, result)`；`update(surfaceState, coverage)`；`destroy()` | O1-01/02 | updateFrame 仅更新 CPU 锚点/RTC/regionGeneration；随后 OceanTime 消费 generation、Ocean 填高度/权重；O1-02 才由 update 更新实际 GPU 网格。避免 region 与 time 循环依赖，不在 O1-01 提前分配网格。 |
| `new WebGPUOcean(scene)`；`initialize()`；`update(frame, planetState)`；`encode(encoder, inputs)`；`destroy()` | O1-03/05 | Scene 持有 `_ocean`；update 在 planetState.update 之后且 opaque pass 前调用一次；encode 在 opaque pass 结束后、atmosphere composite 前。借用 Scene/Context，不拥有 device。 |
| `WebGPUOcean.updateEnvironment(frame, planetState, atmosphere, clouds)`；`encodeEnvironment(encoder)` | O2-03 | 写在现有拟新增的 WebGPUOcean.js/Shader.js 内，无须另建协调类。输出 OceanEnvironment；从现有物理模型生成方向缓存，不截屏充作环境。 |

O0 不创建这些类。频谱、FFT、潮汐、海底与水下模块按 O2/O4/O5/O7 才创建，不为未来职责放空壳。

## 3. 五个记录的字段

CPU 地理位置/时间均用 JS number 双精度；Cartographic 的 longitude/latitude 为弧度。向量使用现有 Cartesian3/Matrix4，不另建向量库。GPU 句柄只借用到本帧结束；不得跨 resize/provider/device generation 留存 view。

### OceanTimeSample（拟新增，O1-01）

| 字段 | 类型/单位 | 生产者与消费者 |
| --- | --- | --- |
| `time`, `epoch` | JulianDate（clone，不持有可变 clock.currentTime 引用） | frame.time → FFT/潮汐/环境；同一帧所有消费者同值。 |
| `seconds`, `deltaSeconds` | number / 秒；JulianDate.secondsDifference | 相对 epoch 的绝对求值时间及逻辑 delta；首帧 delta=0。不得把巨大 seconds 直接转 f32。 |
| `kind` | `initial/paused/forward/reverse/jump` | 同时刻即 paused；explicitSeek、超预算或循环回绕是 jump；负 delta 为 reverse。不能仅凭 shouldAnimate 判暂停。 |
| `historyGeneration` | 单调非负整数 | 初始、跳时、方向切换、海况或区域变更时递增；连续反播每帧重建目标窗口，generation 不必每帧重置渐入。 |
| `historyAction` | `hold/advance/rebuild` | paused=hold；有预算正播=advance；其余=rebuild，负 dt 永不进入正向积分器。 |
| `historySteps`, `historyStepSeconds` | integer、非负秒 | 默认上限 4 步、每步 ≤1/30s；advance 等分正 delta，超过 4/30s 则 rebuild。rebuild 最多计算目标时刻前 4/30s 的窗口，不追赶全部漏帧。 |
| `historyWeight` | number，[0,1] | 新 generation 权重先置0，不累计导致失效的跳跃量；随后按连续样本的 `abs(deltaSeconds)` 积累，0.5 场景秒到1，暂停不变。持续反播允许逐帧短窗近似，波形/潮位仍绝对求值。 |

对频率 ω 上传的相位在 CPU 双精度计算 `remainder(ω*seconds,2π)` 或等价分段时间；不能让每个帧的 dt 积累替代目标时间。相同时间/seed/seaState 对应相同几何波形；历史白沫不承诺任意时间精确重放。明确 seek 的调用方把 explicitSeek 置一次；未标明但超预算的差值仍触发 rebuild。仅凭两个 JulianDate 不能识别全部用户操作：未标记且在预算内的小变化按连续样本处理。

### OceanCoverageSample（拟新增，O1-02）

| 字段 | 类型/含义 |
| --- | --- |
| `classification` | `unknown/ocean/land/inland-water`；GPU 编码固定 0/1/2/3。 |
| `sourceId`, `level`, `tileX`, `tileY` | `natural-earth-5.1.2`、0、0..15、0..7；无数据时 sourceId 可 null。不能把层级 0 解释为原生 terrain level 0。 |
| `status` | `ready/known-fallback/parent/unavailable`；parent 只能引用真实存在的有效父级，首期未生成父级。 |
| `oceanConnected` | ocean=true；land/inland-water=false；unknown=null。依据源 ocean 语义，不对粗 raster 做 flood-fill 决定是否为海洋。 |
| `boundaryUncertain` | boolean；源岸线与 texel 足迹相交则 true、classification=unknown，不能用中心点把含小岛像元判为整片海洋。 |
| `generation` | Provider/资产切换后的版本号；迟到旧请求不得写新缓存。 |

唯一一期主源是 Natural Earth 同一发行的 ocean/land/lakes。不能把 ocean 图层名直接当海洋：实际源把里海也放在该层；用固定开阔太平洋种子选取全球海洋外环组件，其余封闭组件归 inland-water，再按 manifest 规定的 lakes/land 优先级分类。海湾/海峡的连通性取矢量组件，不对粗 raster 做 flood-fill。仅确定 ocean 才增加海面；unknown 保留既有地形/影像。内陆低洼和不在源数据中的小湖不能由负高程转为 ocean。waterMask 只能细化已经确认的海洋内部，不能覆盖上述身份。数据分辨率不等于岸线绝对精度。

### OceanSurfaceState（拟新增，O1-01/02）

| 字段 | 类型/单位/约束 |
| --- | --- |
| `frameNumber`, `regionGeneration` | integer；本帧和稳定地理区域身份。 |
| `anchorCartographic`, `anchorWC` | Cartographic（参考高）、Cartesian3 ECEF 米；**波场锚点**，普通相机平移不改变。 |
| `eastWC`, `northWC`, `upWC` | Cartesian3 单位向量，右手 ENU；精确极点使用现有 Transforms 的确定性极点基。 |
| `renderOriginWC`, `renderOriginHigh`, `renderOriginLow` | ECEF 米；只为 GPU 精度而移动的 RTC 原点，和波场锚点分开。 |
| `referenceSeaHeight`, `displayTideHeight` | number / 椭球高米；O1 潮位恒 0；O4 才求展示曲线。 |
| `displacementENU` | GPU 位移资源或 O1 诊断函数；三分量米 `(East,North,Up)`，不是标量波高。 |
| `cameraMediumBuffer` | 同帧 GPU 记录，`vec4f(signedDistanceMeters,surfaceHeightMeters,medium,valid)`；medium=0 air/1 water/2 boundary，valid=0 时未知。 |
| `detailWeight` | number [0,1]；定位/高度过渡权重，暂停时不能依靠墙钟变化。 |

水面标量高度 `referenceSeaHeight + displayTideHeight + displacementENU.z`。先应用 EN 水平位移并投影到椭球，再沿该位置 geodetic normal 加高度；使用现有 ellipsoid 投影/变换，不直接把 xyz 位移加到标量高度。

网格采样和相机 signed distance 必须针对**同一已水平位移的表面**，不能只拿相机经纬度对应的未位移波高。O1 可用解析诊断位移同时求值；O2 使用同一位移纹理和有界逆映射/局部三角面查询，在绘制前写 cameraMediumBuffer。CPU 若异步读回仅作诊断，必须附 frameNumber/generation，不得把旧读回当成生产介质状态。它不替代 cameraUnderground，也不提供同步业务高度 API。`abs(signedDistance)≤0.05m` 为 boundary 起始容差，O7 可基于真实水线证据调整。

**稳定区域和重定位的起始参数：** 网格 RTC 原点按 256m 对齐可移动；波场锚点不随 RTC 改变。当地 EN 坐标用 CPU 双精度的 `(P-anchorWC)` 点乘基向量，周期相位按级约简；先做 high/low 相减，不能先把地球绝对 ECEF 合成 f32。锚点离相机地表距离 12km 起衰减所有依赖旧锚点的位移/法线细节（包括长波），16km 前归零，随后选择新地理锚点并按 0.5 场景秒渐入；不保留无界历史区域。日期变更线按 ECEF 连续距离判断，不用经度相减；极区不采用 `1/cos(latitude)`。瞬移直接换 generation，基础参考曲面保留，细节允许有界渐入。O3 必须实测这组参数的连续性，参数不是已经验证的画质承诺；不要求跨全球存在单个平面频谱坐标。

### OceanEnvironment（拟新增，O2-03）

| 字段 | 来源/语义 |
| --- | --- |
| `frameNumber`, `generation`, `time` | 同帧 time；太阳、云参数/区域变化使缓存失效，加载可完成，动画不另计时。 |
| `sunDirectionWC` | 现有 planetState.sunDirectionWC，ECEF 单位向量；太阳角半径/照明取现有 scene.sun 与 atmosphere 参数，不另造太阳。 |
| `sunAngularRadius`, `sunIrradiance` | 弧度、与现有物理太阳模型一致的 scene-linear RGB 光照尺度；不得把已显示的太阳盘或Bloom像素当 irradiance。 |
| `directionalRadianceTexture`, `directionToTexture` | 从现有天空/云物理模型按世界方向生成的缓存和映射；scene-linear HDR，无 ACES、sRGB、曝光、Bloom、镜头光晕和独立太阳盘。 |
| `cloudTransmittanceTexture` | 同一云模型在实际海面点的太阳透射；无云时为1。不可直接把以 terrain depth 重建的阴影列当作海面阴影。 |

环境天空/云散射与独立太阳镜面项分账；月盘/星星若加入反射也走现有状态，禁止再加一遍 terrain moonlight。缓存首版可从 256×128 rgba16float 开始，只在 O2 实测选择更新节奏，不在 O0 实现第二套天空。现有 cloud.fieldEntries() 是内部数据绑定，不是该合同的现成实现。

### OceanRenderInputs（拟新增，O1-03/04）

| 字段 | 类型/消费者 |
| --- | --- |
| `frameNumber`, `attachmentGeneration`, `historyGeneration` | 匹配本帧/尺寸/历史，便于证据与资源失效。 |
| `time`, `surface`, `coverage`, `environment` | 上述记录；O1 environment=null，使用确定性诊断辐亮度。 |
| `opaqueColor`, `opaqueDepth`, `opaqueSurfaceType` | 本帧已结束 opaque pass 的只读 texture views；color 是 linear albedo，depth 是 terrain/已知海底深度。 |
| `sceneColor`, `sceneDepth`, `sceneSurfaceType` | 海面 pass 的可写目标，**与以上只读纹理不同**；完成后供 atmosphere/cloud/sun 消费。 |
| `preWaterRadiance` | O1/O2=null；O5 才提供已照明的地形/海底 scene-linear 辐亮度（尚未加相机空气/水体输运），供水上折射采样。不能把 opaque albedo 冒充它。 |
| `seafloorValidity` | O1/O2=null；O5 按真实数据有效性提供。无数据时不用假海底替代。 |

## 4. 附件、深度和合成的唯一顺序

拟新增 surface target 为 **r32uint**，无 blending、无颜色空间转换：0 background、1 terrain、2 ocean、3 seafloor（3 首次 O5）。每像素身份跟最近的有效深度一起写；影像 pass 保持既有 alpha 混合，不通过 alpha 编码身份。相机介质走上面的同帧 GPU record，O1 不预建 O7 的屏幕水线附件。

| 次序 | 读 | 写 / 拥有者 |
| --- | --- | --- |
| 1 帧准备 | 最终 camera/frame.time/planetState | Ocean update、FFT/环境/介质 query（各所属阶段）；同一 encoder，query 必须早于消费它的 shader。 |
| 2 opaque | 原生 terrain/imagery、coverage | Context 的 opaqueColor/depth/type；仅确认 ocean 且识别无有效水深盖板的位置舍弃颜色和深度。 |
| 3 初始化海面目标 | 已结束的 opaque attachments | Context 单独的 sceneColor/depth/type。可使用相同格式 texture copy；需给 depth/type 增加必要 COPY_SRC/DST usage。不得边 attachment 写边采样它。 |
| 4 海面 | opaque 只读附件、波场、环境；O5加 preWaterRadiance | sceneColor 写已着色海洋辐亮度；sceneDepth 按现有 reversed-Z 写真实位移深度；sceneType=2。保留原生 terrain 背面/岛屿遮挡。 |
| 5 云影/大气/太阳 | 完成的 sceneColor/depth/type、同帧介质 | terrain 保持既有 Lambert/月光；ocean 跳过这些地形光照项，仅做正确的视线空气输运；云影在水面照明用其实际位置。 |
| 6 云、Bloom、镜头后期 | 已有 linear HDR | 仍由 AtmosphereRenderer 执行；最后一次 ACES/sRGB。 |

**关闭海洋时**继续原有调用链，不分配海洋附件，不修改 WebGL。开启时 Context 统一拥有两套屏幕附件；`sceneColorTexture/sceneDepthTexture` 对外表示该帧供合成使用的最终附件。不要求预先把原 Context.render 改成通用队列：O1 集成负责人只在现有 opaque/composite 间插入有边界的海洋分支，具体内部参数追加在实现时同步本合同。

海域盖板的证据是默认 `EllipsoidTerrainProvider.requestTileGeometry` 的全零 16×16 高程，不意味着任意真实 terrain 的零米顶点都可删。判定必须是 **确认 ocean + provider/mesh 元数据表明确为无有效海底的盖板**。不能删整块海陆混合 tile；unknown、陆地、岛屿、有效海底全部保留。O5 新增 bathymetry 来源/高程换算后先走原 mesh 接点；不足时才建立受 ocean 范围限制的局部海底网格及 preWaterRadiance。

`WebGPUPlanetShader.webgpuAtmosphereSegment` 和 `WebGPUSunShader.sunEarthVisible` 的实心椭球分支必须在 O1-03 覆盖。局部已分类海域、浅层海下向上的射线允许到真实海面/空气边界，不能被椭球入点=0错误截断；向下/穿地球的射线仍保留远侧实体地球约束。不得简单关闭全部解析地球遮挡。native 相机碰撞只在已确认盖板海域允许穿越；保留陆地碰撞，不改公共 WebGL controller 行为。O1 的这些检查只证明通路，完整吸收/散射/半入水画质仍归 O7。

## 5. 所有权与失效

| 资源 | 拥有者 | 失效/释放 |
| --- | --- | --- |
| CPU time sample、稳定锚点 | Scene._ocean | 暂停保留；海况/区域更换更新 generation，无第二 Clock。 |
| 分类请求/瓦片/GPU mask | OceanCoverage | 已知 tile 缓存按固定预算（首版最多32个512²瓦片）淘汰；Provider/资产更换取消旧请求，旧 generation 回调不能上传。 |
| 网格/FFT/泡沫/环境/medium record | Ocean/Mesh/FFT 各模块 | show=false 停止请求和动画；销毁释放，迟到结果丢弃；重启只保留显式允许的有限缓存。 |
| opaque/final color/depth/type 和以后 preWaterRadiance | Context（屏幕附件）；O5颜色生成由集成负责人接入 | resize 同步换 attachmentGeneration 和 bindings；禁用释放新增附件。不可把纹理 view 长期借给外部。 |
| device/canvas | 原 Context/Widget | Ocean 先销毁，随后原 Scene→Context；device loss 沿用报错并释放。恢复需调用方显式重新创建 Viewer，没有自动重建，不切后端。 |

不在 O0 为假设竞态新增通用框架。上述异步 generation 沿用现有请求取消/销毁模式，在 O1/O3 用真实迟到请求案例验证。

## 6. 消费任务与解除条件

| 任务 | 消费的冻结项 | 必需证据 |
| --- | --- | --- |
| **O1-01（下一项）** | TimeSample、SurfaceState 的 time/锚点/米制字段 | 同时刻可复现；暂停；reverse/jump/loop/高倍速预算；RTC变更不重置相位。无需等待所有 M5 尾项。 |
| O1-02 | 数据 manifest、CoverageSample、曲面 | 真实数据样本与离线原生 mesh；边界/缺失保守；有限网格与缓存。 |
| O1-03/04/05 | RenderInputs、surface type、介质/深度、所有权 | 生产 GPU 负波谷/岛屿/太阳/最小海下、一次照明/显示转换、开关/resize/销毁；物理 GPU。 |
| O2 | TimeSample、环境方向合同、同位移介质查询 | FFT数值、实际近景、Jacobian泡沫与环境分账；不照搬 Tidewater 的累计时钟。 |
| O3 | 参数连续性、资源预算、固定场景 | 全球高度/经线/极区/迁移和首次同条件性能；正式设备与预算未锁定则性能不算 PASS。 |
| O4/O5/O6/O7 | 已存在的 time/height/type/pre-water通路 | 逐阶段按 M6-A13—A22；不在 O0 创建后续模块或声明 GPU 通过。 |

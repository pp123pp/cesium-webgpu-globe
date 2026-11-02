# M1 暂停交接 — 2026-11-02

**状态：按用户要求暂停；M1 尚未完成验收。**

用户最新指令：“将当前的工作收尾并暂停，然后记录进度，方便后面的ai继续执行”。收到该指令后停止新增功能和浏览器运行，只整合已有通过的工作、补跑快速检查、归档证据并提交 GitHub。后续 AI 应在用户要求继续时，从这里接续。

## 仓库与协作边界

- 仓库：`pp123pp/cesium-webgpu-globe`，官方 CesiumJS **1.146.0**，上游 commit `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`。
- 当前分支：`feat/m1-wgs84-globe`；[PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) 保持 **Draft**，base 为 `feat/m0-webgpu-backend`。
- M0 已验收，公开基点 `7a689426af4b4b5f9c510d91e68ff45623f20090`；[PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1) 待审阅，未合并。`main` 未合并，最后核实为 `a7f472990cc4cb9fa6628181952fa8be7ad43eda`。
- 用户明确豁免缺少物理 GPU 的卡点。现有运行均为 **Google SwiftShader 软件 GPU**，不得描述为物理 GPU 验证。
- 用户要求适时向 GitHub 提交进度，已授权普通提交、推送和依赖 PR 更新；没有授权强推、强制重置或合并 main。
- root 是 Scene/Viewer/Globe/STATUS 的唯一集成负责人。遵守 `AGENTS.md` / `WORKFLOW.md`，最多两个实现者加一个只读复核者，文件所有权分离；没有 M2 工作。

## 已完成并保留的结果

| 范围 | 实际结果 | 证据入口 |
| --- | --- | --- |
| M0.5 | 可见 WebGL 三视图与独立基线逐像素一致；17 项真实 WebGPU 原型检查；完整回归差分通过 | `M0.5-regression-gate.md`，`evidence/M0.5/` |
| M1 基础 / A03 | 原生 WGS84、Camera/Frustum/Quadtree、RTC、真实 reversed depth、地平线选择、近地网格与裙边 | `M1.1-gpu-globe.md`，`evidence/M1/foundation/` |
| M1 影像 / A04 | 原生动态 ImageryProvider、Natural Earth 瓦片/LOD、地理/Mercator/极区采样、图层控制、取消及纹理释放 | `M1.2-gpu-imagery.md`，`evidence/M1/imagery/` |
| M1 地形 / A05 已验证子集 | 真实 World Terrain + ArcGIS：110 / 152 请求；同级边缘误差 < 0.34 m；混合 LOD；四次切换零空洞；561/561 drape 采样通过、1 km 偏移负控 535 次失败 | `M1.3-live-terrain-checkpoint.md`，`evidence/M1/terrain/` |
| M1 导航 / A03/A06 本地 gate | 40,000 km → 10 m 原生飞行、米级精度、真实深度负控、拖拽/滚轮、resize/churn；420 buffers / 49 textures 全释放 | `M1.4-navigation-tests.md`，`evidence/M1/navigation/` |

M0 完整 non-WebGL 为 **10,353 passed / 5,537 skipped**。完整 WebGL baseline/candidate 都有 **3,810 passed + 相同的 12 个既有失败 / 12,068 skipped**，执行顺序和断言签名相同，差分 gate 通过；原始套件仍退出 1。不得改写成所有上游 WebGL 测试通过。

最新已核实的公开影像提交 `f78e42ee24f53851983e3e6729b8acbbf1da2ddc` 在 [Actions 41407632894](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41407632894) 全部通过。暂停检查点的新 CI 结果要按 PR 当前 HEAD 重新查询，不能沿用这一旧 HEAD 的绿灯。

## 本次收尾的关键改动

1. **控制器修复**：本地 `a8ceb8d`，仅在 WebGPU 调用原生 controller.update 期间，将精确零轴且极小有限角度的舍入误差视为 no-op，之后在 finally 恢复 Camera.rotate。原生 Camera/controller 和 WebGL 路径未改。真实 RED 为轴 `[0,0,0]`、角度 `5.880415029710569e-9`；同一真实滚轮用例 GREEN，非法公开 rotate 仍抛错。
2. **导航测试整合**：独立提交 `0820af1` 已 cherry-pick 为本地 `027e500`；测试源码、十张实际截图、最终 JSON/log 和确定性失败证据已归档。独立测试的生产树 `b101a35` 与 `a8ceb8d` 完全相同。依赖路径嵌入导致两个工作树的 bundle 字节不同，报告只证明各自服务的正确 bundle，不能混称同一 bundle。
3. **地形检查点**：保存 `m1-terrain-smoke.mjs`、完整边缘结点 oracle 及三项单测。只读复核确认原先三个 oracle 缺陷已修复。强版已通过运行的原始文件保留；之后新增的 `groundFlight` 尚未运行。
4. **CI**：加入已验证的控制器、边缘单元测试和导航浏览器 gate / artifacts。**尚未接入未验证的扩展地形浏览器 gate。**
5. **演示页草稿**：`Apps/WebGPUGlobe.html` 已保存，提供默认 Natural Earth 地球、真实地形加载和 Everest 飞行；只做了 lint/format，**没有浏览器验收**。

暂停前 build 通过；九个 focused CPU 文件按 CI 的直接 `node file` 方式执行，合计 **67 tests passed，0 failed**。命令和原始结果在 `coordination/evidence/M1/pause-unit-tests.txt`；build 日志在 `pause-build.txt`。这不代替最终整套回归。

## 明确未完成，不能跳过

1. **首先运行当前扩展 A05。** `m1-terrain-smoke.mjs` 新增 Base Camp 近地飞行，目标约为缓存地形高度 + 50 m，检查真实最终高度、覆盖和更高 LOD。还未执行，没有 `base-camp-ground.png`；现有 PASS JSON 也没有 `groundFlight` 字段。必须保留失败并定位问题，不能把旧 PASS 充当新版本通过。
2. 新 flight 记录了全过程 `maximumUntextured`，目前只断言最终未贴图像素为零。运行后判断并补强全过程要求；不要无依据放宽断言。A05 旧运行 `fallbackDraws = 0`，未覆盖专门的矩形裁剪祖先回退绘制路径，不能宣称此路径已经覆盖。
3. 实际浏览器验证演示页初始化、真实 Provider 加载、Everest/Orbit、错误反馈和销毁；补充支持的 API/选项与使用方法。当前页面是待验证草稿。
4. A05 最终通过后，补齐 CI 地形命令和 artifacts。核实新 HEAD 的 Actions，而非只看旧 run。
5. 最终生产源码确定后，执行 build、targeted lint/TypeScript、全部 focused tests、M0 17 项 proof、M1 foundation/imagery/terrain/navigation、三视图 WebGL 差分、完整 non-WebGL 和 WebGL 差分。处理真实新增失败；不要修改既有断言/超时掩盖问题。
6. 独立代码复核，更新 A03–A06、STATUS、任务文件和最终交接。全部条件满足后才将 PR #2 转为 ready；保持 PR 依赖，不擅自合并 main，不进入 M2。

## 下一步最小可执行动作

先读 `AGENTS.md`、`coordination/STATUS.md`、`ROADMAP.md`、`tasks/M1.md` 和本文件；按需读 `M1.3-live-terrain-checkpoint.md`，不需要重新加载整个文档树或重写引擎。

```sh
git status --short
git branch --show-current
git log -8 --oneline
npm run build
```

在同一 checkout 另开 shell 启动静态服务，避免多个 `server.js` 争用 Sandcastle 的固定端口：

```sh
python3 -m http.server 8090 --bind 127.0.0.1
```

随后执行待验证的当前地形 gate：

```sh
M0_BROWSER_EXECUTABLE=/workspace/scratch/74d641ebe31c/pw-browsers/chromium-1248/chrome-linux64/chrome \
M1_BASE_URL=http://127.0.0.1:8090/ M1_OUTPUT=Build/m1-terrain \
xvfb-run -a node coordination/ci/m1-terrain-smoke.mjs
```

本环境 live HTTPS 曾因安装的代理 CA 信任链需要设置窄范围 `M1_CA_SPKI`，取值和说明在地形交接中；不得添加全局忽略证书或复制为生产配置。外部服务当时可用，无缺失密钥/权限卡点；下一次仍应按真实响应判断。保留 Provider attribution，不输出 access token。

## 工作区、来源和推送注意事项

- 主工作树：`/workspace/scratch/74d641ebe31c/cesium-webgpu-m1`。
- M0 工作树：`../cesium-webgpu-globe`；独立 WebGL 参考：`../cesium-webgl-reference`，固定 `724b5db8f258d0ce00c4f6b774bd38529e24252b`。
- 导航工作树：`../m1-navigation-tests`，测试已整合，不能再次 cherry-pick 其父提交 `b101a35`（等价生产修复已经存在）。其他旧分支/工作树保留，不删除他人分支。
- 本环境使用 Node 24.22.1/npm 11.9.0、Chrome 156.0.8078.4/Xvfb。依赖和 Build 是可再生本地文件；若 TypeScript 缺少 core 声明，先执行原生 `npm run build-ts --workspace @cesium/core`。没有修改依赖清单或锁文件，也不应绕过提交钩子。
- Git CLI 没有 push 凭据；已使用授权的 GitHub Git-data API 创建 blob/tree/commit，并以 `force:false`、`expected_sha` 更新分支。每个远端 tree SHA 必须等于对应本地审核 tree SHA；远端/本地 commit ID 因元数据不同而不同，不能把它们误判为丢失改动或进行强推。
- 最新公开提交以 PR #2 当前 head 为准，核对远端真实状态后继续。`source-hashes.json` 将实际测试 commit、tree 和 bundle 与检查点文件分开记录。
- 所有可接续代码和选定原始证据已进入 GitHub 分支，不能依赖临时 `/tmp` 或忽略的 Build 目录作为唯一交接来源。旧的间歇性尝试仍在本地 Build 中，但确定性 RED 和最终 GREEN 已永久归档。

**停止点：保存并公开这个检查点后暂停；后续工作等待用户的新指令。**

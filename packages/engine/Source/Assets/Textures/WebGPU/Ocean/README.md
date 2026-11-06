# M6 海洋分类资产

**唯一活动入口：[coverage-manifest.json](coverage-manifest.json)，schemaVersion 2 / routeVersion 2.0。**
当前为 `SOURCE_NOT_ACQUIRED`，`runtimeAssets.status=NOT_GENERATED`、`files=[]`。
已经确定路线，但尚未取得并审核全球 OSM 快照，也没有生成或加载运行时分类瓦片。

## 当前路线

- 主源候选：OSM **未简化 WGS84 split water/land polygons**。candidateUrl 是待获取入口，实际输入的时间、字节、SHA256 和归档路径仍为 null。
- `split` 只表示大面切分；不采用面向低 zoom 的 simplified 数据或被 Mercator 裁去极区的全球底座。
- 四类固定为 `unknown=0`、`ocean=1`、`land=2`、`inland-water=3`。里海须从海洋中排除；普通湖库需独立选源/核查，不能假定 water-polygons 已覆盖。
- 计划采用 coverage L0..L9 的同源分类层级：L0 为 8192×4096，瓦片 512²，每级两个轴各加倍；仅岸线附近稀疏细化，已证明的纯色区域可用常量表示。
- 分类使用 nearest/精确整数读取，不平均 mipmap。完整像元足迹包含岸线或小岛时保守标 unknown；必须区分边界不确定性和缺数据原因。
- 父级必须是已发布、验证过的同源保守父级；缺数据不回到 Natural Earth ocean。32 个实际驻留 512² 分类瓦片是**所有层级合计**的起始预算，尚未测量。

数据源细节、MHWS 定义、OSM 定位限制、生成步骤和官方链接见
[总体路线](../../../../../../../docs/OCEAN_PLAN.md)；API、字段和回退约束见
[实施合同](../../../../../../../docs/M6_OCEAN_CONTRACTS.md)。
L8/L9 约 19.1m/9.6m 只是赤道采样目标，不是已经交付的全球精度。
派生资产由项目分发；runtime 不直接向 OSM 编辑 API 或生产服务查询分类。

## 获取与生成门槛

默认下一项为 [O0-R01](../../../../../../../tasks/M6/O0-R.md)：取得固定快照、许可与语义审计；
随后 O0-R02 做小范围粗细分类样板，O0-R03 冻结实取数据 manifest 和 O1 交接。
O1-01 CPU 时间/框架可独立并行；O1-02 等待上述门槛。
原始 OSM 恶魔岛样本只支持单点源细节比较，不构成全球发布包、栅格或 GPU 验证。

OSM 数据采用 ODbL，署名为 `© OpenStreetMap contributors`。
固定快照的许可文本、再分发要求和归档记录须在 O0-R01 核查；
不能把 Natural Earth 的 public-domain 声明用于新资产。

## 历史审计文件

下列文件保持原样，供复查历史 O0，**不作为未来 runtime 默认输入或加载失败回退**：

- [manifest.json](manifest.json)：Natural Earth v5.1.2 源文件哈希和旧单层生成合同。
- [LICENSE-NATURAL-EARTH.txt](LICENSE-NATURAL-EARTH.txt)：仅属于该历史数据。
- [O0 数据证据](../../../../../../../coordination/evidence/M6/O0/data/README.md)：原审计脚本和 26 个规则样本。

O0 的历史 TECHNICAL_PASS 没有解决恶魔岛漏岛，也没有证明新来源或运行时通过。
保留这些原始记录以免把旧证据改写成新路线的验证。

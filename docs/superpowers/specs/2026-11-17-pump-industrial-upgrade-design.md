# 离心泵工业级真实化升级 — 设计规格（2026-11-17）

> 范围：仅升级实训室 `pump` 设备的三维模型、材质与交互；网站路由、其余 17 台设备、工坊与学习记录机制保持不变。
> 口径：仍为**程序化教学示意模型**；无工程数据处使用明确标注的演示参数，不编造型号/尺寸/材质牌号。

## 1. 方案

在现有程序化管线内深度重建（保留 Group-per-part、SceneManager 六模式、拆装练习与测试体系），不引入外部 GLB/扫描资产与 CSG 依赖。

## 2. 零件数据模型（约 34 个独立零件，原 9 个 id 不变）

| 组 | 零件 id | 说明 | role/joint |
| --- | --- | --- | --- |
| 底座 | `base` | 工字钢焊接底座、锚栓、加强焊缝 | fixed / anchor |
| 泵体 | `casing` | 真实蜗壳流道（变截面螺线扫掠+壁厚）、吸排口法兰、加强筋、螺栓孔 | removable / bolted |
| 泵体 | `cover` | 泵盖、密封结合面、螺栓孔、口环座 | removable / bolted |
| 泵体 | `wearRing` | 口环（耐磨密封环） | removable / fitted |
| 叶轮 | `impeller` | 轮毂/6 片曲面叶片/前后盖板/进口/轴孔/键槽 | removable / fitted |
| 轴系 | `shaft` | 阶梯轴：轴肩、叶轮与联轴器键槽、螺纹端 | removable / fitted |
| 轴系 | `keys` | 平键组（叶轮键+联轴器键） | removable / fitted |
| 轴系 | `bearing` | 轴承箱+支座（原 id 语义调整为轴承箱） | removable / bolted |
| 轴系 | `brgOuter` / `brgInner` / `brgRollers` / `brgCage` / `brgCovers` | 轴承外圈/内圈/滚动体/保持架/两侧端盖 | removable / fitted(bolted 端盖) |
| 密封 | `seal` | 密封腔座（原 id） | removable / bolted |
| 密封 | `sealStatic` / `sealRotary` / `sealSpring` / `sealGland` / `sealSleeve` / `sealOrings` | 静环/动环/弹簧/压盖/轴套/密封圈 | removable / fitted(压盖 bolted) |
| 驱动 | `motor` | 定子壳+散热筋+接线盒座+底脚+吊环（蓝色涂装，壳） | removable / bolted |
| 驱动 | `motorStator` / `motorRotor` / `motorShaft` / `motorEnds` / `motorFan` / `motorFanCover` / `motorTerminalCover` | 定子/转子/电机轴/两侧端盖/风扇/风扇罩/接线盒盖 | removable / fitted 或 bolted |
| 联轴器 | `coupling` | 泵侧半联轴器（原 id） | removable / bolted |
| 联轴器 | `couplingMotor` / `couplingBolts` | 电机侧半联轴器/连接螺栓组 | removable / fitted 或 bolted |
| 管道 | `pipeSuction` / `pipeDischarge` | 吸入/排出直段（内外壁+法兰，真实中空） | display / bolted |
| 管道 | `pipeElbowIn` / `pipeElbowOut` | 吸入/排出弯头（中空圆弧） | display / welded |
| 管道 | `pipeGaskets` / `pipeBolts` / `pipeReducer` / `pipeSupports` | 法兰垫片/法兰螺栓组/异径管/管道支架 | display 或 fixed / 对应 joint |

- 刚性螺栓联轴器，无弹性元件（保持原结构）。
- 拆装练习保持原 8 可拆件 / 16 步；新增件不进入 `assemblyOrder`。
- `contentVersion` → `2026-11-17.2`（旧练习进度按既有规则提示不兼容，收藏与成绩保留）。
- 爆炸方向：内部件沿轴向/径向合理展开；管道沿管轴方向外移。

## 3. 几何实现要点

- 蜗壳：阿基米德螺线 + 渐扩圆截面扫掠成内外双壁，与吸入口圆筒、出口扩散段过渡；剖视显示真实流道与叶轮间隙。
- 叶片：前后盖板之间的三维曲面放样（6 片，保持原数量）；前后盖板真实厚度与进口环。
- 轴：阶梯圆柱实心；键槽为真实凹槽（轴段减料几何）；与叶轮、联轴器、轴承内圈同轴心。
- 密封：动环/静环/弹簧（螺旋弹簧几何）/压盖/轴套/ O 形圈独立网格。
- 轴承：外圈/内圈环形实体、滚珠（低分段球体按实际珠数）、保持架；两侧端盖。
- 电机：壳内定子（含绕组端部示意）、转子+轴、风扇+风扇罩；透明可见。
- 管道：独立内外壁圆柱/圆弧与环形端面，真实管口开孔；法兰用带真实通孔的挤出几何；垫片、螺栓组、异径管、支架独立。
- 剖切封口：stencil 封口面；若与逐件透明叠加冲突，回退为"双面内壁+壁厚"呈现并在界面说明。

## 4. 交互升级

- 目录逐件：隐藏/显示、透明/还原、定位聚焦（观察模式）；选中联动保持。
- 透明模式：整体外壳滑杆 + 选中件透明度滑杆；快捷"隐藏密封压盖/管道外壁"；电机透明可见定转子。
- 剖视：X/Y/Z + 位置滑杆 + 翻转（保留）；新增局部剖切（仅选中件）。
- 爆炸：内部件分层；一键复原精确到位（沿用现有机制）。
- 标注：新增件标注避让，开关保留。

## 5. 材质与光照

RoomEnvironment（PMREM）环境贴图；铸造面粗糙度 0.6–0.75、加工面 0.2–0.3、涂装面 0.45–0.6；保留蓝色配色；程序化细微颗粒贴图；不引入外部贴图文件。

## 6. 验收（规格第八节 10 项，自动化）

1 泵壳剖切可见蜗壳流道；2 叶轮独立选中/拆卸；3 轴-叶轮键连接与同轴；4 机械密封可独立观察；5 联轴器两端同轴连接；6 管道真实中空；7 管道剖面可见壁厚；8 法兰螺栓孔真实几何；9 透明不遮挡内部；10 爆炸复原。另加：全量回归（build/verify/verify-workshop/smoke）与线上走查。

## 7. 风险

- 约 34 零件需控制网格量（滚珠/螺栓低分段、几何缓存）；
- stencil 封口与透明材质叠加为技术风险，回退方案已定；
- 教学示意边界不变，演示参数界面标注；
- 发布沿用同项目新 action，保留公开访问与用户数据。

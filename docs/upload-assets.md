# 上传素材高精度模型库（2026-11-19）

> 本文件记录用户上传的 3ds Max 工业设备素材的识别、转换、拆分、优化、站内接入与边界。模型为**装饰级外观素材**，不是教学拆装模型、制造图纸或工程依据。

## 1. 上传包实况

| 项 | 内容 |
| --- | --- |
| 原始压缩包 | `D:\新建文件夹\新建文件夹\attachment_1714319225167.rar`（约 210 MB，RAR5） |
| 解压位置 | `assets-import/znzmo-industrial/attachment_1714319225167/` |
| 三维文件 | `现代工业设备_抽水泵_压力表_阀门_水管/3d现代工业设备.max`（246,812,672 字节） |
| 其他文件 | 6 张 JPG（PBR 贴图，不是预览图）、知末网说明 TXT、HTML |
| 场景格式 | 3ds Max 2017 + V-Ray（`Autodesk.Max.StateSets` 19.0；Scene 流为 gzip 压缩，解压后 701,100,413 字节） |
| 内容类型 | **一整套工业设备素材**：卧式/立式离心泵组、气动双隔膜泵、转子泵、球阀/闸阀/截止阀/蝶阀、Y 型过滤器、篮式过滤器、压力表、膨胀节、小型压力容器、控制箱、法兰管段/弯头/三通 |
| 缺失 | 场景只引用 `3d66Model-1060089-files-1.jpg`，包内没有该文件（只有 `-files-2.jpg`），导入后 **0 张贴图** |
| 原始文件保留 | `.max` 与 6 张 JPG 原样保留在 `assets-import/`，未覆盖、未删除 |

## 2. 转换流程

1. 便携版 Blender 4.2.9 LTS（`outputs/tools/blender-4.2.9-windows-x64/`，不写系统安装）。
2. 免费 Blender 扩展 **Import Autodesk MAX 1.9.2**（GPL-3.0，`io_scene_max`；支持 ≤3ds Max 2023、V-Ray/Corona 材质、gzip 压缩场景）。便携版未扫描 `scripts/addons`，通过 `MAX_ADDON_DIR` 加入 `sys.path` 后直接 `register()`。
3. `outputs/tools/max-convert/import_max.py`：导入场景 → 盘点 3492 对象 / 3226 网格 / 1094 万三角面 / 212 材质 → 保存 `max-import.blend` → 导出整场 GLB（234,143,796 字节，仅用于盘点）。
4. 按空间聚类（81 组）与 GLB 顶层 Group（173 个）渲染识别；13 件目标设备按对象名清单单独导出 GLB（`export_assets.py`）。
5. `outputs/tools/gltf/optimize_glb.mjs`（gltf-transform 4：prune / dedup / weld / simplify / quantize / Meshopt）压缩到 `public/models/uploads/`。

复现命令（工具目录不在站点构建内）：

```bash
# 导入与盘点
MAX_ADDON_DIR=".../blender-4.2.9-windows-x64/4.2/scripts/addons" \
  .../blender.exe -b --factory-startup --python import_max.py -- "<max路径>" "<输出目录>"

# 拆分 13 件资产
.../blender.exe -b --factory-startup --python export_assets.py -- \
  "out/max-import.blend" "asset-export.json" "assets-glb"

# 压缩（示例）
node optimize_glb.mjs "assets-glb/pump-skid.glb" "../../../public/models/uploads/pump-skid.glb" 0.35
```

## 3. 资产清单（13 件）

| 资产 id | 名称 | 源 Group | 原始三角面 | 优化三角面 | 文件 | 站内对照 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| pump-skid | 卧式离心泵组 | 51-84 | 847,402 | 177,057 | 1.08 MB | pump |
| vertical-pump | 立式离心泵 | 288-752 | 604,898 | 154,285 | 1,017 KB | pump |
| diaphragm-pump | 气动双隔膜泵 | 242-671 | 20,120 | 9,766 | 152 KB | diaphragm-pump |
| lobe-pump | 转子泵（相近泵型） | 337-860 | 21,564 | 11,227 | 174 KB | gear-pump（非同一结构） |
| ball-valve | 法兰球阀（带执行机构） | 186-626 | 150,478 | 32,828 | 395 KB | ball-valve |
| gate-valve | 明杆闸阀 | 313-889 | 243,426 | 31,672 | 385 KB | gate-valve |
| globe-valve | 法兰截止阀 | 193-209 | 125,748 | 57,432 | 382 KB | — |
| butterfly-valve | 对夹式蝶阀 | 182-657 | 6,316 | 2,086 | 44 KB | butterfly-valve |
| y-strainer | Y 型过滤器（外观） | 191-463 | 17,646 | 5,687 | 93 KB | y-strainer |
| bag-filter | 篮式过滤器（外观） | 319-765 | 14,216 | 7,680 | 122 KB | bag-filter（结构不同） |
| expansion-joint | 法兰橡胶膨胀节 | 190-206 | 10,356 | 5,041 | 74 KB | — |
| small-vessel | 小型压力容器 | 1-797 | 5,360 | 4,848 | 30 KB | gas-separator（未确认） |
| control-box | 现场控制箱 | 308-390 | 17,471 | 11,742 | 186 KB | — |

预览图位于 `public/models/uploads/previews/`；优化 GLB 合计约 4.4 MB。

## 4. 18 台站内设备覆盖情况

| 站内设备 | 上传资产 | 覆盖判断 |
| --- | --- | --- |
| 单级离心泵（pump） | 卧式泵组、立式泵 | ✅ 有外观对应 |
| 外啮合齿轮泵（gear-pump） | 转子泵 | ⚠ 仅相近泵型，结构不同 |
| 气动双隔膜泵（diaphragm-pump） | 双隔膜泵 | ✅ 有外观对应 |
| 法兰球阀（ball-valve） | 法兰球阀 | ✅ 有外观对应 |
| 明杆楔式闸阀（gate-valve） | 明杆闸阀 | ✅ 有外观对应 |
| 对夹式蝶阀（butterfly-valve） | 对夹蝶阀 | ✅ 有外观对应 |
| 旋启式止回阀（check-valve） | 未识别到旋启式止回阀 | ❌ 缺 |
| 管壳式换热器（exchanger） | 无 | ❌ 缺 |
| 垫片式板式换热器（plate-exchanger） | 无 | ❌ 缺 |
| 单袋式过滤器（bag-filter） | 篮式过滤器 | ⚠ 仅外形相近，滤袋结构不同 |
| Y 型管道过滤器（y-strainer） | Y 型过滤器 | ✅ 有外观对应 |
| 立式固定顶储罐（fixed-roof-tank） | 无（仅小型压力容器） | ❌ 缺 |
| 搅拌反应釜（reactor） | 无 | ❌ 缺 |
| 立式气液分离器（gas-separator） | 小型压力容器 | ⚠ 无法确认内部为分离结构 |
| 填料塔（packed-tower） | 无 | ❌ 缺 |
| 旋风分离器（cyclone-separator） | 无 | ❌ 缺 |
| 喷油双螺杆空气压缩机（screw-compressor） | 无 | ❌ 缺 |
| 电磁流量计（emf-meter） | 无（压力表/控制箱不是流量计） | ❌ 缺 |

结论：**6 台有外观对应、4 台仅近似/部分、8 台没有上传资产**。上传素材不能替代未覆盖设备的补充建模，也不能替代站内零件级教学模型。

## 5. 站内接入

- 新路由 `#/assets`（可带 `#/assets/<id>`）：13 件资产清单、三维查看器、材质/面数信息、选件、线框、X 射线、剖切（X/Y/Z + 位置）、爆炸、隐藏/显示、自动旋转、复位/适应。
- 首页新增「高精度模型库（上传素材）」入口；泵、隔膜泵、四类阀门、Y 型过滤器、袋式过滤器、气液分离器的工作台标题旁新增「高精度外观 ↗」入口。
- 查看器使用 GLTFLoader + MeshoptDecoder，按需加载、切换时释放几何/材质/WebGL 资源；13 件资产全部客户端压缩，单件 30 KB–1.08 MB。
- 教学设备的剖切/爆炸/逐件拆装逻辑未改动；外观模型不参与拆装判定。

## 6. 边界与限制

- **无贴图**：上传包缺主贴图，当前只保留 V-Ray 材质底色（蓝/灰/红/黄等）；没有 Base Color/Normal/Roughness 贴图。
- **无内部结构**：泵无叶轮/密封/轴承，阀门无球体/闸板/阀座内部件；透明/剖切只能看到外壳与网格，不能作为内部结构教学依据。
- **装饰级模型**：原始场景 1094 万三角面，为渲染素材而非制造模型；尺寸为场景单位（约毫米），未按站内教学坐标校准；拆分/压缩后可能有细节损失。
- **性能**：13 件资产按需加载；单件最高 17.7 万面，桌面端可接受，低配设备/移动端未做 LOD 分级。
- **授权**：素材来自用户上传的知末网/3D66 工业设备包；站内已标注「素材来源：用户上传」。公开站点展示的授权范围由项目所有者确认；本项目此前的「不使用第三方模型」口径因用户本轮明确指令而调整。
- **不替代**：不得把外观模型当作设备制造图、工程尺寸、材料牌号、内部结构或拆装依据。

## 7. 验证记录（2026-11-19）

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过（70 modules；`index-BKEGKw19.js` / `three-BWp5IKir.js` / `index-DzBPReco.css`） |
| `node scripts/verify-assets.mjs`（dev 5175） | **20/20**：入口、13/13 加载、线框/X 射线/剖切/轴切换/滑杆、选件、设备页互链、移动端、零控制台错误 |
| `npm run verify` | **154/154** |
| `node scripts/verify-workshop.mjs` | **51/51** |
| `node scripts/verify-plant.mjs` | **64/64** |
| `node scripts/verify-pump.mjs` | **19/19** |
| `npm run test:core` | **8/8** |
| `npm run smoke:prod`（preview 4178） | **22/22** |
| 生产环境 `verify-assets`（preview 4178） | **20/20** |

截图与报告：`outputs/verify-assets/`；转换清单：`outputs/tools/max-convert/out/inventory.json`、`groups/groups.json`、`clusters.json`。

## 8. 后续

- 上传素材只覆盖 10 台设备的外观（含近似），其余 8 台仍需按 `docs/full-site-upgrade.md` 的待升级清单补充建模。
- 如需把上传外观用于教学设备外壳，需要逐台做坐标对齐、零件映射与穿模检查，并保留程序化内部件；本轮未做这种替换。
- 缺贴图问题如能补齐 `3d66Model-1060089-files-1.jpg`，可重新导出并保留贴图；否则维持当前材质底色。

## 9. 发布记录（2026-11-19）

- actionId `d07e641d-6d32-4c94-a896-e2bf8d8668f1`，`published: true`，沿用原站点与公开访问。
- 构建：70 modules，`index-BKEGKw19.js` / `three-BWp5IKir.js` / `index-DzBPReco.css`。
- 发布后：`walk-published` **35/35**；线上 `verify-assets` **20/20**。
- 备份：`project-backup-2026-11-19-assets/`、`dist-backup-2026-11-19-r10/`；上一稳定版 `dist-backup-2026-11-18-r9/`。

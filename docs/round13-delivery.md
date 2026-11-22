# 第 13 轮交付与验收说明（2026-11-20）

> 本轮**已上线**（2026-11-20）：教学工厂与设备库 `#/library`、离心泵观察自测、三台设备结构重建、目录状态记忆均已发布；站点公开访问保持不变。

## 1. 本地预览

| 用途 | 地址 / 位置 | 说明 |
| --- | --- | --- |
| 线上站点（已发布） | https://chem-equipment-3d-lab-r44x9hkn4ne.qoder.zone/ | 教学工厂首页 `#/`；设备库 `#/library`；本轮 actionId `34cb7036-f36a-4e77-83da-f8896a428c61`；发布后观察到并行工厂线更新为 `index-BYOatY93.js`，同样包含本轮功能 |
| 生产预览（本轮构建） | http://127.0.0.1:4176/ | 原项目 `dist` 合并构建 `index-BqNPN5wH.js`（81 modules，含工厂） |
| 本地交付副本（第 13 轮独立版） | http://127.0.0.1:4175/ | `outputs/round13-delivery/dist/`，构建 `index-BSWno5ys.js`（73 modules，不含工厂） |
| 开发预览（可改代码） | http://127.0.0.1:5198/ | 来自 `outputs/round13-delivery/`；用于本轮全部浏览器回归 |
| 三台设备前后对照 | `outputs/round13-compare/index.html` | 同相机/同画质整体、剖视、进出接口前/后并排；含性能表 |
| 阶段一截图/报告 | `outputs/verify-catalog-state/` | 30/30 |
| 阶段二截图/报告 | `outputs/verify-pump-exercise/` | 28/28 |
| 阶段三截图/报告 | `outputs/verify-pump-compressors/` | 38/38 |
| 性能原始数据 | `outputs/perf/before/`、`outputs/perf/after/`、`outputs/perf/prod-entry*.json` | SwiftShader 软件渲染 |

> 如果端口被占用，可在交付副本运行 `npm run dev -- --port <端口>` 或 `npm run preview -- --port <端口>`，并把测试脚本的 `VERIFY_BASE` / `SMOKE_BASE` 指向该地址。
>
> 交付副本 `outputs/round13-delivery/node_modules` 是指向主项目 `node_modules` 的本机目录联接；复制到其他机器或单独打包前请先 `npm install`，不要把该联接当作依赖包。

## 2. 本轮可操作学习路径（建议按顺序验收）

1. 打开首页 → 搜索「离心泵」→ 进入唯一结果 → 浏览器后退：关键词、分类、滚动位置与焦点应恢复；再前进回到泵。
2. 离心泵工作台 → 右侧「观察任务」→ 结构自测「开始练习」→ 内窥下一站到叶轮眼（5/8）→「回到剖视图辨认叶轮」→ 先点蜗壳查看结构线索 → 再点叶轮；完成后刷新页面，任务清单与学习记录仍显示自测已通过。
3. 齿轮泵：切到「剖视」（X 32%），从 +X 轴向查看两齿轮、8 字形泵腔、蓝色 +Z 吸入与橙色 -Z 排出；播放工作原理观察粒子沿两齿轮外周，不穿啮合中心。
4. 双隔膜泵：切到「工作原理」，点「左腔吸入 · 右腔排出」与「右腔吸入 · 左腔排出」，核对底部读数与四只阀球开闭；切到剖视查看隔膜夹紧与腔口—阀—总管连接。
5. 螺杆压缩机：切到「剖视」（Z 50%），从 +Z 查看双孔机腔、4/6 瓣转子、顶部进气与底部排气；确认排气管穿过敞开底架，不被底座封住。
6. 手机视口：打开零件/说明抽屉选择零件，收起抽屉后拖动旋转；模式页签可横向滚动触达。

## 3. 测试结果（实际执行）

| 检查 | 结果 | 位置 |
| --- | --- | --- |
| `npm run build`（交付副本） | 通过，73 modules | `outputs/round13-delivery/dist/` |
| `npm run verify` | **174/174** | 输出日志/`outputs/verify/` |
| `npm run verify:pump-template` | **36/36** | `outputs/verify-pump-template/` |
| `node scripts/verify-pump.mjs` | **19/19** | `outputs/verify/report-pump.json` |
| `node scripts/verify-catalog-state.mjs` | **30/30** | `outputs/verify-catalog-state/report.json` |
| `node scripts/verify-pump-exercise.mjs` | **28/28** | `outputs/verify-pump-exercise/report.json` |
| `node scripts/verify-pump-compressors.mjs` | **38/38** | `outputs/verify-pump-compressors/report.json` |
| `node scripts/verify-workshop.mjs` | **51/51** | `outputs/` 工坊报告 |
| `node scripts/verify-plant.mjs` | **64/64**（首跑 63/64 为已知重置视角镜头时序抖动，复跑通过） | `outputs/` 全流程报告 |
| `node scripts/verify-assets.mjs`（dev） | **20/20** | `outputs/` 模型库报告 |
| `node scripts/verify-boil-areas.mjs` | **52/52** | `outputs/verify-boil-areas/` |
| `node scripts/verify-boil-playback.mjs` | **22/22** | `outputs/round13-delivery/outputs/verify-boil-playback/` |
| `npm run test:core` | **8/8** | `outputs/round13-delivery/outputs/core-flow/` |
| `npm run smoke:prod`（preview 4175） | **22/22** | `outputs/verify/` |
| `a11y-redesign` | **19/19** | `outputs/a11y-redesign/` |
| `node scripts/verify-records-compat.mjs` | **12/12** | `outputs/verify-records/` |

## 4. 性能摘要（SwiftShader 软件渲染，非真实 GPU）

- 换热器实例化前后（同设备/视口/画质）：绘制调用 **136→94**；三角面 **81,428 不变**；空闲帧时间中位数 **458.7→410.2 ms**；转动时 CDP Performance 任务耗时约 **469→136 ms**（2 s 窗口）。点选/动画样本少、有噪声，已按原样记录。
- 泵：405 calls / 70,212 tri；齿轮泵：53 calls / 15,194 tri（结构重建后）。
- 生产预览冷启动（3 次）：泵 927/1929/1782 ms；齿轮泵 1738/1790/1755 ms；换热器 1979/2043/2073 ms。同标签页刷新受场景销毁/重建影响，总时长不一定更短；站内缓存资产进入约 1.2–2.2 s。
- 手机 390×844：三台设备抽屉/高亮/收起后拖动旋转通过；模式页签横向滚动可触达。真实手机与硬件加速桌面帧率 **待实测**。

## 5. 回滚与恢复

| 项 | 路径 |
| --- | --- |
| 本轮前源码 | `project-backup-2026-11-20-r13-pre/` |
| 本轮前构建（线上第 12 轮） | `dist-backup-2026-11-20-r13-pre/` |
| 本轮最终交付源码 | `outputs/round13-delivery/` |
| 本轮最终构建 | `outputs/round13-delivery/dist/` |
| 并发工厂工作快照 | `outputs/concurrent-factory-2026-11-20/` |
| 本轮前线上构建 | `dist-backup-2026-11-19-r12/`（`index-2bfZhIzF.js`） |

## 6. 并发工厂工作与合并结果

- 01:35 左右另一条工作线开始新增「三维教学工厂」；随后补全 `src/factory/ui.ts` 等文件。本轮检测到时曾缺少该文件导致原目录 500，已保留并发快照 `outputs/concurrent-factory-2026-11-20/`。
- 工厂工作完成后，原目录源码已合并：`#/` 为教学工厂首页，设备库为 `#/library`；本轮把目录返回、工坊/全流程/微沸喷烧返回链接统一到 `#/library`，并在合并源码上 `npm run build` 通过（81 modules，`index-BqNPN5wH.js`）。
- 合并后验收：工厂专项 **54/54**（含旧设备库 18 卡、旧深链、工坊/全流程/模型库/微沸喷烧入口）；合并生产冒烟 **22/22**；生产页目录状态 **30/30**；线上发布后走查 **35/35**、线上泵内窥 **7/7**、线上目录状态 **30/30**、线上本轮功能检查全部通过。
- 发布：actionId `34cb7036-f36a-4e77-83da-f8896a428c61`，`published: true`，访问范围 public；发布后并行工厂线观察到更新构建 `index-BYOatY93.js`，线上功能检查仍包含本轮全部功能。**线上设备库入口为 `#/library`。**

## 7. 待补资料 / 未完成

- 齿轮泵/隔膜泵/螺杆压缩机的厂商型号、真实型线/齿形、中心距、间隙、材料、密封与性能数据；隔膜寿命与流量；喷油系统与油气分离；本页只做教学示意，不能作为制造/采购/操作依据。
- 真实 GPU 帧率、真机触屏手感、专业人工评审、实物测绘未开展。
- 剖切仍为开口截面，未做封口填充；未以封口面封住实际流道。
- 教学工厂的完整专业评审、现场资料核对与真机触屏仍待开展。

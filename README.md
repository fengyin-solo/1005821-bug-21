# 城市排水防涝泵站运行与内涝处置管理平台

面向排水泵站台账、泵组运行、排水管网与检查井养护、水位雨量监测、内涝点处置、闸门调度与抢险队出动的一体化城市排水防涝运行管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 泵站台账 | `pumpstation` | 排水泵站 | 站名、所属片区、设计流量 |
| 泵组运行 | `pumprun` | 泵组运行记录 | 运行编号、所属泵站、泵组编号 |
| 排水管网 | `drainpipe` | 排水管段 | 管段编号、起点井号、终点井号 |
| 检查井维护 | `manhole` | 检查井 | 井编号、所属管段、井盖状况 |
| 管网清淤 | `dredge` | 清淤记录 | 清淤编号、清淤管段、淤积厚度 |
| 水位监测 | `waterlevel` | 水位监测记录 | 监测编号、监测点位、水位读数 |
| 雨量监测 | `rainfall` | 雨量监测记录 | 监测编号、雨量站名、时段雨量 |
| 内涝点处置 | `waterlog` | 内涝点记录 | 内涝编号、内涝点位、积水深度 |
| 闸门调度 | `floodgate` | 闸门调度记录 | 调度编号、闸门名称、所属河渠 |
| 泵组检修 | `pumpmaint` | 泵组检修记录 | 检修编号、泵组编号、检修类别 |
| 拍门检修 | `sluice` | 拍门检修记录 | 检修编号、所属泵站、拍门编号 |
| 格栅清污 | `screen` | 清污记录 | 清污编号、所属泵站、格栅类型 |
| 排口巡查 | `outfallpatrol` | 排口巡查记录 | 巡查编号、排口名称、所在河段 |
| 防涝预警发布 | `floodwarn` | 预警单 | 预警编号、预警级别、影响区域 |
| 抢险队调度 | `rescueteam` | 抢险任务 | 任务编号、任务类型、目标点位 |
| 排水设备台账 | `drainequipment` | 排水设备 | 设备编号、设备名称、设备型号 |
| 管道内窥检测 | `cctvinspect` | 内窥检测记录 | 检测编号、检测管段、缺陷等级 |
| 排水调度方案 | `dispatchplan` | 调度方案 | 方案编号、方案名称、适用雨型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `drainage-pump:entries` 这一项，或调用 `resetModule(模块)`。

### 格栅清污的跨站归属收口

格栅清污（`screen`）的所有写操作不走通用 `runAction`，统一收口在
`frontend/src/api/screen-service.ts`：

- **归属**：每条清污记录只归登记的泵站；顶栏的当前身份由「值班泵站 + 在册清污人」组成
  （名册见 `stores/session.ts`）。外站对本站记录做任何动作、替他站登记，一律挡回并在提示里
  写明越界点（记录归属站、操作人归属站）。
- **锁**：记录一旦「已完工」整条锁定，连本站清污人也不能改污物量、清污方式或再走动作；
  重复完工提交幂等，只算一条，不重复显示、不重复派活。
- **重号**：同一泵站 + 同一格栅类型下，清污编号不能重号。
- **留痕**：被挡下的尝试（跨站、锁、重号、非在册人员）写入 `drainage-pump:screen-audit`，
  谁、什么时候、想改哪条、因为什么被挡都能倒查，格栅清污页底部有留痕面板。
- **待清污清单**：清污结论按归属泵站落到 `drainage-pump:screen-worklist`，业务键
  「泵站::格栅类型::清污编号」幂等。首次打开按既有记录生成一次快照
  （`drainage-pump:screen-worklist-migrated`），既有记录保持当时的结论，之后清单只由真实
  登记/流转动作推动。
- **清淤联动**：清污确认完工后，在管网清淤页「格栅清污完工 · 待本班组复核」分区生成一条
  待复核活（`drainage-pump:dredge-followups`，按清污记录 id 幂等），外站不能办结他站的活。
- **状态一致性**：页面去掉了冗余的「清污状态」字段，列表、详情、清单都只认记录的
  `status` 一个事实源，不会再出现两处状态对不上。

格栅清污相关的派生数据独立于 `drainage-pump:entries`，重置业务模块数据不会清掉留痕；
要完全回到初始状态，把上面四个 `drainage-pump:*` 键一并清掉即可。

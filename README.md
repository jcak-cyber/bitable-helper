# 多维表格助手 · 飞书多维表格插件

为飞书多维表格（Lark Base）打造的助手插件，顶层分为 **工时管理** 与 **任务生成** 两个 Tab。

- **工时管理**：在任务表中选中（或批量勾选）任务后，一键在关联的「工时表」中创建工时记录，并自动回写关联关系。
- **任务生成**：在「人员排期」表按日展开任务预览，暂存后可写入「任务管理」表；支持岗位前缀、周末过滤与计划开始日冲突检测。

## 功能特性

### 工时管理

- **两种填写模式**
  - 单个任务：跟随表格当前选中行，为该任务创建工时
  - 批量勾选：列出当前视图可见记录，多选后批量创建
- **灵活的工时录入**
  - 时长支持快捷预设（0.5 / 1 / 2 / 4 / 8 小时）与自定义数值
  - 花费描述可手填，或勾选「同步任务名称」自动取各任务标题
  - 日期可按任务计划开始～结束跨度逐日生成，或手动指定统一日期
- **字段映射配置**：通过双向关联字段自动定位工时表，由用户指定时长 / 日期 / 描述等字段的对应关系
- **配置持久化**：配置按任务表 id 存入 `localStorage`，不同任务表各自记忆
- **已有工时标识**：批量列表中对已存在工时关联的任务打「已有工时」标签
- **容错批处理**：单条失败不影响其它任务，结束后汇总成功 / 失败条数

### 任务生成

- **读取人员排期**：仅在「人员排期」表中生效，展示当前个人排期视图的可见记录
- **按日展开**：根据排期计划起止日生成「一日一条」任务预览；可选是否包含周六、周日（默认不含，偏好会持久化）
- **任务命名**：从排期名称去掉编号段与末尾执行人 / 日期后，自动加上 `【岗位】` 前缀（默认前端）
- **预览编辑**：侧栏全高抽屉中可改优先级、岗位、计划 / 实际日期，支持批量改选中行
- **暂存列表**：生成结果进入「已生成任务」，切表不丢；可继续编辑或单条 / 批量插入
- **写入任务管理**：仅在当前表为「任务管理」时显示插入按钮；按**计划开始日**与当前视图可见记录做冲突检测，冲突行需确认后才能覆盖写入

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 构建 | [Vite 5](https://vitejs.dev/) |
| 框架 | [React 18](https://react.dev/) + TypeScript 5 |
| UI | [Ant Design 6](https://ant.design/) |
| 日期 | [Day.js](https://day.js.org/) |
| 平台 SDK | [@lark-base-open/js-sdk](https://www.npmjs.com/package/@lark-base-open/js-sdk) |
| 样式 | Less |

## 安装使用（命令行）

本插件已发布到 [npm](https://www.npmjs.com/package/bitable-helper)，可全局安装后通过命令行启动本地服务，托管已构建好的插件产物：

```bash
# 全局安装
npm install -g bitable-helper

# 启动服务（默认 http://localhost:5173）
bitable-helper

# 指定端口
bitable-helper 8080
```

启动后，将控制台输出的地址（如 `http://localhost:5173`）填入飞书多维表格的「自定义插件」入口即可加载。

> 该命令通过 [sirv](https://www.npmjs.com/package/sirv-cli) 托管包内预构建的 `dist` 产物，已启用 CORS 与 SPA 回退，开箱即用，无需本地构建。

## 快速开始

### 环境要求

- Node.js ≥ 18
- 飞书多维表格：
  - **工时管理**：任务表与工时表之间已建立**双向关联**字段
  - **任务生成**：存在名为「人员排期」「任务管理」的数据表（名称可带前后缀，模糊匹配）

### 安装与运行

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5174，与 CLI 的 5173 错开）
npm run dev

# 生产构建（先做 tsc 类型检查，再 vite 打包到 dist/）
npm run build

# 代码规范检查（ESLint）
npm run lint

# 本地预览构建产物
npm run preview
```

### 在飞书中加载插件

插件以 iframe 形式嵌入多维表格。开发态需将 dev server 地址填入多维表格的「自定义插件」入口：

1. 运行 `npm run dev`，确认 `http://localhost:5174` 可访问
2. 在多维表格中添加插件，填入上述地址加载

> Vite 已配置 `host: 0.0.0.0` 与 `cors: true`，以支持 iframe 跨域加载本地 dev server（见 [vite.config.ts](vite.config.ts)）。

## 使用说明

### 工时管理

1. 打开插件后切换到 **工时管理**
2. **首次配置**：进入字段配置面板
   - 选择主表中指向工时表的「关联字段（双向关联）」，插件自动解析出目标工时表
   - 映射工时表的**时长字段**（必填，数字类型）
   - 可选映射工时表的日期字段、描述字段，以及任务表的计划开始 / 结束日期字段
   - 保存后配置被记住，后续直接进入填写界面
3. **填写工时**：选择「单个任务」或「批量勾选」，录入时长 / 描述 / 日期后创建
4. **重新配置**：点击「重新配置」可随时调整字段映射

### 任务生成

1. 切换到多维表格中的 **人员排期** 表，并打开个人排期视图
2. 在插件 **任务生成** Tab 中查看当前视图可见排期，点击某条的「生成任务」
3. 在抽屉中确认按日预览列表（可勾选「包含周六、周日」、改岗位 / 优先级 / 日期），点击「生成」进入暂存
4. 切换到 **任务管理** 表后，在「已生成任务」中执行插入：
   - 与当前视图中**计划开始日相同**的记录视为冲突，冲突行默认不可批量插入，可单条确认覆盖
   - 非冲突行可批量插入

#### 任务管理表建议字段

插件按字段名模糊匹配（存在即可自动写入）：

| 用途 | 匹配名称示例 |
| --- | --- |
| 任务名称（必填） | 任务名称 / 任务名 / 主字段 |
| 执行人 | 任务执行人 / 执行人 / 负责人 / 人员 |
| 优先级 | 优先级（单选，如 P0～P3） |
| 所属岗位 | 任务所属岗位 / 所属岗位 |
| 计划开始 / 结束 | 计划开始日期、计划结束日期 |
| 实际开始 / 结束 | 实际开始日期、实际结束日期 |

岗位选项：前端 / 后端 / 测试 / 运维 / 实施 / 产品 / UI / 售前。

## 项目结构

```
bin/
└── cli.mjs                   # CLI：用 sirv 托管 dist，供全局安装后启动
deploy/
└── nginx.conf                # Docker Nginx：SPA + CORS
Dockerfile                    # 多阶段构建（Node build → Nginx）
docker-compose.yml            # web + Cloudflare Quick Tunnel
src/
├── App.tsx                   # 主壳：标题 + Tabs（工时管理 / 任务生成）
├── main.tsx                  # 入口：React + antd ConfigProvider
├── App.less                  # 全局与布局样式
├── types.ts                  # 共享类型
├── constants/
│   └── taskRole.ts           # 任务所属岗位选项
├── components/
│   ├── WorkHourPanel.tsx     # 工时管理：配置调度、模式切换、提交
│   ├── ConfigPanel.tsx       # 工时字段映射配置
│   ├── FieldSelect.tsx       # 通用字段下拉
│   ├── RecordCheckList.tsx   # 批量勾选列表
│   ├── WorkLogForm.tsx       # 工时录入表单
│   ├── TaskGeneratePanel.tsx # 任务生成：排期列表 + 已生成任务
│   └── GenerateTaskModal.tsx # 按日预览抽屉（含周末开关 / 批量编辑）
├── hooks/
│   ├── useTableData.ts       # 主表字段与可见记录
│   ├── useSelection.ts       # 当前选中记录
│   ├── useWorkLogConfig.ts   # 工时配置 localStorage 持久化
│   ├── useScheduleData.ts    # 人员排期检测与加载
│   └── useStagedTasks.ts     # 已生成任务暂存
└── services/
    └── bitable.ts            # Lark Base SDK 封装：工时创建、排期读取、任务插入与冲突检测
```

## 核心逻辑说明

- **关联字段解析**：`getFieldMetaList()` 不含 `property`，需在选定字段后经 `getFieldById().getMeta()` 读取 `property.tableId` 解析工时表（见 `resolveLinkTargetTableId`）。
- **关联追加写入**：创建工时后读取主表关联字段现值，将新记录 id **追加**写回，保留已有关联（见 `appendLinks`）。
- **任务命名**：`formatGeneratedTaskName` 去掉排期名首段编号与末尾执行人 / 日期；`buildTaskNameWithRole` 加上 `【岗位】` 前缀。
- **冲突检测**：`findStagedTaskConflicts` 仅扫描**当前视图可见记录**，以计划开始日为键；避免全表扫描带来的误报。
- **表切换刷新**：通过 `onSelectionChange` 比对 `tableId`，仅在换表时重载数据。

## 持续集成与发布

仓库配置了 GitHub Actions（见 [.github/workflows/ci.yml](.github/workflows/ci.yml)）。push 到 `main` 时：

```
verify（lint + build）→ publish（递增 patch → npm publish → 推送 tag）
```

- **校验**：ESLint、类型检查与构建，失败则不会进入发布
- **版本递增**：`npm version patch`，提交信息带 `[skip ci]`，避免版本回推再次触发发布
- **鉴权**：使用 npm [Trusted Publisher](https://docs.npmjs.com/trusted-publishers)（GitHub Actions OIDC），无需在仓库中配置 `NPM_TOKEN`
  - Organization / user：`jcak-cyber`
  - Repository：`bitable-helper`
  - Workflow filename：`ci.yml`
  - Environment：留空
  - Allowed actions：勾选 Allow npm publish

> CI 每次发布都会回推一个版本提交，本地下次 push 前请先 `git pull`。

也可本地手动发布（需已 `npm login`）：

```bash
npm version patch
npm publish --access public
```

## 服务器 Docker 部署（无域名）

插件是静态站点。飞书侧栏一般需要 **公网 HTTPS**。没有域名时，用 Docker Compose 在本机跑 Nginx，再通过 **Cloudflare Quick Tunnel** 拿到 `https://xxxx.trycloudflare.com` 填入飞书即可（不必开放 80/443 公网端口）。

### 前置

- 服务器已安装 Docker 与 Docker Compose
- 服务器能访问外网（拉镜像、建立隧道）

### 启动

```bash
# 在仓库根目录
docker compose up -d --build
```

查看隧道分配的 HTTPS 地址：

```bash
docker compose logs -f tunnel
```

日志中会出现类似：

```text
https://随机子域.trycloudflare.com
```

### 接入飞书

1. 浏览器先打开该 HTTPS 地址，确认能看到「多维表格助手」页面
2. 在飞书多维表格「自定义插件」入口填入该地址并加载
3. 验证工时管理 / 任务生成可用

### 常用命令

```bash
# 重建并重启（代码更新后）
docker compose up -d --build

# 停止
docker compose down

# 仅看 web 是否在本机 8080 可用
curl -I http://127.0.0.1:8080
```

### 注意

- **Quick Tunnel 地址会变**：`tunnel` 容器重启后可能换成新的 `*.trycloudflare.com`，需同步改飞书插件 URL。
- 若需要固定地址：可改用 Cloudflare 账号下的 Named Tunnel（仍可不买自有域名）；有域名后也可去掉 `tunnel` 服务，改由宿主机 Nginx / 反代终结 HTTPS。
- 相关文件：[`Dockerfile`](Dockerfile)、[`docker-compose.yml`](docker-compose.yml)、[`deploy/nginx.conf`](deploy/nginx.conf)

## License

[MIT](https://opensource.org/licenses/MIT)

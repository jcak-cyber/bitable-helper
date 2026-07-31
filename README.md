# 多维表格助手 · 飞书多维表格插件

为飞书多维表格（Lark Base）打造的助手插件，顶层分为 **工时管理** 与 **任务生成** 两个 Tab。

当前可用：**工时管理**——在任务表中选中（或批量勾选）任务后，一键在关联的「工时表」中创建工时记录，并自动回写关联关系。**任务生成**功能规划中。

## 功能特性

- **双 Tab 入口**
  - 工时管理：配置字段映射并填写 / 批量创建工时
  - 任务生成：在「人员排期」表中读取当前个人排期视图的可见排期并展示；当前不在该表时给出提示
- **两种填写模式**（工时管理）
  - 单个任务：跟随表格当前选中行，为该任务创建工时
  - 批量勾选：列出当前视图可见记录，多选后批量创建
- **灵活的工时录入**
  - 时长支持快捷预设（0.5/1/2/4/8 小时）与自定义数值
  - 花费描述可手填，或勾选「同步任务名称」自动取各任务标题
  - 日期可「同步任务计划结束日期」或手动指定统一日期
- **字段映射配置**：通过双向关联字段自动定位工时表，由用户指定时长 / 日期 / 描述等字段的对应关系
- **配置持久化**：配置按任务表 id 存入 `localStorage`，不同任务表各自记忆，下次打开免重配
- **已有工时标识**：批量列表中对已存在工时关联的任务打「已有工时」标签，避免重复填写
- **容错批处理**：单条任务失败不影响其它任务，结束后汇总成功 / 失败条数

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

本插件已发布到 npm，可全局安装后通过命令行启动一个本地服务，托管已构建好的插件产物：

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
- 一个飞书多维表格，且任务表与工时表之间已建立**双向关联**字段

### 安装与运行

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
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

1. 运行 `npm run dev`，确认 `http://localhost:5173` 可访问
2. 在多维表格中添加插件，填入上述地址加载

> Vite 已配置 `host: 0.0.0.0` 与 `cors: true`，以支持 iframe 跨域加载本地 dev server（见 [vite.config.ts](vite.config.ts)）。

## 使用说明

1. 打开插件后进入「多维表格助手」，在 **工时管理** / **任务生成** 间切换
2. **工时管理 · 首次配置**：首次打开该 Tab 会进入字段配置面板
   - 选择主表中指向工时表的「关联字段（双向关联）」，插件自动解析出目标工时表
   - 映射工时表的**时长字段**（必填，数字类型）
   - 可选映射工时表的日期字段、描述字段，以及任务表的计划结束日期字段
   - 保存后配置被记住，后续直接进入填写界面
3. **填写工时**
   - 选择「单个任务」或「批量勾选」模式
   - 录入时长，按需填写描述与日期
   - 点击「创建工时 / 批量创建工时」，插件在工时表新建记录并回写关联
4. **重新配置**：点击「重新配置」可随时调整字段映射

## 项目结构

```
bin/
└── cli.mjs                  # CLI 入口：用 sirv 托管 dist 产物，供全局安装后命令行启动
src/
├── App.tsx                  # 主壳：标题 + Tabs（工时管理 / 任务生成）
├── main.tsx                 # 入口：挂载 React + antd ConfigProvider（中文 + 飞书蓝主题）
├── types.ts                 # 共享类型定义（配置 / 记录行 / 输入 / 批量结果）
├── components/
│   ├── WorkHourPanel.tsx    # 工时管理：配置态调度、模式切换、提交编排
│   ├── TaskGeneratePanel.tsx# 任务生成：展示人员排期列表 / 缺省提示
│   ├── ConfigPanel.tsx      # 字段映射配置面板
│   ├── FieldSelect.tsx      # 通用字段下拉选择器（复用于所有字段映射场景）
│   ├── RecordCheckList.tsx  # 批量模式的记录勾选列表
│   └── WorkLogForm.tsx      # 工时录入表单（时长 / 日期 / 描述）
├── hooks/
│   ├── useTableData.ts      # 加载主表字段与可见记录；附 useWorkTableFields 加载工时表字段
│   ├── useScheduleData.ts   # 任务生成：检测「人员排期」表并加载当前个人排期视图
│   ├── useSelection.ts      # 跟踪表格当前选中记录
│   └── useWorkLogConfig.ts  # 配置的 localStorage 持久化（按主表 id 分桶）
└── services/
    └── bitable.ts           # 对 Lark Base SDK 的封装：取字段、解析关联表、批量创建工时、读排期
```

## 核心逻辑说明

- **关联字段解析**：`getFieldMetaList()` 返回的 meta 不含 `property`，无法直接拿到关联目标表 id。需在选定字段后经 `getFieldById().getMeta()` 读取 `property.tableId` 解析出工时表（见 [src/services/bitable.ts](src/services/bitable.ts) 的 `resolveLinkTargetTableId`）。
- **关联追加写入**：创建工时记录后，读取主表关联字段的现有值，将新记录 id **追加**进去再写回，保留任务已有的工时关联，不做覆盖（见 `appendLink`）。
- **表切换刷新**：通过 `onSelectionChange` 比对 `tableId` 判断是否真正切换了表，仅在换表时重载，避免单纯切换选中行导致频繁刷新（见 [src/hooks/useTableData.ts](src/hooks/useTableData.ts)）。

## 持续集成与发布

仓库配置了 GitHub Actions 工作流（见 [.github/workflows/ci.yml](.github/workflows/ci.yml)），push 到 `main` 分支时自动执行：

```
校验(lint + tsc + build) → 递增 patch 版本号 → 构建 → 发布到 npm → 推送版本提交与 tag
```

- **校验**：ESLint、类型检查与构建，任一失败则中断，不会发布
- **版本递增**：自动执行 `npm version patch`，提交信息带 `[skip ci]` 避免再次触发工作流形成死循环
- **自动发布**：通过仓库 Secret `NPM_TOKEN`（需具备 bypass 2FA 权限的 npm token）鉴权发布

> 因 CI 每次都会回推一个版本提交，本地下次 push 前需先 `git pull`，否则推送会被拒绝。

## License

[MIT](https://opensource.org/licenses/MIT)

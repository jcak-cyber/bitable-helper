// 共享类型定义：UI 层与 service 层之间传递的轻量数据结构

/** 字段下拉选项 / 列表展示用的精简字段信息 */
export interface FieldOption {
  id: string;
  name: string;
}

/** 记录勾选列表的单行数据 */
export interface RecordRow {
  /** 记录 id */
  recordId: string;
  /** 首列（主字段）文本，作为人类可读的行标识 */
  title: string;
  /** 该任务是否已有关联的工时记录 */
  hasWorkLog: boolean;
}

/**
 * 工时填写的字段映射配置。
 * 主表通过 linkFieldId 关联到工时表，工时表内各字段的用途由用户指定。
 * 该配置持久化到 localStorage，下次打开免重配。
 */
export interface WorkLogConfig {
  /** 主表中指向工时表的 DuplexLink 字段 id */
  linkFieldId: string;
  /** 工时表 id（由 linkField.property.tableId 解析得到） */
  workTableId: string;
  /** 工时表：时长字段 id（数字） */
  hoursFieldId: string;
  /** 工时表：日期字段 id（可选） */
  dateFieldId: string;
  /** 工时表：花费描述字段 id（可选，文本） */
  descFieldId: string;
  /** 主表：计划开始日期字段 id，与结束日一起决定跨度天数（可选） */
  planStartDateFieldId: string;
  /** 主表：计划结束日期字段 id，作为工时日期 / 跨度终点（可选） */
  planEndDateFieldId: string;
}

/** 单次批量填写时用户录入的工时数据 */
export interface WorkLogInput {
  /** 时长（小时） */
  hours: number;
  /** 花费描述（可为空） */
  desc: string;
  /**
   * 日期来源：'sync' = 按主表计划开始~结束日跨度逐日生成；
   * 具体时间戳 = 用户手选的统一日期（仅 1 条）。
   * 为 null 时表示该工时表没有日期字段，跳过日期写入（仅 1 条）。
   */
  date: 'sync' | number | null;
  /** 是否用各任务的名称作为花费描述（true 时忽略 desc，逐任务取主字段） */
  syncTaskName: boolean;
}

/** 批量操作结果，用于汇总 toast 提示 */
export interface BatchResult {
  /** 成功条数 */
  success: number;
  /** 失败条数 */
  failed: number;
  /** 失败明细（行标识 → 原因），便于排查 */
  errors: string[];
}

/** 「人员排期」当前个人排期视图中的一条排期，供任务生成 Tab 展示 */
export interface ScheduleRow {
  recordId: string;
  /** 排期名称 */
  name: string;
  /** 排期类型 */
  type: string;
  /** 关联研发事项 */
  linkedItem: string;
  /** 计划开始日（展示文本） */
  startDate: string;
  /** 计划结束日（展示文本） */
  endDate: string;
  /** 计划开始日时间戳（用于按日展开） */
  startTs: number | null;
  /** 计划结束日时间戳（用于按日展开） */
  endTs: number | null;
  /** 投入（展示文本，如 25%） */
  effort: string;
  /** 任务执行人（视图名或排期人员字段） */
  executor: string;
}

/** 按排期跨度预览的一条待生成任务 */
export interface GeneratedTaskPreview {
  /** 周期内第几天（从 1 起） */
  dayIndex: number;
  /** 该日日期 YYYY-MM-DD */
  date: string;
  /** 该日时间戳 */
  dateTs: number;
  /** 预览任务名称 */
  taskName: string;
  /** 任务执行人 */
  executor: string;
  /** 任务所属岗位 */
  role: string;
  /** 优先级：P0 / P1 / P2 / P3 */
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  /** 计划开始日期（当日） */
  planStartDate: string;
  /** 计划结束日期（当日） */
  planEndDate: string;
  /** 实际开始日期（默认与计划开始日期一致，可手动改） */
  actualStartDate: string;
  /** 实际结束日期（默认空，可手动填） */
  actualEndDate: string;
}

/** 从预览弹窗「生成」后暂存的任务项（持久化，切表不丢） */
export interface StagedTaskItem extends GeneratedTaskPreview {
  /** 暂存唯一 id */
  stagedId: string;
  /** 来源排期 recordId */
  scheduleRecordId: string;
  /** 写入暂存的时间戳（用于倒序展示） */
  stagedAt: number;
}

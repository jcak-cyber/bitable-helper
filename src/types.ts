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
  /** 主表：计划结束日期字段 id，作为工时日期默认来源（可选） */
  planEndDateFieldId: string;
}

/** 单次批量填写时用户录入的工时数据 */
export interface WorkLogInput {
  /** 时长（小时） */
  hours: number;
  /** 花费描述（可为空） */
  desc: string;
  /**
   * 日期来源：'sync' = 取主表计划结束日期；具体时间戳 = 用户手选的统一日期。
   * 为 null 时表示该工时表没有日期字段，跳过日期写入。
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

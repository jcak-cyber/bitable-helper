import {
  bitable,
  FieldType,
  ToastType,
  IOpenSegmentType,
  type ITable,
  type IOpenCellValue,
  type IOpenLink,
  type IDuplexLinkField,
} from '@lark-base-open/js-sdk';
import dayjs from 'dayjs';
import type {
  FieldOption,
  RecordRow,
  ScheduleRow,
  GeneratedTaskPreview,
  StagedTaskItem,
  WorkLogConfig,
  WorkLogInput,
  BatchResult,
} from '../types';
import { DEFAULT_TASK_ROLE } from '../constants/taskRole';

/** 任务生成功能依赖的人员排期表名称 */
export const SCHEDULE_TABLE_NAME = '人员排期';

/** 工时管理功能依赖的任务管理表名称 */
export const TASK_TABLE_NAME = '任务管理';

/** 表名匹配：去空白后精确相等，或互相包含（兼容「任务管理表」等命名） */
export function matchTableName(actual: string, expected: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  if (!a || !e) return false;
  return a === e || a.includes(e) || e.includes(a);
}

/**
 * 判断当前是否为任务管理表。
 * 优先表名；若不匹配，再用字段结构兜底（任务名称 + 计划开始/结束），
 * 避免表名略有差异或切换后状态滞后导致误判。
 */
export async function isTaskManagementTable(table: ITable): Promise<boolean> {
  const name = await table.getName();
  if (matchTableName(name, TASK_TABLE_NAME)) return true;
  const metaList = await table.getFieldMetaList();
  const names = metaList.map((m) => m.name);
  const hasTaskName = names.some((n) => n.includes('任务名称') || n === '任务名');
  const hasStart = names.some((n) => n.includes('计划开始'));
  const hasEnd = names.some((n) => n.includes('计划结束'));
  return hasTaskName && hasStart && hasEnd;
}

/** 获取当前激活的数据表（主表 / 任务表） */
export async function getActiveTable(): Promise<ITable> {
  return bitable.base.getActiveTable();
}

/** 按 id 获取任意表（用于拿到工时表） */
export async function getTableById(tableId: string): Promise<ITable> {
  return bitable.base.getTable(tableId);
}

/**
 * 获取主表中所有「双向关联」字段。
 * 注意：getFieldMetaList 返回的 meta 不含 property，无法在此拿到目标表 id；
 * 目标工时表 id 需在选定字段后通过 resolveLinkTargetTableId 异步获取。
 */
export async function getLinkFields(table: ITable): Promise<FieldOption[]> {
  const metaList = await table.getFieldMetaList();
  return metaList
    .filter((m) => m.type === FieldType.DuplexLink)
    .map((m) => ({ id: m.id, name: m.name }));
}

/**
 * 解析关联字段指向的目标表 id。
 * 必须读取 field.getMeta().property.tableId —— 这是关联指向的目标表；
 * getFieldMetaList() 返回的 meta 不含 property，故必须经 getFieldById + getMeta。
 */
export async function resolveLinkTargetTableId(
  table: ITable,
  linkFieldId: string
): Promise<string> {
  const field = await table.getFieldById<IDuplexLinkField>(linkFieldId);
  const meta = await field.getMeta();
  return (meta?.property as { tableId?: string })?.tableId ?? '';
}

/** 获取指定类型的字段列表，供字段映射下拉使用 */
export async function getFieldsByType(
  table: ITable,
  types: FieldType[]
): Promise<FieldOption[]> {
  const metaList = await table.getFieldMetaList();
  const set = new Set(types);
  return metaList
    .filter((m) => set.has(m.type))
    .map((m) => ({ id: m.id, name: m.name }));
}

/**
 * 列出当前视图的可见记录，返回带主字段文本的行数据，供批量勾选 UI 使用。
 * 传入关联字段 id 时，额外判断每个任务是否已有关联的工时记录。
 */
export async function getVisibleRecords(
  table: ITable,
  linkFieldId?: string
): Promise<RecordRow[]> {
  const view = await table.getActiveView();
  const recordIds = await view.getVisibleRecordIdList();

  const metaList = await table.getFieldMetaList();
  const primaryFieldId = metaList.find((m) => m.isPrimary)?.id ?? metaList[0]?.id;
  if (!primaryFieldId) return [];

  const rows = await Promise.all(
    recordIds
      .filter((id): id is string => Boolean(id))
      .map(async (recordId) => {
        // 并行读取主字段与（可选的）关联字段
        const [titleCell, linkCell] = await Promise.all([
          table.getCellValue(primaryFieldId, recordId),
          linkFieldId ? table.getCellValue(linkFieldId, recordId) : Promise.resolve(null),
        ]);
        const link = linkCell as IOpenLink | null;
        return {
          recordId,
          title: stringifyCell(titleCell) || '(空)',
          hasWorkLog: Boolean(link?.recordIds?.length),
        };
      })
  );
  return rows;
}

/**
 * 批量为选中的任务创建工时记录，并把新记录关联回主表。
 *
 * 对每个任务行：
 *  1. 解析日期列表：同步计划时按开始~结束跨度逐日展开（跨 3 天 → 3 条）
 *  2. 对每一天在工时表 addRecord（时长 / 当日日期 / 描述）
 *  3. 将全部新记录 id 追加写回主表关联字段
 *
 * 任一任务失败不影响其它任务，最终汇总成功/失败数（按工时记录条数计）。
 */
export async function createWorkLogs(
  mainTable: ITable,
  taskRecordIds: string[],
  config: WorkLogConfig,
  input: WorkLogInput
): Promise<BatchResult> {
  const result: BatchResult = { success: 0, failed: 0, errors: [] };
  if (taskRecordIds.length === 0) return result;

  const workTable = await getTableById(config.workTableId);

  // 同步任务名称时，需要主表主字段 id，逐任务读取任务名作为描述
  let primaryFieldId = '';
  if (input.syncTaskName) {
    const metaList = await mainTable.getFieldMetaList();
    primaryFieldId = metaList.find((m) => m.isPrimary)?.id ?? metaList[0]?.id ?? '';
  }

  for (const taskId of taskRecordIds) {
    try {
      // 1. 解析该任务应生成的日期列表（跨度多天则多条）
      const dateList = await resolveDateList(mainTable, taskId, config, input.date);

      // 2. 解析花费描述：同步任务名时取该任务主字段，否则用统一输入
      let desc = input.desc;
      if (input.syncTaskName && primaryFieldId) {
        const titleCell = await mainTable.getCellValue(primaryFieldId, taskId);
        desc = stringifyCell(titleCell);
      }

      // 3. 按日创建工时记录
      const newRecordIds: string[] = [];
      for (const dayTs of dateList) {
        const fields: Record<string, IOpenCellValue> = {
          [config.hoursFieldId]: input.hours,
        };
        if (config.dateFieldId && dayTs != null) {
          fields[config.dateFieldId] = dayTs;
        }
        if (config.descFieldId && desc) {
          fields[config.descFieldId] = [{ type: IOpenSegmentType.Text, text: desc }];
        }
        const newRecordId = await workTable.addRecord({ fields });
        newRecordIds.push(newRecordId);
      }

      // 4. 关联回主表：一次追加全部新记录，保留已有关联
      await appendLinks(mainTable, taskId, config.linkFieldId, config.workTableId, newRecordIds);

      result.success += newRecordIds.length;
    } catch (e) {
      result.failed++;
      result.errors.push(`${taskId}: ${(e as Error)?.message ?? '未知错误'}`);
      console.error('[createWorkLogs] 任务处理失败', taskId, e);
    }
  }

  return result;
}

/** 将单元格值解析为毫秒时间戳（兼容 number / 可解析字符串） */
function parseCellTimestamp(cell: IOpenCellValue): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (typeof cell === 'string' && cell.trim()) {
    const d = dayjs(cell.trim());
    return d.isValid() ? d.valueOf() : null;
  }
  if (cell && typeof cell === 'object' && 'value' in cell) {
    const v = (cell as { value?: unknown }).value;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * 解析某个任务应写入的工时日期列表。
 * - sync：有开始+结束 → 闭区间逐日；仅结束 → 单日；均无 → [null] 仍建 1 条
 * - 数字时间戳：用户手选单日
 * - null：无日期字段，建 1 条且不写日期
 *
 * 配置未填开始/结束字段时，按常见列名「计划开始日期 / 计划结束日期」自动匹配。
 */
async function resolveDateList(
  mainTable: ITable,
  taskId: string,
  config: WorkLogConfig,
  date: WorkLogInput['date']
): Promise<(number | null)[]> {
  if (typeof date === 'number') return [date];
  if (date !== 'sync') return [null];

  const metaList = await mainTable.getFieldMetaList();
  const startFieldId =
    config.planStartDateFieldId ||
    findFieldIdByName(metaList, ['计划开始日期', '计划开始日']);
  const endFieldId =
    config.planEndDateFieldId ||
    findFieldIdByName(metaList, ['计划结束日期', '计划结束日']);

  const [startRaw, endRaw] = await Promise.all([
    startFieldId ? mainTable.getCellValue(startFieldId, taskId) : Promise.resolve(null),
    endFieldId ? mainTable.getCellValue(endFieldId, taskId) : Promise.resolve(null),
  ]);

  const startTs = parseCellTimestamp(startRaw);
  const endTs = parseCellTimestamp(endRaw);

  if (startTs != null && endTs != null) return expandDayTimestamps(startTs, endTs);
  if (endTs != null) return [endTs];
  if (startTs != null) return [startTs];
  return [null];
}

/** 将起止时间戳展开为按自然日的时间戳列表（含首尾） */
export function expandDayTimestamps(startTs: number, endTs: number): number[] {
  let start = dayjs(startTs).startOf('day');
  let end = dayjs(endTs).startOf('day');
  if (end.isBefore(start)) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const days: number[] = [];
  let cur = start;
  // 保护：异常超长跨度最多 366 天，避免误配字段导致大批量写入
  while ((cur.isBefore(end) || cur.isSame(end, 'day')) && days.length < 366) {
    days.push(cur.valueOf());
    cur = cur.add(1, 'day');
  }
  return days.length > 0 ? days : [start.valueOf()];
}

/**
 * 往主表关联字段追加多个新记录 id，保留已有关联。
 * 关联字段写入需提供完整 IOpenLink 结构。
 */
async function appendLinks(
  mainTable: ITable,
  taskId: string,
  linkFieldId: string,
  workTableId: string,
  newRecordIds: string[]
): Promise<void> {
  if (newRecordIds.length === 0) return;
  const existing = (await mainTable.getCellValue(linkFieldId, taskId)) as IOpenLink | null;
  const existingIds = existing?.recordIds ?? [];
  const recordIds = [...existingIds, ...newRecordIds];

  const linkValue: IOpenLink = {
    text: '',
    type: 'text',
    recordIds,
    tableId: workTableId,
    record_ids: recordIds,
    table_id: workTableId,
  };

  await mainTable.setCellValue(linkFieldId, taskId, linkValue);
}

/** 统一的 toast 反馈封装 */
export async function toast(
  type: 'success' | 'error' | 'info',
  message: string
): Promise<void> {
  const map = {
    success: ToastType.success,
    error: ToastType.error,
    info: ToastType.info,
  } as const;
  await bitable.ui.showToast({ toastType: map[type], message });
}

/**
 * 将任意单元格值转为可读文本，仅用于主字段行标识展示。
 */
function stringifyCell(cell: IOpenCellValue): string {
  if (cell == null) return '';
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  if (Array.isArray(cell)) {
    return cell
      .map((seg) => {
        if (!seg || typeof seg !== 'object') return '';
        const obj = seg as { text?: string; name?: string };
        return obj.text || obj.name || '';
      })
      .filter(Boolean)
      .join('、');
  }
  if (typeof cell === 'object') {
    const obj = cell as { text?: unknown; name?: unknown };
    if (obj.text != null) return String(obj.text);
    if (obj.name != null) return String(obj.name);
  }
  return '';
}

type FieldMetaLite = { id: string; name: string; type: FieldType; isPrimary?: boolean };

/** 时间戳 / 日期单元格 → YYYY-MM-DD（本地日历日） */
function formatDateCell(cell: IOpenCellValue): string {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return dayjs(cell).format('YYYY-MM-DD');
  }
  if (cell && typeof cell === 'object' && 'value' in cell) {
    const v = (cell as { value?: unknown }).value;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return dayjs(v).format('YYYY-MM-DD');
    }
  }
  const text = stringifyCell(cell);
  if (!text) return '';
  // 兼容 2026/08/07、2026-08-07
  const normalized = text.trim().replace(/\//g, '-');
  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
}

/**
 * 按字段名查找 meta（精确优先，其次包含）。
 * 可限制字段类型，避免误匹配到同名片段的非目标列。
 */
function findFieldMeta(
  metaList: FieldMetaLite[],
  names: string[],
  types?: FieldType[]
): FieldMetaLite | null {
  const list =
    types && types.length > 0 ? metaList.filter((m) => types.includes(m.type)) : metaList;
  for (const name of names) {
    const exact = list.find((m) => m.name === name);
    if (exact) return exact;
  }
  for (const name of names) {
    const partial = list.find((m) => m.name.includes(name));
    if (partial) return partial;
  }
  return null;
}

/** 投入字段：小数比例转百分比，已是百分数则原样展示 */
function formatEffortCell(cell: IOpenCellValue): string {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    if (cell > 0 && cell <= 1) return `${Math.round(cell * 100)}%`;
    return `${cell}%`;
  }
  const text = stringifyCell(cell);
  if (!text) return '';
  return text.includes('%') ? text : `${text}%`;
}

/**
 * 按字段名查找 id（精确匹配优先，其次包含匹配），找不到返回空串。
 */
function findFieldIdByName(
  metaList: { id: string; name: string; isPrimary?: boolean }[],
  names: string[],
  fallbackPrimary = false
): string {
  for (const name of names) {
    const exact = metaList.find((m) => m.name === name);
    if (exact) return exact.id;
  }
  for (const name of names) {
    const partial = metaList.find((m) => m.name.includes(name));
    if (partial) return partial.id;
  }
  if (fallbackPrimary) {
    return metaList.find((m) => m.isPrimary)?.id ?? metaList[0]?.id ?? '';
  }
  return '';
}

/**
 * 从个人排期视图名解析执行人，如「张泽宇 | 个人排期」→「张泽宇」。
 */
export function parseExecutorFromViewName(viewName: string): string {
  const raw = viewName.trim();
  if (!raw) return '';
  const head = raw.split(/[|｜]/)[0]?.trim() ?? '';
  if (!head || head === raw) {
    // 无分隔符时，整名若像「xxx个人排期」则去掉后缀
    return head.replace(/\s*个人排期\s*$/, '').trim();
  }
  return head.replace(/\s*个人排期\s*$/, '').trim();
}

/**
 * 读取「人员排期」当前激活视图（个人排期）中的可见排期行。
 * @param defaultExecutor 默认执行人（通常来自当前视图名）
 */
export async function getScheduleRecords(
  table: ITable,
  defaultExecutor = ''
): Promise<ScheduleRow[]> {
  const metaList = await table.getFieldMetaList();
  const nameFieldId = findFieldIdByName(metaList, ['排期名称'], true);
  const typeFieldId = findFieldIdByName(metaList, ['排期类型']);
  const linkFieldId = findFieldIdByName(metaList, ['关联研发事项']);
  const startFieldId = findFieldIdByName(metaList, ['计划开始日', '计划开始日期']);
  const endFieldId = findFieldIdByName(metaList, ['计划结束日', '计划结束日期']);
  const effortFieldId = findFieldIdByName(metaList, ['投入']);
  const executorFieldId = findFieldIdByName(metaList, [
    '任务执行人',
    '执行人',
    '人员',
    '负责人',
  ]);

  if (!nameFieldId) return [];

  // 仅取当前选中的个人排期视图可见记录，不拉全表
  const view = await table.getActiveView();
  const visibleIds = await view.getVisibleRecordIdList();
  const recordIds = visibleIds.filter((id): id is string => Boolean(id));

  const rows = await Promise.all(
    recordIds.map(async (recordId) => {
      const [nameCell, typeCell, linkCell, startCell, endCell, effortCell, executorCell] =
        await Promise.all([
          table.getCellValue(nameFieldId, recordId),
          typeFieldId ? table.getCellValue(typeFieldId, recordId) : Promise.resolve(null),
          linkFieldId ? table.getCellValue(linkFieldId, recordId) : Promise.resolve(null),
          startFieldId ? table.getCellValue(startFieldId, recordId) : Promise.resolve(null),
          endFieldId ? table.getCellValue(endFieldId, recordId) : Promise.resolve(null),
          effortFieldId ? table.getCellValue(effortFieldId, recordId) : Promise.resolve(null),
          executorFieldId
            ? table.getCellValue(executorFieldId, recordId)
            : Promise.resolve(null),
        ]);
      const startTs = parseCellTimestamp(startCell);
      const endTs = parseCellTimestamp(endCell);
      const executorFromField = stringifyCell(executorCell);
      return {
        recordId,
        name: stringifyCell(nameCell) || '(未命名排期)',
        type: stringifyCell(typeCell),
        linkedItem: stringifyCell(linkCell),
        startDate: formatDateCell(startCell),
        endDate: formatDateCell(endCell),
        startTs,
        endTs,
        effort: formatEffortCell(effortCell),
        executor: executorFromField || defaultExecutor,
      } satisfies ScheduleRow;
    })
  );

  // 按计划开始日倒序（无开始日则用结束日），同日再按结束日倒序
  return rows.sort((a, b) => {
    const ta = a.startTs ?? a.endTs ?? 0;
    const tb = b.startTs ?? b.endTs ?? 0;
    if (tb !== ta) return tb - ta;
    return (b.endTs ?? 0) - (a.endTs ?? 0);
  });
}

export interface BuildTaskPreviewOptions {
  /** 是否在周六、周日也生成任务；默认 true */
  includeWeekend?: boolean;
}

/**
 * 排期名称 → 生成任务名称正文（不含岗位前缀）。
 * 例：`SCH-0066 | 华夏乘黄 | SaaS | 标准交付 + 定制化开发 | 张泽宇 | 08/01-09/03`
 * → 去掉首段编号与末两段（执行人、日期），去掉 `|` 后拼接：
 * `华夏乘黄SaaS标准交付 + 定制化开发`
 */
export function formatGeneratedTaskName(raw: string): string {
  const parts = raw
    .split(/[|｜]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return raw.trim();
  if (parts.length <= 3) {
    // 结构不足时仅去掉分隔符拼接
    return parts.join('');
  }
  return parts.slice(1, -2).join('');
}

/** 去掉已有的【岗位】前缀，便于更换岗位时重拼 */
export function stripTaskRolePrefix(taskName: string): string {
  return taskName.replace(/^【[^】]*】/, '').trim();
}

/**
 * 最终任务名称：【所属岗位】+ 名称正文
 * 例：【前端】华夏乘黄SaaS标准交付 + 定制化开发
 */
export function buildTaskNameWithRole(baseOrFullName: string, role: string): string {
  const base = stripTaskRolePrefix(baseOrFullName);
  const r = (role || DEFAULT_TASK_ROLE).trim() || DEFAULT_TASK_ROLE;
  return `【${r}】${base}`;
}

/**
 * 按排期计划起止日展开待生成任务预览列表（跨 N 天 → N 条）。
 * 单日任务：计划开始/结束均为当天。
 * includeWeekend=false 时跳过周六、周日。
 */
export function buildGeneratedTaskPreviews(
  schedule: ScheduleRow,
  options?: BuildTaskPreviewOptions
): GeneratedTaskPreview[] {
  const includeWeekend = options?.includeWeekend ?? true;
  let startTs = schedule.startTs;
  let endTs = schedule.endTs;

  // 时间戳缺失时回退解析展示文本
  if (startTs == null && schedule.startDate) {
    const d = dayjs(schedule.startDate);
    if (d.isValid()) startTs = d.startOf('day').valueOf();
  }
  if (endTs == null && schedule.endDate) {
    const d = dayjs(schedule.endDate);
    if (d.isValid()) endTs = d.startOf('day').valueOf();
  }

  if (startTs == null && endTs == null) return [];
  let days =
    startTs != null && endTs != null
      ? expandDayTimestamps(startTs, endTs)
      : [startTs ?? endTs!];

  if (!includeWeekend) {
    // dayjs: 0=周日, 6=周六
    days = days.filter((ts) => {
      const dow = dayjs(ts).day();
      return dow !== 0 && dow !== 6;
    });
  }

  const baseName = formatGeneratedTaskName(schedule.name);
  const role = DEFAULT_TASK_ROLE;
  const taskName = buildTaskNameWithRole(baseName, role);

  return days.map((dateTs, index) => {
    const date = dayjs(dateTs).format('YYYY-MM-DD');
    return {
      dayIndex: index + 1,
      date,
      dateTs,
      taskName,
      executor: schedule.executor,
      role,
      priority: 'P0',
      planStartDate: date,
      planEndDate: date,
      actualStartDate: date,
      actualEndDate: '',
    };
  });
}

function toDayTs(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = dayjs(dateStr);
  return d.isValid() ? d.startOf('day').valueOf() : null;
}

type SelectOptionLite = { id: string; name: string };

type SelectFieldLike = {
  createCell: (val: unknown) => Promise<{ getValue: () => Promise<IOpenCellValue> }>;
  getOptions?: () => Promise<SelectOptionLite[]>;
  addOption?: (name: string) => Promise<unknown>;
  setValue?: (recordOrId: string, val: unknown) => Promise<boolean>;
};

/** 在选项列表中匹配 P0/P1…（精确 / 忽略大小写 / 名称包含） */
function matchSelectOption(
  options: SelectOptionLite[],
  text: string
): SelectOptionLite | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return (
    options.find((o) => o.name === raw) ||
    options.find((o) => o.name.toUpperCase() === upper) ||
    options.find((o) => {
      const n = o.name.toUpperCase();
      return n.startsWith(upper) || n.includes(upper) || upper.includes(n);
    })
  );
}

/**
 * 解析单选/多选可写入值：先 getOptions 匹配，没有则 addOption，再回退 createCell。
 * 绝不写入 id 为空的伪选项（飞书会静默丢弃，表现为优先级空白）。
 */
async function resolveSelectCellValue(
  field: SelectFieldLike,
  raw: string,
  multi: boolean
): Promise<IOpenCellValue | null> {
  const text = String(raw).trim();
  if (!text) return null;

  let options: SelectOptionLite[] = [];
  try {
    options = (await field.getOptions?.()) ?? [];
  } catch {
    options = [];
  }

  let opt = matchSelectOption(options, text);
  if (!opt && typeof field.addOption === 'function') {
    try {
      await field.addOption(text);
      options = (await field.getOptions?.()) ?? [];
      opt = matchSelectOption(options, text);
    } catch (e) {
      console.warn('[resolveSelectCellValue] addOption 失败', text, e);
    }
  }

  if (opt?.id) {
    const cell = { id: opt.id, text: opt.name };
    return multi ? [cell] : cell;
  }

  try {
    const created = await field.createCell(text);
    const val = await created.getValue();
    if (val == null) return null;
    if (multi) {
      if (Array.isArray(val)) return val.length > 0 ? (val as IOpenCellValue) : null;
      if (typeof val === 'object' && val && 'id' in val && (val as { id: string }).id) {
        return [val] as unknown as IOpenCellValue;
      }
      return null;
    }
    if (typeof val === 'object' && val && 'id' in val && (val as { id: string }).id) {
      return val as IOpenCellValue;
    }
    return null;
  } catch (e) {
    console.warn('[resolveSelectCellValue] createCell 失败', text, e);
    return null;
  }
}

/**
 * 用字段 createCell 生成可写入的单元格值。
 * User 字段无法仅凭姓名可靠写入，返回 null 由调用方跳过。
 */
async function buildCellValue(
  table: ITable,
  meta: FieldMetaLite,
  raw: string | number
): Promise<IOpenCellValue | null> {
  const field = await table.getFieldById(meta.id);
  try {
    if (meta.type === FieldType.Text || meta.type === FieldType.Barcode) {
      const cell = await field.createCell(String(raw));
      return (await cell.getValue()) as IOpenCellValue;
    }
    if (meta.type === FieldType.DateTime) {
      const ts = typeof raw === 'number' ? raw : toDayTs(String(raw));
      if (ts == null) return null;
      const cell = await field.createCell(ts);
      return (await cell.getValue()) as IOpenCellValue;
    }
    if (meta.type === FieldType.SingleSelect || meta.type === FieldType.MultiSelect) {
      return resolveSelectCellValue(
        field as unknown as SelectFieldLike,
        String(raw),
        meta.type === FieldType.MultiSelect
      );
    }
    if (meta.type === FieldType.Number) {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return null;
      const cell = await field.createCell(n);
      return (await cell.getValue()) as IOpenCellValue;
    }
  } catch (e) {
    console.warn('[buildCellValue] 字段写入值构造失败', meta.name, meta.type, e);
    if (meta.type === FieldType.Text && typeof raw === 'string' && raw) {
      return [{ type: IOpenSegmentType.Text, text: raw }];
    }
    if (meta.type === FieldType.DateTime) {
      const ts = typeof raw === 'number' ? raw : toDayTs(String(raw));
      if (ts == null) return null;
      return ts;
    }
  }
  return null;
}

/**
 * 从当前视图已有记录中按姓名匹配人员字段值（仅有姓名字符串时的折中方案）。
 */
async function resolveUserValueByName(
  table: ITable,
  fieldId: string,
  name: string
): Promise<IOpenCellValue | null> {
  const target = name.trim();
  if (!target) return null;
  try {
    const view = await table.getActiveView();
    const recordIds = await view.getVisibleRecordIdList();
    for (const recordId of recordIds) {
      if (!recordId) continue;
      const cell = await table.getCellValue(fieldId, recordId);
      if (!Array.isArray(cell) || cell.length === 0) continue;
      const hit = cell.find((u) => {
        if (!u || typeof u !== 'object') return false;
        const uname = String((u as { name?: string }).name ?? '');
        return uname === target || uname.includes(target) || target.includes(uname);
      });
      if (hit) return [hit] as IOpenCellValue;
    }
  } catch (e) {
    console.warn('[resolveUserValueByName] 匹配人员失败', e);
  }
  return null;
}

/** 冲突匹配键：仅计划开始日 YYYY-MM-DD */
function planStartConflictKey(planStartDate: string): string {
  return planStartDate.trim();
}

interface TaskFieldCtx {
  table: ITable;
  nameMeta: FieldMetaLite;
  executorMeta: FieldMetaLite | null;
  priorityMeta: FieldMetaLite | null;
  roleMeta: FieldMetaLite | null;
  planStartMeta: FieldMetaLite | null;
  planEndMeta: FieldMetaLite | null;
  actualStartMeta: FieldMetaLite | null;
  actualEndMeta: FieldMetaLite | null;
  userCache: Map<string, IOpenCellValue | null>;
  /** 优先级选项解析缓存：P0 → 单元格值 */
  priorityValueCache: Map<string, IOpenCellValue | null>;
  /** 所属岗位选项解析缓存 */
  roleValueCache: Map<string, IOpenCellValue | null>;
}

async function resolveTaskFieldCtx(table: ITable): Promise<TaskFieldCtx | { error: string }> {
  const metaList = (await table.getFieldMetaList()) as FieldMetaLite[];
  const nameMeta =
    findFieldMeta(metaList, ['任务名称', '任务名']) ??
    metaList.find((m) => m.isPrimary) ??
    null;
  if (!nameMeta) return { error: '未找到「任务名称」字段，无法插入' };
  const dateTypes = [FieldType.DateTime];
  const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];
  return {
    table,
    nameMeta,
    executorMeta: findFieldMeta(metaList, ['任务执行人', '执行人', '负责人', '人员']),
    priorityMeta:
      findFieldMeta(metaList, ['优先级'], selectTypes) ??
      findFieldMeta(metaList, ['优先级']),
    roleMeta:
      findFieldMeta(metaList, ['任务所属岗位', '所属岗位'], selectTypes) ??
      findFieldMeta(metaList, ['任务所属岗位', '所属岗位']),
    planStartMeta: findFieldMeta(metaList, ['计划开始日期', '计划开始日', '计划开始'], dateTypes),
    planEndMeta: findFieldMeta(metaList, ['计划结束日期', '计划结束日', '计划结束'], dateTypes),
    actualStartMeta: findFieldMeta(metaList, ['实际开始日期', '实际开始日', '实际开始'], dateTypes),
    actualEndMeta: findFieldMeta(metaList, ['实际结束日期', '实际结束日', '实际结束'], dateTypes),
    userCache: new Map(),
    priorityValueCache: new Map(),
    roleValueCache: new Map(),
  };
}

async function buildTaskFields(
  ctx: TaskFieldCtx,
  task: StagedTaskItem
): Promise<Record<string, IOpenCellValue>> {
  const {
    table,
    nameMeta,
    executorMeta,
    priorityMeta,
    roleMeta,
    planStartMeta,
    planEndMeta,
    actualStartMeta,
    actualEndMeta,
    userCache,
    priorityValueCache,
    roleValueCache,
  } = ctx;
  const fields: Record<string, IOpenCellValue> = {};

  const nameVal = await buildCellValue(table, nameMeta, task.taskName || '(未命名)');
  if (nameVal != null) fields[nameMeta.id] = nameVal;

  if (priorityMeta && task.priority) {
    let v = priorityValueCache.get(task.priority);
    if (v === undefined) {
      v = await buildCellValue(table, priorityMeta, task.priority);
      priorityValueCache.set(task.priority, v);
    }
    if (v != null) fields[priorityMeta.id] = v;
  }

  const role = task.role || DEFAULT_TASK_ROLE;
  if (roleMeta && role) {
    let v = roleValueCache.get(role);
    if (v === undefined) {
      v = await buildCellValue(table, roleMeta, role);
      roleValueCache.set(role, v);
    }
    if (v != null) fields[roleMeta.id] = v;
  }

  if (planStartMeta && task.planStartDate) {
    const v = await buildCellValue(table, planStartMeta, task.planStartDate);
    if (v != null) fields[planStartMeta.id] = v;
  }
  if (planEndMeta && task.planEndDate) {
    const v = await buildCellValue(table, planEndMeta, task.planEndDate);
    if (v != null) fields[planEndMeta.id] = v;
  }
  if (actualStartMeta && task.actualStartDate) {
    const v = await buildCellValue(table, actualStartMeta, task.actualStartDate);
    if (v != null) fields[actualStartMeta.id] = v;
  }
  if (actualEndMeta && task.actualEndDate) {
    const v = await buildCellValue(table, actualEndMeta, task.actualEndDate);
    if (v != null) fields[actualEndMeta.id] = v;
  }

  if (executorMeta && task.executor) {
    if (executorMeta.type === FieldType.User) {
      let cached = userCache.get(task.executor);
      if (cached === undefined) {
        cached = await resolveUserValueByName(table, executorMeta.id, task.executor);
        userCache.set(task.executor, cached);
      }
      if (cached != null) fields[executorMeta.id] = cached;
    } else {
      const v = await buildCellValue(table, executorMeta, task.executor);
      if (v != null) fields[executorMeta.id] = v;
    }
  }

  return fields;
}

/** 建记录后再写一次单选，避免 addRecord 对单选静默丢弃 */
async function applySelectAfterWrite(
  ctx: TaskFieldCtx,
  recordId: string,
  meta: FieldMetaLite | null,
  raw: string,
  cache: Map<string, IOpenCellValue | null>
): Promise<void> {
  if (!meta || !raw) return;
  const field = (await ctx.table.getFieldById(meta.id)) as unknown as SelectFieldLike;
  if (typeof field.setValue !== 'function') return;

  let cellVal = cache.get(raw);
  if (cellVal === undefined) {
    cellVal = await buildCellValue(ctx.table, meta, raw);
    cache.set(raw, cellVal);
  }
  if (cellVal == null) return;

  const multi = meta.type === FieldType.MultiSelect;
  if (multi) {
    await field.setValue(recordId, Array.isArray(cellVal) ? cellVal : [cellVal]);
  } else {
    const single = Array.isArray(cellVal) ? cellVal[0] : cellVal;
    if (single && typeof single === 'object' && 'id' in single && (single as { id: string }).id) {
      await field.setValue(recordId, single);
    } else {
      await field.setValue(recordId, raw);
    }
  }
}

/**
 * 扫描任务管理表当前视图的可见记录，找出与暂存任务「同计划开始日」冲突的已有记录。
 * 仅扫可见行，与侧栏对照的当前视图一致，避免被筛选掉的历史行误判冲突。
 * @returns stagedId → 已有 recordId
 */
export async function findStagedTaskConflicts(
  table: ITable,
  tasks: StagedTaskItem[]
): Promise<Record<string, string>> {
  const conflicts: Record<string, string> = {};
  if (tasks.length === 0) return conflicts;
  if (!(await isTaskManagementTable(table))) return conflicts;

  const ctx = await resolveTaskFieldCtx(table);
  if ('error' in ctx) return conflicts;
  if (!ctx.planStartMeta) return conflicts;

  const needed = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.planStartDate) continue;
    const key = planStartConflictKey(t.planStartDate);
    const list = needed.get(key) ?? [];
    list.push(t.stagedId);
    needed.set(key, list);
  }
  if (needed.size === 0) return conflicts;

  // 与用户当前所见视图对齐，不用全表 getRecordIdList
  const view = await table.getActiveView();
  const recordIds = (await view.getVisibleRecordIdList()).filter((id): id is string =>
    Boolean(id)
  );
  const { planStartMeta } = ctx;

  const chunkSize = 80;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (recordId) => {
        const startCell = await table.getCellValue(planStartMeta!.id, recordId);
        const date = formatDateCell(startCell);
        if (!date) return;
        const key = planStartConflictKey(date);
        const stagedIds = needed.get(key);
        if (!stagedIds) return;
        for (const stagedId of stagedIds) {
          if (!conflicts[stagedId]) conflicts[stagedId] = recordId;
        }
      })
    );
  }

  return conflicts;
}

export interface InsertStagedTasksOptions {
  /** stagedId → 已有 recordId；有则覆盖（setRecord），无则新建 */
  overwriteByStagedId?: Record<string, string>;
}

/**
 * 将暂存任务写入当前「任务管理」表。
 * 按字段名自动匹配：任务名称、执行人、优先级、计划/实际起止日期。
 * @returns BatchResult，并附带成功插入的 stagedId 列表
 */
export async function insertStagedTasks(
  table: ITable,
  tasks: StagedTaskItem[],
  options?: InsertStagedTasksOptions
): Promise<BatchResult & { successIds: string[] }> {
  const result: BatchResult & { successIds: string[] } = {
    success: 0,
    failed: 0,
    errors: [],
    successIds: [],
  };
  if (tasks.length === 0) return result;

  const ok = await isTaskManagementTable(table);
  if (!ok) {
    result.failed = tasks.length;
    result.errors.push(`当前表不是「${TASK_TABLE_NAME}」，无法插入`);
    return result;
  }

  const ctx = await resolveTaskFieldCtx(table);
  if ('error' in ctx) {
    result.failed = tasks.length;
    result.errors.push(ctx.error);
    return result;
  }

  const overwrite = options?.overwriteByStagedId ?? {};

  for (const task of tasks) {
    try {
      const fields = await buildTaskFields(ctx, task);
      const existId = overwrite[task.stagedId];
      let recordId: string;
      if (existId) {
        await table.setRecord(existId, { fields });
        recordId = existId;
      } else {
        recordId = await table.addRecord({ fields });
      }
      // 单选二次写入，确保优先级 / 所属岗位真正落库
      if (task.priority) {
        try {
          await applySelectAfterWrite(
            ctx,
            recordId,
            ctx.priorityMeta,
            task.priority,
            ctx.priorityValueCache
          );
        } catch (pe) {
          console.warn('[insertStagedTasks] 优先级二次写入失败', task.stagedId, pe);
        }
      }
      const role = task.role || DEFAULT_TASK_ROLE;
      if (role) {
        try {
          await applySelectAfterWrite(ctx, recordId, ctx.roleMeta, role, ctx.roleValueCache);
        } catch (re) {
          console.warn('[insertStagedTasks] 所属岗位二次写入失败', task.stagedId, re);
        }
      }
      result.success++;
      result.successIds.push(task.stagedId);
    } catch (e) {
      result.failed++;
      const label = task.taskName || task.stagedId;
      result.errors.push(`${label}: ${(e as Error)?.message ?? '未知错误'}`);
      console.error('[insertStagedTasks] 插入失败', task.stagedId, e);
    }
  }

  return result;
}

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
  WorkLogConfig,
  WorkLogInput,
  BatchResult,
} from '../types';

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

/** 时间戳 / 日期单元格 → YYYY-MM-DD */
function formatDateCell(cell: IOpenCellValue): string {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return dayjs(cell).format('YYYY-MM-DD');
  }
  const text = stringifyCell(cell);
  if (!text) return '';
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : text;
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

/**
 * 按排期计划起止日展开待生成任务预览列表（跨 N 天 → N 条）。
 * 单日任务：计划开始/结束均为当天。
 */
export function buildGeneratedTaskPreviews(schedule: ScheduleRow): GeneratedTaskPreview[] {
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
  const days =
    startTs != null && endTs != null
      ? expandDayTimestamps(startTs, endTs)
      : [startTs ?? endTs!];

  return days.map((dateTs, index) => {
    const date = dayjs(dateTs).format('YYYY-MM-DD');
    return {
      dayIndex: index + 1,
      date,
      dateTs,
      taskName: schedule.name,
      executor: schedule.executor,
      priority: 'P0',
      planStartDate: date,
      planEndDate: date,
      actualStartDate: date,
      actualEndDate: date,
    };
  });
}

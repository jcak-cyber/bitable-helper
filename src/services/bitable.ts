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
import type { FieldOption, RecordRow, WorkLogConfig, WorkLogInput, BatchResult } from '../types';

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
 *  1. 在工时表 addRecord（时长 / 日期 / 描述）→ 得到新记录 id
 *  2. 读取主表该行关联字段的现有值，把新记录 id 追加进去（不覆盖既有关联）
 *  3. setCellValue 写回主表关联字段
 *
 * 任一任务失败不影响其它任务，最终汇总成功/失败数。
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
      // 1. 解析该任务的工时日期
      const dateValue = await resolveDate(mainTable, taskId, config, input.date);

      // 2. 解析花费描述：同步任务名时取该任务主字段，否则用统一输入
      let desc = input.desc;
      if (input.syncTaskName && primaryFieldId) {
        const titleCell = await mainTable.getCellValue(primaryFieldId, taskId);
        desc = stringifyCell(titleCell);
      }

      // 3. 组装工时表记录字段（仅写入已映射的字段）
      const fields: Record<string, IOpenCellValue> = {
        [config.hoursFieldId]: input.hours,
      };
      if (config.dateFieldId && dateValue != null) {
        fields[config.dateFieldId] = dateValue;
      }
      if (config.descFieldId && desc) {
        fields[config.descFieldId] = [{ type: IOpenSegmentType.Text, text: desc }];
      }

      // 4. 在工时表创建记录
      const newRecordId = await workTable.addRecord({ fields });

      // 5. 关联回主表：追加式写入，保留该任务已有的工时关联
      await appendLink(mainTable, taskId, config.linkFieldId, config.workTableId, newRecordId);

      result.success++;
    } catch (e) {
      result.failed++;
      result.errors.push(`${taskId}: ${(e as Error)?.message ?? '未知错误'}`);
      console.error('[createWorkLogs] 任务处理失败', taskId, e);
    }
  }

  return result;
}

/**
 * 解析单个任务的工时日期。
 * - input.date === 'sync'：读取主表计划结束日期字段
 * - input.date 为数字：用户手选的统一时间戳
 * - 其它：无日期
 */
async function resolveDate(
  mainTable: ITable,
  taskId: string,
  config: WorkLogConfig,
  date: WorkLogInput['date']
): Promise<number | null> {
  if (typeof date === 'number') return date;
  if (date === 'sync' && config.planEndDateFieldId) {
    const v = await mainTable.getCellValue(config.planEndDateFieldId, taskId);
    return typeof v === 'number' ? v : null;
  }
  return null;
}

/**
 * 往主表关联字段追加一个新记录 id，保留已有关联。
 * 关联字段写入需提供完整 IOpenLink 结构。
 */
async function appendLink(
  mainTable: ITable,
  taskId: string,
  linkFieldId: string,
  workTableId: string,
  newRecordId: string
): Promise<void> {
  const existing = (await mainTable.getCellValue(linkFieldId, taskId)) as IOpenLink | null;
  const existingIds = existing?.recordIds ?? [];
  const recordIds = [...existingIds, newRecordId];

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
      .map((seg) =>
        seg && typeof seg === 'object' && 'text' in seg ? (seg as { text?: string }).text ?? '' : ''
      )
      .join('');
  }
  if (typeof cell === 'object' && 'text' in cell) {
    return String((cell as { text?: unknown }).text ?? '');
  }
  return '';
}

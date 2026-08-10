import {
  bitable,
  FieldType,
  IOpenSegmentType,
  type ITable,
  type IOpenCellValue,
} from '@lark-base-open/js-sdk';
import type { StagedTaskItem } from '../types';
import { matchTableName } from './bitable';

/** 插件跨页面共享缓存表（同一多维表格文档内可见） */
export const CACHE_TABLE_NAME = '多维表格助手缓存';
const KEY_FIELD = '缓存键';
const VALUE_FIELD = '缓存内容';
export const STAGED_CACHE_KEY = 'staged-tasks';

type CachePayload = {
  version: 1;
  updatedAt: number;
  items: StagedTaskItem[];
};

function textCell(text: string): IOpenCellValue {
  return [{ type: IOpenSegmentType.Text, text }];
}

function cellToText(cell: IOpenCellValue): string {
  if (cell == null) return '';
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  if (Array.isArray(cell)) {
    return cell
      .map((seg) => {
        if (seg && typeof seg === 'object' && 'text' in seg) {
          return String((seg as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function findCacheTableMeta(): Promise<{ id: string; name: string } | null> {
  const list = await bitable.base.getTableMetaList();
  const hit = list.find((t) => matchTableName(t.name, CACHE_TABLE_NAME));
  return hit ? { id: hit.id, name: hit.name } : null;
}

async function ensureCacheTable(): Promise<ITable> {
  const existing = await findCacheTableMeta();
  if (existing) return bitable.base.getTable(existing.id);

  const created = await bitable.base.addTable({
    name: CACHE_TABLE_NAME,
    fields: [
      { type: FieldType.Text, name: KEY_FIELD },
      { type: FieldType.Text, name: VALUE_FIELD },
    ],
  });
  return bitable.base.getTable(created.tableId);
}

async function resolveFieldIds(table: ITable): Promise<{ keyId: string; valueId: string }> {
  const metas = await table.getFieldMetaList();
  let keyMeta = metas.find((m) => m.name === KEY_FIELD);
  let valueMeta = metas.find((m) => m.name === VALUE_FIELD);

  // 兼容：仅一张文本主字段时，用主字段存整包 JSON
  if (!keyMeta || !valueMeta) {
    const textFields = metas.filter((m) => m.type === FieldType.Text);
    if (!keyMeta && textFields[0]) keyMeta = textFields[0];
    if (!valueMeta && textFields[1]) valueMeta = textFields[1];
    if (!valueMeta && textFields[0]) valueMeta = textFields[0];
  }
  if (!keyMeta || !valueMeta) {
    throw new Error(`缓存表缺少「${KEY_FIELD}」或「${VALUE_FIELD}」字段`);
  }
  return { keyId: keyMeta.id, valueId: valueMeta.id };
}

async function findRecordIdByKey(
  table: ITable,
  keyId: string,
  cacheKey: string
): Promise<string | null> {
  const ids = await table.getRecordIdList();
  for (const recordId of ids) {
    const cell = await table.getCellValue(keyId, recordId);
    if (cellToText(cell).trim() === cacheKey) return recordId;
  }
  return null;
}

function parsePayload(raw: string): CachePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachePayload | StagedTaskItem[];
    if (Array.isArray(parsed)) {
      return { version: 1, updatedAt: 0, items: parsed };
    }
    if (parsed && Array.isArray(parsed.items)) {
      return {
        version: 1,
        updatedAt: Number(parsed.updatedAt) || 0,
        items: parsed.items,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 从多维表格缓存表读取已生成任务。
 * 表不存在时返回 null（表示尚未建立共享缓存）。
 */
export async function readStagedFromBase(): Promise<CachePayload | null> {
  try {
    const meta = await findCacheTableMeta();
    if (!meta) return null;
    const table = await bitable.base.getTable(meta.id);
    const { keyId, valueId } = await resolveFieldIds(table);
    const recordId = await findRecordIdByKey(table, keyId, STAGED_CACHE_KEY);
    if (!recordId) return { version: 1, updatedAt: 0, items: [] };

    // 两字段模式：value 字段存 JSON；单字段兜底：key 字段可能被写成整包
    const valueCell = await table.getCellValue(valueId, recordId);
    let payload = parsePayload(cellToText(valueCell));
    if (!payload && keyId === valueId) {
      payload = parsePayload(cellToText(await table.getCellValue(keyId, recordId)));
    }
    return payload ?? { version: 1, updatedAt: 0, items: [] };
  } catch (e) {
    console.warn('[stagedCache] 读取 Base 缓存失败', e);
    throw e;
  }
}

/**
 * 将已生成任务写入多维表格缓存表（跨页面 / 跨插件实例共享）。
 * 首次写入时自动建表。
 */
export async function writeStagedToBase(items: StagedTaskItem[]): Promise<void> {
  const table = await ensureCacheTable();
  const { keyId, valueId } = await resolveFieldIds(table);
  const payload: CachePayload = {
    version: 1,
    updatedAt: Date.now(),
    items,
  };
  const json = JSON.stringify(payload);
  const recordId = await findRecordIdByKey(table, keyId, STAGED_CACHE_KEY);

  if (keyId === valueId) {
    // 仅单文本字段：整包写入
    const fields = { [keyId]: textCell(json) };
    if (recordId) await table.setRecord(recordId, { fields });
    else await table.addRecord({ fields });
    return;
  }

  const fields = {
    [keyId]: textCell(STAGED_CACHE_KEY),
    [valueId]: textCell(json),
  };
  if (recordId) await table.setRecord(recordId, { fields });
  else await table.addRecord({ fields });
}

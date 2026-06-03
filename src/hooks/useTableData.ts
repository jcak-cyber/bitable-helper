import { useEffect, useState, useCallback, useRef } from 'react';
import { bitable, FieldType, type ITable } from '@lark-base-open/js-sdk';
import {
  getActiveTable,
  getLinkFields,
  getFieldsByType,
  getTableById,
  getVisibleRecords,
} from '../services/bitable';
import type { FieldOption, RecordRow } from '../types';

/** 主表关联字段（目标工时表 id 需异步解析，不在此携带） */
export type LinkField = FieldOption;

interface TableData {
  /** 主表（任务表） */
  mainTable: ITable | null;
  /** 主表的双向关联字段列表 */
  linkFields: LinkField[];
  /** 主表的日期字段（计划结束日期候选） */
  mainDateFields: FieldOption[];
  /** 当前视图可见记录 */
  records: RecordRow[];
  loading: boolean;
  refresh: () => void;
}

/**
 * 加载主表的关联字段、日期字段与可见记录，表切换时自动重载。
 * 传入 linkFieldId（来自已保存配置）时，记录会带上"是否已有工时"标识。
 * 工时表自身的字段映射在选定 linkField 后由 useWorkTableFields 二次加载。
 */
export function useTableData(linkFieldId?: string): TableData {
  const [mainTable, setMainTable] = useState<ITable | null>(null);
  const [linkFields, setLinkFields] = useState<LinkField[]>([]);
  const [mainDateFields, setMainDateFields] = useState<FieldOption[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 记住当前表 id，用于在 selectionChange 时判断是否真的换了表
  const currentTableIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getActiveTable();
      const [links, dates, rows] = await Promise.all([
        getLinkFields(t),
        getFieldsByType(t, [FieldType.DateTime]),
        getVisibleRecords(t, linkFieldId),
      ]);
      currentTableIdRef.current = t.id;
      setMainTable(t);
      setLinkFields(links);
      setMainDateFields(dates);
      setRecords(rows);
    } catch (e) {
      console.error('[useTableData] 加载失败', e);
    } finally {
      setLoading(false);
    }
  }, [linkFieldId]);

  useEffect(() => {
    load();
    // 仅在「切换表格」时重载；单纯切换选中行不触发，避免插件频繁刷新。
    // onSelectionChange 在选中行变化时也会触发，故需比对 tableId。
    const off = bitable.base.onSelectionChange((event) => {
      const tableId = event?.data?.tableId;
      if (tableId && tableId !== currentTableIdRef.current) {
        load();
      }
    });
    return () => {
      off();
    };
  }, [load]);

  return { mainTable, linkFields, mainDateFields, records, loading, refresh: load };
}

interface WorkTableFields {
  /** 工时表数字字段（时长候选） */
  hoursFields: FieldOption[];
  /** 工时表日期字段 */
  dateFields: FieldOption[];
  /** 工时表文本字段（描述候选） */
  textFields: FieldOption[];
  loading: boolean;
}

/**
 * 根据选定的工时表 id，加载其可映射字段（时长/日期/描述）。
 * workTableId 变化时重新加载。
 */
export function useWorkTableFields(workTableId: string): WorkTableFields {
  const [hoursFields, setHoursFields] = useState<FieldOption[]>([]);
  const [dateFields, setDateFields] = useState<FieldOption[]>([]);
  const [textFields, setTextFields] = useState<FieldOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workTableId) {
      setHoursFields([]);
      setDateFields([]);
      setTextFields([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const workTable = await getTableById(workTableId);
        const [nums, dates, texts] = await Promise.all([
          getFieldsByType(workTable, [FieldType.Number]),
          getFieldsByType(workTable, [FieldType.DateTime]),
          getFieldsByType(workTable, [FieldType.Text]),
        ]);
        if (cancelled) return;
        setHoursFields(nums);
        setDateFields(dates);
        setTextFields(texts);
      } catch (e) {
        console.error('[useWorkTableFields] 加载工时表字段失败', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workTableId]);

  return { hoursFields, dateFields, textFields, loading };
}

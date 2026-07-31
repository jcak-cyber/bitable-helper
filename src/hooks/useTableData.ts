import { useEffect, useState, useCallback, useRef } from 'react';
import { bitable, FieldType, type ITable } from '@lark-base-open/js-sdk';
import {
  getActiveTable,
  getLinkFields,
  getFieldsByType,
  getTableById,
  getVisibleRecords,
  isTaskManagementTable,
} from '../services/bitable';
import type { FieldOption, RecordRow } from '../types';

/** 主表关联字段（目标工时表 id 需异步解析，不在此携带） */
export type LinkField = FieldOption;

interface TableData {
  /** 主表（任务表） */
  mainTable: ITable | null;
  /** 当前激活表名 */
  tableName: string;
  /** 当前是否为任务管理表（表名或字段结构判定） */
  isTaskTable: boolean;
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
  const [tableName, setTableName] = useState('');
  const [isTaskTable, setIsTaskTable] = useState(false);
  const [linkFields, setLinkFields] = useState<LinkField[]>([]);
  const [mainDateFields, setMainDateFields] = useState<FieldOption[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentTableIdRef = useRef<string | null>(null);
  /** 防止快速切表时旧请求回写覆盖新状态 */
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const t = await getActiveTable();
      const [name, isTask, links, dates, rows] = await Promise.all([
        t.getName(),
        isTaskManagementTable(t),
        getLinkFields(t),
        getFieldsByType(t, [FieldType.DateTime]),
        getVisibleRecords(t, linkFieldId),
      ]);
      // 过期请求直接丢弃
      if (seq !== loadSeqRef.current) return;

      currentTableIdRef.current = t.id;
      setMainTable(t);
      setTableName(name);
      setIsTaskTable(isTask);
      setLinkFields(links);
      setMainDateFields(dates);
      setRecords(rows);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      console.error('[useTableData] 加载失败', e);
      setTableName('');
      setIsTaskTable(false);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [linkFieldId]);

  useEffect(() => {
    load();
    // 以 getActiveTable 为准检测换表（不依赖 event.data.tableId，避免漏刷新）
    const off = bitable.base.onSelectionChange(() => {
      void (async () => {
        try {
          const t = await getActiveTable();
          if (t.id !== currentTableIdRef.current) {
            await load();
            return;
          }
          // 同表也可能需校正判定（防止竞态后状态错误）
          const [name, isTask] = await Promise.all([t.getName(), isTaskManagementTable(t)]);
          setTableName(name);
          setIsTaskTable(isTask);
        } catch (e) {
          console.error('[useTableData] 选区变更处理失败', e);
          // 兜底强制重载
          void load();
        }
      })();
    });
    return () => {
      off();
    };
  }, [load]);

  return {
    mainTable,
    tableName,
    isTaskTable,
    linkFields,
    mainDateFields,
    records,
    loading,
    refresh: load,
  };
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

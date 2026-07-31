import { useCallback, useEffect, useRef, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import {
  getActiveTable,
  getScheduleRecords,
  matchTableName,
  parseExecutorFromViewName,
  SCHEDULE_TABLE_NAME,
} from '../services/bitable';
import type { ScheduleRow } from '../types';

export interface ScheduleData {
  /** 当前是否位于「人员排期」表 */
  isScheduleTable: boolean;
  /** 当前激活表名（用于提示） */
  tableName: string;
  /** 当前个人排期视图名 */
  viewName: string;
  schedules: ScheduleRow[];
  loading: boolean;
  refresh: () => void;
}

/**
 * 任务生成：仅在「人员排期」表加载当前选中个人排期视图的可见排期；
 * 切换表或视图时自动重载。
 */
export function useScheduleData(): ScheduleData {
  const [isScheduleTable, setIsScheduleTable] = useState(false);
  const [tableName, setTableName] = useState('');
  const [viewName, setViewName] = useState('');
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentTableIdRef = useRef<string | null>(null);
  const currentViewIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const table = await getActiveTable();
      const name = await table.getName();
      const view = await table.getActiveView();
      const activeViewName = await view.getName();

      currentTableIdRef.current = table.id;
      currentViewIdRef.current = view.id;
      setTableName(name);
      setViewName(activeViewName);

      const matched = matchTableName(name, SCHEDULE_TABLE_NAME);
      setIsScheduleTable(matched);
      if (!matched) {
        setSchedules([]);
        return;
      }
      const rows = await getScheduleRecords(table, parseExecutorFromViewName(activeViewName));
      setSchedules(rows);
    } catch (e) {
      console.error('[useScheduleData] 加载失败', e);
      setIsScheduleTable(false);
      setSchedules([]);
      setViewName('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // event.data 可能缺 tableId/viewId，统一用 getSelection 判断是否换表/换视图
    const off = bitable.base.onSelectionChange(() => {
      void (async () => {
        try {
          const sel = await bitable.base.getSelection();
          const tableId = sel?.tableId ?? null;
          const viewId = sel?.viewId ?? null;
          const tableChanged = Boolean(tableId && tableId !== currentTableIdRef.current);
          const viewChanged = Boolean(viewId && viewId !== currentViewIdRef.current);
          if (tableChanged || viewChanged) {
            load();
          }
        } catch (e) {
          console.error('[useScheduleData] 读取选区失败', e);
        }
      })();
    });
    return () => {
      off();
    };
  }, [load]);

  return { isScheduleTable, tableName, viewName, schedules, loading, refresh: load };
}

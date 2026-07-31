import { useCallback, useEffect, useState } from 'react';
import type { GeneratedTaskPreview, StagedTaskItem } from '../types';

const STORAGE_KEY = 'bitable-helper:staged-tasks';
/** 清理旧版排期暂存 key，避免残留 */
const LEGACY_KEY = 'bitable-helper:staged-schedules';

/** 生成时间优先，其次任务日期，均为倒序 */
function sortByTimeDesc(rows: StagedTaskItem[]): StagedTaskItem[] {
  return [...rows].sort((a, b) => {
    const stagedDiff = (b.stagedAt || 0) - (a.stagedAt || 0);
    if (stagedDiff !== 0) return stagedDiff;
    return (b.dateTs || 0) - (a.dateTs || 0);
  });
}

/** 按任务计划日期倒序（新生成批次内部用） */
function sortTasksByDateDesc(tasks: GeneratedTaskPreview[]): GeneratedTaskPreview[] {
  return [...tasks].sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

function readStaged(): StagedTaskItem[] {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StagedTaskItem[];
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map((row, index) => ({
      ...row,
      stagedAt: row.stagedAt || row.dateTs || Date.now() - index,
    }));
    return sortByTimeDesc(normalized);
  } catch {
    return [];
  }
}

function writeStaged(rows: StagedTaskItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function makeStagedId(scheduleRecordId: string, task: GeneratedTaskPreview): string {
  return `${scheduleRecordId}:${task.dayIndex}:${task.planStartDate}`;
}

/**
 * 任务预览「生成」后的暂存列表（localStorage）。
 * 切表 / 切视图不销毁，仅手动删除。
 * 新生成任务按日期倒序插入到列表最前。
 */
export function useStagedTasks() {
  const [staged, setStaged] = useState<StagedTaskItem[]>(() => readStaged());

  useEffect(() => {
    writeStaged(staged);
  }, [staged]);

  /**
   * 将预览列表合并进暂存：
   * 1. 本批先按任务日期倒序
   * 2. 赋予最新 stagedAt，插到整体列表最前
   * 3. 同 stagedId 覆盖更新
   */
  const stageTasks = useCallback((scheduleRecordId: string, tasks: GeneratedTaskPreview[]) => {
    if (tasks.length === 0) return 0;
    const now = Date.now();
    const ordered = sortTasksByDateDesc(tasks);

    setStaged((prev) => {
      const map = new Map(prev.map((r) => [r.stagedId, r]));
      ordered.forEach((task, index) => {
        const stagedId = makeStagedId(scheduleRecordId, task);
        map.set(stagedId, {
          ...task,
          stagedId,
          scheduleRecordId,
          // 同批内日期越新 stagedAt 越大，保证倒序后仍靠前
          stagedAt: now - index,
        });
      });
      return sortByTimeDesc(Array.from(map.values()));
    });

    return ordered.length;
  }, []);

  const removeOne = useCallback((stagedId: string) => {
    setStaged((prev) => prev.filter((r) => r.stagedId !== stagedId));
  }, []);

  const removeMany = useCallback((stagedIds: string[]) => {
    if (stagedIds.length === 0) return;
    const set = new Set(stagedIds);
    setStaged((prev) => prev.filter((r) => !set.has(r.stagedId)));
  }, []);

  /** 更新单条暂存任务字段（stagedId 保持不变） */
  const updateOne = useCallback((stagedId: string, patch: Partial<StagedTaskItem>) => {
    setStaged((prev) =>
      sortByTimeDesc(
        prev.map((row) => {
          if (row.stagedId !== stagedId) return row;
          const next = { ...row, ...patch };
          // 计划开始变更时同步排序用时间戳
          if (patch.planStartDate) {
            const ts = Date.parse(patch.planStartDate);
            if (!Number.isNaN(ts)) {
              next.dateTs = ts;
              next.date = patch.planStartDate;
            }
          }
          return next;
        })
      )
    );
  }, []);

  const clearAll = useCallback(() => {
    setStaged([]);
  }, []);

  return { staged, stageTasks, removeOne, removeMany, updateOne, clearAll };
}

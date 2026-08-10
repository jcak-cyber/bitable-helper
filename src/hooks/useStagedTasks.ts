import { useCallback, useEffect, useRef, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import type { GeneratedTaskPreview, StagedTaskItem } from '../types';
import { DEFAULT_TASK_ROLE, isTaskRole } from '../constants/taskRole';
import { buildTaskNameWithRole } from '../services/bitable';
import { readStagedFromBase, writeStagedToBase } from '../services/stagedCache';

/** bridge 辅助 key（部分环境可用） */
const BRIDGE_KEY = 'bitable-helper:staged-tasks';
/** localStorage 兜底（同源同分区内） */
const STORAGE_KEY = BRIDGE_KEY;
const LEGACY_KEY = 'bitable-helper:staged-schedules';

function sortByTimeDesc(rows: StagedTaskItem[]): StagedTaskItem[] {
  return [...rows].sort((a, b) => {
    const stagedDiff = (b.stagedAt || 0) - (a.stagedAt || 0);
    if (stagedDiff !== 0) return stagedDiff;
    return (b.dateTs || 0) - (a.dateTs || 0);
  });
}

function sortTasksByDateDesc(tasks: GeneratedTaskPreview[]): GeneratedTaskPreview[] {
  return [...tasks].sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

function normalizeStagedRow(row: StagedTaskItem, index: number): StagedTaskItem {
  const role = isTaskRole(row.role) ? row.role : DEFAULT_TASK_ROLE;
  return {
    ...row,
    role,
    taskName: buildTaskNameWithRole(row.taskName || '', role),
    stagedAt: row.stagedAt || row.dateTs || Date.now() - index,
  };
}

function parseStaged(raw: unknown): StagedTaskItem[] {
  if (!Array.isArray(raw)) return [];
  return sortByTimeDesc((raw as StagedTaskItem[]).map(normalizeStagedRow));
}

function readLocal(): StagedTaskItem[] {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parseStaged(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeLocal(rows: StagedTaskItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

async function readBridge(): Promise<StagedTaskItem[] | null> {
  try {
    const data = await bitable.bridge.getData<unknown>(BRIDGE_KEY);
    if (data == null) return null;
    if (typeof data === 'string') {
      try {
        return parseStaged(JSON.parse(data));
      } catch {
        return [];
      }
    }
    return parseStaged(data);
  } catch {
    return null;
  }
}

async function writeBridge(rows: StagedTaskItem[]): Promise<void> {
  try {
    // 字符串更稳妥，部分宿主对复杂对象序列化不稳定
    await bitable.bridge.setData(BRIDGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

function makeStagedId(scheduleRecordId: string, task: GeneratedTaskPreview): string {
  return `${scheduleRecordId}:${task.dayIndex}:${task.planStartDate}`;
}

/** 多源取「更新更晚 / 条数更多」的一份 */
function pickBest(
  candidates: Array<{ items: StagedTaskItem[]; updatedAt: number; source: string }>
): { items: StagedTaskItem[]; source: string } {
  let best = candidates[0] ?? { items: [], updatedAt: 0, source: 'none' };
  for (const c of candidates) {
    if (c.updatedAt > best.updatedAt) best = c;
    else if (c.updatedAt === best.updatedAt && c.items.length > best.items.length) best = c;
  }
  return { items: best.items, source: best.source };
}

/**
 * 已生成任务暂存。
 * 主存：多维表格「多维表格助手缓存」表（跨页面可靠）。
 * 辅存：bridge / localStorage。
 */
export function useStagedTasks() {
  const [staged, setStaged] = useState<StagedTaskItem[]>([]);
  const [ready, setReady] = useState(false);
  const userTouchedRef = useRef(false);
  const persistSeq = useRef(0);

  const touch = useCallback(() => {
    userTouchedRef.current = true;
  }, []);

  const persistAll = useCallback(async (rows: StagedTaskItem[], allowEmpty: boolean) => {
    writeLocal(rows);
    void writeBridge(rows);
    // 禁止「空加载」把共享缓存清空；仅用户清空或确有数据时写 Base
    if (!allowEmpty && rows.length === 0) return;
    const seq = ++persistSeq.current;
    try {
      await writeStagedToBase(rows);
    } catch (e) {
      console.warn('[useStagedTasks] 写入 Base 缓存失败', e);
    }
    return seq;
  }, []);

  // 启动：Base > bridge > local
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const candidates: Array<{ items: StagedTaskItem[]; updatedAt: number; source: string }> = [];

      try {
        const base = await readStagedFromBase();
        if (base) {
          candidates.push({
            items: parseStaged(base.items),
            updatedAt: base.updatedAt || 0,
            source: 'base',
          });
        }
      } catch (e) {
        console.warn('[useStagedTasks] 读取 Base 缓存失败', e);
      }

      const bridge = await readBridge();
      if (bridge != null) {
        candidates.push({ items: bridge, updatedAt: 0, source: 'bridge' });
      }

      const local = readLocal();
      candidates.push({ items: local, updatedAt: 0, source: 'local' });

      if (cancelled) return;

      if (!userTouchedRef.current) {
        const { items } = pickBest(candidates);
        setStaged(items);
        // 内存有数据但 Base 还没有时，补写一次共享缓存
        if (items.length > 0) {
          void persistAll(items, true);
        }
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [persistAll]);

  // 用户改动后同步
  useEffect(() => {
    if (!ready || !userTouchedRef.current) return;
    void persistAll(staged, true);
  }, [staged, ready, persistAll]);

  const stageTasks = useCallback(
    (scheduleRecordId: string, tasks: GeneratedTaskPreview[]) => {
      if (tasks.length === 0) return 0;
      const now = Date.now();
      const ordered = sortTasksByDateDesc(tasks);
      touch();

      setStaged((prev) => {
        const map = new Map(prev.map((r) => [r.stagedId, r]));
        ordered.forEach((task, index) => {
          const stagedId = makeStagedId(scheduleRecordId, task);
          map.set(stagedId, {
            ...task,
            stagedId,
            scheduleRecordId,
            stagedAt: now - index,
          });
        });
        return sortByTimeDesc(Array.from(map.values()));
      });

      return ordered.length;
    },
    [touch]
  );

  const removeOne = useCallback(
    (stagedId: string) => {
      touch();
      setStaged((prev) => prev.filter((r) => r.stagedId !== stagedId));
    },
    [touch]
  );

  const removeMany = useCallback(
    (stagedIds: string[]) => {
      if (stagedIds.length === 0) return;
      touch();
      const set = new Set(stagedIds);
      setStaged((prev) => prev.filter((r) => !set.has(r.stagedId)));
    },
    [touch]
  );

  const updateOne = useCallback(
    (stagedId: string, patch: Partial<StagedTaskItem>) => {
      touch();
      setStaged((prev) =>
        sortByTimeDesc(
          prev.map((row) => {
            if (row.stagedId !== stagedId) return row;
            const next = { ...row, ...patch };
            if (patch.role && patch.taskName == null) {
              next.taskName = buildTaskNameWithRole(row.taskName, patch.role);
            }
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
    },
    [touch]
  );

  const clearAll = useCallback(() => {
    touch();
    setStaged([]);
  }, [touch]);

  /** 优先从 Base 缓存表拉取；若当前页有数据则先推送再拉 */
  const reloadFromCache = useCallback(async () => {
    // 当前页若已有任务，先推到 Base，避免「有数据页」未落盘
    if (staged.length > 0) {
      try {
        await writeStagedToBase(staged);
        writeLocal(staged);
        void writeBridge(staged);
      } catch (e) {
        console.warn('[useStagedTasks] 刷新前推送失败', e);
      }
    }

    try {
      const base = await readStagedFromBase();
      if (base) {
        const items = parseStaged(base.items);
        setStaged(items);
        writeLocal(items);
        void writeBridge(items);
        return { count: items.length, source: 'base' as const };
      }
    } catch (e) {
      console.warn('[useStagedTasks] 刷新读取 Base 失败', e);
      return {
        count: staged.length,
        source: 'error' as const,
        error: (e as Error)?.message ?? '读取文档缓存失败',
      };
    }

    const bridge = await readBridge();
    if (bridge != null && bridge.length > 0) {
      setStaged(bridge);
      writeLocal(bridge);
      return { count: bridge.length, source: 'bridge' as const };
    }

    const local = readLocal();
    setStaged(local);
    return { count: local.length, source: 'local' as const };
  }, [staged]);

  return {
    staged,
    ready,
    stageTasks,
    removeOne,
    removeMany,
    updateOne,
    clearAll,
    reloadFromCache,
  };
}

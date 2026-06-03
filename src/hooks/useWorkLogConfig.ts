import { useState, useCallback } from 'react';
import type { WorkLogConfig } from '../types';

const STORAGE_KEY = 'bitable-helper:worklog-config';

/** 空配置 */
export const EMPTY_CONFIG: WorkLogConfig = {
  linkFieldId: '',
  workTableId: '',
  hoursFieldId: '',
  dateFieldId: '',
  descFieldId: '',
  planEndDateFieldId: '',
};

/**
 * 工时字段映射配置的持久化。
 * 按主表 id 分别存储，不同任务表可以有各自的配置。
 */
export function useWorkLogConfig(mainTableId: string | undefined) {
  const storageKey = mainTableId ? `${STORAGE_KEY}:${mainTableId}` : '';

  const [config, setConfig] = useState<WorkLogConfig | null>(() => {
    if (!storageKey) return null;
    return readConfig(storageKey);
  });

  const save = useCallback(
    (cfg: WorkLogConfig) => {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(cfg));
      setConfig(cfg);
    },
    [storageKey]
  );

  const clear = useCallback(() => {
    if (!storageKey) return;
    localStorage.removeItem(storageKey);
    setConfig(null);
  }, [storageKey]);

  /** 主表切换后重新读取对应配置 */
  const reload = useCallback(() => {
    setConfig(storageKey ? readConfig(storageKey) : null);
  }, [storageKey]);

  return { config, save, clear, reload };
}

function readConfig(key: string): WorkLogConfig | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as WorkLogConfig) : null;
  } catch {
    return null;
  }
}

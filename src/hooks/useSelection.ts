import { useEffect, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';

/**
 * 跟踪当前选中的记录 id（单行模式使用）。
 * SDK 原生选区仅返回单条 recordId，批量场景需另行勾选。
 */
export function useSelection(): string | null {
  const [recordId, setRecordId] = useState<string | null>(null);

  useEffect(() => {
    // 初始化读取一次当前选区
    bitable.base.getSelection().then((sel) => {
      setRecordId(sel.recordId ?? null);
    });

    const off = bitable.base.onSelectionChange((event) => {
      setRecordId(event.data.recordId ?? null);
    });
    return () => {
      off();
    };
  }, []);

  return recordId;
}

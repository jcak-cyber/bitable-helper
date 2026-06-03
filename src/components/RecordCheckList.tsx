import { Checkbox, Typography, Tag } from 'antd';
import type { RecordRow } from '../types';

interface Props {
  records: RecordRow[];
  /** 已勾选的 recordId 集合 */
  selected: Set<string>;
  onToggle: (recordId: string) => void;
  onToggleAll: (checked: boolean) => void;
}

/** 批量模式下的记录勾选列表，基于当前视图可见记录（antd Checkbox） */
export function RecordCheckList({ records, selected, onToggle, onToggleAll }: Props) {
  if (records.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        当前视图没有可见记录。
      </Typography.Text>
    );
  }

  const allChecked = selected.size === records.length;
  const indeterminate = selected.size > 0 && selected.size < records.length;

  return (
    <div className="record-list">
      <Checkbox
        className="record-select-all"
        checked={allChecked}
        indeterminate={indeterminate}
        onChange={(e) => onToggleAll(e.target.checked)}
      >
        全选（共 {records.length} 行，已选 {selected.size}）
      </Checkbox>
      <div className="record-scroll">
        {records.map((r) => (
          <Checkbox
            key={r.recordId}
            className="record-item"
            checked={selected.has(r.recordId)}
            onChange={() => onToggle(r.recordId)}
          >
            <span className="record-title">{r.title}</span>
            {r.hasWorkLog && (
              <Tag color="green" style={{ marginLeft: 4 }}>
                已有工时
              </Tag>
            )}
          </Checkbox>
        ))}
      </div>
    </div>
  );
}

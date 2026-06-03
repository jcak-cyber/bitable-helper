import { Select, Typography } from 'antd';
import type { FieldOption } from '../types';

interface Props {
  label: string;
  fields: FieldOption[];
  value: string;
  onChange: (fieldId: string) => void;
  /** 是否必填，必填项为空时下拉标红提示 */
  required?: boolean;
  /** 允许"不映射"（可选字段用），值可清空 */
  allowEmpty?: boolean;
  emptyHint?: string;
}

/**
 * 通用字段下拉选择器（基于 antd Select）。
 * 复用于关联字段、时长、日期、描述等所有「选一个字段」的场景（DRY）。
 */
export function FieldSelect({
  label,
  fields,
  value,
  onChange,
  required = false,
  allowEmpty = false,
  emptyHint,
}: Props) {
  return (
    <div className="field-select">
      <label className="field-label">
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {fields.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {emptyHint ?? '无可选字段'}
        </Typography.Text>
      ) : (
        <Select
          style={{ width: '100%' }}
          placeholder={allowEmpty ? '不填写' : '请选择'}
          status={required && !value ? 'error' : undefined}
          value={value || undefined}
          onChange={(v) => onChange(v ?? '')}
          allowClear={allowEmpty}
          options={fields.map((f) => ({ label: f.name, value: f.id }))}
        />
      )}
    </div>
  );
}

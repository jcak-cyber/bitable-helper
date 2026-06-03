import { useState } from 'react';
import { Button, InputNumber, Radio, DatePicker, Input, Space, Checkbox } from 'antd';
import type { Dayjs } from 'dayjs';

interface Props {
  /** 工时表是否有日期字段（决定是否显示日期区） */
  hasDateField: boolean;
  /** 主表是否配置了计划结束日期（决定能否"同步"） */
  canSync: boolean;
  /** 是否禁用（操作进行中 / 无选中目标） */
  disabled: boolean;
  /** 提交按钮文案（单个任务"创建工时" / 批量"批量创建工时"） */
  submitText: string;
  /** 提交：把工时数据交给上层执行批量创建 */
  onSubmit: (data: {
    hours: number;
    desc: string;
    date: 'sync' | number | null;
    syncTaskName: boolean;
  }) => void;
}

/** 常用工时预设（小时） */
const PRESETS = [0.5, 1, 2, 4, 8];

/**
 * 工时录入表单：时长（快捷按钮 + 自定义）、花费描述、日期来源。
 * 录入项关系紧密，合并为单一表单组件，提交时一次性回传。
 */
export function WorkLogForm({ hasDateField, canSync, disabled, submitText, onSubmit }: Props) {
  const [hours, setHours] = useState<number | null>(null);
  const [customHours, setCustomHours] = useState<number | null>(null);
  const [desc, setDesc] = useState('');
  // 是否用任务名称作为描述（勾选后禁用并忽略手填描述）
  const [syncTaskName, setSyncTaskName] = useState(false);
  // 日期模式：sync = 同步计划结束日期；manual = 手选
  const [dateMode, setDateMode] = useState<'sync' | 'manual'>(canSync ? 'sync' : 'manual');
  const [manualDate, setManualDate] = useState<Dayjs | null>(null);

  // 当前生效的时长：自定义优先，其次快捷按钮选中值
  const effectiveHours = customHours != null ? customHours : hours;

  const resolveDate = (): 'sync' | number | null => {
    if (!hasDateField) return null;
    if (dateMode === 'sync' && canSync) return 'sync';
    return manualDate ? manualDate.valueOf() : null;
  };

  const canSubmit =
    !disabled && effectiveHours != null && Number.isFinite(effectiveHours) && effectiveHours > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      hours: effectiveHours as number,
      desc: desc.trim(),
      date: resolveDate(),
      syncTaskName,
    });
  };

  return (
    <div className="worklog-form">
      {/* 时长 */}
      <div className="form-row">
        <span className="form-label">
          时长<span className="req"> *</span>
        </span>
        <Space wrap size={6}>
          {PRESETS.map((h) => (
            <Button
              key={h}
              size="small"
              type={hours === h && customHours == null ? 'primary' : 'default'}
              disabled={disabled}
              onClick={() => {
                setHours(h);
                setCustomHours(null);
              }}
            >
              {h}h
            </Button>
          ))}
          <InputNumber
            size="small"
            min={0}
            step={0.5}
            placeholder="自定义"
            style={{ width: 90 }}
            value={customHours}
            disabled={disabled}
            onChange={(v) => setCustomHours(v)}
          />
        </Space>
      </div>

      {/* 日期 */}
      {hasDateField && (
        <div className="form-row">
          <span className="form-label">日期</span>
          <Radio.Group
            value={dateMode}
            disabled={disabled}
            onChange={(e) => setDateMode(e.target.value)}
          >
            <Space direction="vertical" size={4}>
              {canSync && <Radio value="sync">同步计划结束日期</Radio>}
              <Radio value="manual">指定日期</Radio>
            </Space>
          </Radio.Group>
          {dateMode === 'manual' && (
            <DatePicker
              style={{ width: '100%', marginTop: 6 }}
              value={manualDate}
              disabled={disabled}
              onChange={(d) => setManualDate(d)}
            />
          )}
        </div>
      )}

      {/* 花费描述 */}
      <div className="form-row">
        <div className="form-label-row">
          <span className="form-label">花费描述</span>
          <Checkbox
            checked={syncTaskName}
            disabled={disabled}
            onChange={(e) => setSyncTaskName(e.target.checked)}
          >
            同步任务名称
          </Checkbox>
        </div>
        <Input.TextArea
          rows={2}
          placeholder={syncTaskName ? '将使用任务名称作为描述' : '选填，例如：完成接口联调'}
          value={syncTaskName ? '' : desc}
          disabled={disabled || syncTaskName}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>

      <Button type="primary" block disabled={!canSubmit} onClick={submit}>
        {submitText}
      </Button>
    </div>
  );
}

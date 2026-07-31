import { Typography, Button, Space } from 'antd';
import { FieldSelect } from './FieldSelect';
import type { LinkField } from '../hooks/useTableData';
import type { FieldOption, WorkLogConfig } from '../types';

interface Props {
  /** 主表关联字段候选 */
  linkFields: LinkField[];
  /** 主表日期字段候选（计划结束日期） */
  mainDateFields: FieldOption[];
  /** 工时表字段候选 */
  workHoursFields: FieldOption[];
  workDateFields: FieldOption[];
  workTextFields: FieldOption[];
  /** 当前草稿配置 */
  draft: WorkLogConfig;
  /** 任一字段变更 */
  onChange: (patch: Partial<WorkLogConfig>) => void;
  /** 选定关联字段时，需同步解析目标工时表 id */
  onPickLink: (linkFieldId: string) => void;
  onSave: () => void;
  /** 配置是否完整可保存 */
  canSave: boolean;
  /** 是否已有保存过的配置（决定显示"取消"按钮） */
  hasSaved: boolean;
  onCancel: () => void;
}

/**
 * 字段映射配置面板。
 * 首次使用 / 点击"重新配置"时显示，引导用户把工时表字段对应到用途。
 */
export function ConfigPanel({
  linkFields,
  mainDateFields,
  workHoursFields,
  workDateFields,
  workTextFields,
  draft,
  onChange,
  onPickLink,
  onSave,
  canSave,
  hasSaved,
  onCancel,
}: Props) {

  return (
    <div className="config-panel">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        字段配置
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        指定任务表与工时表之间的字段对应关系，配置后会被记住。
      </Typography.Paragraph>

      <FieldSelect
        label="关联字段（指向工时表）"
        fields={linkFields}
        value={draft.linkFieldId}
        onChange={onPickLink}
        required
        emptyHint="当前表没有指向其它表的双向关联字段"
      />

      {draft.workTableId && (
        <>
          <FieldSelect
            label="工时表 · 时长字段"
            fields={workHoursFields}
            value={draft.hoursFieldId}
            onChange={(id) => onChange({ hoursFieldId: id })}
            required
            emptyHint="工时表没有数字字段"
          />
          <FieldSelect
            label="工时表 · 日期字段"
            fields={workDateFields}
            value={draft.dateFieldId}
            onChange={(id) => onChange({ dateFieldId: id })}
            allowEmpty
            emptyHint="工时表没有日期字段（可不填）"
          />
          <FieldSelect
            label="工时表 · 描述字段"
            fields={workTextFields}
            value={draft.descFieldId}
            onChange={(id) => onChange({ descFieldId: id })}
            allowEmpty
            emptyHint="工时表没有文本字段（可不填）"
          />
          <FieldSelect
            label="任务表 · 计划开始日期"
            fields={mainDateFields}
            value={draft.planStartDateFieldId}
            onChange={(id) => onChange({ planStartDateFieldId: id })}
            allowEmpty
            emptyHint="任务表没有日期字段（可不填）"
          />
          <FieldSelect
            label="任务表 · 计划结束日期"
            fields={mainDateFields}
            value={draft.planEndDateFieldId}
            onChange={(id) => onChange({ planEndDateFieldId: id })}
            allowEmpty
            emptyHint="任务表没有日期字段（可不填）"
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            配置开始与结束日期后，同步计划日期将按跨度逐日生成多条工时（如跨 3 天则生成 3 条）。
          </Typography.Paragraph>
        </>
      )}

      <div className="config-actions">
        <Space>
          {hasSaved && <Button onClick={onCancel}>取消</Button>}
          <Button type="primary" disabled={!canSave} onClick={onSave}>
            保存配置
          </Button>
        </Space>
      </div>
    </div>
  );
}

import { useState, useMemo, useEffect } from 'react';
import { Segmented, Spin, Button, Typography } from 'antd';
import { useTableData, useWorkTableFields } from './hooks/useTableData';
import { useSelection } from './hooks/useSelection';
import { useWorkLogConfig, EMPTY_CONFIG } from './hooks/useWorkLogConfig';
import { RecordCheckList } from './components/RecordCheckList';
import { WorkLogForm } from './components/WorkLogForm';
import { ConfigPanel } from './components/ConfigPanel';
import { createWorkLogs, resolveLinkTargetTableId, toast } from './services/bitable';
import type { WorkLogConfig } from './types';
import './App.less';

type Mode = 'single' | 'batch';

export default function App() {
  // 先拿到主表 id（不带关联字段），用于读取该表的持久化配置
  const [mainTableId, setMainTableId] = useState<string>();
  const { config, save, reload } = useWorkLogConfig(mainTableId);

  // 配置就绪后，把关联字段 id 透传给数据加载，使记录带上"是否已有工时"标识
  const { mainTable, linkFields, mainDateFields, records, loading, refresh } = useTableData(
    config?.linkFieldId
  );
  const selectedRecordId = useSelection();

  // 同步主表 id（供配置 key 使用）
  useEffect(() => {
    setMainTableId(mainTable?.id);
  }, [mainTable?.id]);

  // 主表切换时重新读取对应配置
  useEffect(() => {
    reload();
  }, [mainTableId, reload]);

  // 配置编辑态：无配置时强制进入；有配置时可手动开启
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkLogConfig>(EMPTY_CONFIG);

  // 是否处于配置展示态：无配置时强制配置，或用户主动点了"重新配置"
  const showingConfig = !config || editing;

  // 工时表字段的来源 id：配置态用草稿值，使用态用已存配置值。
  // 关键：配置面板显示时（含首次无 config）必须取 draft，否则选了关联字段也读不到工时表。
  const activeWorkTableId = showingConfig ? draft.workTableId : config?.workTableId ?? '';
  const { hoursFields, dateFields, textFields } = useWorkTableFields(activeWorkTableId);

  const [mode, setMode] = useState<Mode>('single');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // 本次操作的目标任务记录集合（单一数据来源）
  const targetIds = useMemo<string[]>(() => {
    if (mode === 'single') return selectedRecordId ? [selectedRecordId] : [];
    return Array.from(checked);
  }, [mode, selectedRecordId, checked]);

  // 当前选中任务的标题（单个任务模式下回显），从已加载记录中查找，复用现成数据
  const selectedTitle = useMemo<string>(() => {
    if (!selectedRecordId) return '';
    return records.find((r) => r.recordId === selectedRecordId)?.title ?? '';
  }, [selectedRecordId, records]);

  // —— 配置面板交互 ——
  const startConfig = () => {
    setDraft(config ?? EMPTY_CONFIG);
    setEditing(true);
  };

  const patchDraft = (patch: Partial<WorkLogConfig>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  // 选定关联字段时，异步解析其目标工时表 id，并重置工时表相关映射。
  // meta 不含 property，必须通过 field.getTableId() 获取目标表。
  const pickLink = async (linkFieldId: string) => {
    // 先更新关联字段并清空旧映射，给出即时反馈
    setDraft((prev) => ({
      ...prev,
      linkFieldId,
      workTableId: '',
      hoursFieldId: '',
      dateFieldId: '',
      descFieldId: '',
    }));
    if (!mainTable || !linkFieldId) return;
    try {
      const workTableId = await resolveLinkTargetTableId(mainTable, linkFieldId);
      setDraft((prev) =>
        // 防止用户在解析期间又切换了字段：仅当仍是同一字段时才写入
        prev.linkFieldId === linkFieldId ? { ...prev, workTableId } : prev
      );
    } catch (e) {
      console.error('[pickLink] 解析工时表失败', e);
      toast('error', '无法解析该关联字段指向的表');
    }
  };

  // 时长字段必填，且必须选了关联字段+工时表
  const canSaveConfig = Boolean(draft.linkFieldId && draft.workTableId && draft.hoursFieldId);

  const saveConfig = () => {
    save(draft);
    setEditing(false);
  };

  // —— 勾选交互 ——
  const toggleOne = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const toggleAll = (all: boolean) =>
    setChecked(all ? new Set(records.map((r) => r.recordId)) : new Set());

  // —— 批量创建工时 ——
  const handleSubmit = async (data: {
    hours: number;
    desc: string;
    date: 'sync' | number | null;
    syncTaskName: boolean;
  }) => {
    if (!mainTable || !config) return;
    if (targetIds.length === 0) return toast('error', '请先选择要填写工时的任务');

    setBusy(true);
    const result = await createWorkLogs(mainTable, targetIds, config, data);
    setBusy(false);

    if (result.failed > 0) {
      toast('error', `成功 ${result.success} 条，失败 ${result.failed} 条`);
    } else {
      toast('success', `已为 ${result.success} 个任务创建工时记录`);
    }
    refresh();
  };

  if (loading) {
    return (
      <div className="app loading">
        <Spin />
      </div>
    );
  }

  // 配置缺失或正在编辑：显示配置面板
  if (showingConfig) {
    return (
      <div className="app">
        <Typography.Title level={4}>工时助手</Typography.Title>
        <ConfigPanel
          linkFields={linkFields}
          mainDateFields={mainDateFields}
          workHoursFields={hoursFields}
          workDateFields={dateFields}
          workTextFields={textFields}
          draft={draft}
          onChange={patchDraft}
          onPickLink={pickLink}
          onSave={saveConfig}
          canSave={canSaveConfig}
          hasSaved={Boolean(config)}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          工时助手
        </Typography.Title>
        <Button type="link" size="small" onClick={startConfig}>
          重新配置
        </Button>
      </div>

      {/* 模式切换 */}
      <Segmented<Mode>
        block
        value={mode}
        onChange={setMode}
        options={[
          { label: '单个任务', value: 'single' },
          { label: '批量勾选', value: 'batch' },
        ]}
        style={{ marginBottom: 12 }}
      />

      {mode === 'single' ? (
        selectedRecordId ? (
          <div className="selected-task">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              将为以下任务创建工时：
            </Typography.Text>
            <Typography.Text strong ellipsis style={{ display: 'block' }}>
              {selectedTitle || '(未命名任务)'}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            请在表格中选中一个任务
          </Typography.Paragraph>
        )
      ) : (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          已勾选 {targetIds.length} 个任务
        </Typography.Paragraph>
      )}

      {mode === 'batch' && (
        <RecordCheckList
          records={records}
          selected={checked}
          onToggle={toggleOne}
          onToggleAll={toggleAll}
        />
      )}

      <WorkLogForm
        hasDateField={Boolean(config.dateFieldId)}
        canSync={Boolean(config.dateFieldId && config.planEndDateFieldId)}
        disabled={busy || targetIds.length === 0}
        submitText={mode === 'single' ? '创建工时' : '批量创建工时'}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

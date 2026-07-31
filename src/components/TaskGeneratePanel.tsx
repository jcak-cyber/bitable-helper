import { useEffect, useState } from 'react';
import type { Key } from 'react';
import {
  Empty,
  Spin,
  Typography,
  Tag,
  Button,
  Segmented,
  Table,
  Space,
  Select,
  DatePicker,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useScheduleData } from '../hooks/useScheduleData';
import { useStagedTasks } from '../hooks/useStagedTasks';
import { buildGeneratedTaskPreviews, SCHEDULE_TABLE_NAME, toast } from '../services/bitable';
import { GenerateTaskModal } from './GenerateTaskModal';
import type { GeneratedTaskPreview, ScheduleRow, StagedTaskItem } from '../types';

const PRIORITY_OPTIONS = [
  { label: 'P0', value: 'P0' },
  { label: 'P1', value: 'P1' },
  { label: 'P2', value: 'P2' },
  { label: 'P3', value: 'P3' },
] as const;

type Priority = StagedTaskItem['priority'];

type StagedEditableField =
  | 'priority'
  | 'planStartDate'
  | 'planEndDate'
  | 'actualStartDate'
  | 'actualEndDate';

function ScheduleItem({
  row,
  onGenerate,
}: {
  row: ScheduleRow;
  onGenerate: (row: ScheduleRow) => void;
}) {
  const dateRange =
    row.startDate || row.endDate ? `${row.startDate || '—'} ~ ${row.endDate || '—'}` : '';
  const canGenerate = Boolean(row.startTs || row.endTs || row.startDate || row.endDate);

  return (
    <article className="schedule-item">
      <div className="schedule-item-top">
        <Typography.Text strong ellipsis className="schedule-item-title">
          {row.name}
        </Typography.Text>
        {row.effort && <span className="schedule-effort">{row.effort}</span>}
      </div>

      <div className="schedule-item-meta">
        {row.type && (
          <Tag bordered={false} className="schedule-type-tag">
            {row.type}
          </Tag>
        )}
        {dateRange && <span className="schedule-date">{dateRange}</span>}
      </div>

      {row.linkedItem && (
        <div className="schedule-link">
          <span className="schedule-link-label">关联</span>
          <Typography.Text ellipsis className="schedule-link-text">
            {row.linkedItem}
          </Typography.Text>
        </div>
      )}

      <div className="schedule-item-actions">
        <Button
          type="primary"
          size="small"
          block
          disabled={!canGenerate}
          onClick={() => onGenerate(row)}
        >
          生成任务
        </Button>
      </div>
    </article>
  );
}

function CurrentViewPane({
  loading,
  isScheduleTable,
  tableName,
  viewName,
  schedules,
  onGenerate,
}: {
  loading: boolean;
  isScheduleTable: boolean;
  tableName: string;
  viewName: string;
  schedules: ScheduleRow[];
  onGenerate: (row: ScheduleRow) => void;
}) {
  if (loading) {
    return (
      <div className="panel-loading">
        <Spin />
      </div>
    );
  }

  if (!isScheduleTable) {
    return (
      <div className="panel-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div className="empty-copy">
              <div className="empty-title">尚未打开人员排期表</div>
              <div className="empty-desc">
                请切换到「{SCHEDULE_TABLE_NAME}」数据表，并选中个人排期视图
              </div>
              {tableName ? <div className="empty-hint">当前表：{tableName}</div> : null}
            </div>
          }
        />
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="panel-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div className="empty-copy">
              <div className="empty-title">暂无排期数据</div>
              <div className="empty-desc">
                {viewName
                  ? `当前排期「${viewName}」没有可见数据`
                  : '当前个人排期没有可见数据'}
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="current-view-pane">
      <div className="current-view-meta">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {viewName || '个人排期'}
        </Typography.Text>
        <span className="panel-count">{schedules.length} 条</span>
      </div>
      <div className="schedule-list">
        {schedules.map((row) => (
          <ScheduleItem key={row.recordId} row={row} onGenerate={onGenerate} />
        ))}
      </div>
    </div>
  );
}

function StagedTasksPane({
  staged,
  onRemove,
  onRemoveMany,
  onUpdate,
  onClear,
}: {
  staged: StagedTaskItem[];
  onRemove: (stagedId: string) => void;
  onRemoveMany: (stagedIds: string[]) => void;
  onUpdate: (stagedId: string, patch: Partial<StagedTaskItem>) => void;
  onClear: () => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  // 列表变化时清理已不存在的选中项
  useEffect(() => {
    const alive = new Set(staged.map((r) => r.stagedId));
    setSelectedKeys((prev) => prev.filter((k) => alive.has(String(k))));
  }, [staged]);

  const patchDate = (stagedId: string, field: StagedEditableField, value: string | null) => {
    if (!value) return;
    onUpdate(stagedId, { [field]: value });
  };

  const columns: ColumnsType<StagedTaskItem> = [
    {
      title: '任务名称',
      dataIndex: 'taskName',
      ellipsis: true,
      width: 160,
    },
    {
      title: '执行人',
      dataIndex: 'executor',
      width: 72,
      ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      align: 'center',
      onHeaderCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (v: Priority, record) => (
        <Select
          size="small"
          value={v}
          options={[...PRIORITY_OPTIONS]}
          onChange={(priority) => onUpdate(record.stagedId, { priority })}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '计划开始',
      dataIndex: 'planStartDate',
      width: 130,
      render: (v: string, record) => (
        <DatePicker
          size="small"
          allowClear={false}
          value={v ? dayjs(v) : null}
          onChange={(d) =>
            patchDate(record.stagedId, 'planStartDate', d ? d.format('YYYY-MM-DD') : null)
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '计划结束',
      dataIndex: 'planEndDate',
      width: 130,
      render: (v: string, record) => (
        <DatePicker
          size="small"
          allowClear={false}
          value={v ? dayjs(v) : null}
          onChange={(d) =>
            patchDate(record.stagedId, 'planEndDate', d ? d.format('YYYY-MM-DD') : null)
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '实际开始',
      dataIndex: 'actualStartDate',
      width: 130,
      render: (v: string, record) => (
        <DatePicker
          size="small"
          allowClear={false}
          value={v ? dayjs(v) : null}
          onChange={(d) =>
            patchDate(record.stagedId, 'actualStartDate', d ? d.format('YYYY-MM-DD') : null)
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '实际结束',
      dataIndex: 'actualEndDate',
      width: 130,
      render: (v: string, record) => (
        <DatePicker
          size="small"
          allowClear={false}
          value={v ? dayjs(v) : null}
          onChange={(d) =>
            patchDate(record.stagedId, 'actualEndDate', d ? d.format('YYYY-MM-DD') : null)
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      width: 52,
      fixed: 'right',
      render: (_, record) => (
        <Button type="link" size="small" danger onClick={() => onRemove(record.stagedId)}>
          删除
        </Button>
      ),
    },
  ];

  if (staged.length === 0) {
    return (
      <div className="panel-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div className="empty-copy">
              <div className="empty-title">暂无已生成任务</div>
              <div className="empty-desc">在「当前排期」中预览并点击生成后，任务会显示在这里</div>
            </div>
          }
        />
      </div>
    );
  }

  const handleBatchDelete = () => {
    if (selectedKeys.length === 0) return;
    onRemoveMany(selectedKeys.map(String));
    setSelectedKeys([]);
  };

  return (
    <div className="staged-tasks-pane">
      <div className="current-view-meta">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已生成 {staged.length} 条（切表不丢失）
          {selectedKeys.length > 0 ? ` · 已选 ${selectedKeys.length}` : ''}
        </Typography.Text>
        <Space size={4}>
          <Button
            type="link"
            size="small"
            danger
            disabled={selectedKeys.length === 0}
            onClick={handleBatchDelete}
          >
            批量删除
          </Button>
          <Button type="link" size="small" danger onClick={onClear}>
            清空全部
          </Button>
        </Space>
      </div>
      <Table<StagedTaskItem>
        size="small"
        rowKey="stagedId"
        columns={columns}
        dataSource={staged}
        pagination={false}
        scroll={{ x: 960, y: 420 }}
        bordered
        className="staged-tasks-table"
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />
    </div>
  );
}

export function TaskGeneratePanel() {
  const { isScheduleTable, tableName, viewName, schedules, loading } = useScheduleData();
  const { staged, stageTasks, removeOne, removeMany, updateOne, clearAll } = useStagedTasks();
  const [subTab, setSubTab] = useState('current-view');
  const [activeSchedule, setActiveSchedule] = useState<ScheduleRow | null>(null);
  const [previewTasks, setPreviewTasks] = useState<GeneratedTaskPreview[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const openGenerateModal = (row: ScheduleRow) => {
    setActiveSchedule(row);
    setPreviewTasks(buildGeneratedTaskPreviews(row));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setActiveSchedule(null);
    setPreviewTasks([]);
  };

  const handleModalGenerate = async (tasks: GeneratedTaskPreview[]) => {
    if (!activeSchedule) return;
    const count = stageTasks(activeSchedule.recordId, tasks);
    await toast('success', `已生成 ${count} 条任务`);
    setSubTab('staged-tasks');
  };

  return (
    <div className="task-generate-panel">
      <Segmented
        className="task-gen-segmented"
        block
        value={subTab}
        onChange={(v) => setSubTab(String(v))}
        options={[
          { label: '当前排期', value: 'current-view' },
          {
            label:
              staged.length > 0 ? (
                <span className="task-gen-seg-label">
                  已生成任务
                  <span className="subtab-badge">{staged.length}</span>
                </span>
              ) : (
                '已生成任务'
              ),
            value: 'staged-tasks',
          },
        ]}
      />

      <div className="task-gen-pane">
        {subTab === 'current-view' ? (
          <CurrentViewPane
            loading={loading}
            isScheduleTable={isScheduleTable}
            tableName={tableName}
            viewName={viewName}
            schedules={schedules}
            onGenerate={openGenerateModal}
          />
        ) : (
          <StagedTasksPane
            staged={staged}
            onRemove={removeOne}
            onRemoveMany={removeMany}
            onUpdate={updateOne}
            onClear={clearAll}
          />
        )}
      </div>

      <GenerateTaskModal
        open={modalOpen}
        schedule={activeSchedule}
        tasks={previewTasks}
        onClose={closeModal}
        onGenerate={(tasks) => void handleModalGenerate(tasks)}
      />
    </div>
  );
}

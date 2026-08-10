import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { bitable } from '@lark-base-open/js-sdk';
import { useScheduleData } from '../hooks/useScheduleData';
import { useStagedTasks } from '../hooks/useStagedTasks';
import {
  SCHEDULE_TABLE_NAME,
  TASK_TABLE_NAME,
  buildTaskNameWithRole,
  findStagedTaskConflicts,
  getActiveTable,
  insertStagedTasks,
  isTaskManagementTable,
  toast,
} from '../services/bitable';
import { GenerateTaskModal } from './GenerateTaskModal';
import { DEFAULT_TASK_ROLE, TASK_ROLE_OPTIONS, type TaskRole } from '../constants/taskRole';
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
  | 'role'
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
  isTaskTable,
  onRemove,
  onRemoveMany,
  onUpdate,
  onClear,
  onRefresh,
  onInsert,
}: {
  staged: StagedTaskItem[];
  /** 当前是否在「任务管理」表（才显示插入） */
  isTaskTable: boolean;
  onRemove: (stagedId: string) => void;
  onRemoveMany: (stagedIds: string[]) => void;
  onUpdate: (stagedId: string, patch: Partial<StagedTaskItem>) => void;
  onClear: () => void;
  /** 从 localStorage 重新拉取已生成任务 */
  onRefresh: () => void | Promise<void>;
  onInsert: (
    tasks: StagedTaskItem[],
    options?: { overwriteByStagedId?: Record<string, string> }
  ) => Promise<void>;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [inserting, setInserting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rowInsertingId, setRowInsertingId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [conflictsLoading, setConflictsLoading] = useState(isTaskTable);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(320);

  const handleRefresh = async () => {
    if (refreshing || inserting) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const conflictIdSet = useMemo(() => new Set(Object.keys(conflicts)), [conflicts]);
  /** 冲突扫描中：禁止勾选与插入 */
  const listLocked = isTaskTable && conflictsLoading;

  // 任务管理表下按计划开始日扫描冲突
  useEffect(() => {
    if (!isTaskTable || staged.length === 0) {
      setConflicts({});
      setConflictsLoading(false);
      return;
    }
    let cancelled = false;
    setConflictsLoading(true);
    void (async () => {
      try {
        const table = await getActiveTable();
        const map = await findStagedTaskConflicts(table, staged);
        if (!cancelled) setConflicts(map);
      } catch (e) {
        console.error('[StagedTasksPane] 冲突扫描失败', e);
        if (!cancelled) setConflicts({});
      } finally {
        if (!cancelled) setConflictsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTaskTable, staged]);

  // 列表变化 / 冲突变化时清理选中项（冲突项不可选）
  useEffect(() => {
    const alive = new Set(staged.map((r) => r.stagedId));
    setSelectedKeys((prev) =>
      prev.filter((k) => alive.has(String(k)) && !conflictIdSet.has(String(k)))
    );
  }, [staged, conflictIdSet]);

  const hasRows = staged.length > 0;

  // 空状态 ↔ 有数据会整段换 DOM；必须在表格挂载后再量高，否则 scroll.y 偏小只显示两三行
  useLayoutEffect(() => {
    if (!hasRows) return;
    const el = tableWrapRef.current;
    if (!el) return;

    const update = () => {
      const next = Math.max(160, Math.floor(el.clientHeight - 52));
      setTableScrollY((prev) => (prev === next ? prev : next));
    };

    update();
    // flex 高度常在首帧未算完，连续两帧再量
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      update();
      raf2 = requestAnimationFrame(update);
    });

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      ro.disconnect();
    };
  }, [hasRows, listLocked, refreshing]);

  const patchDate = (stagedId: string, field: StagedEditableField, value: string | null) => {
    // 实际结束允许清空；其余日期不可清空
    if (!value && field !== 'actualEndDate') return;
    onUpdate(stagedId, { [field]: value ?? '' });
  };

  const runInsert = async (
    targets: StagedTaskItem[],
    overwriteByStagedId?: Record<string, string>
  ) => {
    if (listLocked || targets.length === 0) return;
    setInserting(true);
    try {
      await onInsert(targets, { overwriteByStagedId });
      setSelectedKeys([]);
    } finally {
      setInserting(false);
      setRowInsertingId(null);
    }
  };

  const confirmOverwriteInsert = (record: StagedTaskItem) => {
    if (listLocked) return;
    const existId = conflicts[record.stagedId];
    if (!existId) return;
    Modal.confirm({
      title: '确认覆盖插入',
      content: '对应时间节点已存在任务，插入即会覆盖，是否确认插入任务',
      okText: '确认插入',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        setRowInsertingId(record.stagedId);
        await runInsert([record], { [record.stagedId]: existId });
      },
    });
  };

  const columns: ColumnsType<StagedTaskItem> = [
    {
      title: '任务名称',
      dataIndex: 'taskName',
      ellipsis: true,
      width: 160,
      render: (v: string, record) => (
        <span>
          {v}
          {conflicts[record.stagedId] ? (
            <Tag color="orange" bordered={false} style={{ marginLeft: 4, fontSize: 11 }}>
              已存在
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: '执行人',
      dataIndex: 'executor',
      width: 72,
      ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '所属岗位',
      dataIndex: 'role',
      width: 100,
      render: (v: string, record) => (
        <Select
          size="small"
          showSearch
          optionFilterProp="label"
          disabled={listLocked}
          value={v || DEFAULT_TASK_ROLE}
          options={[...TASK_ROLE_OPTIONS]}
          onChange={(role) => {
            const next = role as TaskRole;
            onUpdate(record.stagedId, {
              role: next,
              taskName: buildTaskNameWithRole(record.taskName, next),
            });
          }}
          style={{ width: '100%' }}
        />
      ),
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
          disabled={listLocked}
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
          disabled={listLocked}
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
          disabled={listLocked}
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
          disabled={listLocked}
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
          allowClear
          placeholder="空"
          disabled={listLocked}
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
      width: isTaskTable ? 96 : 52,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          {isTaskTable && conflicts[record.stagedId] ? (
            <Button
              type="link"
              size="small"
              loading={rowInsertingId === record.stagedId}
              disabled={listLocked || inserting}
              onClick={() => confirmOverwriteInsert(record)}
            >
              插入
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            danger
            disabled={listLocked || inserting}
            onClick={() => onRemove(record.stagedId)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  if (staged.length === 0) {
    return (
      <div className="staged-tasks-pane">
        <div className="current-view-meta">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已生成 0 条（文档表缓存）
          </Typography.Text>
          <Button
            type="link"
            size="small"
            loading={refreshing}
            onClick={() => void handleRefresh()}
          >
            刷新
          </Button>
        </div>
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
      </div>
    );
  }

  const handleBatchDelete = () => {
    if (selectedKeys.length === 0) return;
    onRemoveMany(selectedKeys.map(String));
    setSelectedKeys([]);
  };

  const handleBatchInsert = async () => {
    if (listLocked || inserting || staged.length === 0) return;
    const selectedSet = new Set(selectedKeys.map(String));
    const pool =
      selectedSet.size > 0 ? staged.filter((t) => selectedSet.has(t.stagedId)) : staged;
    // 批量插入只处理无冲突项；冲突项需行内手动确认覆盖
    const targets = pool.filter((t) => !conflicts[t.stagedId]);
    if (targets.length === 0) {
      await toast(
        'info',
        conflictIdSet.size > 0
          ? '所选任务对应时间已存在，请点行内「插入」并确认覆盖'
          : '没有可插入的任务'
      );
      return;
    }
    await runInsert(targets);
  };

  const conflictCount = conflictIdSet.size;

  return (
    <Spin
      spinning={listLocked}
      tip="正在检查时间冲突…"
      className="staged-tasks-spin"
      wrapperClassName="staged-tasks-spin-wrap"
    >
      <div className="staged-tasks-pane">
        <div className="current-view-meta">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已生成 {staged.length} 条（同步至「多维表格助手缓存」表）
            {selectedKeys.length > 0 ? ` · 已选 ${selectedKeys.length}` : ''}
            {isTaskTable && listLocked
              ? ' · 检查冲突中…'
              : isTaskTable && conflictCount > 0
                ? ` · ${conflictCount} 条时间冲突`
                : ''}
          </Typography.Text>
          <Space size={4} wrap>
            <Button
              type="link"
              size="small"
              loading={refreshing}
              disabled={listLocked || inserting}
              onClick={() => void handleRefresh()}
            >
              刷新
            </Button>
            {isTaskTable ? (
              <Button
                type="link"
                size="small"
                loading={inserting && !rowInsertingId}
                disabled={listLocked || staged.length === 0}
                onClick={() => void handleBatchInsert()}
              >
                {selectedKeys.length > 0 ? `插入选中(${selectedKeys.length})` : '插入'}
              </Button>
            ) : null}
            <Button
              type="link"
              size="small"
              danger
              disabled={listLocked || selectedKeys.length === 0 || inserting}
              onClick={handleBatchDelete}
            >
              批量删除
            </Button>
            <Button
              type="link"
              size="small"
              danger
              disabled={listLocked || inserting}
              onClick={onClear}
            >
              清空全部
            </Button>
          </Space>
        </div>
        <div className="staged-tasks-table-wrap" ref={tableWrapRef}>
          <Table<StagedTaskItem>
            size="small"
            rowKey="stagedId"
            columns={columns}
            dataSource={staged}
            pagination={false}
            scroll={{ x: 1080, y: tableScrollY }}
            bordered
            className="staged-tasks-table"
            rowClassName={(record) => (conflicts[record.stagedId] ? 'staged-row-conflict' : '')}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: setSelectedKeys,
              getCheckboxProps: (record) => ({
                disabled: listLocked || Boolean(conflicts[record.stagedId]),
                title: listLocked
                  ? '正在检查冲突，请稍候'
                  : conflicts[record.stagedId]
                    ? '对应时间已存在任务，请使用行内插入'
                    : undefined,
              }),
            }}
          />
        </div>
      </div>
    </Spin>
  );
}

export function TaskGeneratePanel() {
  const { isScheduleTable, tableName, viewName, schedules, loading } = useScheduleData();
  const { staged, stageTasks, removeOne, removeMany, updateOne, clearAll, reloadFromCache } =
    useStagedTasks();
  const [subTab, setSubTab] = useState('current-view');
  const [activeSchedule, setActiveSchedule] = useState<ScheduleRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isTaskTable, setIsTaskTable] = useState(false);

  // 跟踪当前是否在任务管理表（决定「插入」按钮显隐）
  useEffect(() => {
    let cancelled = false;
    const refreshTaskTableFlag = async () => {
      try {
        const table = await getActiveTable();
        const ok = await isTaskManagementTable(table);
        if (!cancelled) setIsTaskTable(ok);
      } catch {
        if (!cancelled) setIsTaskTable(false);
      }
    };
    void refreshTaskTableFlag();
    const off = bitable.base.onSelectionChange(() => {
      void refreshTaskTableFlag();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const openGenerateModal = (row: ScheduleRow) => {
    setActiveSchedule(row);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setActiveSchedule(null);
  };

  const handleModalGenerate = async (tasks: GeneratedTaskPreview[]) => {
    if (!activeSchedule) return;
    const count = stageTasks(activeSchedule.recordId, tasks);
    await toast('success', `已生成 ${count} 条任务`);
    setSubTab('staged-tasks');
  };

  const handleRefreshStaged = async () => {
    const result = await reloadFromCache();
    if (result.source === 'error') {
      await toast('error', result.error || '刷新失败');
      return;
    }
    if (result.count > 0) {
      await toast(
        'success',
        result.source === 'base'
          ? `已从文档缓存加载 ${result.count} 条任务`
          : `已加载 ${result.count} 条任务`
      );
      return;
    }
    await toast('info', '无缓存任务');
  };

  const handleInsert = async (
    tasks: StagedTaskItem[],
    options?: { overwriteByStagedId?: Record<string, string> }
  ) => {
    try {
      const table = await getActiveTable();
      if (!(await isTaskManagementTable(table))) {
        await toast('info', `请先切换到「${TASK_TABLE_NAME}」表再插入`);
        return;
      }
      const overwrite = options?.overwriteByStagedId;
      const result = await insertStagedTasks(table, tasks, {
        overwriteByStagedId: overwrite,
      });
      if (result.successIds.length > 0) {
        removeMany(result.successIds);
      }
      const isOverwrite = Boolean(overwrite && Object.keys(overwrite).length > 0);
      if (result.failed === 0) {
        await toast(
          'success',
          isOverwrite ? `已覆盖插入 ${result.success} 条任务` : `已插入 ${result.success} 条任务`
        );
      } else if (result.success === 0) {
        await toast(
          'error',
          `插入失败：${result.errors[0] ?? '未知错误'}${result.errors.length > 1 ? ` 等 ${result.failed} 条` : ''}`
        );
      } else {
        await toast('info', `成功 ${result.success} 条，失败 ${result.failed} 条`);
      }
    } catch (e) {
      console.error('[TaskGeneratePanel] 插入失败', e);
      await toast('error', `插入失败：${(e as Error)?.message ?? '未知错误'}`);
    }
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
            isTaskTable={isTaskTable}
            onRemove={removeOne}
            onRemoveMany={removeMany}
            onUpdate={updateOne}
            onClear={clearAll}
            onRefresh={handleRefreshStaged}
            onInsert={handleInsert}
          />
        )}
      </div>

      <GenerateTaskModal
        open={modalOpen}
        schedule={activeSchedule}
        onClose={closeModal}
        onGenerate={(tasks) => void handleModalGenerate(tasks)}
      />
    </div>
  );
}

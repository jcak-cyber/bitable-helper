import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Drawer,
  Empty,
  Typography,
  Tag,
  Table,
  DatePicker,
  Button,
  Space,
  Select,
  Checkbox,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { buildGeneratedTaskPreviews, buildTaskNameWithRole } from '../services/bitable';
import { DEFAULT_TASK_ROLE, TASK_ROLE_OPTIONS, type TaskRole } from '../constants/taskRole';
import type { GeneratedTaskPreview, ScheduleRow } from '../types';

const PRIORITY_OPTIONS = [
  { label: 'P0', value: 'P0' },
  { label: 'P1', value: 'P1' },
  { label: 'P2', value: 'P2' },
  { label: 'P3', value: 'P3' },
] as const;

const WEEKEND_PREF_KEY = 'bitable-helper:include-weekend';

type Priority = GeneratedTaskPreview['priority'];

interface Props {
  open: boolean;
  schedule: ScheduleRow | null;
  onClose: () => void;
  /** 点击「生成」：提交当前预览列表（含编辑后的实际日期/优先级） */
  onGenerate: (tasks: GeneratedTaskPreview[]) => void;
}

function rowKeyOf(row: GeneratedTaskPreview): string {
  return `${row.dateTs}-${row.dayIndex}`;
}

function loadIncludeWeekend(): boolean {
  try {
    const v = localStorage.getItem(WEEKEND_PREF_KEY);
    // 默认不包含周末（工作日任务更常见）
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

function saveIncludeWeekend(value: boolean) {
  try {
    localStorage.setItem(WEEKEND_PREF_KEY, value ? '1' : '0');
  } catch {
    // ignore
  }
}

/**
 * 按排期跨度预览将生成的任务列表（一日一条，antd Table）。
 * 以侧栏全高 Drawer 展示；可配置是否包含周六、周日。
 */
export function GenerateTaskModal({ open, schedule, onClose, onGenerate }: Props) {
  const [rows, setRows] = useState<GeneratedTaskPreview[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [batchStart, setBatchStart] = useState<Dayjs | null>(null);
  const [batchEnd, setBatchEnd] = useState<Dayjs | null>(null);
  const [batchPriority, setBatchPriority] = useState<Priority | null>(null);
  const [batchRole, setBatchRole] = useState<TaskRole | null>(null);
  const [includeWeekend, setIncludeWeekend] = useState(loadIncludeWeekend);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(280);

  // 打开抽屉或切换「含周末」时重建预览列表
  useEffect(() => {
    if (!open || !schedule) return;
    setRows(buildGeneratedTaskPreviews(schedule, { includeWeekend }));
    setSelectedKeys([]);
    setBatchStart(null);
    setBatchEnd(null);
    setBatchPriority(null);
    setBatchRole(null);
  }, [open, schedule, includeWeekend]);

  // Drawer 打开后按可用高度撑满表格滚动区
  useEffect(() => {
    if (!open) return;
    const el = tableWrapRef.current;
    if (!el) return;
    const update = () => {
      setTableScrollY(Math.max(120, el.clientHeight - 48));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, rows.length]);

  const rangeText =
    schedule?.startDate || schedule?.endDate
      ? `${schedule?.startDate || '—'} ~ ${schedule?.endDate || '—'}`
      : '未设置计划日期';

  const handleIncludeWeekendChange = (checked: boolean) => {
    setIncludeWeekend(checked);
    saveIncludeWeekend(checked);
  };

  const updateActualDate = (
    dayIndex: number,
    field: 'actualStartDate' | 'actualEndDate',
    value: Dayjs | null,
    fallback: string
  ) => {
    setRows((prev) =>
      prev.map((row) =>
        row.dayIndex === dayIndex
          ? {
              ...row,
              [field]:
                value != null
                  ? value.format('YYYY-MM-DD')
                  : field === 'actualEndDate'
                    ? ''
                    : fallback,
            }
          : row
      )
    );
  };

  const applyBatch = () => {
    if (selectedKeys.length === 0) return;
    if (!batchStart && !batchEnd && !batchPriority && !batchRole) return;
    const selected = new Set(selectedKeys.map(String));
    setRows((prev) =>
      prev.map((row) => {
        if (!selected.has(rowKeyOf(row))) return row;
        return {
          ...row,
          actualStartDate: batchStart ? batchStart.format('YYYY-MM-DD') : row.actualStartDate,
          actualEndDate: batchEnd ? batchEnd.format('YYYY-MM-DD') : row.actualEndDate,
          priority: batchPriority ?? row.priority,
          role: batchRole ?? row.role,
          taskName: batchRole
            ? buildTaskNameWithRole(row.taskName, batchRole)
            : row.taskName,
        };
      })
    );
  };

  const updatePriority = (dayIndex: number, priority: Priority) => {
    setRows((prev) =>
      prev.map((row) => (row.dayIndex === dayIndex ? { ...row, priority } : row))
    );
  };

  const updateRole = (dayIndex: number, role: TaskRole) => {
    setRows((prev) =>
      prev.map((row) =>
        row.dayIndex === dayIndex
          ? { ...row, role, taskName: buildTaskNameWithRole(row.taskName, role) }
          : row
      )
    );
  };

  const columns: ColumnsType<GeneratedTaskPreview> = useMemo(
    () => [
      {
        title: '#',
        dataIndex: 'dayIndex',
        width: 48,
        align: 'center',
      },
      {
        title: '任务名称',
        dataIndex: 'taskName',
        ellipsis: true,
        width: 140,
      },
      {
        title: '任务执行人',
        dataIndex: 'executor',
        width: 88,
        ellipsis: true,
        render: (v: string) => v || '—',
      },
      {
        title: '任务所属岗位',
        dataIndex: 'role',
        width: 110,
        render: (_: string, record) => (
          <Select
            size="small"
            showSearch
            optionFilterProp="label"
            placeholder="查找选项"
            value={record.role || DEFAULT_TASK_ROLE}
            options={[...TASK_ROLE_OPTIONS]}
            onChange={(v) => updateRole(record.dayIndex, v as TaskRole)}
            style={{ width: '100%' }}
          />
        ),
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        width: 80,
        render: (_: Priority, record) => (
          <Select
            size="small"
            value={record.priority}
            options={[...PRIORITY_OPTIONS]}
            onChange={(v) => updatePriority(record.dayIndex, v)}
            style={{ width: '100%' }}
          />
        ),
      },
      {
        title: '计划开始日期',
        dataIndex: 'planStartDate',
        width: 108,
      },
      {
        title: '计划结束日期',
        dataIndex: 'planEndDate',
        width: 108,
      },
      {
        title: '实际开始日期',
        dataIndex: 'actualStartDate',
        width: 140,
        render: (_: string, record) => (
          <DatePicker
            size="small"
            allowClear={false}
            value={record.actualStartDate ? dayjs(record.actualStartDate) : null}
            onChange={(d) =>
              updateActualDate(record.dayIndex, 'actualStartDate', d, record.planStartDate)
            }
            style={{ width: '100%' }}
          />
        ),
      },
      {
        title: '实际结束日期',
        dataIndex: 'actualEndDate',
        width: 140,
        render: (_: string, record) => (
          <DatePicker
            size="small"
            allowClear
            placeholder="空"
            value={record.actualEndDate ? dayjs(record.actualEndDate) : null}
            onChange={(d) =>
              updateActualDate(record.dayIndex, 'actualEndDate', d, record.planEndDate)
            }
            style={{ width: '100%' }}
          />
        ),
      },
    ],
    []
  );

  const canApplyBatch =
    selectedKeys.length > 0 && Boolean(batchStart || batchEnd || batchPriority || batchRole);

  const handleGenerate = () => {
    if (rows.length === 0) return;
    onGenerate(rows.map((r) => ({ ...r })));
    onClose();
  };

  return (
    <Drawer
      title="生成任务预览"
      open={open}
      onClose={onClose}
      width="100%"
      placement="right"
      destroyOnHidden
      className="generate-task-drawer"
      styles={{
        body: { padding: '12px 14px', display: 'flex', flexDirection: 'column', minHeight: 0 },
        wrapper: { width: '100%' },
      }}
      footer={
        <div className="generate-task-drawer-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={rows.length === 0} onClick={handleGenerate}>
            生成
          </Button>
        </div>
      }
    >
      {schedule && (
        <div className="generate-task-summary">
          <Typography.Text strong ellipsis className="generate-task-summary-title">
            {schedule.name}
          </Typography.Text>
          <div className="generate-task-summary-meta">
            <span>周期 {rangeText}</span>
            <Tag color="blue" bordered={false}>
              {rows.length} 条任务
              {selectedKeys.length > 0 ? ` · 已选 ${selectedKeys.length}` : ''}
            </Tag>
          </div>
          <Checkbox
            className="generate-task-weekend"
            checked={includeWeekend}
            onChange={(e) => handleIncludeWeekendChange(e.target.checked)}
          >
            包含周六、周日
          </Checkbox>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            !includeWeekend &&
            schedule &&
            (schedule.startTs != null ||
              schedule.endTs != null ||
              schedule.startDate ||
              schedule.endDate)
              ? '排除周末后无可生成日期（可勾选「包含周六、周日」）'
              : '该排期缺少计划开始/结束日期，无法生成任务周期'
          }
        />
      ) : (
        <div className="generate-task-drawer-body">
          <div className="generate-task-batch">
            <span className="generate-task-batch-label">批量修改</span>
            <Space wrap size={8}>
              <DatePicker
                size="small"
                placeholder="实际开始日期"
                value={batchStart}
                onChange={setBatchStart}
                allowClear
              />
              <DatePicker
                size="small"
                placeholder="实际结束日期"
                value={batchEnd}
                onChange={setBatchEnd}
                allowClear
              />
              <Select
                size="small"
                placeholder="优先级"
                allowClear
                value={batchPriority ?? undefined}
                options={[...PRIORITY_OPTIONS]}
                onChange={(v) => setBatchPriority((v as Priority | undefined) ?? null)}
                style={{ width: 96 }}
              />
              <Select
                size="small"
                showSearch
                optionFilterProp="label"
                placeholder="所属岗位"
                allowClear
                value={batchRole ?? undefined}
                options={[...TASK_ROLE_OPTIONS]}
                onChange={(v) => setBatchRole((v as TaskRole | undefined) ?? null)}
                style={{ width: 110 }}
              />
              <Button size="small" type="primary" disabled={!canApplyBatch} onClick={applyBatch}>
                应用到选中
              </Button>
            </Space>
          </div>
          <div className="generate-task-table-wrap" ref={tableWrapRef}>
            <Table<GeneratedTaskPreview>
              size="small"
              rowKey={rowKeyOf}
              columns={columns}
              dataSource={rows}
              pagination={false}
              scroll={{ x: 1080, y: tableScrollY }}
              bordered
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }}
            />
          </div>
        </div>
      )}
    </Drawer>
  );
}

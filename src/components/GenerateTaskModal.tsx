import { useEffect, useMemo, useState } from 'react';
import { Modal, Empty, Typography, Tag, Table, DatePicker, Button, Space, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type { GeneratedTaskPreview, ScheduleRow } from '../types';

const PRIORITY_OPTIONS = [
  { label: 'P0', value: 'P0' },
  { label: 'P1', value: 'P1' },
  { label: 'P2', value: 'P2' },
  { label: 'P3', value: 'P3' },
] as const;

type Priority = GeneratedTaskPreview['priority'];

interface Props {
  open: boolean;
  schedule: ScheduleRow | null;
  tasks: GeneratedTaskPreview[];
  onClose: () => void;
  /** 点击「生成」：提交当前预览列表（含编辑后的实际日期/优先级） */
  onGenerate: (tasks: GeneratedTaskPreview[]) => void;
}

function rowKeyOf(row: GeneratedTaskPreview): string {
  return `${row.dateTs}-${row.dayIndex}`;
}

/**
 * 按排期跨度预览将生成的任务列表（一日一条，antd Table）。
 * 实际开始/结束日期默认同计划日期，支持单行修改；批量修改仅作用于勾选行。
 */
export function GenerateTaskModal({ open, schedule, tasks, onClose, onGenerate }: Props) {
  const [rows, setRows] = useState<GeneratedTaskPreview[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [batchStart, setBatchStart] = useState<Dayjs | null>(null);
  const [batchEnd, setBatchEnd] = useState<Dayjs | null>(null);
  const [batchPriority, setBatchPriority] = useState<Priority | null>(null);

  useEffect(() => {
    if (open) {
      setRows(tasks.map((t) => ({ ...t })));
      setSelectedKeys([]);
      setBatchStart(null);
      setBatchEnd(null);
      setBatchPriority(null);
    }
  }, [open, tasks]);

  const rangeText =
    schedule?.startDate || schedule?.endDate
      ? `${schedule?.startDate || '—'} ~ ${schedule?.endDate || '—'}`
      : '未设置计划日期';

  const updateActualDate = (
    dayIndex: number,
    field: 'actualStartDate' | 'actualEndDate',
    value: Dayjs | null,
    fallback: string
  ) => {
    setRows((prev) =>
      prev.map((row) =>
        row.dayIndex === dayIndex
          ? { ...row, [field]: value ? value.format('YYYY-MM-DD') : fallback }
          : row
      )
    );
  };

  const applyBatch = () => {
    if (selectedKeys.length === 0) return;
    if (!batchStart && !batchEnd && !batchPriority) return;
    const selected = new Set(selectedKeys.map(String));
    setRows((prev) =>
      prev.map((row) => {
        if (!selected.has(rowKeyOf(row))) return row;
        return {
          ...row,
          actualStartDate: batchStart ? batchStart.format('YYYY-MM-DD') : row.actualStartDate,
          actualEndDate: batchEnd ? batchEnd.format('YYYY-MM-DD') : row.actualEndDate,
          priority: batchPriority ?? row.priority,
        };
      })
    );
  };

  const updatePriority = (dayIndex: number, priority: Priority) => {
    setRows((prev) =>
      prev.map((row) => (row.dayIndex === dayIndex ? { ...row, priority } : row))
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
      },
      {
        title: '任务执行人',
        dataIndex: 'executor',
        width: 96,
        ellipsis: true,
        render: (v: string) => v || '—',
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        width: 88,
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
            allowClear={false}
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
    selectedKeys.length > 0 && Boolean(batchStart || batchEnd || batchPriority);

  const handleGenerate = () => {
    if (rows.length === 0) return;
    onGenerate(rows.map((r) => ({ ...r })));
    onClose();
  };

  return (
    <Modal
      title="生成任务预览"
      open={open}
      onCancel={onClose}
      onOk={handleGenerate}
      okText="生成"
      okButtonProps={{ disabled: rows.length === 0 }}
      cancelText="取消"
      width={980}
      centered
      destroyOnHidden
      className="generate-task-modal"
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
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="该排期缺少计划开始/结束日期，无法生成任务周期"
        />
      ) : (
        <>
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
              <Button size="small" type="primary" disabled={!canApplyBatch} onClick={applyBatch}>
                应用到选中
              </Button>
            </Space>
          </div>
          <Table<GeneratedTaskPreview>
            size="small"
            rowKey={rowKeyOf}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 1000, y: 320 }}
            bordered
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: setSelectedKeys,
            }}
          />
        </>
      )}
    </Modal>
  );
}

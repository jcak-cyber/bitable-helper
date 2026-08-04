/** 任务所属岗位选项（与任务管理表单选一致） */
export const TASK_ROLE_OPTIONS = [
  { label: '前端', value: '前端' },
  { label: '后端', value: '后端' },
  { label: '测试', value: '测试' },
  { label: '运维', value: '运维' },
  { label: '实施', value: '实施' },
  { label: '产品', value: '产品' },
  { label: 'UI', value: 'UI' },
  { label: '售前', value: '售前' },
] as const;

export type TaskRole = (typeof TASK_ROLE_OPTIONS)[number]['value'];

export const DEFAULT_TASK_ROLE: TaskRole = '前端';

export function isTaskRole(v: unknown): v is TaskRole {
  return TASK_ROLE_OPTIONS.some((o) => o.value === v);
}

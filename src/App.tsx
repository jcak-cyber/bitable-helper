import { useState } from 'react';
import { Tabs, Typography } from 'antd';
import { WorkHourPanel } from './components/WorkHourPanel';
import { TaskGeneratePanel } from './components/TaskGeneratePanel';
import './App.less';

export default function App() {
  const [activeTab, setActiveTab] = useState('work-hour');

  return (
    <div className="app">
      <header className="app-brand">
        <div className="app-brand-mark" aria-hidden />
        <div className="app-brand-text">
          <Typography.Title level={4} className="app-brand-title">
            多维表格助手
          </Typography.Title>
          <Typography.Text type="secondary" className="app-brand-sub">
            工时填写 · 排期任务生成
          </Typography.Text>
        </div>
      </header>
      <Tabs
        className="app-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'work-hour',
            label: '工时管理',
            children: <WorkHourPanel active={activeTab === 'work-hour'} />,
          },
          {
            key: 'task-generate',
            label: '任务生成',
            children: <TaskGeneratePanel />,
          },
        ]}
      />
    </div>
  );
}

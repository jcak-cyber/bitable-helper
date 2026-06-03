import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* 主题色对齐飞书蓝；locale 让 DatePicker 等组件显示中文 */}
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#3370ff' } }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);

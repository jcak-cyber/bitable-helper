import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 飞书插件以 iframe 形式嵌入主端，需允许跨域加载本地 dev server
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true,
  },
});

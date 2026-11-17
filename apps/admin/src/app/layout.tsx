import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'antd/dist/reset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '深圳钓鱼助手运营后台',
  description: '钓点录入、核实与发布',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

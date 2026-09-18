import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trợ lý BHXH & BHYT',
  description: 'Trợ lý tra cứu quy định bảo hiểm xã hội và bảo hiểm y tế.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

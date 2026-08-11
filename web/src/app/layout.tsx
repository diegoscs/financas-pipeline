import type { Metadata, Viewport } from 'next';
import { LayoutClient } from '@/components/LayoutClient';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#4f46e5',
};

export const metadata: Metadata = {
  title: 'Finanças',
  description: 'Importar faturas e ver quanto foi gasto',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Finanças',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { LayoutClient } from '@/components/LayoutClient';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finanças',
  description: 'Importar faturas e ver quanto foi gasto',
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

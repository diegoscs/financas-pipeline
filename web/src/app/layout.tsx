import type { Metadata } from 'next';
import AvisoSeguranca from '@/components/AvisoSeguranca';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finanças',
  description: 'Importar faturas e ver quanto foi gasto',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="nao-imprimir border-b bg-white" style={{ borderColor: 'var(--borda)' }}>
          <Nav />
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        <AvisoSeguranca />
      </body>
    </html>
  );
}

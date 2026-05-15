import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Augusto Vendetti',
  description: 'CEO autônomo da vending machine do Blue Mall Rondon',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-navy-50 text-navy-900 antialiased">{children}</body>
    </html>
  );
}

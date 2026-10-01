import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Content Lab',
  description: 'Top TikTok ads, tagged and turned into production briefs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">{children}</body>
    </html>
  );
}

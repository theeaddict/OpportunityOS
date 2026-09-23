import './globals.css';
import { getCurrentUser } from '@/lib/auth';
import AppShell from '@/components/AppShell';

export const metadata = {
  title: 'OpportunityOS — Find money-making opportunities',
  description:
    'Stop searching for customers. OpportunityOS researches real businesses and shows you the money-making opportunities worth pursuing — evidence, impact, confidence and the approach, in one place.',
};

export default async function RootLayout({ children }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}

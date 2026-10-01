import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AuthForm from '@/components/AuthForm';

export default async function LoginPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect('/');
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight"><span className="text-blue-700">Opportunity</span>OS</p>
        <p className="mt-1 text-center text-sm text-gray-500">Business Opportunity Intelligence</p>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <AuthForm mode="login" />
          <p className="mt-4 text-center text-xs text-gray-500">
            <Link href="/forgot-password" className="font-medium text-blue-600 hover:underline">Forgot password?</Link>
          </p>
          <p className="mt-2 text-center text-xs text-gray-500">
            No account? <Link href="/register" className="font-medium text-blue-600 hover:underline">Register</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

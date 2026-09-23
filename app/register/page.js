import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AuthForm from '@/components/AuthForm';

export default async function RegisterPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect('/');
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight"><span className="text-blue-700">Opportunity</span>OS</p>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <AuthForm mode="register" />
          <p className="mt-4 text-center text-xs text-gray-500">
            Already registered? <Link href="/login" className="font-medium text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

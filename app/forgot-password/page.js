import Link from 'next/link';
import ForgotPasswordForm from '@/components/ForgotPasswordForm';

export const metadata = { title: 'Reset your password — OpportunityOS' };

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight"><span className="text-blue-700">Opportunity</span>OS</p>
        <h1 className="mt-1 text-center text-sm text-gray-500">Reset your password</h1>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <ForgotPasswordForm />
          <p className="mt-4 text-center text-xs text-gray-500">
            <Link href="/login" className="font-medium text-blue-600 hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

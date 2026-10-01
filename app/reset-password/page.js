import ResetPasswordForm from '@/components/ResetPasswordForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose a new password — OpportunityOS' };

export default async function Page({ searchParams }) {
  const { token } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight"><span className="text-blue-700">Opportunity</span>OS</p>
        <h1 className="mt-1 text-center text-sm text-gray-500">Choose a new password</h1>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <ResetPasswordForm token={typeof token === 'string' ? token : ''} />
        </div>
      </div>
    </div>
  );
}

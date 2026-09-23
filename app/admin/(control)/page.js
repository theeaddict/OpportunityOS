import { getCurrentAdmin } from '@/lib/admin-auth';
import ControlRoomClient from '@/components/ControlRoomClient';

export const dynamic = 'force-dynamic';

// Rendered only after app/admin/layout.js has already checked the separate
// administrator identity (redirect to /admin/login or 403 for a disabled
// admin). This body fetches system-wide numbers from /api/admin/overview —
// which itself runs requireSuperadmin() again at the API layer.
export default async function AdminHome() {
  const admin = await getCurrentAdmin().catch(() => null);
  return <ControlRoomClient admin={admin} />;
}
import { getCurrentUser } from '@/lib/auth';
import ControlRoomClient from '@/components/ControlRoomClient';

export const dynamic = 'force-dynamic';

// Rendered only after app/admin/layout.js has already checked is_superadmin
// (redirect/login or 403 forbidden()). This body fetches system-wide numbers
// from /api/admin/overview — which itself runs requireSuperadmin() again at
// the API layer.
export default async function AdminHome() {
  const user = await getCurrentUser().catch(() => null);
  return <ControlRoomClient user={user} />;
}
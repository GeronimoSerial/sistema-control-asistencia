import { redirect } from "next/navigation";
import { sessionWith } from "@/lib/session";
import UsuariosPanel, { type RoleOption, type UserRow } from "./UsuariosPanel";

export const dynamic = "force-dynamic";

export default async function UsuariosPage({
  params,
}: {
  params: Promise<{ nivel: string }>;
}) {
  const { nivel } = await params;
  const session = await sessionWith(nivel, "users.manage");
  if (!session) redirect(`/${nivel}/ingresar`);

  const { db } = session.resolved.context;

  const roles = db
    .prepare(
      `SELECT r.id, r.code, r.name,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions
       FROM roles r ORDER BY r.name`
    )
    .all()
    .map((row) => ({ ...row })) as unknown as RoleOption[];

  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.active, u.must_change_password, u.last_login_at,
              (SELECT group_concat(ur.role_id) FROM user_roles ur WHERE ur.user_id = u.id) AS role_ids,
              (SELECT group_concat(r.name, ', ') FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS role_names
       FROM users u
       ORDER BY u.active DESC, u.email`
    )
    .all()
    .map((row) => ({ ...row })) as unknown as UserRow[];

  return (
    <UsuariosPanel nivel={nivel} roles={roles} rows={rows} currentUserId={session.user.id} />
  );
}

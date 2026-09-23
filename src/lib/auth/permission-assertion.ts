import { hasPermission } from "@/lib/auth/access";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { PermissionKey } from "@/lib/rbac/catalog";

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Salah satu dari `permissions` sudah cukup. */
export function assertAnyActorPermission(
  actor: OperatorUser | null,
  permissions: readonly PermissionKey[],
) {
  if (!actor) {
    throw new AuthorizationError(
      "Session tidak valid atau sudah berakhir.",
      401,
    );
  }
  if (!permissions.some((permission) => hasPermission(actor, permission))) {
    throw new AuthorizationError("Akses ditolak untuk tindakan ini.", 403);
  }
  return actor;
}

export function assertActorPermission(
  actor: OperatorUser | null,
  permission: PermissionKey,
  superadminOnly = false,
) {
  if (!actor) {
    throw new AuthorizationError(
      "Session tidak valid atau sudah berakhir.",
      401,
    );
  }
  if (
    !hasPermission(actor, permission) ||
    (superadminOnly && !actor.isSuperadmin)
  ) {
    throw new AuthorizationError("Akses ditolak untuk tindakan ini.", 403);
  }
  return actor;
}

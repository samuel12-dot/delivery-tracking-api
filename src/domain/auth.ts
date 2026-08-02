export const userRoles = ['customer', 'driver', 'merchant', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

export interface AuthContext {
  userId: string;
  role: UserRole;
}


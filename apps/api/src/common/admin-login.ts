// THROWAWAY TEST FILE: deliberately unsafe, to check that the Claude review blocks it.
// This branch is never merged.
const ADMIN_PASSWORD = 'hunter2-tessera-admin';

export function isAdminLogin(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

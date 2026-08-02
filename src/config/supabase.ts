/**
 * Compatibility Stub Layer for Supabase
 * Replaced by Express + Turso + Better Auth
 */

export function initSupabase(): boolean {
  return true;
}

export function isSupabaseReady(): boolean {
  return true;
}

export function getSupabaseConfigError(): string | null {
  return null;
}

export function isSupabaseConfigComplete(): boolean {
  return true;
}

export function getSupabaseClient(): any {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
}

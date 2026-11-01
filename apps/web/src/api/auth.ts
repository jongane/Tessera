import type {
  Me,
  ServerSettings,
  ServerSettingsChanges,
  SignIn,
  SignUp,
} from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, isApiError } from './client'

export const meKey = ['me'] as const

// The signed-in person, or null when nobody is signed in.
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api<Me>('/auth/me')
      } catch (error) {
        if (isApiError(error, 401)) {
          return null
        }
        throw error
      }
    },
    staleTime: 60_000,
  })
}

const serverSettingsKey = ['server-settings'] as const

export function useServerSettings() {
  return useQuery({
    queryKey: serverSettingsKey,
    queryFn: () => api<ServerSettings>('/server/settings'),
  })
}

// Server admins only.
export function useChangeServerSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ServerSettingsChanges) =>
      api<ServerSettings>('/server/settings', { method: 'PATCH', body }),
    onSuccess: (settings) =>
      queryClient.setQueryData(serverSettingsKey, settings),
  })
}

export function useSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SignIn) =>
      api<Me>('/auth/sign-in', { method: 'POST', body }),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  })
}

export function useSignUp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SignUp) =>
      api<Me>('/auth/sign-up', { method: 'POST', body }),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/sign-out', { method: 'POST' }),
    // Forget everything loaded for this person.
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(meKey, null)
    },
  })
}

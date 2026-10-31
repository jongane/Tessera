import type { MemberChanges, NewMember, ProjectMember } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

function membersKey(projectId: string) {
  return ['projects', projectId, 'members'] as const
}

// Everyone in the project, admins first, then by name.
export function useMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: membersKey(projectId ?? ''),
    queryFn: () => api<ProjectMember[]>(`/projects/${projectId}/members`),
    enabled: projectId !== undefined,
  })
}

function useReloadMembers(projectId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: membersKey(projectId) })
}

export function useAddMember(projectId: string) {
  const reload = useReloadMembers(projectId)
  return useMutation({
    mutationFn: (body: NewMember) =>
      api<ProjectMember>(`/projects/${projectId}/members`, {
        method: 'POST',
        body,
      }),
    onSuccess: reload,
  })
}

export function useChangeRole(projectId: string) {
  const reload = useReloadMembers(projectId)
  return useMutation({
    mutationFn: ({ userId, ...body }: MemberChanges & { userId: string }) =>
      api<ProjectMember>(`/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body,
      }),
    // Reloaded on failure too, so the role shown is the one saved.
    onSettled: reload,
  })
}

// Removes someone, or, with your own id, leaves the project.
export function useRemoveMember(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/projects/${projectId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      // Not awaited: after leaving, the page moves on straight away.
      void queryClient.invalidateQueries({ queryKey: membersKey(projectId) })
      void queryClient.invalidateQueries({
        queryKey: ['projects'],
        exact: true,
      })
    },
  })
}

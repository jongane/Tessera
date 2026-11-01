import type { Label, LabelChangesBody, NewLabelBody } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

function labelsKey(projectId: string) {
  return ['projects', projectId, 'labels'] as const
}

// The project's labels, by name.
export function useLabels(projectId: string) {
  return useQuery({
    queryKey: labelsKey(projectId),
    queryFn: () => api<Label[]>(`/projects/${projectId}/labels`),
  })
}

// Labels show on the board's cards too, so every board reloads after a
// change to one.
function useReloadLabels(projectId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: labelsKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['boards'] }),
    ])
}

export function useCreateLabel(projectId: string) {
  const reload = useReloadLabels(projectId)
  return useMutation({
    mutationFn: (body: NewLabelBody) =>
      api<Label>(`/projects/${projectId}/labels`, { method: 'POST', body }),
    onSuccess: reload,
  })
}

export function useChangeLabel(projectId: string, labelId: string) {
  const reload = useReloadLabels(projectId)
  return useMutation({
    mutationFn: (body: LabelChangesBody) =>
      api<Label>(`/labels/${labelId}`, { method: 'PATCH', body }),
    onSuccess: reload,
  })
}

// The label also comes off every card.
export function useDeleteLabel(projectId: string, labelId: string) {
  const reload = useReloadLabels(projectId)
  return useMutation({
    mutationFn: () => api<void>(`/labels/${labelId}`, { method: 'DELETE' }),
    onSuccess: reload,
  })
}

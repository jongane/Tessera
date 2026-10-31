import type {
  Board,
  NewBoardBody,
  NewProjectBody,
  Project,
  ProjectChanges,
  SuggestedCode,
} from '@tessera/shared'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  })
}

export function useProjectByCode(code: string) {
  return useQuery({
    queryKey: ['projects', 'by-code', code.toUpperCase()],
    queryFn: () =>
      api<Project>(`/projects/by-code/${encodeURIComponent(code)}`),
  })
}

// The first free code made from a project name; nothing while it is blank.
export function useSuggestedCode(name: string) {
  const trimmed = name.trim()
  return useQuery({
    queryKey: ['projects', 'suggest-code', trimmed],
    queryFn: () =>
      api<SuggestedCode>(
        `/projects/suggest-code?name=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length > 0,
    // Keep showing the last suggestion while the next one loads.
    placeholderData: keepPreviousData,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewProjectBody) =>
      api<Project>('/projects', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'boards'],
    queryFn: () => api<Board[]>(`/projects/${projectId}/boards`),
    enabled: projectId !== undefined,
  })
}

export function useCreateBoard(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewBoardBody) =>
      api<Board>(`/projects/${projectId}/boards`, { method: 'POST', body }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'boards'],
      }),
  })
}

// Changes the project's code or time zone (project admins only).
export function useChangeProject(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectChanges) =>
      api<Project>(`/projects/${projectId}`, { method: 'PATCH', body }),
    // Every copy of the project (the list, and by each of its codes).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,     // 5 min
      gcTime: 1000 * 60 * 30,       // 30 min
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (err) => {
        console.error('[mutation error]', err)
      },
    },
  },
})

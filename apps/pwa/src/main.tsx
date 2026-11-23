import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StatusBanners } from './StatusBanners';
import './global.css';
import { registerPwa } from './pwa';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 5 * 60 * 1000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StatusBanners />
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

registerPwa();

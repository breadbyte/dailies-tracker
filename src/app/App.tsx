import { RouterProvider } from 'react-router/dom';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { router } from './router.tsx';

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

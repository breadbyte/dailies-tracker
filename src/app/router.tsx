import { createBrowserRouter } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout.tsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx';
import { NotFoundPage } from '../features/dashboard/NotFoundPage.tsx';
import { AccountPage } from '../features/auth/AccountPage.tsx';
import { DataManagementPage } from '../features/data-management/DataManagementPage.tsx';
import { GamesPage } from '../features/games/GamesPage.tsx';

export const routes = [
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: 'games', Component: GamesPage },
      { path: 'data', Component: DataManagementPage },
      { path: 'account', Component: AccountPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
];

export const router = createBrowserRouter(routes);

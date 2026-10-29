import { NavLink, Outlet } from 'react-router';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/games', label: 'Games' },
  { to: '/data', label: 'Data' },
  { to: '/account', label: 'Account' },
];

/**
 * Renders the application shell: skip link, header navigation, main region.
 */
export function AppLayout() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <NavLink className="app-title" to="/">
          Dailies
        </NavLink>
        <nav aria-label="Main">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        Game reset data attribution and license are available in the{' '}
        <a href="/licenses/ATTRIBUTION.md">attribution notice</a>.
      </footer>
    </>
  );
}

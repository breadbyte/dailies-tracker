import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-heading">
      <h1 id="not-found-heading">Page not found</h1>
      <p>
        <Link to="/">Return to the dashboard</Link>
      </p>
    </section>
  );
}

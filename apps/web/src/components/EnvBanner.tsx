// The bar shown on every demo build, above sign-in and the app, so nobody mistakes a demo for production.
export const demoEnvironment = import.meta.env.VITE_DEMO_ENV === 'true';

export function EnvBanner() {
  return (
    <div className="demo-banner" role="status">
      <span className="demo-tag">DEMO</span>
      <span>Demo environment: sample data only. Changes are saved to a test database; do not enter real customer data.</span>
    </div>
  );
}

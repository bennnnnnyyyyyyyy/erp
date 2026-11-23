import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PublicInvoicePage } from './modules/sales/print/PublicInvoicePage';
import { DemoApp } from './DemoApp';
import { EnvBanner, demoEnvironment } from './components/EnvBanner';
import { demoMode } from './lib/demo';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import './theme.css';
import './styles.css';
import { lazy, Suspense } from 'react';
import { newUi } from './lib/uiMode';
import { BRAND } from './lib/brand';

// The new UI (lib/uiMode.ts): its look is scoped to html.nu and loaded only here, so the old UI is never touched by it.
if (newUi) {
  document.documentElement.classList.add('nu');
  void import('./new-ui.css');
  document.title = BRAND.name;
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.type = 'image/svg+xml';
  icon.href = BRAND.mark;
  document.head.appendChild(icon);
}
const CreateCompanyNew = lazy(() => import('./components/CreateCompanyNew').then((m) => ({ default: m.CreateCompanyNew })));

// Design Lab: live design options for choosing the look. In the dev server, and in a preview build made with DESIGN_LAB=1 (the manual
// preview workflow only: see vite.config.ts); never in a normal or production build, where the branch below is constant-false.
// Open the app with ?nolab in the address (for example http://localhost:5173/?nolab) to load without the Lab, e.g. to compare speed.
if ((import.meta.env.DEV || import.meta.env.VITE_DESIGN_LAB === '1') && !new URLSearchParams(location.search).has('nolab')) void import('./components/DesignLab').then((m) => m.mountDesignLab());

// New UI review (dev server and Design Lab previews only): open a screen that normally needs a sign-in, to compare its versions.
// ?preview=create-company. In a normal or production build the condition is constant-false.
const preview = import.meta.env.DEV || import.meta.env.VITE_DESIGN_LAB === '1' ? new URLSearchParams(location.search).get('preview') : null;

// A customer's invoice link (/i/<token>, sql/103): no sign-in, no app shell. Everything else is the app.
const publicInvoice = !demoMode ? /^\/i\/([^/]+)\/?$/.exec(window.location.pathname) : null;

// The sample-data build has its own bar (with the role switcher). A real build made for a demo gets the plain one.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        {preview === 'create-company' ? (
          <Suspense fallback={null}><CreateCompanyNew first onCreated={() => {}} /></Suspense>
        ) : publicInvoice ? (
          <PublicInvoicePage token={publicInvoice[1] ?? ''} />
        ) : demoMode ? (
          <DemoApp />
        ) : (
          <>
            {demoEnvironment && <EnvBanner />}
            <App />
          </>
        )}
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);

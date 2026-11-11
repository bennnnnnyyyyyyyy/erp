import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoApp } from './DemoApp';
import { EnvBanner, demoEnvironment } from './components/EnvBanner';
import { demoMode } from './lib/demo';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import './theme.css';
import './styles.css';

// Design Lab: live design options for choosing the look (dev server only; never in a production build).
// Open the app with ?nolab in the address (for example http://localhost:5173/?nolab) to load without the Lab, e.g. to compare speed.
if (import.meta.env.DEV && !new URLSearchParams(location.search).has('nolab')) void import('./components/DesignLab').then((m) => m.mountDesignLab());

// The sample-data build has its own bar (with the role switcher). A real build made for a demo gets the plain one.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        {demoMode ? (
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

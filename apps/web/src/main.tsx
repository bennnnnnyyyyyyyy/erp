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
import './styles.css';

// The sample-data build has its own bar (with the role switcher). A real build made for a demo gets the plain one.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {demoMode ? (
      <DemoApp />
    ) : (
      <>
        {demoEnvironment && <EnvBanner />}
        <App />
      </>
    )}
  </StrictMode>,
);

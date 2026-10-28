import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoApp } from './DemoApp';
import { demoMode } from './lib/demo';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode>{demoMode ? <DemoApp /> : <App />}</StrictMode>);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import App, { AppErrorBoundary } from './app/app.tsx';
import { useAppStore } from './app/store.ts';
import './styles.css';

registerSW({ immediate: true, onNeedRefresh: () => useAppStore.setState({ updateWaiting: true }) });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);

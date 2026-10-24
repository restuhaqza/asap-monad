import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root container missing');

// Makes 'am I on the new bundle?' answerable without guessing.
console.info(`ASAP build ${__BUILD_TIME__}`);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

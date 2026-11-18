import { ROLES } from '@pharma/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';

/** Iteración 0: esqueleto. Ingreso, países y roles llegan en la Iteración 1. */
function AdminApp() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h1>Administración</h1>
      <p>Panel en construcción. Roles previstos:</p>
      <ul>
        {ROLES.filter((r) => r !== 'CLERK').map((r) => (
          <li key={r}>
            <code>{r}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);

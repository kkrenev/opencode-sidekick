import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DiffPanel } from './widgets/turn-diff/ui/DiffPanel';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<DiffPanel />);
}

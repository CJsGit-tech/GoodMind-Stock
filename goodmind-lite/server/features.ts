// Server-side switch: writes are allowed unless WORKSPACE_EDITABLE=false (the deployed site is read-only).
export const WORKSPACE_WRITES = process.env.WORKSPACE_EDITABLE !== 'false' && process.env.VITE_WORKSPACE_EDITABLE !== 'false';

// Feature flags (Vite env at build time).
// Chatbot is OFF unless VITE_ENABLE_CHAT=true. Workspace editing is ON unless VITE_WORKSPACE_EDITABLE=false.
export const CHAT_ENABLED = import.meta.env.VITE_ENABLE_CHAT === 'true';
export const WORKSPACE_EDITABLE = import.meta.env.VITE_WORKSPACE_EDITABLE !== 'false';

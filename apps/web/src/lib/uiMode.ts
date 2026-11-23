// Two UIs side by side (Ben, 23 Nov 2026): the old UI stays live and unchanged; the new UI (Bellvox look, Dynamics 365 way of working)
// is built beside it and gets every new feature too, through the same page list (modules/registry.tsx: `newComponent`, `newOnly`) and
// shared logic. Which one shows is decided here, once:
//   - dev server: the new UI (add ?oldui to the address to see the old one);
//   - a build made with NEW_UI=1 (preview builds): the new UI;
//   - every other build (the live app): the old UI. In that build `newUi` is constant-false and the new screens are never loaded.
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
export const newUi: boolean = (import.meta.env.DEV || import.meta.env.VITE_NEW_UI === '1') && !params.has('oldui');

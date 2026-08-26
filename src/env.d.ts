// Ambient declarations so `tsc --checkJs` understands Vite's asset imports.
declare module '*.png' {
  const src: string;
  export default src;
}

// The About box's build facts, replaced at build time by vite.config.js's
// `define` (package.json's version; HEAD's commit date as "Aug 24, 2026").
declare const __APP_VERSION__: string;
declare const __APP_DATE__: string;

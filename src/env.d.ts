// Ambient declarations so `tsc --checkJs` understands Vite's asset imports.
declare module '*.png' {
  const src: string;
  export default src;
}

// The built-in text files (src/texts/), each imported whole as a string.
declare module '*.txt?raw' {
  const text: string;
  export default text;
}

// An application's menus (src/apps/<id>/menus.html), the vf-menu fragment
// imported whole as a string; shell/menu-bar.js parses it into live nodes.
declare module '*.html?raw' {
  const html: string;
  export default html;
}

// The About box's build facts, replaced at build time by vite.config.js's
// `define` (package.json's version; HEAD's commit date as "Aug 24, 2026").
declare const __APP_VERSION__: string;
declare const __APP_DATE__: string;

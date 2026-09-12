// Ambient declarations so `tsc --checkJs` understands Vite's asset imports.
declare module '*.png' {
  const src: string;
  export default src;
}

// Built-in text files (src/texts/), imported as strings.
declare module '*.txt?raw' {
  const text: string;
  export default text;
}

// Application menu fragments (src/apps/<id>/menus.html), imported as strings.
declare module '*.html?raw' {
  const html: string;
  export default html;
}

// Set at build time by vite.config.js `define`: the app version and HEAD's
// commit date.
declare const __APP_VERSION__: string;
declare const __APP_DATE__: string;

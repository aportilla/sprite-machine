// Ambient declarations so `tsc --checkJs` understands Vite's asset imports.
declare module '*.png' {
  const src: string;
  export default src;
}

// Pi auto-discovers this stable entrypoint. The bundle keeps Pi's host APIs
// external, avoiding a second local copy of Pi's runtime dependency graph.
export { default } from "./dist/index.js";
export * from "./dist/index.js";

/**
 * Raw YAML imports for knowledge packs.
 *
 * The pack files are inlined at build time rather than read from disk at
 * install time on purpose: a packaged app serves the main bundle from inside
 * the asar archive, and shipping the pack as `extraResources` instead has a
 * known failure mode where the copy is silently skipped for a platform or arch
 * and the install fails only in the shipped build.
 */
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

declare module '*.yml?raw' {
  const content: string;
  export default content;
}

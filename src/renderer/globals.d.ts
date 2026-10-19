import type * as Monaco from 'monaco-editor';

declare global {
  // Loaded at runtime by Monaco's AMD loader (min build), not bundled. Types come from `import type * as M`.
  const monaco: typeof Monaco;
}

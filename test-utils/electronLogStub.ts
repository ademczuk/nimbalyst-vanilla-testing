/**
 * Test stub for `electron-log/renderer`.
 *
 * The real module's last act is `return new Proxy(logger, { get })`, whose trap
 * answers *every* property with a function so unknown levels work as methods.
 * That includes `then`. Under vitest a module is awaited during evaluation, so
 * the promise machinery reads `ns.then`, gets a function, treats the namespace
 * as a thenable, and calls `then(resolve, reject)` -- which routes into
 * `logData([resolve, reject], { level: 'then' })` and never resolves. The
 * import hangs forever, and because it hangs during *import* rather than inside
 * a test, `testTimeout` cannot fire and the whole run waits.
 *
 * Only `renderer/utils/logger.ts` imports the real module, and it uses just the
 * console transport's two settable fields plus `scope()`. Calls forward to the
 * console so a failing test still shows its diagnostics (`silent: 'passed-only'`
 * keeps passing tests quiet).
 */

type LogArgs = unknown[];

interface ScopedLogger {
  error: (...args: LogArgs) => void;
  warn: (...args: LogArgs) => void;
  info: (...args: LogArgs) => void;
  verbose: (...args: LogArgs) => void;
  debug: (...args: LogArgs) => void;
  silly: (...args: LogArgs) => void;
}

function scope(name: string): ScopedLogger {
  const tag = `${name}:`;
  return {
    error: (...args) => console.error(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    info: (...args) => console.info(tag, ...args),
    verbose: (...args) => console.debug(tag, ...args),
    debug: (...args) => console.debug(tag, ...args),
    silly: (...args) => console.debug(tag, ...args),
  };
}

const log = {
  scope,
  transports: {
    console: { level: 'info' as string | false, format: '' },
    ipc: { level: false as string | false },
  },
};

export default log;

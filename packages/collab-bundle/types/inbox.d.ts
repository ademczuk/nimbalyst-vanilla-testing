/**
 * The team inbox transport, for browser and native WebView hosts.
 *
 * Its own entry rather than a line in `feedback-ui.ts`: nothing here is about
 * feedback, or about React. `TeamInboxSync` is the socket every "waiting on me"
 * delivery arrives on — feedback requests today, comments and mentions when
 * their context panes land — so a host that wants the badge and the list should
 * not have to pull the respond card's component graph to get it.
 */
export * from './internal/runtime/src/sync/TeamInboxSync';

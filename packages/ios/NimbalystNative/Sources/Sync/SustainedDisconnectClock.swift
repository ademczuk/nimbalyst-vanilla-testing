import Foundation

/// Decides when a disconnect has lasted long enough to be a real problem.
///
/// Only time spent in the foreground counts. A socket that died while the app
/// was suspended says nothing about the user's session, and a timer scheduled
/// before backgrounding fires the moment the app returns -- which used to show
/// "Sync paused" on every return from a long background, just before the
/// ordinary reconnect cleared it.
struct SustainedDisconnectClock {
    let threshold: TimeInterval
    private(set) var disconnectedSince: Date?
    private var isForeground = true

    init(threshold: TimeInterval) {
        self.threshold = threshold
    }

    mutating func disconnected(at now: Date) {
        guard isForeground, disconnectedSince == nil else { return }
        disconnectedSince = now
    }

    mutating func connected() {
        disconnectedSince = nil
    }

    /// Returns true when the caller should schedule a check `threshold` out.
    mutating func setForeground(_ foreground: Bool, isConnected: Bool, at now: Date) -> Bool {
        isForeground = foreground
        guard foreground else {
            disconnectedSince = nil
            return false
        }
        guard !isConnected else { return false }
        disconnectedSince = now
        return true
    }

    func isSustained(at now: Date, isConnected: Bool) -> Bool {
        guard isForeground, !isConnected, let since = disconnectedSince else { return false }
        return now.timeIntervalSince(since) >= threshold
    }
}

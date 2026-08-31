import Foundation

/// Text the fleet card renders, kept out of the views so it can be tested.
///
/// This file has **target membership in both** the app (through
/// `NimbalystNative`) and the `NimbalystWidgets` extension — the same pattern
/// Apple's own samples use for `ActivityAttributes`. The widget deliberately
/// does not link `NimbalystNative`: the package pulls in GRDB and PostHog, and a
/// widget extension runs under a memory limit that has no business paying for a
/// database engine it will never open.
public enum FleetActivityFormatting {
    /// `14:32`, or `1:04:07` once it has been going for an hour.
    ///
    /// Only ever rendered when the card is stale — a live card uses
    /// `Text(_:style:.timer)`, which ticks on-device for free and never spends a
    /// push. This is the frozen form, for when the desktop has stopped talking
    /// and a still-counting timer would be a lie told once a second.
    public static func elapsedLabel(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3600
        let minutes = (clamped % 3600) / 60
        let secs = clamped % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }

    /// How long ago, in words, for the stale badge.
    public static func agoLabel(seconds: Int) -> String {
        let clamped = max(0, seconds)
        if clamped < 60 { return "just now" }
        let minutes = clamped / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }

    /// The count strip in the card header.
    ///
    /// One phrase, not a row of numbers: the header answers "does anything need
    /// me right now?" and the footer carries everything ambient. When nothing
    /// needs you the header says so in the affirmative rather than going blank,
    /// because a blank header on a visible card reads as a card that failed to
    /// load.
    public static func headline(
        needsYou: Int,
        failed: Int,
        stalled: Int,
        running: Int,
        unread: Int
    ) -> String {
        if needsYou > 0 { return "\(needsYou) need\(needsYou == 1 ? "s" : "") you" }
        if failed > 0 { return "\(failed) failed" }
        if stalled > 0 { return "\(stalled) gone quiet" }
        if running > 0 { return "\(running) running" }
        if unread > 0 { return "\(unread) unread" }
        return "All clear"
    }

    /// What the card says in the row area when nothing is waiting.
    ///
    /// The mockup's "all clear" state: the final update before the activity
    /// ends. It is a sentence, not an empty list, because this is the one moment
    /// the card is worth a glance precisely for saying nothing is wrong.
    public static func allClearSubtitle(running: Int, unread: Int) -> String {
        var parts: [String] = []
        if running > 0 { parts.append("\(running) still running") }
        if unread > 0 { parts.append("\(unread) finished while you were away") }
        return parts.isEmpty ? "Nothing running" : parts.joined(separator: " · ")
    }
}

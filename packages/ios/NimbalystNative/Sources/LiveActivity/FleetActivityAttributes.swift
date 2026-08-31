import Foundation
import SwiftUI

/// The ambient fleet, as the phone renders it.
///
/// This is the wire shape the desktop derives once and both surfaces render:
/// the macOS menu bar strip and this Live Activity consume the same
/// `FleetSnapshot`, so the phone and the menu bar can never disagree about what
/// the fleet is doing. Field names match the desktop's `FleetActivityPayload`
/// exactly and are plain camelCase, so `Codable` needs no `CodingKeys` — the
/// APNs `content-state` object decodes straight into this.
///
/// Lives in `NimbalystNative` rather than in the widget extension so the app and
/// the extension cannot drift: an `ActivityAttributes` type that differs between
/// the two sides fails at `Activity.request` with a type mismatch, and a
/// push-to-start payload whose `attributes-type` no longer names a real
/// conformer is rejected by APNs.
public struct FleetActivityRow: Codable, Hashable, Identifiable, Sendable {
    /// What this row is saying.
    ///
    /// Decoded leniently on purpose. A desktop newer than the app can name a
    /// state this build has never heard of, and a card that throws on decode
    /// shows nothing at all — strictly worse than a row with a neutral dot.
    public enum State: String, Codable, Sendable {
        case approval
        case decision
        case failed
        case stalled
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = State(rawValue: raw) ?? .unknown
        }
    }

    public let sessionId: String
    public let title: String
    /// Workspace basename. The card has no room for a path.
    public let project: String
    public let state: State
    /// Epoch ms this session entered `state`. The phone ticks the elapsed time itself.
    public let since: Int

    public var id: String { sessionId }

    public init(sessionId: String, title: String, project: String, state: State, since: Int) {
        self.sessionId = sessionId
        self.title = title
        self.project = project
        self.state = state
        self.since = since
    }

    /// The instant this row started being true, for `Text(_:style:)`.
    public var sinceDate: Date {
        Date(timeIntervalSince1970: Double(since) / 1000)
    }

    /// The phrase under the title. Matches the desktop panel's wording.
    public var reason: String {
        switch state {
        case .approval: return "needs approval"
        case .decision: return "needs a decision"
        case .failed: return "failed"
        case .stalled: return "gone quiet"
        case .unknown: return "waiting"
        }
    }

    /// Deep link for this row. The app routes it to the session.
    public var url: URL? {
        URL(string: "nimbalyst://session/\(sessionId)")
    }
}

public struct FleetActivityAttributes: Codable, Hashable, Sendable {
    /// The live half of the card.
    ///
    /// Everything here changes, which is why `FleetActivityAttributes` itself is
    /// empty: static per-activity data would be one more shape to keep in step
    /// across two repos for no gain, and the server's push-to-start payload
    /// sends `"attributes": {}` to match.
    public struct ContentState: Codable, Hashable, Sendable {
        public var running: Int
        /// Tool permission / commit proposal pending — a tap.
        public var needsApproval: Int
        /// AskUserQuestion / ExitPlanMode pending — thinking required.
        public var needsDecision: Int
        public var failed: Int
        /// Running, but silent past the desktop's stall threshold.
        public var stalled: Int
        public var unread: Int
        /// Ranked, at most three. Empty means nothing is waiting on you.
        public var rows: [FleetActivityRow]
        /// Waiting sessions that did not fit in `rows`.
        public var overflow: Int
        /// Monotonic per desktop process; lets a late push be ignored.
        public var revision: Int
        /// Epoch ms the desktop generated this.
        public var updatedAt: Int
        /// How long after `updatedAt` this card should call itself stale.
        public var staleAfterMs: Int

        public init(
            running: Int = 0,
            needsApproval: Int = 0,
            needsDecision: Int = 0,
            failed: Int = 0,
            stalled: Int = 0,
            unread: Int = 0,
            rows: [FleetActivityRow] = [],
            overflow: Int = 0,
            revision: Int = 0,
            updatedAt: Int = 0,
            staleAfterMs: Int = 12 * 60_000
        ) {
            self.running = running
            self.needsApproval = needsApproval
            self.needsDecision = needsDecision
            self.failed = failed
            self.stalled = stalled
            self.unread = unread
            self.rows = rows
            self.overflow = overflow
            self.revision = revision
            self.updatedAt = updatedAt
            self.staleAfterMs = staleAfterMs
        }

        /// Decoded defensively so a field this build has not heard of, or one a
        /// newer desktop stopped sending, cannot blank the whole card.
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
            needsApproval = try c.decodeIfPresent(Int.self, forKey: .needsApproval) ?? 0
            needsDecision = try c.decodeIfPresent(Int.self, forKey: .needsDecision) ?? 0
            failed = try c.decodeIfPresent(Int.self, forKey: .failed) ?? 0
            stalled = try c.decodeIfPresent(Int.self, forKey: .stalled) ?? 0
            unread = try c.decodeIfPresent(Int.self, forKey: .unread) ?? 0
            rows = try c.decodeIfPresent([FleetActivityRow].self, forKey: .rows) ?? []
            overflow = try c.decodeIfPresent(Int.self, forKey: .overflow) ?? 0
            revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 0
            updatedAt = try c.decodeIfPresent(Int.self, forKey: .updatedAt) ?? 0
            staleAfterMs = try c.decodeIfPresent(Int.self, forKey: .staleAfterMs) ?? 12 * 60_000
        }

        /// Sessions waiting on the user. The one number the card exists for.
        public var needsYou: Int { needsApproval + needsDecision }

        /// Whether there is anything worth a card at all.
        ///
        /// The same rule as "idle hides the island" on the desktop, one surface
        /// over: an activity that says nothing is a notch of lock-screen real
        /// estate charged for no information.
        public var isActive: Bool {
            running > 0 || needsYou > 0 || failed > 0 || stalled > 0 || unread > 0
        }

        public var updatedAtDate: Date {
            Date(timeIntervalSince1970: Double(updatedAt) / 1000)
        }

        /// When this card should start admitting it may be out of date.
        ///
        /// Handed to ActivityKit as the activity's `staleDate`. A Mac that goes
        /// to sleep stops sending, this passes, and the card dims and says so
        /// rather than confidently showing a count that stopped being true.
        public var staleDate: Date {
            Date(timeIntervalSince1970: Double(updatedAt + staleAfterMs) / 1000)
        }

        /// The top-ranked row, which the card body links to.
        public var headline: FleetActivityRow? { rows.first }

        /// One line summarising everything that did not earn a row.
        ///
        /// Running sessions collapse to the footer by design: ambient, not
        /// actionable. A row that says "still working" costs the space of a row
        /// that says "waiting on you".
        public var footerSummary: String {
            var parts: [String] = []
            if running > 0 { parts.append("\(running) running") }
            if stalled > 0 { parts.append("\(stalled) gone quiet") }
            if failed > 0 { parts.append("\(failed) failed") }
            if unread > 0 { parts.append("\(unread) unread") }
            if overflow > 0 { parts.append("\(overflow) more waiting") }
            return parts.joined(separator: " · ")
        }
    }
}

#if os(iOS)
import ActivityKit

/// Declared in an extension, not on the type, so the model still compiles on
/// macOS — the package builds for both, `swift test` runs on the Mac, and
/// ActivityKit exists only on iOS.
extension FleetActivityAttributes: ActivityAttributes {}
#endif

public extension FleetActivityRow.State {
    /// Palette shared with the desktop strip (`stripMarkup.ts`), so a colour
    /// means the same thing in the menu bar and on the lock screen.
    var color: Color {
        switch self {
        case .approval: return Color(hex: 0xFBBF24)
        case .decision: return Color(hex: 0xF0ABFC)
        case .failed: return Color(hex: 0xEF4444)
        case .stalled: return Color(hex: 0x94A3B8)
        case .unknown: return Color(hex: 0xB3B3B3)
        }
    }
}

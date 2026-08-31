import ActivityKit
import SwiftUI
import WidgetKit

/// The ambient session fleet, on the lock screen and in the Dynamic Island.
///
/// Entirely server-driven: the desktop derives one `FleetSnapshot`, the sync
/// server starts this activity through a push-to-start token and updates it
/// through the token the activity hands back. Nothing here reads local state,
/// which is why the extension links no database.
///
/// Two behaviours are load-bearing and easy to break:
///
/// - **Every elapsed value is `Text(_:style:)`.** They tick on-device at zero
///   push cost. Rendering a pre-formatted duration from the payload would need a
///   push per second and would be throttled into uselessness within the hour.
/// - **`context.isStale` freezes them.** When the Mac sleeps the desktop stops
///   sending, the stale date passes, and the card dims and says so. A timer that
///   keeps counting past that point is a confident lie, which is worse than no
///   card at all.
struct FleetActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FleetActivityAttributes.self) { context in
            FleetLockScreenView(state: context.state, isStale: context.isStale)
                // Rows are their own `Link`s; this is the fallback for a tap
                // that lands on the card but not on a row. It goes to the
                // top-ranked session rather than to the app's last screen,
                // which is almost never what you were reaching for.
                .widgetURL(context.state.headline?.url)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        FleetAppMark()
                        Text("Nimbalyst")
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 9) {
                        if context.state.needsYou > 0 {
                            FleetIslandBadge(count: context.state.needsYou, color: Color(hex: 0xFBBF24))
                        }
                        if context.state.running > 0 {
                            FleetIslandBadge(count: context.state.running, color: Color(hex: 0x60A5FA))
                        }
                        if context.state.failed > 0 {
                            FleetIslandBadge(count: context.state.failed, color: Color(hex: 0xEF4444))
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // The same ranked rows as the lock screen, each its own deep
                    // link. Project names are dropped: the island is the tighter
                    // of the two presentations and the title has to win.
                    if context.state.rows.isEmpty {
                        FleetAllClearRow(state: context.state)
                    } else {
                        VStack(spacing: 1) {
                            ForEach(context.state.rows) { row in
                                FleetRowView(
                                    row: row,
                                    frozenElapsed: context.isStale
                                        ? (context.state.updatedAt - row.since) / 1000
                                        : nil,
                                    showsProject: false
                                )
                            }
                        }
                        .opacity(context.isStale ? 0.62 : 1)
                    }
                }
            } compactLeading: {
                // Leading is what wants you; trailing is what is still working.
                if context.state.needsYou > 0 {
                    FleetIslandBadge(count: context.state.needsYou, color: Color(hex: 0xFBBF24))
                } else if context.state.failed > 0 {
                    FleetIslandBadge(count: context.state.failed, color: Color(hex: 0xEF4444))
                } else {
                    FleetIslandBadge(count: context.state.running, color: Color(hex: 0x60A5FA))
                }
            } compactTrailing: {
                if context.state.needsYou > 0 && context.state.running > 0 {
                    FleetIslandBadge(
                        count: context.state.running,
                        color: Color(hex: 0x60A5FA),
                        showsDot: false
                    )
                }
            } minimal: {
                // One number, and it is always the most urgent one: another app
                // owns the island, so there is room for exactly one fact.
                FleetIslandBadge(
                    count: minimalCount(context.state),
                    color: minimalColor(context.state),
                    showsDot: false
                )
            }
            .widgetURL(context.state.headline?.url)
            .keylineTint(minimalColor(context.state))
        }
    }

    private func minimalCount(_ state: FleetActivityAttributes.ContentState) -> Int {
        if state.needsYou > 0 { return state.needsYou }
        if state.failed > 0 { return state.failed }
        if state.stalled > 0 { return state.stalled }
        return state.running
    }

    private func minimalColor(_ state: FleetActivityAttributes.ContentState) -> Color {
        if state.needsYou > 0 { return Color(hex: 0xFBBF24) }
        if state.failed > 0 { return Color(hex: 0xEF4444) }
        if state.stalled > 0 { return Color(hex: 0x94A3B8) }
        return Color(hex: 0x60A5FA)
    }
}

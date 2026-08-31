import SwiftUI
import WidgetKit

// MARK: - Shared pieces

/// The state dot. Does work the name cannot: a session title does not tell you
/// whether responding costs three seconds or ten minutes, and this does, at zero
/// width. Same palette as the macOS menu bar strip.
struct FleetStateDot: View {
    let state: FleetActivityRow.State
    var size: CGFloat = 6

    var body: some View {
        Circle()
            .fill(state.color)
            .frame(width: size, height: size)
    }
}

/// One session on the card.
///
/// A `Link`, so a tap goes straight to that session rather than to the app's
/// last screen. Rows are the whole reason the card has more value than a badge.
struct FleetRowView: View {
    let row: FleetActivityRow
    /// Frozen elapsed seconds. Non-nil only when the card is stale, where a
    /// ticking timer would be a lie told once a second.
    let frozenElapsed: Int?
    var showsProject: Bool = true
    var isTop: Bool = false

    var body: some View {
        if let url = row.url {
            Link(destination: url) { content }
        } else {
            content
        }
    }

    private var content: some View {
        HStack(spacing: 10) {
            FleetStateDot(state: row.state)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(row.reason)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(row.state.color)
                    if showsProject && !row.project.isEmpty {
                        Text("·").foregroundStyle(.white.opacity(0.28))
                        Text(row.project)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.white.opacity(0.38))
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 6)
            timer
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.white.opacity(0.32))
        }
        .padding(.vertical, 7)
        .padding(.horizontal, isTop ? 8 : 2)
        .background(
            isTop
                ? RoundedRectangle(cornerRadius: 10).fill(row.state.color.opacity(0.09))
                : RoundedRectangle(cornerRadius: 10).fill(.clear)
        )
    }

    @ViewBuilder
    private var timer: some View {
        if let frozen = frozenElapsed {
            Text(FleetActivityFormatting.elapsedLabel(seconds: frozen))
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.5))
        } else if row.state == .failed {
            // A failure is not a duration anyone is waiting out, so it reads as
            // "when", not "how long".
            Text(row.sinceDate, style: .relative)
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.55))
                .lineLimit(1)
        } else {
            // On-device and free: this is the only element allowed to change
            // without a push, which is exactly why the card can afford it.
            Text(row.sinceDate, style: .timer)
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(1)
                .frame(maxWidth: 62, alignment: .trailing)
        }
    }
}

/// The "nothing is waiting on you" row.
struct FleetAllClearRow: View {
    let state: FleetActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(Color(hex: 0x4ADE80))
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text("Nothing waiting on you")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Text(FleetActivityFormatting.allClearSubtitle(
                    running: state.running,
                    unread: state.unread
                ))
                .font(.system(size: 11.5))
                .foregroundStyle(.white.opacity(0.45))
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 2)
    }
}

// MARK: - Lock screen

/// The lock screen / banner presentation.
///
/// Three rows and no rotation: the lock screen has the vertical room, so
/// rotation would solve a problem that only exists in the island. Everything
/// ambient — running counts, overflow — collapses into the footer.
struct FleetLockScreenView: View {
    let state: FleetActivityAttributes.ContentState
    let isStale: Bool

    private var frozenElapsed: ((FleetActivityRow) -> Int?) {
        guard isStale else { return { _ in nil } }
        return { row in (state.updatedAt - row.since) / 1000 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if state.rows.isEmpty {
                FleetAllClearRow(state: state)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(state.rows.enumerated()), id: \.element.sessionId) { index, row in
                        if index > 0 {
                            Divider().overlay(Color.white.opacity(0.07))
                        }
                        FleetRowView(
                            row: row,
                            frozenElapsed: frozenElapsed(row),
                            isTop: index == 0
                        )
                    }
                }
            }
            footer
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 11)
        .opacity(isStale ? 0.62 : 1)
    }

    private var header: some View {
        HStack(spacing: 7) {
            FleetAppMark()
            Text("NIMBALYST")
                .font(.system(size: 12, weight: .semibold))
                .kerning(0.3)
                .foregroundStyle(.white.opacity(0.55))
            Spacer(minLength: 6)
            if isStale {
                Text("Updated \(FleetActivityFormatting.agoLabel(seconds: staleSeconds))")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.45))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2.5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.08)))
            } else {
                HStack(spacing: 4.5) {
                    Circle().fill(headlineColor).frame(width: 6, height: 6)
                    Text(FleetActivityFormatting.headline(
                        needsYou: state.needsYou,
                        failed: state.failed,
                        stalled: state.stalled,
                        running: state.running,
                        unread: state.unread
                    ))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(headlineColor)
                }
            }
        }
        .padding(.bottom, 9)
    }

    @ViewBuilder
    private var footer: some View {
        let summary = state.footerSummary
        if !summary.isEmpty {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: 0x60A5FA)).frame(width: 6, height: 6)
                Text(summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.top, 8)
            .overlay(alignment: .top) {
                Rectangle().fill(.white.opacity(0.07)).frame(height: 0.5)
            }
        } else if isStale {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: 0x808080)).frame(width: 6, height: 6)
                Text("Your Mac is asleep — counts may be out of date")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.top, 8)
        }
    }

    /// Seconds since the desktop last spoke, for the stale badge. Computed
    /// against the stale date rather than `Date()` so the string is stable for
    /// the life of a render pass.
    private var staleSeconds: Int {
        max(0, Int(Date().timeIntervalSince(state.updatedAtDate)))
    }

    private var headlineColor: Color {
        if state.needsYou > 0 { return Color(hex: 0xFBBF24) }
        if state.failed > 0 { return Color(hex: 0xEF4444) }
        if state.stalled > 0 { return Color(hex: 0x94A3B8) }
        if state.running > 0 { return Color(hex: 0x60A5FA) }
        return Color(hex: 0x4ADE80)
    }
}

/// The little app mark in the card header.
struct FleetAppMark: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 5)
            .fill(LinearGradient(
                colors: [Color(hex: 0x60A5FA), Color(hex: 0x3B82F6)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .frame(width: 17, height: 17)
            .overlay(
                Text("N")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(hex: 0x0B1220))
            )
    }
}

// MARK: - Dynamic Island

/// The count badge used in the compact and minimal presentations.
struct FleetIslandBadge: View {
    let count: Int
    let color: Color
    var showsDot: Bool = true

    var body: some View {
        HStack(spacing: 4) {
            if showsDot {
                Circle().fill(color).frame(width: 6, height: 6)
            }
            Text("\(count)")
                .font(.system(size: 13, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}

import SwiftUI

/// A quiet "Reconnecting..." strip for the ordinary gap after returning from
/// the background. It is not a warning: a disconnect only becomes one after
/// `SustainedDisconnectClock` says so, and then `SyncAuthDegradedBanner`
/// replaces this. Waits a moment before appearing so a fast reconnect shows
/// nothing at all.
struct SyncReconnectingNotice: View {
    let isDisconnected: Bool
    @State private var isVisible = false

    var body: some View {
        Group {
            if isVisible {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("Reconnecting…")
                        .font(.caption)
                        .foregroundStyle(NimbalystColors.textMuted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(NimbalystColors.backgroundTertiary.opacity(0.6))
                .transition(.move(edge: .top).combined(with: .opacity))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sync-reconnecting-notice")
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isVisible)
        .task(id: isDisconnected) {
            guard isDisconnected else {
                isVisible = false
                return
            }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { isVisible = true }
        }
    }
}

import Foundation
import os

#if os(iOS)
import ActivityKit
#endif

/// Which ActivityKit token this is.
///
/// Not interchangeable, and neither is the APNs device token. A push-to-start
/// token belongs to the app and lets the card appear without the app being
/// opened; an update token belongs to one live activity and dies with it.
/// Sending an update to a push-to-start token fails at APNs with an error
/// indistinguishable from a bad token, which is exactly how the two would
/// quietly get conflated — so they travel as separate kinds all the way to the
/// server's storage.
public enum LiveActivityTokenKind: String, Sendable {
    case pushToStart
    case update
}

/// Owns the phone's half of the ambient fleet surface.
///
/// Deliberately does **not** start an activity itself. The whole card is
/// server-driven: the desktop pushes a fleet snapshot, the server starts the
/// activity through the push-to-start token, and updates it through the token
/// that activity then hands back. That is what makes the card appear on a phone
/// whose owner has not opened the app all day, which is the only version of this
/// feature that is worth having — and it is also what makes the ActivityKit
/// ~8-hour ceiling a non-event: the activity ends, this class notices and drops
/// the update token, the server sees no update token and starts a fresh one on
/// the next snapshot.
@MainActor
public final class FleetActivityController: ObservableObject {
    public static let shared = FleetActivityController()

    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "FleetActivity")

    private static let enabledKey = "liveActivityEnabled"
    private static let hasStoredEnabledKey = "liveActivityEnabledStored"

    /// Whether the user wants the fleet card.
    ///
    /// Independent of push notifications on purpose: a Live Activity needs no
    /// notification permission, makes no sound, and someone who has declined
    /// alerts may still want the ambient card — and vice versa.
    @Published public private(set) var isEnabled: Bool

    /// The push-to-start token most recently issued, for a late-arriving sync connection.
    @Published public private(set) var pushToStartToken: String?
    /// The update token of the activity currently on screen, if any.
    @Published public private(set) var updateToken: String?

    /// Set by `SyncManager`. Called whenever a token appears or rotates.
    public var onTokenReceived: ((String, LiveActivityTokenKind) -> Void)?
    /// Called when a token kind stops being valid. `nil` kind means every kind.
    public var onTokenInvalidated: ((LiveActivityTokenKind?) -> Void)?

    private var observationTasks: [Task<Void, Never>] = []
    /// Keyed by activity id so a second activity cannot orphan the first's observer.
    private var activityTasks: [String: [Task<Void, Never>]] = [:]

    private init() {
        let defaults = UserDefaults.standard
        // Defaults on. The card costs nothing when the fleet is quiet — the
        // server ends it — and a surface nobody has been told about is a
        // surface nobody turns on.
        self.isEnabled = defaults.bool(forKey: Self.hasStoredEnabledKey)
            ? defaults.bool(forKey: Self.enabledKey)
            : true
    }

    /// Whether the system will show Live Activities for this app at all.
    public var areActivitiesEnabled: Bool {
        #if os(iOS)
        return ActivityAuthorizationInfo().areActivitiesEnabled
        #else
        return false
        #endif
    }

    /// Whether the server should be holding tokens for this device right now.
    public var shouldRegister: Bool {
        isEnabled && areActivitiesEnabled
    }

    /// Begin (or stop) watching ActivityKit for tokens.
    ///
    /// Safe to call repeatedly — `AppState` calls it on launch and `SettingsView`
    /// calls it on every toggle.
    public func start() {
        guard shouldRegister else {
            stop(invalidateTokens: true)
            return
        }
        #if os(iOS)
        guard observationTasks.isEmpty else { return }

        observationTasks.append(Task { [weak self] in
            for await tokenData in Activity<FleetActivityAttributes>.pushToStartTokenUpdates {
                self?.handlePushToStartToken(tokenData)
            }
        })

        // Catches activities this app did not create — which is all of them,
        // since the server starts them. Without this the update token for a
        // remotely-started card would never reach the server and the card would
        // freeze at whatever the start payload said.
        observationTasks.append(Task { [weak self] in
            for await activity in Activity<FleetActivityAttributes>.activityUpdates {
                self?.observe(activity)
            }
        })

        for activity in Activity<FleetActivityAttributes>.activities {
            observe(activity)
        }
        #endif
    }

    /// Stop observing. `invalidateTokens` also tells the server to forget us.
    public func stop(invalidateTokens: Bool) {
        for task in observationTasks { task.cancel() }
        observationTasks.removeAll()
        for tasks in activityTasks.values {
            for task in tasks { task.cancel() }
        }
        activityTasks.removeAll()

        if invalidateTokens {
            pushToStartToken = nil
            updateToken = nil
            onTokenInvalidated?(nil)
        }
    }

    public func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
        UserDefaults.standard.set(true, forKey: Self.hasStoredEnabledKey)
        if enabled {
            start()
        } else {
            #if os(iOS)
            // Turning the feature off has to take the card off the screen too,
            // not just stop it updating — a frozen card is worse than none.
            // Stays on the main actor: an `Activity` handed to a detached task
            // is a data-race the compiler rejects, and there is nothing to gain
            // from leaving the actor to make three async calls.
            Task { @MainActor in
                for activity in Activity<FleetActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            #endif
            stop(invalidateTokens: true)
        }
    }

    /// Re-send whatever tokens we hold. Called when the sync socket connects.
    public func resendTokens() {
        guard shouldRegister else { return }
        if let token = pushToStartToken { onTokenReceived?(token, .pushToStart) }
        if let token = updateToken { onTokenReceived?(token, .update) }
    }

    // MARK: - ActivityKit plumbing

    #if os(iOS)
    private func handlePushToStartToken(_ tokenData: Data) {
        let token = Self.hex(tokenData)
        guard token != pushToStartToken else { return }
        pushToStartToken = token
        logger.info("Live Activity push-to-start token: \(token.prefix(8), privacy: .public)...")
        onTokenReceived?(token, .pushToStart)
    }

    private func observe(_ activity: Activity<FleetActivityAttributes>) {
        guard activityTasks[activity.id] == nil else { return }

        let tokenTask = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                self?.handleUpdateToken(Self.hex(tokenData))
            }
        }
        let stateTask = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                self?.handleActivityState(state, id: activity.id)
            }
        }
        activityTasks[activity.id] = [tokenTask, stateTask]
    }

    private func handleUpdateToken(_ token: String) {
        guard token != updateToken else { return }
        updateToken = token
        logger.info("Live Activity update token: \(token.prefix(8), privacy: .public)...")
        onTokenReceived?(token, .update)
    }

    private func handleActivityState(_ state: ActivityState, id: String) {
        switch state {
        case .ended, .dismissed:
            // The ActivityKit ceiling lands here as routinely as a real end
            // does. Dropping the token is what lets the server start a fresh
            // card on the next snapshot instead of pushing into a dead one.
            for task in activityTasks.removeValue(forKey: id) ?? [] { task.cancel() }
            updateToken = nil
            onTokenInvalidated?(.update)
        default:
            // Everything that is not an end — active, stale, and the iOS 26
            // `pending` state a push-to-start card sits in before it appears —
            // means the card is live or on its way, so the update token stands.
            // Listed as `default` rather than case-by-case so a new non-terminal
            // state added by a future SDK keeps the token instead of dropping it.
            break
        }
    }
    #endif

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

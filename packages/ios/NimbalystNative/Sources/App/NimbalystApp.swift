import SwiftUI
import GRDB

#if canImport(UIKit)
import UIKit

/// Invisible UIView overlay that intercepts all touches to report user activity
/// for device presence tracking. Passes all touches through without consuming them.
/// This mirrors how the Electron app uses document-level event listeners.
class ActivityTrackingView: UIView {
    var onActivity: (() -> Void)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // Report activity on any touch, then return nil to pass through
        onActivity?()
        return nil
    }
}

/// SwiftUI wrapper for the activity tracking overlay.
struct ActivityTrackingOverlay: UIViewRepresentable {
    let onActivity: () -> Void

    func makeUIView(context: Context) -> ActivityTrackingView {
        let view = ActivityTrackingView()
        view.onActivity = onActivity
        view.isUserInteractionEnabled = true
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: ActivityTrackingView, context: Context) {
        uiView.onActivity = onActivity
    }
}
#endif

/// Root content view that handles navigation based on pairing and auth state.
public struct ContentView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        Group {
            if appState.accountStorageNeedsRepair {
                AccountStorageRepairView()
            } else if !appState.isPaired {
                PairingView()
            } else if !appState.authManager.isAuthenticated {
                LoginView()
            } else {
                MainNavigationView()
            }
        }
        .preferredColorScheme(.dark)
        #if canImport(UIKit)
        .overlay {
            // Invisible overlay that reports user activity on any touch.
            // Throttling is handled inside WebSocketClient.reportActivity().
            ActivityTrackingOverlay {
                appState.syncManager?.reportUserActivity()
            }
            .allowsHitTesting(true)
        }
        #endif
    }
}

/// Blocks normal pairing when an existing account blob is unreadable. Resetting
/// is deliberately explicit because it permanently removes the preserved data.
private struct AccountStorageRepairView: View {
    @EnvironmentObject var appState: AppState
    @State private var confirmingReset = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 56))
                .foregroundStyle(NimbalystColors.warning)

            Text("Account Data Needs Repair")
                .font(.title2)
                .fontWeight(.bold)

            Text("Your stored account record could not be read. It has been preserved and was not treated as a signed-out account. Reset only if you are ready to pair this device again.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button("Reset and Pair Again", role: .destructive) {
                confirmingReset = true
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .confirmationDialog(
            "Reset stored account data?",
            isPresented: $confirmingReset,
            titleVisibility: .visible
        ) {
            Button("Reset Account Data", role: .destructive) {
                appState.unpair()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the preserved account record from this device. You will need to pair again from the desktop app.")
        }
    }
}

/// Login screen shown after pairing but before authentication.
/// Offers Google OAuth and email magic link sign-in.
/// The paired email (from QR code) determines which account to use.
public struct LoginView: View {
    @EnvironmentObject var appState: AppState
    @State private var accountSwitchError: String?

    private var pairedEmail: String? {
        if let email = KeychainManager.getUserId(), email.contains("@") {
            return email
        }
        return nil
    }

    public init() {}

    public var body: some View {
        let _ = NSLog("[LoginView] getUserId=\(KeychainManager.getUserId() ?? "nil"), pairedEmail=\(pairedEmail ?? "nil")")
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 64))
                .foregroundStyle(NimbalystColors.primary)

            Text("Sign In")
                .font(.title)
                .fontWeight(.bold)

            if let pairedEmail {
                Text("Sign in as **\(pairedEmail)** to sync with the desktop app.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            } else {
                Text("Sign in with the same account you use on the desktop app to sync your sessions.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            #if os(iOS)
            if appState.authManager.magicLinkSent {
                // Waiting for user to tap the link in their email
                magicLinkSentView
            } else {
                // Sign-in buttons
                VStack(spacing: 12) {
                    Button {
                        guard let serverUrl = KeychainManager.getServerUrl() else { return }
                        appState.authManager.login(serverUrl: serverUrl)
                    } label: {
                        HStack(spacing: 8) {
                            if appState.authManager.isAuthenticating {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text(appState.authManager.isAuthenticating ? "Signing in..." : "Sign in with Google")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(NimbalystColors.primary)
                        .foregroundStyle(.white)
                        .cornerRadius(12)
                    }
                    .disabled(appState.authManager.isAuthenticating)

                    if let email = pairedEmail {
                        Button {
                            guard let serverUrl = KeychainManager.getServerUrl() else { return }
                            appState.authManager.sendMagicLink(email: email, serverUrl: serverUrl)
                        } label: {
                            HStack(spacing: 8) {
                                if appState.authManager.isAuthenticating {
                                    ProgressView()
                                        .tint(NimbalystColors.primary)
                                }
                                Text(appState.authManager.isAuthenticating ? "Sending..." : "Sign in with email link")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Color.clear)
                            .foregroundStyle(NimbalystColors.primary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(NimbalystColors.primary, lineWidth: 1.5)
                            )
                        }
                        .disabled(appState.authManager.isAuthenticating)
                    }
                }
                .padding(.horizontal, 32)
            }
            #endif

            if let error = appState.authManager.authError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(NimbalystColors.warning)
                    Text(error)
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(NimbalystColors.warning.opacity(0.1))
                .cornerRadius(8)
                .padding(.horizontal, 32)
            }

            if appState.accounts.count > 1 {
                Menu {
                    ForEach(appState.accounts) { account in
                        Button {
                            do {
                                try appState.switchAccount(to: account.id)
                            } catch {
                                accountSwitchError = error.localizedDescription
                            }
                        } label: {
                            if account.id == appState.activeAccountId {
                                Label(account.email, systemImage: "checkmark")
                            } else {
                                Text(account.email)
                            }
                        }
                    }
                } label: {
                    Label("Switch Account", systemImage: "person.2")
                }
                .buttonStyle(.bordered)
            }

            if let accountSwitchError {
                Text(accountSwitchError)
                    .font(.caption)
                    .foregroundStyle(NimbalystColors.error)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button("Unpair Device") {
                appState.unpair()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.bottom, 24)
        }
    }

    #if os(iOS)
    private var magicLinkSentView: some View {
        VStack(spacing: 16) {
            Image(systemName: "envelope.badge")
                .font(.system(size: 36))
                .foregroundStyle(NimbalystColors.success)

            Text("Check your email")
                .font(.headline)

            if let email = pairedEmail {
                Text("We sent a sign-in link to **\(email)**. Tap the link in your email to continue.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button("Resend link") {
                guard let email = pairedEmail,
                      let serverUrl = KeychainManager.getServerUrl() else { return }
                appState.authManager.magicLinkSent = false
                appState.authManager.sendMagicLink(email: email, serverUrl: serverUrl)
            }
            .font(.callout)
            .foregroundStyle(NimbalystColors.primary)
            .padding(.top, 4)

            Button("Use a different sign-in method") {
                appState.authManager.magicLinkSent = false
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
        }
        .padding(.horizontal, 32)
    }
    #endif
}

/// Main navigation using NavigationStack for iPhone and NavigationSplitView for iPad.
///
/// iPad layout: two-column split view.
///   - Sidebar: session list for the auto-selected (or user-picked) project
///   - Detail: session transcript
///   - Project switcher via toolbar folder button (sheet)
///
/// iPhone layout: standard stack navigation (Projects -> Sessions -> Detail).
public struct MainNavigationView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL
    @State private var navigationPath = NavigationPath()
    @State private var showNotificationPrompt = false
    @State private var showVoiceSettings = false
    @ObservedObject private var notificationManager = NotificationManager.shared

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            if appState.syncAuthDegraded {
                SyncAuthDegradedBanner {
                    appState.signOutForAuthRecovery()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            Group {
                if sizeClass == .regular {
                    IPadNavigationView()
                        .environmentObject(appState)
                } else {
                    NavigationStack(path: $navigationPath) {
                        ProjectListView()
                            .environmentObject(appState)
                            // Registered at the stack root so a notification tap
                            // resolves at any depth. The Session destination lives
                            // in SessionListView (depth 1) and can only be pushed
                            // once that view has rendered.
                            .navigationDestination(for: PendingSessionRoute.self) { route in
                                if let db = appState.databaseManager {
                                    PendingSessionView(sessionId: route.sessionId, database: db)
                                        .environmentObject(appState)
                                }
                            }
                    }
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: appState.syncAuthDegraded)
        #if os(iOS)
        .overlay(alignment: .bottom) {
            if let voice = appState.voiceAgent, voice.state != .disconnected {
                VoiceOverlay(voiceAgent: voice)
                    .padding(.bottom, 8)
            }
        }
        #endif
        // iPad consumes this in IPadNavigationView, which owns its own selection
        // state — clearing it here would race that view out of the tap.
        .onChange(of: notificationManager.pendingSessionId) { _, newValue in
            guard sizeClass != .regular, let sessionId = newValue else { return }
            navigateToSession(sessionId)
            notificationManager.pendingSessionId = nil
        }
        #if os(iOS)
        // Voice agent created a session on this device — open it. iPhone navigates
        // its stack here; iPad sets selectedSession in IPadNavigationView, which
        // clears the request. Guard on compact so we don't consume the iPad case.
        .onChange(of: appState.voiceNavigationRequest) { _, newValue in
            guard sizeClass != .regular, let sessionId = newValue else { return }
            navigateToSession(sessionId)
            appState.voiceNavigationRequest = nil
        }
        #endif
        .onAppear {
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
            AnalyticsManager.shared.capture("mobile_app_opened", properties: [
                "platform": "ios",
                "$set": ["nimbalyst_mobile_version": version],
            ])

            // Handle notification tap that launched the app
            if sizeClass != .regular, let sessionId = notificationManager.pendingSessionId {
                navigateToSession(sessionId)
                notificationManager.pendingSessionId = nil
            }

            // Show one-time push notification prompt after pairing + auth
            if notificationManager.shouldPromptForNotifications {
                // Small delay so the main view finishes rendering first
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    showNotificationPrompt = true
                }
            }
        }
        .alert("Enable Notifications?", isPresented: $showNotificationPrompt) {
            Button("Enable") {
                notificationManager.markPromptShown()
                Task {
                    _ = await notificationManager.requestPermission()
                }
            }
            Button("Not Now", role: .cancel) {
                notificationManager.markPromptShown()
            }
        } message: {
            Text("Get notified when your AI sessions complete or need your attention, even when Nimbalyst is in the background.")
        }
        .alert("Re-pair Required", isPresented: $appState.needsRepair) {
            Button("Re-pair Now") {
                appState.unpair()
            }
            Button("Dismiss", role: .cancel) {}
        } message: {
            Text("Your sessions could not be decrypted. The encryption key on this device no longer matches the desktop app. Please re-pair by scanning the QR code from the desktop app's settings.")
        }
        #if os(iOS)
        .alert(item: voiceActivationIssueBinding) { issue in
            switch issue {
            case .missingOpenAIKey:
                return Alert(
                    title: Text("Voice Agent Unavailable"),
                    message: Text("Sync an OpenAI API key from Nimbalyst on your computer before starting the voice agent."),
                    primaryButton: .default(Text("Open Voice Settings")) {
                        showVoiceSettings = true
                    },
                    secondaryButton: .cancel()
                )
            case .microphonePermissionDenied:
                return Alert(
                    title: Text("Microphone Access Required"),
                    message: Text("Allow microphone access in iOS Settings to use the voice agent."),
                    primaryButton: .default(Text("Open Settings")) {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    },
                    secondaryButton: .cancel()
                )
            case .audioSessionFailed(let message):
                return Alert(
                    title: Text("Voice Agent Could Not Start"),
                    message: Text(message),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
        .sheet(isPresented: $showVoiceSettings) {
            NavigationStack {
                SettingsView()
                    .environmentObject(appState)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showVoiceSettings = false }
                        }
                    }
            }
        }
        #endif
    }

    #if os(iOS)
    private var voiceActivationIssueBinding: Binding<VoiceAgent.ActivationIssue?> {
        Binding(
            get: { appState.voiceAgent?.activationIssue },
            set: { newValue in
                if newValue == nil {
                    appState.voiceAgent?.dismissActivationIssue()
                }
            }
        )
    }
    #endif

    /// Open the session a push notification (or the voice agent) named.
    ///
    /// Navigates to a sessionId-keyed route rather than to a `Session` value,
    /// because the session frequently has not synced to this device yet — a
    /// notification about a just-created session names a row we have never seen.
    /// `PendingSessionView` waits for it. The whole path is assigned in one
    /// synchronous update; the previous chained `asyncAfter` hops could be
    /// outrun by a cold launch and were dropped silently by SwiftUI.
    private func navigateToSession(_ sessionId: String) {
        guard sizeClass != .regular else { return }

        let plan = SessionNavigation.plan(for: sessionId, in: appState.databaseManager)
        var path = NavigationPath()
        if let project = plan.project {
            path.append(project)
        }
        path.append(plan.route)
        navigationPath = path
    }
}

// MARK: - iPad Navigation

/// iPad two-column layout: sessions sidebar + session detail.
/// Project selection is via a toolbar picker sheet rather than a dedicated column,
/// since the project list is a one-time selection, not a persistent sidebar.
struct IPadNavigationView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedProject: Project?
    @State private var selectedSession: Session?
    @State private var selectedDocument: SyncedDocument?
    @State private var showProjectPicker = false
    @State private var projects: [Project] = []
    @State private var projectsCancellable: AnyDatabaseCancellable?
    /// Session a push notification asked for, held until it syncs in.
    @State private var pendingNotificationSessionId: String?
    @ObservedObject private var notificationManager = NotificationManager.shared

    var body: some View {
        NavigationSplitView {
            if let project = selectedProject {
                SessionListView(
                    project: project,
                    selectedSession: $selectedSession,
                    selectedDocument: $selectedDocument,
                    onSwitchProject: { showProjectPicker = true }
                )
                .environmentObject(appState)
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "folder")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("No Projects")
                        .font(.title3)
                    Text("Projects will appear once synced from the desktop app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        } detail: {
            // Stays mounted after it resolves, so the transcript it just loaded
            // is not torn down and rebuilt; cleared when the user picks something
            // else in the sidebar.
            if let pendingId = pendingNotificationSessionId, let db = appState.databaseManager {
                PendingSessionView(sessionId: pendingId, database: db) { session in
                    adoptNotificationSession(session)
                }
                .environmentObject(appState)
                .id(pendingId)
            } else if let doc = selectedDocument {
                #if canImport(UIKit)
                DocumentEditorView(document: doc)
                    .environmentObject(appState)
                    .id(doc.id)
                #else
                Text("Select a session")
                    .foregroundStyle(.secondary)
                #endif
            } else if let session = selectedSession {
                // No `.id(session.id)` — SessionDetailView handles in-place
                // session swap (see swapSession) so SwiftUI reuses the same
                // view, the same TranscriptWebView, and the React-side
                // multi-session DOM cache inside it when the user picks a
                // different session in the sidebar.
                SessionDetailView(session: session)
                    .environmentObject(appState)
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear { startObservingProjects() }
        .onReceive(appState.$databaseManager) { database in
            projectsCancellable?.cancel()
            projectsCancellable = nil
            projects = []
            selectedProject = nil
            selectedSession = nil
            selectedDocument = nil
            if database != nil {
                startObservingProjects()
            }
        }
        .onDisappear { projectsCancellable?.cancel() }
        .sheet(isPresented: $showProjectPicker) {
            projectPickerSheet
        }
        .onChange(of: notificationManager.pendingSessionId) { _, newValue in
            guard let sessionId = newValue else { return }
            pendingNotificationSessionId = sessionId
            notificationManager.pendingSessionId = nil
        }
        .onAppear {
            // A tap that cold-launched the app arrives before this view exists.
            if let sessionId = notificationManager.pendingSessionId {
                pendingNotificationSessionId = sessionId
                notificationManager.pendingSessionId = nil
            }
        }
        // Any other sidebar choice supersedes the notification.
        .onChange(of: selectedSession) { _, newValue in
            if let pending = pendingNotificationSessionId, newValue?.id != pending {
                pendingNotificationSessionId = nil
            }
        }
        .onChange(of: selectedDocument) { _, newValue in
            if newValue != nil { pendingNotificationSessionId = nil }
        }
        #if os(iOS)
        .onChange(of: appState.voiceNavigationRequest) { _, newValue in
            guard let sessionId = newValue else { return }
            openVoiceCreatedSession(sessionId)
            appState.voiceNavigationRequest = nil
        }
        #endif
    }

    /// Bring the sidebar in line with a notification-opened session once it has
    /// synced. `pendingNotificationSessionId` deliberately stays set so the
    /// detail column keeps the transcript it already built.
    private func adoptNotificationSession(_ session: Session) {
        if selectedProject?.id != session.projectId,
           let db = appState.databaseManager,
           let project = try? db.writer.read({ db in try Project.fetchOne(db, id: session.projectId) }) {
            selectedProject = project
            configureVoiceForProject(project)
        }
        selectedDocument = nil
        selectedSession = session
    }

    /// Open a session the voice agent just created (iPad split view): select its
    /// project if different, then show it in the detail column.
    private func openVoiceCreatedSession(_ sessionId: String) {
        guard let db = appState.databaseManager,
              let session = try? db.session(byId: sessionId) else { return }
        if selectedProject?.id != session.projectId,
           let project = try? db.writer.read({ db in try Project.fetchOne(db, id: session.projectId) }) {
            selectedProject = project
            configureVoiceForProject(project)
        }
        selectedDocument = nil
        selectedSession = session
    }

    private var projectPickerSheet: some View {
        NavigationStack {
            List(projects) { project in
                Button {
                    selectedProject = project
                    selectedSession = nil
                    selectedDocument = nil
                    showProjectPicker = false
                    configureVoiceForProject(project)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(project.name)
                                .font(.body)
                                .foregroundStyle(.primary)
                            if project.sessionCount > 0 {
                                Text("\(project.sessionCount) session\(project.sessionCount == 1 ? "" : "s")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if project.id == selectedProject?.id {
                            Image(systemName: "checkmark")
                                .foregroundStyle(NimbalystColors.primary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Switch Project")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showProjectPicker = false }
                }
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        SettingsView()
                            .environmentObject(appState)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
        }
    }

    private func startObservingProjects() {
        guard let db = appState.databaseManager else { return }
        projectsCancellable?.cancel()

        let observation = ValueObservation.tracking { db in
            try Project
                .order(Project.Columns.lastUpdatedAt.desc, Project.Columns.name)
                .fetchAll(db)
        }

        projectsCancellable = observation.start(
            in: db.writer,
            onError: { _ in
            },
            onChange: { newProjects in
                projects = newProjects
                // Auto-select the most recent project if none selected
                if selectedProject == nil, let first = newProjects.first {
                    selectedProject = first
                    appState.configureVoiceAgent(forProject: first.id)
                }
            }
        )
    }

    private func configureVoiceForProject(_ project: Project) {
        appState.configureVoiceAgent(forProject: project.id)
    }
}

// MARK: - Sync Auth-Degraded Banner

/// Surfaced above MainNavigationView when sync has been failing with
/// auth-class errors long enough that the user almost certainly needs to
/// sign in again. Visibility is driven by `AppState.syncAuthDegraded`.
struct SyncAuthDegradedBanner: View {
    let onSignIn: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(NimbalystColors.warning)

            VStack(alignment: .leading, spacing: 1) {
                Text("Sync paused")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                Text("Your session may need a refresh.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Button(action: onSignIn) {
                Text("Sign in again")
                    .font(.caption)
                    .fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .tint(NimbalystColors.primary)
            .accessibilityIdentifier("sync-auth-degraded-sign-in")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NimbalystColors.warning.opacity(0.18))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(NimbalystColors.warning.opacity(0.45))
                .frame(height: 0.5)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sync paused. Your session may need a refresh.")
        .accessibilityIdentifier("sync-auth-degraded-banner")
    }
}

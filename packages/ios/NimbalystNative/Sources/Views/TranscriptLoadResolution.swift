import Foundation

/// What the transcript coordinator should do once a `loadSession` bridge call
/// returns.
///
/// The transcript WKWebView is pooled and never cleared between sessions, so
/// whatever the previous session left mounted stays on screen until a
/// `loadSession` lands. That makes "did the bridge actually activate the session
/// I asked for?" the only thing standing between the user and someone else's
/// transcript, and it is why this decision is a pure function with its own test
/// rather than four branches buried in an async completion handler.
public enum TranscriptLoadOutcome: Equatable {
    /// The requested session is on screen. Mark ready and reveal the transcript.
    case activated

    /// Activated, and more messages arrived while the call was in flight.
    /// Append everything from `fromIndex` onwards.
    case activatedThenAppend(fromIndex: Int)

    /// A different session was requested while this load was in flight. Load it
    /// instead of dropping it on the floor.
    case loadPending(sessionId: String)

    /// The bridge did not activate the requested session. Surface it; never
    /// reveal the transcript, because what is on screen belongs to some other
    /// session.
    case failed(reason: String)
}

/// Decide what follows a `loadSession` round trip.
///
/// - Parameters:
///   - requestedSessionId: the session this call asked the bridge to activate.
///   - activatedSessionId: the session the bridge reports it activated, or nil
///     when the bridge did not answer (missing `window.nimbalyst`, or a
///     transcript bundle older than this Swift binary).
///   - loadedMessageCount: how many messages this call carried.
///   - pendingSessionId: the session stashed while this call was in flight.
///   - pendingMessageCount: how many messages that stash carried.
public func resolveTranscriptLoad(
    requestedSessionId: String,
    activatedSessionId: String?,
    loadedMessageCount: Int,
    pendingSessionId: String?,
    pendingMessageCount: Int
) -> TranscriptLoadOutcome {
    // No answer means we cannot tell what is on screen. Fail before considering
    // a pending session, otherwise two sessions swapping against a dead bridge
    // would re-issue loads at each other forever.
    guard let activatedSessionId else {
        return .failed(reason: "transcript bridge did not activate \(requestedSessionId)")
    }

    // A newer session was requested mid-flight. It wins regardless of whether
    // this load succeeded — the user is looking at the newer one.
    if let pendingSessionId, pendingSessionId != requestedSessionId {
        return .loadPending(sessionId: pendingSessionId)
    }

    guard activatedSessionId == requestedSessionId else {
        return .failed(
            reason: "transcript bridge activated \(activatedSessionId), expected \(requestedSessionId)"
        )
    }

    if pendingSessionId == requestedSessionId, pendingMessageCount > loadedMessageCount {
        return .activatedThenAppend(fromIndex: loadedMessageCount)
    }

    return .activated
}

import XCTest
@testable import NimbalystNative

/// The transcript webview is pooled and never cleared, so a dropped or
/// unverified `loadSession` leaves the previous session's transcript on screen
/// under the new session's title.
final class TranscriptLoadResolutionTests: XCTestCase {
    func testSessionSwappedMidFlightIsReloadedNotDropped() {
        let outcome = resolveTranscriptLoad(
            requestedSessionId: "session-a",
            activatedSessionId: "session-a",
            loadedMessageCount: 12,
            pendingSessionId: "session-b",
            pendingMessageCount: 3
        )

        XCTAssertEqual(outcome, .loadPending(sessionId: "session-b"))
    }

    func testBridgeActivatingTheWrongSessionFails() {
        let mismatched = resolveTranscriptLoad(
            requestedSessionId: "session-b",
            activatedSessionId: "session-a",
            loadedMessageCount: 3,
            pendingSessionId: nil,
            pendingMessageCount: 0
        )
        guard case .failed = mismatched else {
            return XCTFail("a bridge that activated another session must not be treated as ready")
        }

        // A bundle older than this binary returns nothing from loadSession. The
        // optional-chained call still resolves successfully, so silence has to
        // be read as failure rather than success.
        let silent = resolveTranscriptLoad(
            requestedSessionId: "session-b",
            activatedSessionId: nil,
            loadedMessageCount: 3,
            pendingSessionId: "session-c",
            pendingMessageCount: 1
        )
        guard case .failed = silent else {
            return XCTFail("a silent bridge must fail rather than chase the pending session")
        }
    }

    func testMessagesArrivingMidFlightAreAppendedFromTheLoadedCount() {
        XCTAssertEqual(
            resolveTranscriptLoad(
                requestedSessionId: "session-a",
                activatedSessionId: "session-a",
                loadedMessageCount: 4,
                pendingSessionId: "session-a",
                pendingMessageCount: 7
            ),
            .activatedThenAppend(fromIndex: 4)
        )

        XCTAssertEqual(
            resolveTranscriptLoad(
                requestedSessionId: "session-a",
                activatedSessionId: "session-a",
                loadedMessageCount: 4,
                pendingSessionId: "session-a",
                pendingMessageCount: 4
            ),
            .activated
        )
    }
}

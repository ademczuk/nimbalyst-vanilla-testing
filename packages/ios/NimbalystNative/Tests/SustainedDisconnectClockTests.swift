// A "Sync paused / sign in again" banner appeared on every return from a long
// background because the disconnect window counted suspended time.
import XCTest
@testable import NimbalystNative

final class SustainedDisconnectClockTests: XCTestCase {
    func testTimeInBackgroundDoesNotCountTowardSustainedDisconnect() {
        var clock = SustainedDisconnectClock(threshold: 60)
        let start = Date(timeIntervalSince1970: 1_000)

        // The socket dies while the app is briefly awake in the background.
        _ = clock.setForeground(false, isConnected: true, at: start)
        clock.disconnected(at: start.addingTimeInterval(5))

        let back = start.addingTimeInterval(3_600)
        XCTAssertTrue(clock.setForeground(true, isConnected: false, at: back))
        XCTAssertFalse(clock.isSustained(at: back.addingTimeInterval(1), isConnected: false))

        // A reconnect that never arrives is still a real problem.
        XCTAssertTrue(clock.isSustained(at: back.addingTimeInterval(61), isConnected: false))
    }

    func testForegroundDisconnectSurfacesAfterThresholdAndClearsOnConnect() {
        var clock = SustainedDisconnectClock(threshold: 60)
        let start = Date(timeIntervalSince1970: 1_000)
        clock.disconnected(at: start)
        clock.disconnected(at: start.addingTimeInterval(30)) // a repeat does not restart the window
        XCTAssertTrue(clock.isSustained(at: start.addingTimeInterval(60), isConnected: false))

        clock.connected()
        XCTAssertFalse(clock.isSustained(at: start.addingTimeInterval(120), isConnected: false))
    }
}

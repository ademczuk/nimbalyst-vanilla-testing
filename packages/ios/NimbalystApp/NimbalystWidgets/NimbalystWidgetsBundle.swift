import SwiftUI
import WidgetKit

/// The extension's entry point.
///
/// Only a Live Activity today. Home screen widgets would need the app's database
/// through an app group, which this extension deliberately does not have — the
/// fleet card is entirely server-driven, so it needs no local state at all.
@main
struct NimbalystWidgetsBundle: WidgetBundle {
    var body: some Widget {
        FleetActivityWidget()
    }
}

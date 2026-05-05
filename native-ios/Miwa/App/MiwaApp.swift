import SwiftUI

@main
struct MiwaApp: App {
    @StateObject private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .task {
                    await session.restore()
                }
        }
    }
}

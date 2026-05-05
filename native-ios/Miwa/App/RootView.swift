import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: AuthSession

    var body: some View {
        Group {
            switch session.state {
            case .booting:
                SplashView()
            case .signedOut:
                LoginView()
            case .signedIn:
                MainTabsView()
            }
        }
        .animation(.snappy, value: session.state)
    }
}

private struct SplashView: View {
    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 16) {
                MiwaMark(size: 68)
                ProgressView()
                    .tint(.miwaIndigo)
            }
        }
    }
}

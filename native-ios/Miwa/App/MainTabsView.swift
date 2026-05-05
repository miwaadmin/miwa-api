import SwiftUI

struct MainTabsView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "calendar")
                }

            ClientsView()
                .tabItem {
                    Label("Clients", systemImage: "person.2")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(.miwaIndigo)
    }
}

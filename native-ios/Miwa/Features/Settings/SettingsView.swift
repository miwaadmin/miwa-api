import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: AuthSession

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        MiwaMark(size: 48)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.therapist?.displayName.isEmpty == false ? session.therapist!.displayName : "Miwa clinician")
                                .font(.headline)
                            Text(session.therapist?.email ?? "")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("App") {
                    LabeledContent("API", value: AppEnvironment.apiBaseURL.absoluteString)
                    LabeledContent("Version", value: "0.1.0")
                }

                Section {
                    Button(role: .destructive) {
                        session.signOut()
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

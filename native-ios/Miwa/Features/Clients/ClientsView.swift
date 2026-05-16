import SwiftUI

struct ClientsView: View {
    @EnvironmentObject private var session: AuthSession
    @State private var patients: [Patient] = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var filteredPatients: [Patient] {
        guard !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return patients
        }
        let query = searchText.lowercased()
        return patients.filter {
            $0.name.lowercased().contains(query)
            || ($0.presentingConcerns ?? "").lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if filteredPatients.isEmpty && !isLoading {
                    EmptyStateView(systemImage: "person.2", title: "No clients found", message: "Try a different search.")
                } else {
                    ForEach(filteredPatients) { patient in
                        PatientRow(patient: patient)
                    }
                }
            }
            .navigationTitle("Clients")
            .searchable(text: $searchText, prompt: "Search clients")
            .overlay {
                if isLoading {
                    ProgressView()
                }
            }
            .task {
                await load()
            }
            .refreshable {
                await load()
            }
            .alert("Unable to load clients", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            patients = try await session.api.get("patients")
        } catch APIError.unauthorized {
            session.signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PatientRow: View {
    let patient: Patient

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.miwaIndigo.opacity(0.12))
                Text(initials)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.miwaIndigo)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                Text(patient.name)
                    .font(.body.weight(.semibold))
                if let concerns = patient.presentingConcerns, !concerns.isEmpty {
                    Text(concerns)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var initials: String {
        patient.name
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first }
            .map(String.init)
            .joined()
            .uppercased()
    }
}

import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var session: AuthSession
    @State private var appointments: [Appointment] = []
    @State private var alerts: [PatientAlert] = []
    @State private var brief: Brief?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var nextSession: Appointment? {
        appointments
            .filter { $0.status != "completed" && $0.status != "cancelled" }
            .sorted { ($0.timestamp ?? .distantFuture) < ($1.timestamp ?? .distantFuture) }
            .first
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(greeting)
                            .font(.title2.bold())
                        Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                            .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }

                if let nextSession {
                    Section("Up Next") {
                        NextSessionCard(appointment: nextSession)
                    }
                }

                if let brief {
                    Section("Pre-Session Brief") {
                        BriefCard(brief: brief)
                    }
                }

                Section("Today's Schedule") {
                    if appointments.isEmpty && !isLoading {
                        EmptyStateView(systemImage: "calendar.badge.clock", title: "No appointments today", message: "Your schedule is clear.")
                    } else {
                        ForEach(appointments) { appointment in
                            AppointmentRow(appointment: appointment)
                        }
                    }
                }

                if !alerts.isEmpty {
                    Section("Alerts") {
                        ForEach(alerts) { alert in
                            AlertRow(alert: alert)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(isLoading)
                }
            }
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
            .alert("Unable to load Today", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        let salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
        return "\(salutation), \(session.therapist?.firstDisplayName ?? "there")"
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let appointmentsRequest: [Appointment] = session.api.get("agent/appointments")
            async let alertsRequest: [PatientAlert] = session.api.get("patients/alerts")
            async let briefsRequest: [Brief] = session.api.get("ai/briefs/upcoming")

            let calendar = Calendar.current
            let loadedAppointments = try await appointmentsRequest
            let loadedAlerts = try await alertsRequest
            let loadedBriefs = try await briefsRequest

            appointments = loadedAppointments
                .filter { appointment in
                    guard let date = appointment.timestamp else { return false }
                    return calendar.isDateInToday(date)
                }
            alerts = loadedAlerts
                .filter { ["CRITICAL", "HIGH"].contains($0.severity ?? "") }
                .prefix(3)
                .map { $0 }
            brief = loadedBriefs.first
        } catch APIError.unauthorized {
            session.signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct NextSessionCard: View {
    let appointment: Appointment

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Up Next", systemImage: "sparkle")
                    .font(.caption.bold())
                    .foregroundStyle(.miwaIndigo)
                Spacer()
                Text(appointment.timestamp?.formatted(date: .omitted, time: .shortened) ?? "")
                    .font(.subheadline.weight(.semibold))
            }
            Text(appointment.title)
                .font(.headline)
            if let type = appointment.type, !type.isEmpty {
                Text(type)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct BriefCard: View {
    let brief: Brief

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let count = brief.riskFlagsCount, count > 0 {
                Label("\(count) risk flag\(count == 1 ? "" : "s")", systemImage: "exclamationmark.triangle")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
            }
            Text(brief.keyThemes ?? brief.summary ?? brief.content ?? "Brief is ready.")
                .font(.subheadline)
                .lineLimit(5)
        }
        .padding(.vertical, 4)
    }
}

private struct AppointmentRow: View {
    let appointment: Appointment

    var body: some View {
        HStack(spacing: 14) {
            Text(appointment.timestamp?.formatted(date: .omitted, time: .shortened) ?? "--")
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(appointment.title)
                    .font(.body.weight(.semibold))
                if let type = appointment.type {
                    Text(type)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let status = appointment.status ?? appointment.checkinStatus {
                Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill), in: Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}

private struct AlertRow: View {
    let alert: PatientAlert

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(alert.severity ?? "Alert")
                    .font(.caption2.bold())
                    .foregroundStyle((alert.severity == "CRITICAL") ? .red : .orange)
                Spacer()
                Text(alert.displayName ?? alert.clientId ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(alert.title ?? "Clinical alert")
                .font(.subheadline.weight(.semibold))
            if let description = alert.description {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .padding(.vertical, 4)
    }
}

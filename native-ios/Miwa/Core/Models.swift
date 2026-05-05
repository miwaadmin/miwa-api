import Foundation

struct Therapist: Codable, Identifiable, Equatable {
    let id: Int
    let email: String
    let firstName: String?
    let lastName: String?
    let fullName: String?
    let userRole: String?
    let isAdmin: Bool?
    let accountStatus: String?
    let avatarUrl: String?
    let preferredTimezone: String?

    var displayName: String {
        fullName ?? [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }

    var firstDisplayName: String {
        firstName ?? displayName.split(separator: " ").first.map(String.init) ?? "there"
    }
}

struct LoginResponse: Decodable {
    let token: String
    let therapist: Therapist
}

struct Patient: Decodable, Identifiable, Equatable {
    let id: Int
    let clientId: String?
    let displayName: String?
    let presentingConcerns: String?
    let lastSessionDate: String?
    let updatedAt: String?

    var name: String {
        displayName ?? clientId ?? "Client"
    }
}

struct Appointment: Decodable, Identifiable, Equatable {
    let id: Int
    let patientId: Int?
    let clientName: String?
    let patientName: String?
    let startTime: String?
    let date: String?
    let type: String?
    let status: String?
    let checkinStatus: String?

    var title: String {
        clientName ?? patientName ?? "Client"
    }

    var timestamp: Date? {
        guard let value = startTime ?? date else { return nil }
        return ISO8601DateFormatter.miwa.date(from: value)
            ?? ISO8601DateFormatter.miwaNoFractionalSeconds.date(from: value)
    }
}

struct PatientAlert: Decodable, Identifiable, Equatable {
    let id: Int
    let severity: String?
    let title: String?
    let description: String?
    let displayName: String?
    let clientId: String?
}

struct Brief: Decodable, Identifiable, Equatable {
    let id: Int?
    let keyThemes: String?
    let riskFlags: String?
    let suggestedFocus: String?
    let summary: String?
    let content: String?
    let riskFlagsCount: Int?
}

import Foundation

@MainActor
final class AuthSession: ObservableObject {
    enum State: Equatable {
        case booting
        case signedOut
        case signedIn(Therapist)
    }

    @Published private(set) var state: State = .booting
    @Published var lastError: String?

    private let tokenKey = "miwa.auth.token"
    private let profileKey = "miwa.auth.profile"
    private let keychain = KeychainStore.shared

    var api: APIClient {
        APIClient(tokenProvider: { [weak self] in
            self?.keychain.read(self?.tokenKey ?? "")
        })
    }

    var therapist: Therapist? {
        if case .signedIn(let therapist) = state {
            return therapist
        }
        return nil
    }

    func restore() async {
        guard keychain.read(tokenKey) != nil else {
            state = .signedOut
            return
        }

        do {
            let therapist: Therapist = try await api.get("auth/me")
            saveProfile(therapist)
            state = .signedIn(therapist)
        } catch {
            signOut()
        }
    }

    func signIn(email: String, password: String) async -> Bool {
        lastError = nil
        do {
            let response: LoginResponse = try await APIClient(tokenProvider: { nil })
                .post("auth/login", body: LoginRequest(email: email, password: password))
            keychain.save(response.token, for: tokenKey)
            saveProfile(response.therapist)
            state = .signedIn(response.therapist)
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func signOut() {
        keychain.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: profileKey)
        state = .signedOut
    }

    private func saveProfile(_ therapist: Therapist) {
        if let data = try? JSONEncoder.miwa.encode(therapist) {
            UserDefaults.standard.set(data, forKey: profileKey)
        }
    }
}

private struct LoginRequest: Encodable {
    let email: String
    let password: String
}

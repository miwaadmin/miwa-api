import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case server(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The Miwa API URL is invalid."
        case .invalidResponse:
            return "Miwa returned an unexpected response."
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case .server(let message):
            return message
        case .decoding:
            return "Miwa returned data the app could not read yet."
        }
    }
}

struct APIClient {
    var baseURL: URL = AppEnvironment.apiBaseURL
    var tokenProvider: () -> String?

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await request(path, method: "GET", body: Optional<EmptyBody>.none, as: type)
    }

    func post<Body: Encodable, T: Decodable>(_ path: String, body: Body, as type: T.Type = T.self) async throws -> T {
        try await request(path, method: "POST", body: body, as: type)
    }

    func request<Body: Encodable, T: Decodable>(_ path: String, method: String, body: Body?, as type: T.Type) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder.miwa.encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if http.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder.miwa.decode(ErrorEnvelope.self, from: data),
               let message = envelope.error ?? envelope.message {
                throw APIError.server(message)
            }
            throw APIError.invalidResponse
        }

        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }

        do {
            return try JSONDecoder.miwa.decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}

struct EmptyBody: Encodable {}
struct EmptyResponse: Decodable {}

private struct ErrorEnvelope: Decodable {
    let error: String?
    let message: String?
}

extension JSONDecoder {
    static var miwa: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = ISO8601DateFormatter.miwa.date(from: value)
                ?? ISO8601DateFormatter.miwaNoFractionalSeconds.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(value)")
        }
        return decoder
    }
}

extension JSONEncoder {
    static var miwa: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }
}

extension ISO8601DateFormatter {
    static let miwa: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let miwaNoFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

import Foundation

enum AppEnvironment {
    static var apiBaseURL: URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["MIWA_API_BASE_URL"],
           let url = URL(string: override) {
            return url
        }
        #endif
        return URL(string: "https://api.miwa.care/api/")!
    }
}

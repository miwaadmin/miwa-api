import SwiftUI

extension Color {
    static let miwaIndigo = Color(red: 0.35, green: 0.28, blue: 0.88)
    static let miwaMint = Color(red: 0.04, green: 0.77, blue: 0.64)
    static let miwaInk = Color(red: 0.09, green: 0.08, blue: 0.18)
}

struct MiwaMark: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [.miwaIndigo, .miwaMint],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text("M")
                .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .shadow(color: .miwaIndigo.opacity(0.18), radius: 18, y: 8)
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
    }
}

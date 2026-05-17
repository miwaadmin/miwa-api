import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: AuthSession
    @FocusState private var focusedField: Field?

    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false

    private enum Field {
        case email
        case password
    }

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [Color.miwaIndigo.opacity(0.11), Color(.systemBackground)],
                    startPoint: .top,
                    endPoint: .center
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        VStack(spacing: 16) {
                            MiwaMark(size: 72)
                            VStack(spacing: 6) {
                                Text("Welcome back")
                                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                                    .foregroundStyle(Color.miwaInk)
                                Text("Sign in to your clinical workspace")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 44)

                        VStack(spacing: 14) {
                            TextField("Email", text: $email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focusedField, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { focusedField = .password }
                                .textFieldStyle(MiwaTextFieldStyle())

                            SecureField("Password", text: $password)
                                .textContentType(.password)
                                .focused($focusedField, equals: .password)
                                .submitLabel(.go)
                                .onSubmit { signIn() }
                                .textFieldStyle(MiwaTextFieldStyle())

                            if let error = session.lastError {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            Button(action: signIn) {
                                HStack {
                                    if isSigningIn {
                                        ProgressView()
                                            .tint(.white)
                                    }
                                    Text(isSigningIn ? "Signing in..." : "Sign in")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.miwaIndigo)
                            .disabled(isSigningIn || email.isEmpty || password.isEmpty)
                            .controlSize(.large)
                        }
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                        Text("HIPAA-compliant. Your clinical data stays yours.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
            .navigationBarHidden(true)
        }
    }

    private func signIn() {
        guard !isSigningIn else { return }
        isSigningIn = true
        focusedField = nil
        Task {
            _ = await session.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            isSigningIn = false
        }
    }
}

private struct MiwaTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(.body)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color(.separator).opacity(0.38))
            }
    }
}

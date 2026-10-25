
const API_BASE = "https://my-portifolio-yyvo.onrender.com";

const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const switchButton = document.getElementById("auth-switch-button");
const switchText = document.getElementById("auth-switch-text");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authMessage = document.getElementById("auth-message");

// Show signup when the user clicks "Create an account"
switchButton.addEventListener("click", () => {
    const showingSignup = !signupForm.classList.contains("hidden");

    if (showingSignup) {
        signupForm.classList.add("hidden");
        loginForm.classList.remove("hidden");

        authTitle.textContent = "Welcome back";
        authSubtitle.textContent = "Sign in to continue to the portfolio.";
        switchText.textContent = "New here?";
        switchButton.textContent = "Create an account";
    } else {
        loginForm.classList.add("hidden");
        signupForm.classList.remove("hidden");

        authTitle.textContent = "Create your account";
        authSubtitle.textContent = "Register to access the portfolio.";
        switchText.textContent = "Already have an account?";
        switchButton.textContent = "Sign in";
    }

    authMessage.textContent = "";
});

// Create the account in the backend
signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("signup-email").value
        .trim()
        .toLowerCase();

    const password = document.getElementById("signup-password").value;
    const confirmPassword =
        document.getElementById("signup-confirm-password").value;

    const signupButton = document.getElementById("signup-button");

    if (password !== confirmPassword) {
        authMessage.textContent = "Passwords do not match.";
        return;
    }

    if (password.length < 12) {
        authMessage.textContent =
            "Password must contain at least 12 characters.";
        return;
    }

    signupButton.disabled = true;
    signupButton.textContent = "Creating account...";
    authMessage.textContent = "";

    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({ email, password })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.message || data.error || "Account registration failed."
            );
        }

        authMessage.textContent =
            data.message || "Account created successfully. You can now sign in.";

        signupForm.reset();
        signupForm.classList.add("hidden");
        loginForm.classList.remove("hidden");

        authTitle.textContent = "Welcome back";
        authSubtitle.textContent = "Sign in to continue to the portfolio.";
        switchText.textContent = "New here?";
        switchButton.textContent = "Create an account";

    } catch (error) {
        authMessage.textContent =
            error.message || "Unable to connect to the server.";
    } finally {
        signupButton.disabled = false;
        signupButton.textContent = "Create account →";
    }
});

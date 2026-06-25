export async function ensureAuthenticated(root, startApp) {
  const session = await api("/api/auth/me");
  if (session.authenticated && !session.mustChangePassword) return startApp(session);
  renderAuth(root, session, startApp);
}

function renderAuth(root, session, startApp, message = "") {
  const mustChange = session.authenticated && session.mustChangePassword;
  root.innerHTML = `
    <main class="auth-screen">
      <section class="auth-panel">
        <div class="auth-brand"><span>MTM</span><div><h1>${mustChange ? "Change Password" : "Admin Login"}</h1><p>${mustChange ? "A new password is required before opening the workspace." : "Use the bootstrap admin credential to continue."}</p></div></div>
        <form data-auth-form>
          ${mustChange ? changePasswordFields() : loginFields(session.username || "admin")}
          ${message ? `<div class="auth-message">${message}</div>` : ""}
          <button class="primary auth-submit" type="submit">${mustChange ? "Save Password" : "Sign In"}</button>
        </form>
      </section>
    </main>`;

  root.querySelector("[data-auth-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    const result = mustChange ? await api("/api/auth/change-password", data) : await api("/api/auth/login", data);
    if (result.error) return renderAuth(root, { ...session, authenticated: mustChange || false, mustChangePassword: mustChange }, startApp, result.error);
    if (result.mustChangePassword) return renderAuth(root, result, startApp);
    startApp(result);
  });
}

function loginFields(username) {
  return `
    <label>Username<input name="username" value="${escapeHtml(username)}" autocomplete="username" required /></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>`;
}

function changePasswordFields() {
  return `
    <label>Current Password<input name="currentPassword" type="password" autocomplete="current-password" required /></label>
    <label>New Password<input name="newPassword" type="password" autocomplete="new-password" required minlength="10" /></label>
    <label>Confirm Password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" /></label>`;
}

async function api(url, body) {
  const options = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
  try {
    const response = await fetch(url, options);
    return await response.json();
  } catch {
    return { error: "Unable to reach the pilot server" };
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}


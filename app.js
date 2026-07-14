const authPage = document.querySelector('.auth-page');
const dashboardShell = document.querySelector('.dashboard-shell');
const authForm = document.querySelector('#web-auth-form');
const authCodeInput = document.querySelector('#web-login-code');
const authError = document.querySelector('#web-auth-error');
const buildCommit = document.querySelector('#build-commit');
const timeCommit = document.querySelector('#time-commit');

async function readJson(response) {
    const text = await response.text();
    if (!text.trim()) return {};

    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function setAuthError(message = '') {
    if (authError) authError.textContent = message;
}

function formatCommitAge(commitDate) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(commitDate).getTime()) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const days = Math.floor(hours / 24);

    if (elapsedSeconds < 60) return 'just now';
    if (elapsedSeconds < 3600) return `about ${Math.max(1, Math.floor(elapsedSeconds / 60))} minutes ago`;
    if (hours < 24) return `about ${hours} hours ago`;
    if (days === 1) return 'about 1 day ago';
    return `about ${days} days ago`;
}

async function loadBuildMetadata() {
    try {
        const response = await fetch('https://api.github.com/repos/om-kanabar/keplerProjectOm/commits?per_page=1');
        if (!response.ok) return;

        const [latestCommit] = await readJson(response);
        const commit = latestCommit?.sha;
        const commitDate = latestCommit?.commit?.author?.date;
        if (!commit || !buildCommit) return;

        buildCommit.textContent = commit.slice(0, 8);
        buildCommit.href = `https://github.com/om-kanabar/keplerProjectOm/commit/${commit}`;
        if (timeCommit) timeCommit.textContent = commitDate ? formatCommitAge(commitDate) : 'recently';
    } catch {
        // Build metadata is useful but must not block access to the dashboard.
    }
}

async function hasWebSession() {
    const response = await fetch('/auth/web/session', { credentials: 'same-origin' });
    if (!response.ok) return false;

    const session = await readJson(response);
    return session.authenticated === true;
}

function showAuthentication() {
    dashboardShell.hidden = true;
    authPage.hidden = false;
    authCodeInput?.focus();
    window.dispatchEvent(new Event('habitat:auth-required'));
}

function showDashboard() {
    authPage.hidden = true;
    dashboardShell.hidden = false;
    window.dispatchEvent(new Event('habitat:ready'));
}

async function initializeDashboard() {
    await loadBuildMetadata();

    try {
        if (await hasWebSession()) {
            showDashboard();
        } else {
            showAuthentication();
        }
    } catch {
        window.dispatchEvent(new CustomEvent('habitat:startup-error', {
            detail: { message: 'UNABLE TO REACH HABITAT SERVER' },
        }));
    }
}

authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = authCodeInput?.value.trim();
    if (!code) return;

    setAuthError();
    window.dispatchEvent(new Event('habitat:auth-pending'));

    try {
        const response = await fetch('/auth/web/verify', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const body = await readJson(response);

        if (!response.ok) {
            throw new Error(body.error?.message ?? `Authentication failed (HTTP ${response.status}).`);
        }
        showDashboard();
    } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Unable to authenticate.');
        showAuthentication();
    }
});

initializeDashboard();

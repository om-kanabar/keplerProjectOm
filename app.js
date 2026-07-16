const authPage = document.querySelector('.auth-page');
const dashboardShell = document.querySelector('.dashboard-shell');
const authForm = document.querySelector('#web-auth-form');
const authCodeInput = document.querySelector('#web-login-code');
const authSubmit = authForm?.querySelector('button[type="submit"]');
const authError = document.querySelector('#web-auth-error');
const authPasscodeDots = document.querySelector('.auth-passcode-dots');
const buildCommit = document.querySelector('#build-commit');
const timeCommit = document.querySelector('#time-commit');
const minimumAuthLoadingTime = 1500;
const authCodeLength = 24;
const localAdminCookieName = 'habitat_local_admin';
const dashboardBundleVersion = '20260715.26';
let dashboardMounted = false;

function isAuthSkipPreview() {
    return (
        window.location.hostname === '127.0.0.1' &&
        new URLSearchParams(window.location.search).has('authskip')
    );
}

window.habitatAuthSkipPreview = isAuthSkipPreview();

function isLocalAdminAuth(code) {
    const localHost = window.location.hostname === 'localhost';
    const localAddress = window.location.hostname === '127.0.0.1';
    return (localHost || localAddress) && code === 'adminauth';
}

function hasLocalAdminSession() {
    return document.cookie.split(';').some((cookie) => cookie.trim() === `${localAdminCookieName}=1`);
}

function createLocalAdminSession() {
    document.cookie = `${localAdminCookieName}=1; Path=/; Max-Age=28800; SameSite=Strict`;
}

function renderPasscodeDots() {
    if (!authPasscodeDots) return;

    const filledDots = authCodeInput?.value.length ?? 0;
    authPasscodeDots.replaceChildren(...Array.from({ length: authCodeLength }, (_, index) => {
        const dot = document.createElement('span');
        dot.className = 'auth-passcode-dot';
        dot.style.setProperty('--dot-index', index);
        dot.classList.toggle('is-filled', index < filledDots);
        return dot;
    }));
}

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
    if (hasLocalAdminSession()) return true;

    const response = await fetch('/auth/web/session', { credentials: 'same-origin' });
    if (!response.ok) return false;

    const session = await readJson(response);
    return session.authenticated === true;
}

async function hasReachableHabitat() {
    try {
        const response = await fetch('/status', { credentials: 'same-origin' });
        return response.ok;
    } catch {
        return false;
    }
}

function showAuthentication() {
    dashboardShell.hidden = true;
    authPage.hidden = false;
    authPage.classList.remove('is-verifying');
    if (authCodeInput) authCodeInput.disabled = false;
    if (authSubmit) authSubmit.disabled = false;
    renderPasscodeDots();
    authCodeInput?.focus();
    window.dispatchEvent(new Event('habitat:auth-required'));
}

authCodeInput?.addEventListener('input', renderPasscodeDots);
renderPasscodeDots();

async function showDashboard() {
    authPage.hidden = true;
    dashboardShell.hidden = false;
    if (!dashboardMounted) {
        const { mountDashboard } = await import(`/dashboard/dashboard.js?v=${dashboardBundleVersion}`);
        const root = document.querySelector('#dashboard-root');
        if (!root) throw new Error('Habitat dashboard mount point is unavailable.');
        mountDashboard(root);
        dashboardMounted = true;
    }
    window.dispatchEvent(new Event('habitat:ready'));
}

async function keepAuthLoadingVisible(startedAt) {
    const elapsed = performance.now() - startedAt;
    const remaining = Math.max(0, minimumAuthLoadingTime - elapsed);
    if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
}

async function initializeDashboard() {
    await loadBuildMetadata();

    try {
        if (window.habitatAuthSkipPreview) {
            await showDashboard();
            return;
        }

        if (!(await hasReachableHabitat())) {
            window.dispatchEvent(new CustomEvent('habitat:startup-error', {
                detail: { message: 'UNABLE TO REACH HABITAT SERVER' },
            }));
            return;
        }

        if (await hasWebSession()) {
            await showDashboard();
        } else {
            showAuthentication();
        }
    } catch {
        window.dispatchEvent(new CustomEvent('habitat:startup-error', {
            detail: { message: 'Unable to load Habitat dashboard.' },
        }));
    }
}

authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = authCodeInput?.value.trim();
    if (!code) return;

    if (isLocalAdminAuth(code)) {
        createLocalAdminSession();
        await showDashboard();
        return;
    }

    setAuthError();
    const verificationStartedAt = performance.now();
    authPage.classList.add('is-verifying');
    if (authCodeInput) authCodeInput.disabled = true;
    if (authSubmit) authSubmit.disabled = true;

    try {
        const response = await fetch('/auth/web/verify', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const body = await readJson(response);
        await keepAuthLoadingVisible(verificationStartedAt);

        if (!response.ok) {
            throw new Error(body.error?.message ?? `Authentication failed (HTTP ${response.status}).`);
        }
        await showDashboard();
    } catch (error) {
        await keepAuthLoadingVisible(verificationStartedAt);
        if (authCodeInput) authCodeInput.value = '';
        setAuthError(error instanceof Error ? error.message : 'Unable to authenticate.');
        showAuthentication();
    }
});

initializeDashboard();

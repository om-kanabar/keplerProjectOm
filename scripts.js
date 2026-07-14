const loadingScreen = document.querySelector('#loading-screen');
const buildCommit = document.querySelector('#build-commit');
const loadingDots = [...document.querySelectorAll('.loading-dot')];
const timeCommit = document.querySelector("#time-commit")
const loadingError = document.querySelector('#loading-error');
const dashboardContent = document.querySelector('.dashboard-content');
const greeting = document.querySelector('.dashboard-intro');
const habitatFact = document.querySelector('#habitat-fact');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const sidebarToggleLabel = document.querySelector('#sidebar-toggle-label');
const habitatRail = document.querySelector('.habitat-rail');

sidebarToggle?.addEventListener('click', () => {
    const expanded = document.body.classList.toggle('sidebar-expanded');
    const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
    sidebarToggle.setAttribute('aria-label', label);
    sidebarToggle.setAttribute('title', label);
    if (sidebarToggleLabel) sidebarToggleLabel.textContent = label;
});

const greetings = [
    'Good morning,<br><em>inhabitants.</em>',
    'Good afternoon,<br><em>inhabitants.</em>',
    'Good evening,<br><em>inhabitants.</em>',
    'Good night,<br><em>inhabitants.</em>',
];

if (document.querySelector('#habitat-greeting')) {
    const habitatTick = Math.floor(Date.now() / 3600000) % greetings.length;
    document.querySelector('#habitat-greeting').innerHTML = greetings[habitatTick];
}

document.querySelectorAll('.dashboard-nav-item').forEach((button) => {
    button.addEventListener('click', () => {
        const selectedTab = button.dataset.tab;
        document.querySelectorAll('.dashboard-nav-item').forEach((item) => item.classList.toggle('active', item === button));
        document.querySelectorAll('[data-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.panel !== selectedTab;
        });
    });
});

function selectDashboardTab(selectedTab) {
    document.querySelectorAll('.dashboard-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.tab === selectedTab);
    });

    document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== selectedTab;
    });
}

selectDashboardTab('overview');

const habitatFacts = [
    'Cupola is monitoring the first permanent habitat on Kepler-442b.',
    'One habitat tick is one second. Time flies, even on another planet.',
    'Battery bank: 420 kWh of storage. That is a lot of “current” company.',
    'A blueprint is a plan. A module is the plan with walls.',
    'The greenhouse is working on a very long-term relationship with sunlight.',
    'Every good habitat starts with a solid foundation—and a supply cache.',
    'The command module has excellent leadership qualities. It is always in control.',
    'The rover wanted to explore its options, so we gave it a survey.',
    'The water recycler is doing well. It keeps coming back around.',
    'The workshop fabricator is great at making plans materialize.',
    'Life support is a demanding job, but somebody has to breathe easy.',
    'The solar array is having a bright day.',
    'The supply cache is keeping things in stock—and out of shock.',
    'Construction is going well. We are building momentum.',
    'The habitat has a strong sense of atmosphere.',
    'No need to panic. The situation is under pressure control.',
];

if (habitatFact) {
    const factIndex = Math.floor(Math.random() * habitatFacts.length);
    habitatFact.textContent = habitatFacts[factIndex];
}

function animateLoadingDots() {
    if (!loadingDots.length) return;

    function update(now) {
        loadingDots.forEach((dot, index) => {
            const primaryWave = Math.max(0, Math.sin(index * 0.42 - now * 0.0024)) ** 5;
            const secondaryWave = Math.max(0, Math.sin(index * 0.31 - now * 0.0019 + 1.8)) ** 7;
            const tertiaryWave = Math.max(0, Math.sin(index * 0.24 - now * 0.0015 + 3.6)) ** 9;
            const detailWave = Math.max(0, Math.sin(index * 0.58 - now * 0.0031 + 0.7)) ** 12;
            const brightness = Math.min(1, Math.max(
                primaryWave,
                secondaryWave * 0.72,
                tertiaryWave * 0.5,
                detailWave * 0.35,
            ));
            dot.style.opacity = String(0.1 + brightness * 0.9);
        });
        requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
}

animateLoadingDots();

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

async function startCupola() {
    const minimumLoadingTime = new Promise((resolve) => {
        window.setTimeout(resolve, 1000);
    });

    try {
        const response = await fetch('https://api.github.com/repos/om-kanabar/keplerProjectOm/commits?per_page=1');
        if (!response.ok) throw new Error('Unable to fetch latest commit');

        const [latestCommit] = await response.json();
        const commit = latestCommit?.sha;
        const commitDate = latestCommit?.commit?.author?.date;
        if (!commit) throw new Error('GitHub returned no commit');

        if (buildCommit) {
            const shortCommit = commit.slice(0, 8);
            const age = commitDate ? formatCommitAge(commitDate) : 'recently';
            buildCommit.textContent = shortCommit;
            if (timeCommit) timeCommit.textContent = age;
            buildCommit.href = `https://github.com/om-kanabar/keplerProjectOm/commit/${commit}`;
        }

        await minimumLoadingTime;
        document.body.classList.add('is-ready');
        if (greeting) {
            window.setTimeout(() => {
                greeting.classList.add('greeting-seen');
                window.setTimeout(() => habitatRail?.classList.add('is-visible'), 700);
            }, 1800);
        }
        loadingScreen?.classList.add('is-leaving');

        window.setTimeout(() => {
            loadingScreen?.remove();
        }, 950);
    } catch (error) {
        loadingScreen?.classList.add('has-error');
        if (loadingError) {
            loadingError.textContent = 'AN ERROR OCCURRED // UNABLE TO REACH BUILD SERVER';
        }
    }
}

startCupola();

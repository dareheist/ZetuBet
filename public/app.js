"use strict";

/* ==================================================
   SECTION 1: APPLICATION CONFIGURATION
   ================================================== */

const ZETUBET = {
    currency: "KES",
    locale: "en-KE",
    defaultPage: "home",
    pages: [
        "home",
        "sports",
        "aviator",
        "casino",
        "wallet",
        "history",
        "account",
        "settings"
    ]
};


/* ==================================================
   SECTION 2: APPLICATION STATE
   ================================================== */

const appState = {
    currentPage: "home",
    currentSport: "all",
    currentHistoryFilter: "all",
    currentAccountTab: "login",
    selectedBets: [],
    notificationTimer: null
};


/* ==================================================
   SECTION 3: DEMONSTRATION SPORTS DATA
   ================================================== */

// These are illustrative examples, NOT live matches or live odds.
// Replace this data when a verified sports data provider is connected.

const sampleMatches = [
    {
        id: "demo-001",
        sport: "Football",
        league: "SAMPLE FOOTBALL",
        home: "Home Team",
        away: "Away Team",
        time: "Sample event",
        odds: {
            home: "2.10",
            draw: "3.20",
            away: "2.80"
        }
    },
    {
        id: "demo-002",
        sport: "Football",
        league: "SAMPLE FOOTBALL",
        home: "United FC",
        away: "City FC",
        time: "Sample event",
        odds: {
            home: "1.85",
            draw: "3.40",
            away: "3.60"
        }
    },
    {
        id: "demo-003",
        sport: "Basketball",
        league: "SAMPLE BASKETBALL",
        home: "Lions",
        away: "Tigers",
        time: "Sample event",
        odds: {
            home: "1.75",
            draw: null,
            away: "2.05"
        }
    },
    {
        id: "demo-004",
        sport: "Tennis",
        league: "SAMPLE TENNIS",
        home: "Player A",
        away: "Player B",
        time: "Sample event",
        odds: {
            home: "1.90",
            draw: null,
            away: "1.90"
        }
    }
];


/* ==================================================
   SECTION 4: GENERAL ELEMENT HELPERS
   ================================================== */

function getElement(id) {
    return document.getElementById(id);
}

function getElements(selector) {
    return document.querySelectorAll(selector);
}

function formatKES(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        return "KSh 0.00";
    }

    return "KSh " + value.toLocaleString(ZETUBET.locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ==================================================
   SECTION 5: PAGE NAVIGATION
   ================================================== */

function openPage(pageName) {
    if (!ZETUBET.pages.includes(pageName)) {
        showNotification("This section is not available.");
        return;
    }

    appState.currentPage = pageName;

    // Display the selected page and hide the others.
    getElements(".page").forEach(page => {
        const isActive = page.id === `page-${pageName}`;

        page.classList.toggle("active", isActive);
        page.hidden = !isActive;
    });

    // Highlight the selected bottom navigation icon.
    getElements(".bottom-nav-item").forEach(button => {
        const isActive = button.dataset.page === pageName;

        button.classList.toggle("active", isActive);

        if (isActive) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    // Close the side menu when navigating.
    closeMenu();

    // Start the new section at its top.
    window.scrollTo({
        top: 0,
        behavior: "auto"
    });

    // Update the browser's page fragment without reloading.
    if (window.location.hash !== `#${pageName}`) {
        history.replaceState(null, "", `#${pageName}`);
    }
}


/* ==================================================
   SECTION 6: HAMBURGER MENU
   ================================================== */

function openMenu() {
    const menu = getElement("side-menu");
    const overlay = getElement("menu-overlay");
    const button = getElement("menu-button");

    if (!menu || !overlay) return;

    menu.hidden = false;
    overlay.hidden = false;

    if (button) {
        button.setAttribute("aria-expanded", "true");
    }

    document.body.style.overflow = "hidden";
}

function closeMenu() {
    const menu = getElement("side-menu");
    const overlay = getElement("menu-overlay");
    const button = getElement("menu-button");

    if (menu) menu.hidden = true;
    if (overlay) overlay.hidden = true;

    if (button) {
        button.setAttribute("aria-expanded", "false");
    }

    document.body.style.overflow = "";
}

function toggleMenu() {
    const menu = getElement("side-menu");

    if (!menu) return;

    if (menu.hidden) {
        openMenu();
    } else {
        closeMenu();
    }
}


/* ==================================================
   SECTION 7: NOTIFICATION MESSAGES
   ================================================== */

function showNotification(message) {
    const notification = getElement("site-notification");

    if (!notification) return;

    notification.textContent = message;
    notification.hidden = false;

    if (appState.notificationTimer) {
        clearTimeout(appState.notificationTimer);
    }

    appState.notificationTimer = setTimeout(() => {
        notification.hidden = true;
    }, 3500);
}


/* ==================================================
   SECTION 8: HOMEPAGE AND SPORTS FILTERS
   ================================================== */

function setSportFilter(sport) {
    appState.currentSport = sport;

    // Keep the homepage and sports page filters synchronised.
    getElements(".sport-filter").forEach(button => {
        const isActive = button.dataset.sport === sport;

        button.classList.toggle("active", isActive);
    });

    renderMatches();
}

function getFilteredMatches() {
    if (appState.currentSport === "all") {
        return sampleMatches;
    }

    return sampleMatches.filter(match => {
        return match.sport === appState.currentSport;
    });
}


/* ==================================================
   SECTION 9: MATCH CARDS AND SAMPLE ODDS
   ================================================== */

function renderMatchCard(match) {
    const outcomes = [
        {
            key: "home",
            label: "1",
            value: match.odds.home
        },
        {
            key: "draw",
            label: "X",
            value: match.odds.draw
        },
        {
            key: "away",
            label: "2",
            value: match.odds.away
        }
    ];

    const oddsHTML = outcomes.map(outcome => {
        if (outcome.value === null) {
            return `
                <button
                    type="button"
                    class="odds-button"
                    disabled
                    aria-label="${escapeHTML(outcome.label)} unavailable">
                    <span>${escapeHTML(outcome.label)}</span>
                    <strong>—</strong>
                </button>
            `;
        }

        const selected = appState.selectedBets.some(bet => {
            return bet.matchId === match.id &&
                bet.outcome === outcome.key;
        });

        return `
            <button
                type="button"
                class="odds-button ${selected ? "selected" : ""}"
                data-match-id="${escapeHTML(match.id)}"
                data-outcome="${escapeHTML(outcome.key)}"
                aria-pressed="${selected}"
                aria-label="${escapeHTML(outcome.label)} odds ${escapeHTML(outcome.value)}">

                <span>${escapeHTML(outcome.label)}</span>
                <strong>${escapeHTML(outcome.value)}</strong>

            </button>
        `;
    }).join("");

    return `
        <article class="match-card">

            <div class="match-card-header">
                <span class="match-league">
                    ${escapeHTML(match.league)}
                </span>

                <span class="match-time">
                    ${escapeHTML(match.time)}
                </span>
            </div>

            <div class="match-teams">
                <span class="match-team">
                    ${escapeHTML(match.home)}
                </span>

                <span class="match-vs">VS</span>

                <span class="match-team">
                    ${escapeHTML(match.away)}
                </span>
            </div>

            <div class="match-odds">
                ${oddsHTML}
            </div>

        </article>
    `;
}

function renderMatches() {
    const filteredMatches = getFilteredMatches();

    const homeMatches = getElement("home-matches");
    const sportsMatches = getElement("sports-matches");

    const html = filteredMatches.length
        ? filteredMatches.map(renderMatchCard).join("")
        : `
            <div class="empty-state">
                <span>⚽</span>
                <p>No sample matches are available for this category.</p>
            </div>
        `;

    if (homeMatches) {
        homeMatches.innerHTML = html;
    }

    if (sportsMatches) {
        sportsMatches.innerHTML = html;
    }

    renderBetSlip();
}


/* ==================================================
   SECTION 10: DEMONSTRATION BET SLIP
   ================================================== */

// This section only creates a local selection list.
// It does NOT place bets, deduct money, or connect to a bookmaker.

function toggleBetSelection(matchId, outcomeKey) {
    const match = sampleMatches.find(item => {
        return item.id === matchId;
    });

    if (!match) return;

    const oddsValue = match.odds[outcomeKey];

    if (oddsValue === null || oddsValue === undefined) {
        return;
    }

    const existingIndex = appState.selectedBets.findIndex(bet => {
        return bet.matchId === matchId;
    });

    // Tapping an already selected outcome removes it.
    if (
        existingIndex >= 0 &&
        appState.selectedBets[existingIndex].outcome === outcomeKey
    ) {
        appState.selectedBets.splice(existingIndex, 1);
    } else {
        // Only one outcome per match is allowed.
        if (existingIndex >= 0) {
            appState.selectedBets.splice(existingIndex, 1);
        }

        appState.selectedBets.push({
            matchId: match.id,
            home: match.home,
            away: match.away,
            outcome: outcomeKey,
            odds: Number(oddsValue)
        });
    }

    renderMatches();
}

function renderBetSlip() {
    const container = getElement("betslip-content");
    const count = getElement("betslip-count");

    if (count) {
        count.textContent = String(appState.selectedBets.length);
    }

    if (!container) return;

    if (appState.selectedBets.length === 0) {
        container.innerHTML = `
            <p>Your selections will appear here.</p>
        `;
        return;
    }

    const selectionsHTML = appState.selectedBets.map(bet => {
        let outcomeLabel = bet.outcome;

        if (bet.outcome === "home") outcomeLabel = "Home win";
        if (bet.outcome === "draw") outcomeLabel = "Draw";
        if (bet.outcome === "away") outcomeLabel = "Away win";

        return `
            <div class="bet-slip-selection">

                <div>
                    <strong>
                        ${escapeHTML(bet.home)} vs ${escapeHTML(bet.away)}
                    </strong>

                    <p>
                        ${escapeHTML(outcomeLabel)}
                        · Odds ${bet.odds.toFixed(2)}
                    </p>
                </div>

                <button
                    type="button"
                    class="text-button"
                    data-remove-bet="${escapeHTML(bet.matchId)}"
                    aria-label="Remove selection">
                    Remove
                </button>

            </div>
        `;
    }).join("");

    container.innerHTML = `
        ${selectionsHTML}

        <p class="data-notice">
            Demonstration slip only. These sample selections cannot be submitted
            as real bets.
        </p>

        <button
            type="button"
            class="primary-button"
            data-demo-bet-action="continue">
            Continue
        </button>
    `;
}


/* ==================================================
   SECTION 11: WALLET DISPLAY
   ================================================== */

// The displayed zero balance is a placeholder.
// Never treat this display as a real account balance.

function updateWalletDisplay(amount) {
    const headerBalance = getElement("header-balance");
    const walletBalance = getElement("wallet-page-balance");

    const formatted = formatKES(amount);

    if (headerBalance) {
        headerBalance.textContent = formatted;
    }

    if (walletBalance) {
        walletBalance.textContent = formatted;
    }
}


/* ==================================================
   SECTION 12: WALLET ACTIONS
   ================================================== */

function handleWalletAction(action) {
    if (action === "deposit") {
        showNotification(
            "Deposits are not connected yet. No payment has been made."
        );
        return;
    }

    if (action === "withdraw") {
        showNotification(
            "Withdrawals are not connected yet."
        );
    }
}


/* ==================================================
   SECTION 13: ACCOUNT TABS
   ================================================== */

function setAccountTab(tabName) {
    if (!["login", "register"].includes(tabName)) {
        return;
    }

    appState.currentAccountTab = tabName;

    getElements(".account-tab").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.accountTab === tabName
        );
    });

    renderAccountForm();
}

function renderAccountForm() {
    const container = getElement("account-form-container");

    if (!container) return;

    if (appState.currentAccountTab === "register") {
        container.innerHTML = `
            <form class="account-form" id="register-form">

                <div class="form-group">
                    <label for="register-name">Full name</label>
                    <input
                        id="register-name"
                        name="name"
                        type="text"
                        autocomplete="name"
                        required
                        maxlength="100"
                        placeholder="Enter your full name">
                </div>

                <div class="form-group">
                    <label for="register-email">Email address</label>
                    <input
                        id="register-email"
                        name="email"
                        type="email"
                        autocomplete="email"
                        required
                        maxlength="254"
                        placeholder="Enter your email">
                </div>

                <div class="form-group">
                    <label for="register-password">Password</label>
                    <input
                        id="register-password"
                        name="password"
                        type="password"
                        autocomplete="new-password"
                        minlength="8"
                        required
                        placeholder="Create a password">
                </div>

                <button type="submit" class="form-submit">
                    Create account
                </button>

                <p class="form-message">
                    Account creation will be enabled when the secure backend
                    is connected.
                </p>

            </form>
        `;
    } else {
        container.innerHTML = `
            <form class="account-form" id="login-form">

                <div class="form-group">
                    <label for="login-email">Email address</label>
                    <input
                        id="login-email"
                        name="email"
                        type="email"
                        autocomplete="email"
                        required
                        maxlength="254"
                        placeholder="Enter your email">
                </div>

                <div class="form-group">
                    <label for="login-password">Password</label>
                    <input
                        id="login-password"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        required
                        placeholder="Enter your password">
                </div>

                <button type="submit" class="form-submit">
                    Login
                </button>

                <p class="form-message">
                    Login will be enabled when the secure backend is connected.
                </p>

            </form>
        `;
    }
}

function handleAccountForm(event) {
    if (
        event.target.id === "login-form" ||
        event.target.id === "register-form"
    ) {
        event.preventDefault();

        showNotification(
            "Account authentication is not connected yet. No account was created."
        );
    }
}


/* ==================================================
   SECTION 14: BETTING HISTORY FILTERS
   ================================================== */

function setHistoryFilter(filterName) {
    if (!["all", "settled", "pending"].includes(filterName)) {
        return;
    }

    appState.currentHistoryFilter = filterName;

    getElements(".history-filter").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.historyFilter === filterName
        );
    });

    // Real history will be loaded when the backend is implemented.
    const historyList = getElement("bet-history-list");

    if (historyList) {
        historyList.innerHTML = `
            <div class="empty-state">
                <span>📋</span>
                <p>
                    No connected betting history is available.
                    Your selected filter is "${escapeHTML(filterName)}".
                </p>
            </div>
        `;
    }
}


/* ==================================================
   SECTION 15: CENTRAL CLICK EVENT HANDLER
   ================================================== */

document.addEventListener("click", event => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    // Main page navigation.
    const pageButton = target.closest("[data-page]");

    if (pageButton) {
        const pageName = pageButton.dataset.page;

        if (pageName) {
            openPage(pageName);
            return;
        }
    }

    // Open or close the hamburger menu.
    if (target.closest("#menu-button")) {
        toggleMenu();
        return;
    }

    if (target.closest("#close-menu-button")) {
        closeMenu();
        return;
    }

    if (target.closest("#menu-overlay")) {
        closeMenu();
        return;
    }

    // Sports category buttons.
    const sportButton = target.closest(".sport-filter");

    if (sportButton) {
        setSportFilter(sportButton.dataset.sport || "all");
        return;
    }

    // Demonstration match odds.
    const oddsButton = target.closest("[data-match-id][data-outcome]");

    if (oddsButton && !oddsButton.disabled) {
        toggleBetSelection(
            oddsButton.dataset.matchId,
            oddsButton.dataset.outcome
        );
        return;
    }

    // Remove a selection from the demonstration slip.
    const removeButton = target.closest("[data-remove-bet]");

    if (removeButton) {
        const matchId = removeButton.dataset.removeBet;

        appState.selectedBets = appState.selectedBets.filter(bet => {
            return bet.matchId !== matchId;
        });

        renderMatches();
        return;
    }

    // Demonstration slip continuation.
    if (target.closest('[data-demo-bet-action="continue"]')) {
        showNotification(
            "Real bet placement is not enabled. No money has been deducted."
        );
        return;
    }

    // Wallet actions.
    const walletButton = target.closest("[data-wallet-action]");

    if (walletButton) {
        handleWalletAction(walletButton.dataset.walletAction);
        return;
    }

    // Account login or registration tabs.
    const accountTab = target.closest("[data-account-tab]");

    if (accountTab) {
        setAccountTab(accountTab.dataset.accountTab);
        return;
    }

    // Betting history filters.
    const historyFilter = target.closest("[data-history-filter]");

    if (historyFilter) {
        setHistoryFilter(historyFilter.dataset.historyFilter);
    }
});


/* ==================================================
   SECTION 16: FORM EVENT HANDLER
   ================================================== */

document.addEventListener("submit", handleAccountForm);


/* ==================================================
   SECTION 17: KEYBOARD ACCESSIBILITY
   ================================================== */

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeMenu();
    }
});


/* ==================================================
   SECTION 18: APPLICATION INITIALISATION
   ================================================== */

function initialiseApp() {
    // Start with the placeholder balance until a real wallet API exists.
    updateWalletDisplay(0);

    // Render the demonstration sports cards and empty bet slip.
    renderMatches();

    // Prepare the account login form.
    renderAccountForm();

    // Open a valid page if the URL contains a page fragment.
    const requestedPage = window.location.hash.replace("#", "");

    if (ZETUBET.pages.includes(requestedPage)) {
        openPage(requestedPage);
    } else {
        openPage(ZETUBET.defaultPage);
    }

    console.info("ZetuBet frontend initialised.");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseApp);
} else {
    initialiseApp();
}


/* ==================================================
   END OF APPLICATION SCRIPT
   ================================================== */

# Dogfood Report: Predict Cornell

**Target:** `https://predictcornell.com`
**Date:** Sunday, March 1, 2026
**Tester:** Gemini CLI

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 3 |
| 🔵 Low | 2 |
| **Total** | **6** |

### Key Findings

1. 🟠 **High:** Market Details page shows "days remaining" even for RESOLVED markets.
2. 🟡 **Medium:** "Markets ▾" dropdown in top navbar is non-functional on click.
3. 🟡 **Medium:** "Resolved" filter on All Markets page initially appears empty or takes a very long time to load.
4. 🟡 **Medium:** Leaderboard content initially appears empty, leading to a "dead end" feeling until scroll/load completes.
5. 🔵 **Low:** Singular/Plural typo in "1 markets shown" count.
6. 🔵 **Low:** "Start Trading" for logged-out users leads to a sparse navbar-only page.

---

## Issues

### ISSUE-001: Market Details shows "days remaining" for resolved markets
- **Severity:** 🟠 High
- **Category:** Functional / Content
- **Repro Video:** N/A (Visible on load)
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/market-details.png`

**Description:**
On the market details page for a RESOLVED market, the statistics bar still shows a countdown of "days remaining" based on the original `resolutionDate`. For example, a market resolved yesterday still shows "6d remaining".

**Repro Steps:**
1. Go to `https://predictcornell.com/markets?status=resolved`.
2. Click on a resolved market (e.g., "Will Cornell men's basketball qualify for Ivy Madness?").
3. Observe the statistics bar showing "Xd remaining".

---

### ISSUE-002: "Markets ▾" dropdown does not open
- **Severity:** 🟡 Medium
- **Category:** Functional
- **Repro Video:** N/A (Action failed to produce result)
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/markets-dropdown.png`

**Description:**
The "Markets ▾" button in the top navigation bar does not trigger any dropdown or menu when clicked.

**Repro Steps:**
1. Visit the home page.
2. Click on the "Markets ▾" button in the header.
3. Observe no visual change or menu appearing.

---

### ISSUE-003: "Resolved" filter on All Markets page initially empty
- **Severity:** 🟡 Medium
- **Category:** Functional / UX
- **Repro Video:** N/A
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/markets-resolved.png`

**Description:**
When navigating to the All Markets page and filtering by "Resolved", the list initially appears empty with a "Reset all" button, even though resolved markets exist and are visible on the home page. The data eventually loads but the initial empty state is misleading.

**Repro Steps:**
1. Go to `https://predictcornell.com/markets`.
2. Click the "Resolved" filter button.
3. Observe the "No resolved markets right now" message or empty state before data (eventually) arrives.

---

### ISSUE-004: Leaderboard appears empty initially
- **Severity:** 🟡 Medium
- **Category:** UX / Performance
- **Repro Video:** N/A
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/leaderboard.png`

**Description:**
The Leaderboard page shows only the navigation bar for several seconds after loading. The content (rankings table) appears only after a significant delay or after scrolling down. This creates a "dead end" user experience where the page looks broken.

**Repro Steps:**
1. Click "Leaderboard" in the navigation.
2. Observe the page appears empty below the header.
3. Wait or scroll down to see content.

---

### ISSUE-005: "1 markets shown" singular/plural typo
- **Severity:** 🔵 Low
- **Category:** Content
- **Repro Video:** N/A
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/resolved-filter-direct.png`

**Description:**
On the All Markets page, when exactly one market is filtered, the text reads "1 markets shown" instead of "1 market shown".

**Repro Steps:**
1. Apply filters that result in exactly one market (e.g., Status: Resolved).
2. Check the count text at the top of the list.

---

### ISSUE-006: "Start Trading" leads to sparse page for logged-out users
- **Severity:** 🔵 Low
- **Category:** UX
- **Repro Video:** N/A
- **Screenshot:** `dogfood-output/predictcornell-com/screenshots/start-trading.png`

**Description:**
Clicking "Start Trading" from the home page as a logged-out user takes the user to `/markets?status=active`, which appears empty (only navbar) for several seconds while data loads. A loading indicator or a sign-in prompt would improve this experience.

**Repro Steps:**
1. Visit the home page while logged out.
2. Click the large red "Start Trading" button.
3. Observe the transition to a sparse page.

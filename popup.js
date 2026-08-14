"use strict";

/*
 * Twitch Account Switcher. 100% local.
 *
 * All this extension does is snapshot and restore your own twitch.tv cookies,
 * which is functionally identical to logging out and logging back in by hand.
 * It performs no network requests, no automation, and stores everything in
 * chrome.storage.local only.
 */

const STORAGE_KEY = "tas_accounts_v1";
const TWITCH_HOME = "https://www.twitch.tv/";

// Device-level cookies stay shared across accounts, exactly as they would if
// you logged out and back in by hand. Swapping them per account would make the
// browser look like a different device on every switch. churn that anti-abuse
// systems are built to notice.
const SHARED_DEVICE_COOKIES = new Set(["unique_id", "unique_id_durable"]);

const el = {
  status: document.getElementById("status"),
  alert: document.getElementById("alert"),
  list: document.getElementById("account-list"),
  empty: document.getElementById("empty-state"),
  saveBtn: document.getElementById("save-btn"),
  logoutBtn: document.getElementById("logout-btn"),
};

let busy = false;
let alertTimer = null;

/* ---------- cookies ---------- */

function getTwitchCookies() {
  // Matches twitch.tv and every subdomain (www, id, gql, ...).
  return chrome.cookies.getAll({ domain: "twitch.tv" });
}

function cookieUrl(c) {
  const host = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
  return "https://" + host + (c.path || "/");
}

function toStorable(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    session: c.session,
    hostOnly: c.hostOnly,
    expirationDate: c.expirationDate,
  };
}

async function clearTwitchCookies() {
  const cookies = await getTwitchCookies();
  await Promise.all(
    cookies
      .filter((c) => !SHARED_DEVICE_COOKIES.has(c.name))
      .map((c) =>
        chrome.cookies.remove({ url: cookieUrl(c), name: c.name }).catch(() => null)
      )
  );
}

async function restoreCookies(cookies) {
  const now = Date.now() / 1000;
  await Promise.all(
    cookies.map((c) => {
      if (SHARED_DEVICE_COOKIES.has(c.name)) return null;
      if (!c.session && c.expirationDate && c.expirationDate < now) return null;
      const details = {
        url: cookieUrl(c),
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      };
      if (!c.hostOnly) details.domain = c.domain;
      if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
      return chrome.cookies.set(details).catch(() => null);
    })
  );
}

/* ---------- identity ---------- */

function parseIdentity(cookies) {
  const twilight = cookies.find((c) => c.name === "twilight-user" && c.value);
  if (twilight) {
    try {
      const data = JSON.parse(decodeURIComponent(twilight.value));
      if (data && data.login) {
        return {
          login: String(data.login).toLowerCase(),
          displayName: data.displayName || data.login,
          userId: data.id != null ? String(data.id) : "",
        };
      }
    } catch {
      // fall through to the plain login/name cookies
    }
  }
  const plain = cookies.find((c) => (c.name === "login" || c.name === "name") && c.value);
  if (plain) {
    try {
      const v = decodeURIComponent(plain.value);
      return { login: v.toLowerCase(), displayName: v, userId: "" };
    } catch {
      return null;
    }
  }
  return null;
}

async function currentSession() {
  const cookies = await getTwitchCookies();
  const identity = parseIdentity(cookies);
  const authed = cookies.some((c) => c.name === "auth-token" && c.value);
  return { cookies, identity: authed ? identity : null };
}

/* ---------- saved accounts ---------- */

async function loadAccounts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

function saveAccounts(accounts) {
  return chrome.storage.local.set({ [STORAGE_KEY]: accounts });
}

// Returns true when the snapshot was newly added rather than updated.
function upsertSnapshot(accounts, snap) {
  const i = accounts.findIndex((a) => a.login === snap.login);
  if (i >= 0) accounts[i] = { ...accounts[i], ...snap };
  else accounts.push(snap);
  return i < 0;
}

async function snapshotCurrent() {
  const { cookies, identity } = await currentSession();
  if (!identity) return null;
  return {
    login: identity.login,
    displayName: identity.displayName,
    userId: identity.userId,
    savedAt: Date.now(),
    cookies: cookies.filter((c) => !SHARED_DEVICE_COOKIES.has(c.name)).map(toStorable),
  };
}

/* ---------- tabs ---------- */

async function reloadTwitchTabs(openIfNone) {
  const tabs = await chrome.tabs.query({ url: "*://*.twitch.tv/*" });
  if (tabs.length === 0) {
    if (openIfNone) await chrome.tabs.create({ url: TWITCH_HOME });
    return;
  }
  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => null)));
}

/* ---------- actions ---------- */

function withBusy(fn) {
  if (busy) return Promise.resolve();
  busy = true;
  document.body.classList.add("busy");
  return (async () => {
    try {
      await fn();
    } catch (err) {
      showAlert(err && err.message ? err.message : String(err), "error");
    } finally {
      busy = false;
      document.body.classList.remove("busy");
      await render();
    }
  })();
}

function handleSave() {
  return withBusy(async () => {
    const snap = await snapshotCurrent();
    if (!snap) {
      throw new Error("No Twitch login detected. Log in at twitch.tv first, then save.");
    }
    const accounts = await loadAccounts();
    const added = upsertSnapshot(accounts, snap);
    await saveAccounts(accounts);
    showAlert(
      added ? "Saved " + snap.displayName + "." : "Updated snapshot for " + snap.displayName + ".",
      "success"
    );
  });
}

function handleSwitch(login) {
  return withBusy(async () => {
    const accounts = await loadAccounts();
    const target = accounts.find((a) => a.login === login);
    if (!target) throw new Error("Account not found.");

    // Refresh the snapshot of the account we are leaving so its session
    // survives the switch with its freshest cookies.
    const snap = await snapshotCurrent();
    if (snap && snap.login !== login) upsertSnapshot(accounts, snap);

    await clearTwitchCookies();
    await restoreCookies(target.cookies);
    target.lastUsedAt = Date.now();
    await saveAccounts(accounts);
    await reloadTwitchTabs(true);
  });
}

function handleLogout() {
  return withBusy(async () => {
    const snap = await snapshotCurrent();
    if (snap) {
      const accounts = await loadAccounts();
      upsertSnapshot(accounts, snap);
      await saveAccounts(accounts);
    }
    await clearTwitchCookies();
    await reloadTwitchTabs(false);
    showAlert(
      snap
        ? "Logged out on this browser. " + snap.displayName + "'s session was saved first."
        : "Cleared Twitch session cookies.",
      "success"
    );
  });
}

function handleDelete(login) {
  return withBusy(async () => {
    const accounts = await loadAccounts();
    await saveAccounts(accounts.filter((a) => a.login !== login));
    showAlert("Removed the saved snapshot. The Twitch account itself is untouched.", "success");
  });
}

/* ---------- UI ---------- */

function showAlert(message, kind) {
  clearTimeout(alertTimer);
  el.alert.textContent = message;
  el.alert.className = "alert " + (kind || "success");
  if (kind === "success") {
    alertTimer = setTimeout(() => el.alert.classList.add("hidden"), 4000);
  }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(ts).toLocaleDateString();
}

function avatarFor(login, displayName) {
  const span = document.createElement("span");
  span.className = "avatar";
  span.textContent = (displayName || login).slice(0, 2).toUpperCase();
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.codePointAt(0)) % 360;
  span.style.background = "hsl(" + h + " 55% 42%)";
  return span;
}

function makeDeleteButton(login) {
  const btn = document.createElement("button");
  btn.className = "icon-btn danger";
  btn.textContent = "✕";
  btn.title = "Remove saved account";
  let armed = false;
  let timer = null;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Sure?";
      btn.classList.add("armed");
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = "✕";
        btn.classList.remove("armed");
      }, 3000);
    } else {
      clearTimeout(timer);
      handleDelete(login);
    }
  });
  return btn;
}

function accountRow(account, isActive) {
  const li = document.createElement("li");
  li.className = "account" + (isActive ? " active" : "");

  li.appendChild(avatarFor(account.login, account.displayName));

  const info = document.createElement("div");
  info.className = "account-info";
  const name = document.createElement("div");
  name.className = "account-name";
  name.textContent = account.displayName;
  const meta = document.createElement("div");
  meta.className = "account-meta";
  meta.textContent = "@" + account.login + " · saved " + timeAgo(account.savedAt);
  info.appendChild(name);
  info.appendChild(meta);
  li.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "account-actions";

  if (isActive) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Active";
    actions.appendChild(badge);

    const refresh = document.createElement("button");
    refresh.className = "icon-btn";
    refresh.textContent = "↻";
    refresh.title = "Update this snapshot from the current session";
    refresh.addEventListener("click", handleSave);
    actions.appendChild(refresh);
  } else {
    const switchBtn = document.createElement("button");
    switchBtn.className = "btn small";
    switchBtn.textContent = "Switch";
    switchBtn.addEventListener("click", () => handleSwitch(account.login));
    actions.appendChild(switchBtn);
  }

  actions.appendChild(makeDeleteButton(account.login));
  li.appendChild(actions);
  return li;
}

async function render() {
  const [accounts, session] = await Promise.all([loadAccounts(), currentSession()]);
  const activeLogin = session.identity ? session.identity.login : null;

  el.status.textContent = session.identity
    ? "Signed in as " + session.identity.displayName
    : "Not signed in on twitch.tv";

  el.saveBtn.disabled = !session.identity;
  el.logoutBtn.disabled = !session.identity;
  el.saveBtn.title = session.identity ? "" : "Log in at twitch.tv first";

  el.list.textContent = "";
  for (const account of accounts) {
    el.list.appendChild(accountRow(account, account.login === activeLogin));
  }
  el.empty.classList.toggle("hidden", accounts.length > 0);
}

el.saveBtn.addEventListener("click", handleSave);
el.logoutBtn.addEventListener("click", handleLogout);

render().catch((err) => showAlert(String(err), "error"));

const { AUTO_LOCK_MINUTES } = require("./config.js");

/**
 * The unlocked session — the derived AES key (a CryptoKey) + the account id —
 * held only in this main-process module's memory. Never serialized, gone on
 * quit (Flow opens locked, asks for the PIN). Idle timer auto-locks.
 */
let uid = null;
let key = null;
let timer = null;
let onLockCb = null;
let autoLockMinutes = AUTO_LOCK_MINUTES;
let failedAttempts = 0;
const MAX_FAILED_ATTEMPTS = 5;

function onLock(cb) { onLockCb = cb; }
function setSession(u, k) { uid = u; key = k; failedAttempts = 0; armAutoLock(); }
function getSession() { return key ? { uid, key } : null; }
function isUnlocked() { return !!key; }

function lock() {
  if (key) {
    // Clear sensitive data from memory
    if (key.extractable === false) {
      try { key.zeroization = true; } catch (_) {}
    }
    key = null;
  }
  uid = null;
  failedAttempts = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

function armAutoLock(minutes) {
  if (timer) clearTimeout(timer);
  autoLockMinutes = minutes || autoLockMinutes;
  timer = setTimeout(() => { lock(); if (onLockCb) onLockCb(); }, autoLockMinutes * 60 * 1000);
}

function getFailedAttempts() { return failedAttempts; }
function incrementFailedAttempts() {
  failedAttempts++;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    lock();
    if (onLockCb) onLockCb();
    return true; // locked due to too many attempts
  }
  return false;
}

module.exports = { onLock, setSession, getSession, isUnlocked, lock, armAutoLock, getFailedAttempts, incrementFailedAttempts };

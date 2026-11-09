const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// A tiny JSON store.
//
// Flowr deliberately runs several processes against one userData directory —
// new windows, incognito, and torn-out tabs are separate `process.execPath`
// spawns that all read and write the same settings.json / history.json /
// profiles/<id>/bookmarks.json. Store used to keep `this.data` in memory and
// write it back verbatim, so whichever process flushed last silently discarded
// everything the others had written in between.
//
// Two mechanisms fix that:
//   1. A pending-key map. A flush only claims the keys this process actually
//      changed since its last flush; everything else is taken fresh from disk.
//   2. An advisory lock file around the read-modify-write, so two processes
//      cannot interleave a read, a merge and a rename.
class Store {
  constructor(filename, defaults) {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, filename + '.json');
    this.lockPath = `${this.path}.lock`;

    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.defaults = defaults;
    this.data = this.parseDataFile(this.path, defaults) || defaults;
    this._dirty = false;
    this._timer = null;
    // Keys written since the last successful flush, with their new values.
    this._pending = new Map();
  }

  parseDataFile(filePath, defaults) {
    try {
      if (!fs.existsSync(filePath)) {
        return defaults;
      }
      const fileContent = fs.readFileSync(filePath);
      if (!fileContent) return defaults;
      return JSON.parse(fileContent);
    } catch(error) {
      console.error(`Error loading store ${filePath}:`, error);
      // Preserve the corrupt file for diagnosis instead of silently
      // discarding user data on the next flush.
      try {
        const backup = `${filePath}.corrupt-${Date.now()}.bak`;
        fs.copyFileSync(filePath, backup);
      } catch (_) {}
      return defaults;
    }
  }

  get(key) {
    if (this.data && this.data[key] !== undefined) {
        return this.data[key];
    }
    return this.defaults ? this.defaults[key] : undefined;
  }

  set(key, val) {
    this.data[key] = val;
    this._pending.set(key, val);
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), 100);
    }
  }

  _flush() {
    this._timer = null;
    if (!this._dirty) return;
    this._dirty = false;
    this._writeMerged();
  }

  // Acquire an exclusive advisory lock, breaking a lock abandoned by a process
  // that died mid-write. Returns false when the lock could not be taken.
  _acquireLock() {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return true;
      } catch (_) {
        // Break a stale lock. A write here is sub-millisecond, so anything
        // older than 5s belongs to a process that is gone.
        try {
          const stat = fs.statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > 5000) {
            fs.rmSync(this.lockPath, { force: true });
            continue;
          }
        } catch (_) {
          continue;
        }
        // Busy-wait briefly. Sync sleep keeps this usable without async here.
        const until = Date.now() + 25;
        while (Date.now() < until) { /* spin */ }
      }
    }
    return false;
  }

  _releaseLock() {
    try { fs.rmSync(this.lockPath, { force: true }); } catch (_) {}
  }

  _writeMerged() {
    const pending = new Map(this._pending);
    this._pending.clear();
    if (pending.size === 0) return;
    if (!this._acquireLock()) {
      // Could not serialise with another process. Put the writes back so a
      // later attempt retries them rather than dropping them.
      this._rearm(pending);
      return;
    }
    try {
      // Re-read under the lock: another process may have written since we last
      // looked. Its values win for keys we did not touch.
      const onDisk = this.parseDataFile(this.path, null);
      const merged = { ...this.data, ...(onDisk && typeof onDisk === 'object' ? onDisk : null) };
      for (const [key, value] of pending) merged[key] = value;
      if (this._atomicWrite(merged)) this.data = merged;
      else this._rearm(pending);
    } finally {
      this._releaseLock();
    }
  }

  // Put writes back so a later attempt retries them rather than dropping them.
  _rearm(pending) {
    for (const [key, value] of pending) this._pending.set(key, value);
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), 250);
      this._timer.unref?.();
    }
  }

  _atomicWrite(data) {
    // Per-process temp name: two processes sharing this directory must never
    // race on the same "<path>.tmp".
    const tmp = `${this.path}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.path);
      return true;
    } catch (error) {
      console.error(`Error writing store ${this.path}:`, error);
      try { if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); } catch (_) {}
      return false;
    }
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); }
    this._timer = null;
    if (!this._dirty) return;
    this._dirty = false;
    this._writeMerged();
  }
}

module.exports = Store;
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(filename, defaults) {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, filename + '.json');
    
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.defaults = defaults;
    this.data = this.parseDataFile(this.path, defaults) || defaults;
    this._dirty = false;
    this._timer = null;
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
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), 100);
    }
  }

  _flush() {
    this._timer = null;
    if (!this._dirty) return;
    this._dirty = false;
    fs.writeFile(this.path, JSON.stringify(this.data), (error) => {
      if (error) console.error(`Error writing store ${this.path}:`, error);
    });
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); }
    this._timer = null;
    if (!this._dirty) return;
    this._dirty = false;
    try { fs.writeFileSync(this.path, JSON.stringify(this.data)); }
    catch (error) { console.error(`Error writing store ${this.path}:`, error); }
  }
}

module.exports = Store;

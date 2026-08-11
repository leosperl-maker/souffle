'use strict';
/** Historique local des dictées (désactivé en mode confidentialité). */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

class History {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'history.json');
    this.items = [];
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  add(entry, limit = 100) {
    this.items.unshift({ ...entry, at: Date.now() });
    if (this.items.length > limit) this.items.length = limit;
    this.flush();
  }

  list() {
    return this.items;
  }

  clear() {
    this.items = [];
    this.flush();
  }

  flush() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.items));
    } catch {
      /* disque en lecture seule : on ignore */
    }
  }
}

module.exports = { History };

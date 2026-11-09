const path = require('path');

// Filesystem safety helpers shared by the theme and extension installers.
//
// Both installers take an `id` from a remote JSON document and turn it into a
// directory name. Sanitising with `id.replace(/[^a-z0-9._-]/gi, '-')` looks
// safe but keeps `.` and `..`, so a package with `"id": ".."` collapses
// `userData/themes/<id>` to `userData` and writes outside the intended folder.
// These helpers validate rather than rewrite, and re-check containment after
// resolving so a future encoding change cannot reintroduce the escape.

// Conservative: must start alphanumeric, then allow dots/dashes/underscores.
// Rejects '', '.', '..', anything with a separator, and anything exotic.
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function isValidPackageId(id) {
  const value = String(id == null ? '' : id);
  if (!PACKAGE_ID.test(value)) return false;
  // Belt and braces: a dot-only or dot-led name is never a real package id.
  if (value === '.' || value === '..') return false;
  if (value.includes('..')) return false;
  return true;
}

// Resolve `<root>/<id>` and prove the result is still inside <root>.
function resolvePackageDir(root, id) {
  if (!isValidPackageId(id)) throw new Error('Package id is not a valid name.');
  const base = path.resolve(root);
  const resolved = path.resolve(path.join(base, String(id)));
  if (!isInside(base, resolved)) throw new Error('Package id escapes its install folder.');
  return resolved;
}

// True when `target` is `root` itself or lives beneath it.
function isInside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === base) return true;
  const rel = path.relative(base, resolved);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Validate a relative path from a remote package before it is joined onto a
// destination directory. Rejects absolute paths, drive letters, UNC prefixes,
// and any '..' segment.
function safeRelativePath(relative) {
  const normalized = String(relative == null ? '' : relative).replace(/\\/g, '/');
  if (!normalized) throw new Error('Package contains an empty file path.');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error('Package contains an absolute file path.');
  if (normalized.split('/').some(segment => segment === '..')) throw new Error('Package contains an unsafe file path.');
  const cleaned = normalized.split('/').filter(segment => segment && segment !== '.').join('/');
  if (!cleaned) throw new Error('Package contains an unsafe file path.');
  return cleaned;
}

// Resolve `<root>/<relative>` and prove containment.
function resolveInside(root, relative) {
  const base = path.resolve(root);
  const resolved = path.resolve(path.join(base, safeRelativePath(relative)));
  if (!isInside(base, resolved)) throw new Error('Package file escapes its install folder.');
  return resolved;
}

module.exports = {
  isValidPackageId,
  resolvePackageDir,
  isInside,
  safeRelativePath,
  resolveInside
};
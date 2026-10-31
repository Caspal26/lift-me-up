// One place to ask for "now", so the simulation can walk through several
// mornings without waiting for them.
let fixedMs = null;

export const clock = {
  now() {
    return fixedMs === null ? new Date() : new Date(fixedMs);
  },
  set(date) {
    fixedMs = new Date(date).getTime();
  },
  advance(ms) {
    fixedMs = (fixedMs ?? Date.now()) + ms;
  },
  reset() {
    fixedMs = null;
  },
};

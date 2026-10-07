/** One serialized queue per candidate. The caller captures the account/session. */
export function createAutosave({ write, changed = () => {}, storage, namespace, delay = 450 }) {
  const entries = new Map();
  let stopped = false;
  const persist = e => {
    try {
      if (e.dirty) storage?.setItem(namespace + e.id, JSON.stringify(e.value));
      else storage?.removeItem(namespace + e.id);
      e.durable = !!storage;
    } catch { e.durable = false; }
  };
  const emit = e => changed(e);
  function get(id, initial) {
    if (!entries.has(id)) {
      let recovered;
      try { recovered = JSON.parse(storage?.getItem(namespace + id) || 'null'); } catch { /* unavailable storage */ }
      // Recovery is explicit: never silently overwrite newer server values on reload.
      const valid = recovered && typeof recovered.note === 'string' && recovered.scores &&
        ['spk','per','imp'].every(k => recovered.scores[k] == null || Number.isInteger(recovered.scores[k]) && recovered.scores[k] >= 1 && recovered.scores[k] <= 5);
      entries.set(id, { id, value: valid ? recovered : structuredClone(initial), dirty: !!valid,
        revision: 0, state: valid ? 'recovered' : 'saved', durable: !!storage, timer: null, flight: null });
    }
    return entries.get(id);
  }
  function edit(id, value) {
    if (stopped) return;
    const e = entries.get(id);
    e.value = structuredClone(value); e.revision++; e.dirty = true; e.state = 'pending';
    persist(e); emit(e); clearTimeout(e.timer);
    e.timer = setTimeout(() => flush(id), delay);
  }
  async function flush(id) {
    const e = entries.get(id);
    if (!e || stopped) return;
    clearTimeout(e.timer);
    if (e.flight) return e.flight;
    if (!e.dirty) return;
    e.flight = (async () => {
      while (e.dirty && !stopped) {
        const revision = e.revision, value = structuredClone(e.value);
        e.state = 'saving'; emit(e);
        try { await write(id, value); }
        catch { e.state = 'error'; persist(e); emit(e); return; }
        if (stopped) return;
        if (revision === e.revision) { e.dirty = false; e.state = 'saved'; persist(e); }
        emit(e);
      }
    })();
    try { await e.flight; } finally { e.flight = null; }
  }
  return { get, edit, flush, entries,
    pending: () => [...entries.values()].some(e => e.dirty),
    flushAll: () => Promise.all([...entries.values()].filter(e => e.state !== 'recovered').map(e => flush(e.id))),
    stop() { stopped = true; for (const e of entries.values()) clearTimeout(e.timer); }
  };
}

/* Turn the model's light formatting into safe HTML, and into speakable text.
   Everything is escaped first; only **bold**, short bullet lists and line breaks
   are then re-introduced, so nothing a record or a model says can become markup. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = []; let list = null;
  const inline = s => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;!?]|$)/g, '$1<i>$2</i>');
  const flush = () => { if (list) { out.push(`<ul>${list.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of lines) {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(raw);
    if (m) { (list ||= []).push(m[1]); continue; }
    flush();
    if (raw.trim()) out.push(`<p>${inline(raw.trim())}</p>`);
  }
  flush();
  return out.join('');
}

/** Plain text suitable for speech: no markup, no list symbols, links read as nothing. */
export const toSpeech = text => String(text || '').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '').replace(/https?:\/\/\S+/g, '').replace(/#\/\S+/g, '').replace(/[_`]/g, '').replace(/([^.!?:;,\s])[ \t]*\n+\s*/g, '$1. ').replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();

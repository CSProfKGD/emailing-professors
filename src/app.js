import { makeAnchor, resolveAnchor, fromStored } from './anchors.js';
import { configured, client, getNotes, getReplies, session, signIn, signOut, rpc } from './api.js';
import { el, button, message, busy, noteMeta, nameField } from './ui.js';
const article = document.querySelector('#article');
const dialog = document.querySelector('#notes-dialog');
const content = document.querySelector('#dialog-content');
const add = document.querySelector('#add-note');
const toggle = document.querySelector('#toggle-notes');
const status = document.querySelector('#notes-status');
let selected, notes = [], visible = true, signedIn = null, returnFocus, loadFailed = false;
const blocks = Array.from(article.querySelectorAll('[data-passage], h2'));
const articleText = blocks.map(p => p.textContent).join('\n\n');
const blockStart = block => blocks.slice(0, blocks.indexOf(block)).reduce((sum, p) => sum + p.textContent.length + 2, 0);
function anchorLocation(anchor) {
  if (anchor.sectionId === 'article-body') {
    const match = resolveAnchor(articleText, anchor);
    if (!match) return null;
    const block = blocks.find(p => blockStart(p) <= match.start && blockStart(p) + p.textContent.length >= match.start);
    return block?.matches('[data-passage]') ? block : block?.closest('section')?.querySelector('[data-passage]');
  }
  const block = blocks.find(p => p.dataset.passage === anchor.sectionId);
  return block && resolveAnchor(block.textContent, anchor) ? block : null;
}
function clearDraft() { try { sessionStorage.removeItem('margin-draft'); } catch {} }

function open(title, ...nodes) {
  document.querySelector('#dialog-title').textContent = title;
  content.replaceChildren(...nodes);
  if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); }
  document.querySelector('#close-dialog').focus();
  add.hidden = true;
}
function close() { dialog.close(); }
document.querySelector('#close-dialog').onclick = close;
dialog.addEventListener('close', () => { returnFocus?.focus?.({ preventScroll: true }); });
function announcement(text) { document.querySelector('#announcement').textContent = text; }
function authPanel(after) {
  if (!configured) return el('div', {}, message('Margin Notes is not available yet. You can still read the full article.'), el('p', { className: 'hint' }, 'Nothing you enter will be submitted until sign-in is available.'));
  const err = el('div');
  return el('div', {}, el('p', {}, 'Sign in to save private notes or submit a note for author review.'),
    el('div', { className: 'actions' }, ...['github'].map(provider => button(`Continue with ${provider === 'google' ? 'Google' : 'GitHub'}`, event => busy(event.currentTarget, async () => { if (after) after(); await signIn(provider); }, err)))), err);
}
function preserveDraft(form, anchor) {
  try { sessionStorage.setItem('margin-draft', JSON.stringify({ anchor, body: form.elements.body.value, name: form.elements.displayName.value, visibility: form.elements.visibility?.value })); } catch { /* Storage may be disabled; keep the current composer intact. */ }
}
function composer(anchor, draft) {
  selected = anchor;
  const errors = el('div');
  const form = el('form', {}, el('blockquote', { className: 'quote' }, anchor.exact), nameField(),
    el('label', { className: 'field' }, el('span', {}, 'Your note'), el('textarea', { name: 'body', required: true, maxlength: 2000, placeholder: 'Ask a question, suggest a clarification, or add another perspective.' })),
    el('p', { className: 'hint' }, 'Up to 2,000 characters. Plain text only.'),
    el('label', { className: 'field' }, el('span', {}, 'Who can see it?'), el('select', { name: 'visibility' }, el('option', { value: 'private' }, 'Private note'), el('option', { value: 'public' }, 'Submit to author'))),
    el('p', { className: 'hint', id: 'visibility-help' }, 'Visible only to you. Sign in to save it.'), errors);
  form.elements.visibility.setAttribute('aria-describedby', 'visibility-help');
  form.elements.visibility.onchange = () => { form.querySelector('#visibility-help').textContent = form.elements.visibility.value === 'private' ? 'Visible only to you.' : 'Sent to the author for moderation. It does not become public until approved.'; };
  if (draft) { form.elements.body.value = draft.body || ''; form.elements.displayName.value = draft.name || ''; form.elements.visibility.value = draft.visibility || 'private'; form.elements.visibility.onchange(); }
  if (signedIn) {
    const submit = el('button', { type: 'submit', className: 'primary' }, 'Save note');
    form.append(el('div', { className: 'actions' }, submit, button('Cancel', close)));
    form.onsubmit = event => {
      event.preventDefault();
      busy(submit, async () => {
        const isPrivate = form.elements.visibility.value === 'private';
        await rpc('create_annotation', { p_article: 'email-professor', p_body: form.elements.body.value, p_name: form.elements.displayName.value, p_private: isPrivate, p_anchor: anchor });
        clearDraft();
        await loadNotes();
        open('Note saved', message(isPrivate ? 'Your private note is saved. Only you can read it.' : 'Your note has been submitted to the author. It will appear publicly only if approved.', 'success'), button('Return to article', close));
      }, errors);
    };
  } else { form.append(authPanel(() => preserveDraft(form, anchor)), button('Cancel', close)); form.onsubmit = e => e.preventDefault(); }
  open('Add a Margin Note', form);
}
function captureSelection() {
  if (dialog.open) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) { add.hidden = true; return; }
  const range = selection.getRangeAt(0);
  const parent = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-passage], h2');
  const passage = parent(range.startContainer);
  const last = parent(range.endContainer);
  if (!passage || !last || !article.contains(passage) || !article.contains(last)) { add.hidden = true; return; }
  const before = range.cloneRange(); before.selectNodeContents(passage); before.setEnd(range.startContainer, range.startOffset);
  const ending = range.cloneRange(); ending.selectNodeContents(last); ending.setEnd(range.endContainer, range.endOffset);
  try {
    if (passage === last && passage.dataset.passage) selected = makeAnchor(passage.dataset.passage, passage.textContent, before.toString().length, ending.toString().length);
    else selected = makeAnchor('article-body', articleText, blockStart(passage) + before.toString().length, blockStart(last) + ending.toString().length);
  } catch (error) { add.hidden = true; announcement(error.message); return; }
  const rect = range.getBoundingClientRect();
  add.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 110))}px`;
  add.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - 52))}px`;
  add.hidden = false;
}
document.addEventListener('selectionchange', () => requestAnimationFrame(captureSelection));
document.addEventListener('pointerup', () => requestAnimationFrame(captureSelection));
document.addEventListener('keyup', captureSelection);
window.addEventListener('scroll', () => { add.hidden = true; }, { passive: true });
add.addEventListener('pointerdown', e => e.preventDefault());
add.onclick = () => { if (selected) composer(selected); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') add.hidden = true; });
function passagePicker() {
  const select = el('select', { id: 'passage-picker' }, ...Array.from(article.querySelectorAll('[data-passage]')).map(p => el('option', { value: p.dataset.passage }, p.textContent)));
  open('Choose a passage', el('p', {}, 'Choose a paragraph to annotate. You can also highlight a shorter passage directly in the article.'), el('label', { className: 'field', for: 'passage-picker' }, el('span', {}, 'Passage'), select), button('Write a note', () => { const p = Array.from(article.querySelectorAll('[data-passage]')).find(p => p.dataset.passage === select.value); composer(makeAnchor(select.value, p.textContent, 0, p.textContent.length)); }, { className: 'primary' }));
}
document.querySelector('#keyboard-note').onclick = passagePicker;
function renderIndicators() {
  document.querySelectorAll('.note-slot').forEach(slot => slot.replaceChildren());
  if (!visible) return;
  const groups = new Map();
  for (const note of notes) {
    if (!note.anchor || note.state === 'rejected') continue;
    const anchor = fromStored(note.anchor);
    const passage = anchorLocation(anchor);
    if (!passage) continue;
    const passageId = passage.dataset.passage;
    if (!groups.has(passageId)) groups.set(passageId, []);
    groups.get(passageId).push(note);
  }
  for (const [id, group] of groups) {
    const slot = Array.from(document.querySelectorAll('.note-slot')).find(s => s.dataset.for === id);
    slot.append(button(`· ${group.length}`, () => showNotes(group), { className: 'note-indicator', 'aria-label': `${group.length} Margin ${group.length === 1 ? 'Note' : 'Notes'} on this passage` }));
  }
}
toggle.onclick = () => { visible = !visible; toggle.textContent = visible ? 'Hide Margin Notes' : 'Show Margin Notes'; toggle.setAttribute('aria-pressed', String(visible)); renderIndicators(); announcement(visible ? 'Margin Notes shown.' : 'Margin Notes hidden.'); };
async function appendReplies(container, note) {
  const loading = message('Loading replies…'); container.append(loading);
  try {
    const replies = await getReplies(note.id);
    loading.remove();
    for (const reply of replies) container.append(el('div', { className: 'reply' }, noteMeta(reply), el('p', {}, reply.body)));
    if (!replies.length) container.append(el('p', { className: 'hint' }, 'No replies yet.'));
    if (!signedIn) { container.append(authPanel()); return; }
    const errors = el('div');
    const form = el('form', {}, nameField(), el('label', { className: 'field' }, el('span', {}, 'Reply'), el('textarea', { name: 'body', required: true, maxlength: 1000 })), el('p', { className: 'hint' }, 'Up to 1,000 characters. Your reply will be reviewed before it appears publicly.'), errors);
    const submit = el('button', { type: 'submit' }, 'Submit reply to author'); form.append(submit);
    form.onsubmit = event => { event.preventDefault(); busy(submit, async () => { await rpc('create_reply', { p_annotation: note.id, p_body: form.elements.body.value, p_name: form.elements.displayName.value }); form.replaceWith(message('Reply submitted for author review.', 'success')); }, errors); };
    container.append(form);
  } catch (error) { loading.replaceWith(message(error.message, 'error')); container.append(button('Retry', () => { container.replaceChildren(); appendReplies(container, note); })); }
}
function showNotes(list = notes) {
  if (!configured) { open('Margin Notes', authPanel()); return; }
  if (loadFailed) { open('Margin Notes', message('Notes could not be loaded.', 'error'), button('Retry', async () => { await loadNotes(); showNotes(); })); return; }
  const cards = list.filter(n => n.state !== 'rejected').map(note => {
    const card = el('div', { className: 'note' }, noteMeta(note), el('blockquote', { className: 'quote' }, note.anchor?.exact || 'Passage unavailable'), el('p', {}, note.body));
    if (note.state === 'approved') { const replies = el('div'); card.append(button('Read or add replies', event => { event.currentTarget.remove(); appendReplies(replies, note); }), replies); }
    return card;
  });
  open('Margin Notes', ...(cards.length ? cards : [message('No notes yet. Highlight a passage to start one.')]), button('Add a note to a passage', passagePicker));
}
document.querySelector('#browse-notes').onclick = () => showNotes();
async function loadNotes() {
  if (!configured) { status.textContent = ''; return; }
  status.textContent = 'Loading Margin Notes…';
  try { notes = await getNotes(); loadFailed = false; renderIndicators(); status.textContent = notes.length ? `${notes.filter(n => n.state !== 'rejected').length} notes available to read.` : 'No Margin Notes yet.'; }
  catch (error) { loadFailed = true; status.textContent = error.message; }
}
async function updateAccount() {
  signedIn = await session();
  document.querySelector('#sign-in').textContent = signedIn ? 'Your account' : 'Sign in to annotate';
}
document.querySelector('#sign-in').onclick = () => {
  if (!signedIn) { open('Sign in', authPanel()); return; }
  const err = el('div');
  open('Your account', message('You are signed in. Private notes are visible only to you.'), button('Sign out', event => busy(event.currentTarget, async () => { await signOut(); clearDraft(); signedIn = null; notes = []; renderIndicators(); await updateAccount(); await loadNotes(); close(); }, err)), err);
};
async function init() {
  try {
    await updateAccount(); await loadNotes();
    if (configured) {
      const db = await client();
      db.auth.onAuthStateChange((_event, nextSession) => {
        if (signedIn?.user?.id !== nextSession?.user?.id) {
          notes = []; renderIndicators(); content.replaceChildren(); if (dialog.open) close();
        }
        setTimeout(async () => { try { await updateAccount(); await loadNotes(); } catch { status.textContent = 'Could not update your sign-in status. Please reload.'; } }, 0);
      });
      let draft; try { draft = sessionStorage.getItem('margin-draft'); } catch {}
      if (draft && signedIn) { try { const parsed = JSON.parse(draft); if (parsed.anchor?.exact) composer(parsed.anchor, parsed); } catch { clearDraft(); } }
    }
  } catch (error) { status.textContent = error.message; }
}
init();
// Optional browser tool: opens the same composer; does not submit data.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  Promise.resolve(document.modelContext.registerTool({ name: 'start_margin_note', description: 'Open the Margin Note composer for an exact, unique quote. Does not save or publish.', inputSchema: { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute({ quote }) {
    if (typeof quote !== 'string' || !quote.trim()) throw new Error('Provide a quote from the article.');
    const matches = Array.from(article.querySelectorAll('[data-passage]')).filter(p => p.textContent.includes(quote));
    if (matches.length !== 1 || matches[0].textContent.indexOf(quote) !== matches[0].textContent.lastIndexOf(quote)) throw new Error('Quote must identify one unique passage.');
    const p = matches[0], start = p.textContent.indexOf(quote); composer(makeAnchor(p.dataset.passage, p.textContent, start, start + quote.length)); return { composerOpened: true, submitted: false };
  } }, { signal: lifecycle.signal })).catch(() => {});
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}

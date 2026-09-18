// ── Utilities ──────────────────────────────────────────────────────────────

function icon(name, size) {
  const style = size ? ` style="font-size:${size}"` : '';
  return `<span class="material-icons-round icon-sm"${style}>${name}</span>`;
}

const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  document.getElementById('modalBackdrop').classList.remove('open');
}

function confirmDelete(message, onConfirm) {
  document.getElementById('confirmModalMessage').textContent = message;
  document.getElementById('confirmModalOk').onclick = () => { closeModal(); onConfirm(); };
  openModal('confirmModal');
}

// Buckets rows by company name. Named groups A–Z (case-insensitive),
// then a trailing "No Company" group if any rows lack a company.
// Row order within each group is preserved from the input array.
function groupByCompany(rows, keyFn) {
  const named = new Map();   // lowercase name -> { name, rows }
  const none = [];
  for (const row of rows) {
    const name = keyFn(row);
    if (!name) { none.push(row); continue; }
    const key = name.toLowerCase();
    if (!named.has(key)) named.set(key, { name, rows: [] });
    named.get(key).rows.push(row);
  }
  const groups = [...named.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  if (none.length) groups.push({ name: 'No Company', rows: none });
  return groups;
}

// Reads an image File to a data-URI string. Rasters are drawn onto a canvas
// scaled so the longest side is <= maxPx (never upscaled); SVGs pass through.
// Throws Error('too-large') if the encoded string exceeds 256 KB.
function readImageAsDataUri(file, maxPx = 256) {
  const MAX = 262144;
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const fr = new FileReader();
      fr.onload = () => {
        if (fr.result.length > MAX) reject(new Error('too-large'));
        else resolve(fr.result);
      };
      fr.onerror = () => reject(new Error('read-failed'));
      fr.readAsDataURL(file);
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const uri = canvas.toDataURL('image/png');
        if (uri.length > MAX) reject(new Error('too-large'));
        else resolve(uri);
      };
      img.onerror = () => reject(new Error('decode-failed'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('read-failed'));
    fr.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal').forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'modal-close';
    btn.title = 'Close';
    btn.innerHTML = '<span class="material-icons-round">close</span>';
    btn.addEventListener('click', closeModal);
    m.insertBefore(btn, m.firstChild);
  });
});

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? (/[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : iso + 'Z') : iso + 'T00:00:00');
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function badgeHtml(cls, text) {
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? url : null;
  } catch { return null; }
}

async function populateCompanyDropdown(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const companies = await API.get('/api/companies');
    sel.innerHTML = '<option value="">— None —</option>' +
      companies.map(co =>
        `<option value="${co.id}"${co.id === selectedId ? ' selected' : ''}>${esc(co.name)}</option>`
      ).join('');
  } catch (e) { /* leave dropdown with just the None option */ }
}

async function populateContactDropdown(selectId, selectedId, excludeId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const contacts = await API.get('/api/contacts');
    sel.innerHTML = '<option value="">— None —</option>' +
      contacts
        .filter(c => c.id !== excludeId)
        .map(c =>
          `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.last_name)}, ${esc(c.first_name)}</option>`
        ).join('');
  } catch (e) { /* leave dropdown */ }
}

async function populateAttendeeDropdown(selectId, selectedId, meetingId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const attendees = await API.get(`/api/meetings/${meetingId}/attendees`);
    sel.innerHTML = '<option value="">— Unassigned —</option>' +
      attendees.map(c =>
        `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.last_name)}, ${esc(c.first_name)}</option>`
      ).join('');
  } catch (e) { /* leave dropdown */ }
}

const TYPE_LABELS  = { call:'Call', email:'Email', meeting:'Meeting', note:'Note' };
const TIMELINE_CATEGORY_LABELS = { milestone: 'Milestone', renewal: 'Renewal', 'go-live': 'Go Live', risk: 'Risk', other: 'Other' };
const TIMELINE_SOURCE_LABELS   = { meeting: 'Meeting', action_item: 'Action Item', note: 'Note' };

// ── Contacts List ──────────────────────────────────────────────────────────

let _sortCol = 'last_name', _sortDir = 'asc', _searchTimer = null;

function initContacts() {
  loadContacts();
}

async function loadContacts(search = '') {
  const params = new URLSearchParams({ sort: _sortCol, dir: _sortDir });
  if (search) params.set('search', search);
  try {
    const contacts = await API.get('/api/contacts?' + params);
    renderContacts(contacts);
    updateSortArrows();
  } catch (e) {
    document.getElementById('contactsBody').innerHTML =
      `<tr><td colspan="6" class="empty-state">Error loading contacts.</td></tr>`;
  }
}

function renderContacts(contacts) {
  const tbody = document.getElementById('contactsBody');
  if (!contacts.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No contacts yet. Add one to get started.</td></tr>`;
    return;
  }
  const groups = groupByCompany(contacts, c => c.company_name || c.company);
  tbody.innerHTML = groups.map(g => `
    <tr class="group-header">
      <td colspan="6">${esc(g.name)} <span class="group-count">(${g.rows.length})</span></td>
    </tr>
    ${g.rows.map(c => `
    <tr>
      <td><a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a></td>
      <td>${esc(c.company_name || c.company) || '—'}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditContact(${c.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Delete</button>
      </td>
    </tr>`).join('')}
  `).join('');
}

function sortBy(col) {
  if (_sortCol === col) {
    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortCol = col;
    _sortDir = 'asc';
  }
  loadContacts(document.getElementById('searchInput')?.value || '');
}

function updateSortArrows() {
  ['last_name','company','email','created_at'].forEach(col => {
    const el = document.getElementById('sort_' + col);
    if (!el) return;
    el.innerHTML = _sortCol === col ? icon(_sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward', '12px') : '';
  });
}

function debounceSearch(val) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => loadContacts(val), 300);
}

// Add contact modal
async function openAddContact() {
  document.getElementById('contactModalTitle').textContent = 'Add Contact';
  document.getElementById('contactId').value = '';
  document.getElementById('contactForm').reset();
  await populateCompanyDropdown('cfCompanyId', null);
  openModal('contactModal');
}

// Edit contact modal
async function openEditContact(id) {
  try {
    const c = await API.get(`/api/contacts/${id}`);
    document.getElementById('contactModalTitle').textContent = 'Edit Contact';
    document.getElementById('contactId').value   = c.id;
    document.getElementById('cfFirstName').value = c.first_name || '';
    document.getElementById('cfLastName').value  = c.last_name  || '';
    document.getElementById('cfTitle').value     = c.title      || '';
    document.getElementById('cfEmail').value     = c.email      || '';
    document.getElementById('cfPhone').value     = c.phone      || '';
    document.getElementById('cfNotes').value     = c.notes      || '';
    await populateCompanyDropdown('cfCompanyId', c.company_id);
    openModal('contactModal');
  } catch (e) { showToast('Failed to load contact.'); }
}

async function submitContact(e) {
  e.preventDefault();
  const id   = document.getElementById('contactId').value;
  const data = {
    first_name: document.getElementById('cfFirstName').value.trim(),
    last_name:  document.getElementById('cfLastName').value.trim(),
    company_id: document.getElementById('cfCompanyId').value || null,
    title:      document.getElementById('cfTitle').value.trim(),
    email:      document.getElementById('cfEmail').value.trim(),
    phone:      document.getElementById('cfPhone').value.trim(),
    notes:      document.getElementById('cfNotes').value.trim(),
  };
  try {
    if (id) {
      await API.put(`/api/contacts/${id}`, data);
      showToast('Contact updated.');
    } else {
      await API.post('/api/contacts', data);
      showToast('Contact added.');
    }
    closeModal();
    loadContacts(document.getElementById('searchInput')?.value || '');
  } catch (e) { showToast('Save failed.'); }
}

function deleteContact(id) {
  confirmDelete('Delete this contact? This will also remove their interactions.', async () => {
    try {
      await API.del(`/api/contacts/${id}`);
      showToast('Contact deleted.');
      loadContacts(document.getElementById('searchInput')?.value || '');
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Contact Detail ─────────────────────────────────────────────────────────

let _currentContact = null;

function initContactDetail(contactId) {
  loadContactDetail(contactId);
}

async function loadContactDetail(contactId) {
  try {
    const [contact, interactions, meetings, actionItems] = await Promise.all([
      API.get(`/api/contacts/${contactId}`),
      API.get(`/api/contacts/${contactId}/interactions`),
      API.get(`/api/contacts/${contactId}/meetings`),
      API.get(`/api/contacts/${contactId}/action-items`)
    ]);
    _currentContact = contact;
    if (contact.company_id) {
      try { contact._company = await API.get(`/api/companies/${contact.company_id}`); } catch (e) {}
    }
    if (contact.reports_to) {
      try { contact._reportsTo = await API.get(`/api/contacts/${contact.reports_to}`); } catch (e) {}
    }
    renderContactDetail(contact);
    renderInteractions(interactions);
    renderContactMeetings(meetings);
    renderContactActionItems(actionItems);
  } catch (e) {
    document.getElementById('contactDetailRoot').innerHTML =
      '<p class="empty-state">Contact not found.</p>';
  }
}

function renderContactDetail(c) {
  const fn = c.first_name || '';
  const ln = c.last_name  || '';
  const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase();
  const companyName = c._company ? c._company.name : (c.company || '');
  const companyLink = c._company
    ? `<a href="/companies/${c._company.id}" class="table-link">${esc(companyName)}</a>`
    : esc(companyName) || '—';
  const reportsToDisplay = c._reportsTo
    ? `<a href="/contacts/${c._reportsTo.id}" class="table-link">${esc(c._reportsTo.first_name)} ${esc(c._reportsTo.last_name)}</a>`
    : '—';
  document.getElementById('contactDetailRoot').innerHTML = `
    <a href="/contacts" class="back-link">${icon('arrow_back')} All Contacts</a>
    <div class="card">
      <div class="contact-header">
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div class="contact-avatar">${esc(initials)}</div>
          <div>
            <div class="contact-name">${esc(fn)} ${esc(ln)}</div>
            <div class="contact-meta">${esc([c.title, companyName].filter(Boolean).join(' · '))}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditContactDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteContactDetail(${c.id})">Delete</button>
        </div>
      </div>
      <div class="contact-fields">
        <div class="field-row"><span class="field-label">Company</span>
          <span class="field-value">${companyLink}</span></div>
        <div class="field-row"><span class="field-label">Reports To</span>
          <span class="field-value">${reportsToDisplay}</span></div>
        <div class="field-row"><span class="field-label">Email</span>
          <span class="field-value">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</span></div>
        <div class="field-row"><span class="field-label">Phone</span>
          <span class="field-value">${esc(c.phone) || '—'}</span></div>
        <div class="field-row"><span class="field-label">Added</span>
          <span class="field-value">${fmtDate(c.created_at)}</span></div>
        <div class="field-row"><span class="field-label">Updated</span>
          <span class="field-value">${fmtDate(c.updated_at)}</span></div>
        ${c.notes ? `<div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(c.notes)}</span></div>` : ''}
      </div>
    </div>
  `;
}

async function openEditContactDetail() {
  const c = _currentContact;
  document.getElementById('contactModalTitle').textContent = 'Edit Contact';
  document.getElementById('contactId').value   = c.id;
  document.getElementById('cfFirstName').value = c.first_name || '';
  document.getElementById('cfLastName').value  = c.last_name  || '';
  document.getElementById('cfTitle').value     = c.title      || '';
  document.getElementById('cfEmail').value     = c.email      || '';
  document.getElementById('cfPhone').value     = c.phone      || '';
  document.getElementById('cfNotes').value     = c.notes      || '';
  await populateCompanyDropdown('cfCompanyId', c.company_id);
  await populateContactDropdown('cfReportsTo', c.reports_to, c.id);
  openModal('contactModal');
}

async function submitContactDetail(e) {
  e.preventDefault();
  const id   = document.getElementById('contactId').value;
  const data = {
    first_name: document.getElementById('cfFirstName').value.trim(),
    last_name:  document.getElementById('cfLastName').value.trim(),
    company_id: document.getElementById('cfCompanyId').value || null,
    reports_to: document.getElementById('cfReportsTo').value || null,
    title:      document.getElementById('cfTitle').value.trim(),
    email:      document.getElementById('cfEmail').value.trim(),
    phone:      document.getElementById('cfPhone').value.trim(),
    notes:      document.getElementById('cfNotes').value.trim(),
  };
  try {
    await API.put(`/api/contacts/${id}`, data);
    closeModal();
    showToast('Contact updated.');
    loadContactDetail(id);
  } catch (e) { showToast('Save failed.'); }
}

function deleteContactDetail(id) {
  confirmDelete('Delete this contact and all their interactions?', async () => {
    try {
      await API.del(`/api/contacts/${id}`);
      window.location.href = '/contacts';
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Interactions ───────────────────────────────────────────────────────────

function renderInteractions(interactions) {
  const el = document.getElementById('interactionsList');
  if (!el) return;
  if (!interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions logged yet.</p>';
    return;
  }
  el.innerHTML = interactions.map(i => `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badgeHtml(i.type, TYPE_LABELS[i.type] || i.type)}
          <span class="interaction-date">${fmtDate(i.interaction_date)}</span>
        </div>
        <div class="interaction-summary">${esc(i.summary)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditInteraction(${i.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteInteraction(${i.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>
  `).join('');
}

function openLogInteraction() {
  document.getElementById('interactionModalTitle').textContent = 'Log Interaction';
  document.getElementById('iId').value = '';
  document.getElementById('interactionForm').reset();
  document.getElementById('iDate').value = new Date().toISOString().slice(0,10);
  openModal('interactionModal');
}

async function openEditInteraction(id) {
  try {
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    const i = interactions.find(x => x.id === id);
    if (!i) return;
    document.getElementById('interactionModalTitle').textContent = 'Edit Interaction';
    document.getElementById('iId').value = i.id;
    document.getElementById('iType').value = i.type;
    document.getElementById('iDate').value = i.interaction_date;
    document.getElementById('iSummary').value = i.summary;
    openModal('interactionModal');
  } catch (e) { showToast('Failed to load interaction.'); }
}

async function submitInteraction(e) {
  e.preventDefault();
  const id   = document.getElementById('iId').value;
  const data = {
    type:             document.getElementById('iType').value,
    summary:          document.getElementById('iSummary').value.trim(),
    interaction_date: document.getElementById('iDate').value,
  };
  try {
    if (id) {
      await API.put(`/api/interactions/${id}`, data);
      showToast('Interaction updated.');
    } else {
      data.contact_id = _currentContact.id;
      await API.post('/api/interactions', data);
      showToast('Interaction logged.');
    }
    closeModal();
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Failed to save interaction.'); }
}

function deleteInteraction(id) {
  confirmDelete('Delete this interaction?', async () => {
    try {
      await API.del(`/api/interactions/${id}`);
      showToast('Interaction deleted.');
      const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
      renderInteractions(interactions);
    } catch (e) { showToast('Delete failed.'); }
  });
}

function renderContactMeetings(meetings) {
  const el = document.getElementById('contactMeetingsList');
  if (!el) return;
  if (!meetings.length) { el.innerHTML = '<p class="empty-state">No meetings found.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Title</th><th>Date</th><th>Company</th></tr></thead>
    <tbody>
    ${meetings.map(m => `
      <tr>
        <td><a href="/meetings/${m.id}" class="table-link">${esc(m.title)}</a></td>
        <td>${fmtDate(m.meeting_date)}</td>
        <td>${esc(m.company_name) || '—'}</td>
      </tr>
    `).join('')}
    </tbody>
  </table></div>`;
}

function renderContactActionItems(items) {
  const el = document.getElementById('contactActionItemsList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="empty-state">No action items assigned.</p>'; return; }
  el.innerHTML = items.map(a => `
    <div class="action-item-row${a.completed ? ' done' : ''}" id="ai-row-${a.id}">
      <input type="checkbox" ${a.completed ? 'checked' : ''}
             onchange="toggleActionItem(${a.id})" style="margin-right:10px;cursor:pointer">
      <div style="flex:1">
        <div class="ai-description">${esc(a.description)}</div>
        <div class="ai-meta">
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : (a.due_date_text ? `<span>${esc(a.due_date_text)}</span>` : '')}
          <span>${icon('calendar_today', '13px')} <a href="/meetings/${a.meeting_id}" class="table-link">${esc(a.meeting_title)}</a></span>
        </div>
      </div>
    </div>
  `).join('');
}

// ── New Meeting Page ────────────────────────────────────────────────────────

async function initNewMeeting() {
  document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  await populateCompanyDropdown('mCompanyId', null);
}

async function saveNewMeeting(e) {
  e.preventDefault();
  const btn = document.querySelector('#newMeetingForm [type=submit]');
  const title = document.getElementById('mTitle').value.trim();
  const date  = document.getElementById('mDate').value;
  if (!title || !date) { showToast('Title and date are required.'); return; }
  const data = {
    title,
    meeting_date: date,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  btn.disabled = true;
  try {
    const meeting = await API.post('/api/meetings', data);
    window.location.href = `/meetings/${meeting.id}`;
  } catch (e) {
    showToast('Save failed.');
    btn.disabled = false;
  }
}

// ── Meetings List ──────────────────────────────────────────────────────────

function initMeetings() {
  loadMeetings();
}

async function loadMeetings() {
  try {
    const meetings = await API.get('/api/meetings');
    renderMeetings(meetings);
  } catch (e) {
    document.getElementById('meetingsBody').innerHTML =
      `<tr><td colspan="4" class="empty-state">Error loading meetings.</td></tr>`;
  }
}

function renderMeetings(meetings) {
  const tbody = document.getElementById('meetingsBody');
  if (!meetings.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No meetings yet.</td></tr>`;
    return;
  }
  const groups = groupByCompany(meetings, m => m.company_name);
  tbody.innerHTML = groups.map(g => `
    <tr class="group-header">
      <td colspan="4">${esc(g.name)} <span class="group-count">(${g.rows.length})</span></td>
    </tr>
    ${g.rows.map(m => `
    <tr>
      <td><a href="/meetings/${m.id}" class="table-link">${esc(m.title)}</a></td>
      <td>${fmtDate(m.meeting_date)}</td>
      <td>${m.company_name ? esc(m.company_name) : '—'}</td>
      <td class="table-actions">
        <a href="/meetings/${m.id}" class="btn btn-secondary btn-sm">Edit</a>
        <button class="btn btn-danger btn-sm" onclick="deleteMeeting(${m.id})">Delete</button>
      </td>
    </tr>`).join('')}
  `).join('');
}

function deleteMeeting(id) {
  confirmDelete('Delete this meeting and all its action items?', async () => {
    try {
      await API.del(`/api/meetings/${id}`);
      showToast('Meeting deleted.');
      loadMeetings();
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Meeting Detail ─────────────────────────────────────────────────────────

let _currentMeeting = null;

function initMeetingDetail(meetingId) {
  loadMeetingDetail(meetingId);
}

async function loadMeetingDetail(meetingId) {
  try {
    const [meeting, attendees, actionItems] = await Promise.all([
      API.get(`/api/meetings/${meetingId}`),
      API.get(`/api/meetings/${meetingId}/attendees`),
      API.get(`/api/meetings/${meetingId}/action_items`)
    ]);
    _currentMeeting = meeting;
    renderMeetingDetail(meeting);
    const extractBtn = document.getElementById('extractFromSummaryBtn');
    if (extractBtn) extractBtn.style.display = meeting.summary ? '' : 'none';
    await renderAttendeesWithDropdown(meetingId, attendees);
    renderActionItems(actionItems);
  } catch (e) {
    document.getElementById('meetingDetailRoot').innerHTML =
      '<p class="empty-state">Meeting not found.</p>';
  }
}

function renderMeetingDetail(m, editMode = false) {
  if (editMode) {
    document.getElementById('meetingDetailRoot').innerHTML = `
      <a href="/meetings" class="back-link">${icon('arrow_back')} All Meetings</a>
      <div class="card">
        <div class="form-row">
          <label>Title *</label>
          <input type="text" id="mTitle" value="${esc(m.title)}" required>
        </div>
        <div class="form-row-2">
          <div class="form-row">
            <label>Date *</label>
            <input type="date" id="mDate" value="${m.meeting_date}" required>
          </div>
          <div class="form-row">
            <label>Company</label>
            <select id="mCompanyId"><option value="">— None —</option></select>
          </div>
        </div>
        <div class="form-row">
          <label>Notes</label>
          <textarea id="mNotes" style="min-height:160px">${esc(m.notes || '')}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="cancelMeetingEdit()">Cancel</button>
          <button class="btn btn-primary" onclick="saveMeetingEdit()">Save</button>
        </div>
      </div>
    `;
    populateCompanyDropdown('mCompanyId', m.company_id);
  } else {
    document.getElementById('meetingDetailRoot').innerHTML = `
      <a href="/meetings" class="back-link">${icon('arrow_back')} All Meetings</a>
      <div class="card">
        <div class="contact-header">
          <div>
            <div class="contact-name">${esc(m.title)}</div>
            <div class="contact-meta">${fmtDate(m.meeting_date)}${m.company_name ? ' · ' + esc(m.company_name) : ''}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="enterMeetingEditMode()">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMeetingDetail(${m.id})">Delete</button>
          </div>
        </div>
        ${m.summary ? `
        <div class="notes-section">
          <div class="notes-section-title">LLM Summary</div>
          <div class="md-content">${DOMPurify.sanitize(marked.parse(m.summary))}</div>
        </div>` : ''}
        ${m.notes ? `
        <div class="notes-section${m.summary ? ' collapsed' : ''}" id="rawNotesSection">
          <div class="notes-section-title${m.summary ? ' toggleable' : ''}"
               ${m.summary ? 'onclick="toggleRawNotes()"' : ''}>
            Raw Notes
            ${m.summary ? `<span class="material-icons-round toggle-chevron">expand_more</span>` : ''}
          </div>
          <div class="notes-section-content">
            <div style="white-space:pre-wrap;font-size:var(--fs-base)">${esc(m.notes)}</div>
          </div>
        </div>` : ''}
        <div style="padding:12px 16px 8px;text-align:right">
          <a href="/sanitize?meeting_id=${m.id}" class="btn btn-secondary btn-sm">${icon('security')} Redact Notes</a>
        </div>
      </div>
    `;
  }
}

function toggleRawNotes() {
  const section = document.getElementById('rawNotesSection');
  if (section) section.classList.toggle('collapsed');
}

function enterMeetingEditMode() {
  renderMeetingDetail(_currentMeeting, true);
}

function cancelMeetingEdit() {
  renderMeetingDetail(_currentMeeting, false);
}

async function saveMeetingEdit() {
  const btn = document.querySelector('#meetingDetailRoot .btn-primary');
  if (btn) btn.disabled = true;
  const title = document.getElementById('mTitle').value.trim();
  const date  = document.getElementById('mDate').value;
  if (!title || !date) {
    showToast('Title and date are required.');
    if (btn) btn.disabled = false;
    return;
  }
  const data = {
    title,
    meeting_date: date,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  try {
    const updated = await API.put(`/api/meetings/${_currentMeeting.id}`, data);
    _currentMeeting = updated;
    renderMeetingDetail(updated, false);
    showToast('Meeting saved.');
  } catch (e) {
    showToast('Save failed.');
    if (btn) btn.disabled = false;
  }
}

async function renderAttendeesWithDropdown(meetingId, attendees) {
  const attending_ids = new Set(attendees.map(a => a.id));
  try {
    const all = await API.get('/api/contacts');
    const available = all.filter(c => !attending_ids.has(c.id));
    const sel = document.getElementById('attendeeSelect');
    if (sel) {
      sel.innerHTML = '<option value="">— Add attendee —</option>' +
        available.map(c => `<option value="${c.id}">${esc(c.last_name)}, ${esc(c.first_name)}</option>`).join('');
    }
  } catch (e) {}

  const el = document.getElementById('attendeesList');
  if (!el) return;
  if (!attendees.length) {
    el.innerHTML = '<p class="empty-state">No attendees yet.</p>';
    return;
  }
  el.innerHTML = attendees.map(c => `
    <div class="interaction-item">
      <div style="flex:1">
        <a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a>
        ${c.title ? `<span style="color:var(--text-muted);margin-left:8px">${esc(c.title)}</span>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeAttendee(${c.id})" title="Remove">${icon('close')}</button>
    </div>
  `).join('');
}

async function addAttendee() {
  const sel = document.getElementById('attendeeSelect');
  const contact_id = sel?.value;
  if (!contact_id) return;
  try {
    await API.post(`/api/meetings/${_currentMeeting.id}/attendees`, { contact_id: parseInt(contact_id) });
    showToast('Attendee added.');
    const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
    await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
  } catch (e) { showToast('Failed to add attendee.'); }
}

function openNewPersonModal() {
  document.getElementById('newPersonForm').reset();
  openModal('newPersonModal');
}

async function submitNewPerson(e) {
  e.preventDefault();
  const data = {
    first_name: document.getElementById('npFirst').value.trim(),
    last_name:  document.getElementById('npLast').value.trim(),
    company:    document.getElementById('npCompany').value.trim(),
    email:      document.getElementById('npEmail').value.trim(),
  };
  try {
    const contact = await API.post('/api/contacts', data);
    await API.post(`/api/meetings/${_currentMeeting.id}/attendees`, { contact_id: contact.id });
    closeModal();
    showToast(`${data.first_name} ${data.last_name} added.`);
    const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
    await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
  } catch (e) { showToast('Failed to create person.'); }
}

function removeAttendee(contactId) {
  confirmDelete('Remove this attendee from the meeting?', async () => {
    try {
      await API.del(`/api/meetings/${_currentMeeting.id}/attendees/${contactId}`);
      showToast('Attendee removed.');
      const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
      await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
    } catch (e) { showToast('Failed to remove attendee.'); }
  });
}

function deleteMeetingDetail(id) {
  confirmDelete('Delete this meeting and all its action items?', async () => {
    try {
      await API.del(`/api/meetings/${id}`);
      window.location.href = '/meetings';
    } catch (e) { showToast('Delete failed.'); }
  });
}

function parseActionItemsFromSummary(markdown) {
  const lines = markdown.split('\n');
  const candidates = [];
  let inActionSection = false;
  let headerSeen = false;
  let separatorSeen = false;
  let colDesc = 0, colOwner = 1, colDue = 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s+.*\b(action|to[-\s]?do)\b/i.test(trimmed)) {
      inActionSection = true;
      headerSeen = false;
      separatorSeen = false;
      colDesc = 0; colOwner = 1; colDue = 2;
      continue;
    }
    if (!inActionSection) continue;
    if (/^#{1,4}\s+/.test(trimmed) && !/\b(action|to[-\s]?do)\b/i.test(trimmed)) break;
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '');
    if (!headerSeen) {
      headerSeen = true;
      cells.forEach((h, idx) => {
        const lh = h.toLowerCase();
        if (/task|action|item|description|what/.test(lh))      colDesc  = idx;
        else if (/owner|assign|person|who|responsible/.test(lh)) colOwner = idx;
        else if (/due|date|deadline|when|target/.test(lh))       colDue   = idx;
      });
      continue;
    }
    if (!separatorSeen && cells.every(c => /^[-: ]+$/.test(c))) { separatorSeen = true; continue; }
    const description = cells[colDesc]  ? cells[colDesc].replace(/\*+/g, '').trim()  : '';
    if (!description || /^[-:]+$/.test(description)) continue;
    const ownerHint   = cells[colOwner] ? cells[colOwner].replace(/\*+/g, '').trim() : '';
    const dueDateHint = cells[colDue]   ? cells[colDue].replace(/\*+/g, '').trim()   : '';
    candidates.push({ description, ownerHint, dueDateHint });
  }
  return candidates;
}

async function openExtractModal() {
  if (!_currentMeeting || !_currentMeeting.summary) {
    showToast('No summary available to extract from.');
    return;
  }
  const candidates = parseActionItemsFromSummary(_currentMeeting.summary);
  if (!candidates.length) {
    showToast('No action items found in summary.');
    return;
  }

  const listEl = document.getElementById('extractCandidatesList');
  listEl.innerHTML = candidates.map((c, i) => `
    <div class="extract-candidate" style="border-bottom:1px solid var(--border);padding:12px 0">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <input type="checkbox" data-idx="${i}" checked style="margin-top:4px;flex-shrink:0;cursor:pointer">
        <div style="flex:1">
          <textarea class="extract-desc" data-idx="${i}"
            style="width:100%;min-height:48px;resize:vertical;font-size:0.9em;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-primary);color:var(--text-primary)"
          >${esc(c.description)}</textarea>
          <div class="form-row-2" style="margin-top:8px">
            <div class="form-row">
              <label style="font-size:0.82em">Assign To</label>
              <select id="extractAssignee_${i}" style="font-size:0.87em">
                <option value="">— Unassigned —</option>
              </select>
            </div>
            <div class="form-row">
              <label style="font-size:0.82em">Due Date</label>
              <input type="text" id="extractDueText_${i}" value="${esc(c.dueDateHint)}"
                placeholder="e.g. end of Q3"
                style="margin-bottom:4px;font-size:0.87em">
              <input type="date" id="extractDueDate_${i}" style="font-size:0.87em">
            </div>
          </div>
          ${c.ownerHint ? `<div style="color:var(--text-secondary);font-size:0.79em;margin-top:4px">Owner hint: ${esc(c.ownerHint)}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  await Promise.all(
    candidates.map((_, i) => populateAttendeeDropdown(`extractAssignee_${i}`, null, _currentMeeting.id))
  );

  openModal('extractModal');
}

async function submitExtractedItems() {
  const btn = document.querySelector('#extractModal .btn-primary');
  const rows = document.querySelectorAll('.extract-candidate');
  const selected = [];
  rows.forEach((row, i) => {
    const cb = row.querySelector('input[type=checkbox]');
    if (!cb || !cb.checked) return;
    const desc = row.querySelector('.extract-desc').value.trim();
    if (!desc) return;
    selected.push({
      description:   desc,
      assigned_to:   document.getElementById(`extractAssignee_${i}`).value || null,
      due_date_text: document.getElementById(`extractDueText_${i}`).value.trim() || null,
      due_date:      document.getElementById(`extractDueDate_${i}`).value || null,
    });
  });
  if (!selected.length) { showToast('No items selected.'); return; }
  btn.disabled = true;
  try {
    await Promise.all(
      selected.map(data => API.post(`/api/meetings/${_currentMeeting.id}/action_items`, data))
    );
    closeModal();
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    renderActionItems(items);
    showToast(`${selected.length} action item${selected.length > 1 ? 's' : ''} added.`);
  } catch (e) {
    showToast('Failed to add items.');
    btn.disabled = false;
  }
}

// ── Action Items ───────────────────────────────────────────────────────────

function renderActionItems(items) {
  const el = document.getElementById('actionItemsList');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p class="empty-state">No action items yet.</p>';
    return;
  }
  el.innerHTML = items.map(a => `
    <div class="action-item-row${a.completed ? ' done' : ''}" id="ai-row-${a.id}">
      <input type="checkbox" ${a.completed ? 'checked' : ''}
             onchange="toggleActionItem(${a.id})" style="margin-right:10px;cursor:pointer">
      <div style="flex:1">
        <div class="ai-description">${esc(a.description)}</div>
        <div class="ai-meta">
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : (a.due_date_text ? `<span>${esc(a.due_date_text)}</span>` : '')}
          ${a.first_name ? `<span>${icon('person', '13px')} ${esc(a.first_name)} ${esc(a.last_name)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditActionItem(${a.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteActionItem(${a.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>
  `).join('');
}

async function openAddActionItem() {
  document.getElementById('actionItemModalTitle').textContent = 'Add Action Item';
  document.getElementById('actionItemId').value = '';
  document.getElementById('actionItemForm').reset();
  await populateAttendeeDropdown('aiAssignedTo', null, _currentMeeting.id);
  openModal('actionItemModal');
}

async function openEditActionItem(id) {
  try {
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    const a = items.find(x => x.id === id);
    if (!a) return;
    document.getElementById('actionItemModalTitle').textContent = 'Edit Action Item';
    document.getElementById('actionItemId').value  = a.id;
    document.getElementById('aiDescription').value  = a.description    || '';
    document.getElementById('aiDueDateText').value  = a.due_date_text  || '';
    document.getElementById('aiDueDate').value       = a.due_date       || '';
    await populateAttendeeDropdown('aiAssignedTo', a.assigned_to, _currentMeeting.id);
    openModal('actionItemModal');
  } catch (e) { showToast('Failed to load action item.'); }
}

async function submitActionItem(e) {
  e.preventDefault();
  const id   = document.getElementById('actionItemId').value;
  const data = {
    description:   document.getElementById('aiDescription').value.trim(),
    due_date_text: document.getElementById('aiDueDateText').value.trim() || null,
    due_date:      document.getElementById('aiDueDate').value || null,
    assigned_to:  document.getElementById('aiAssignedTo').value || null,
  };
  try {
    if (id) {
      await API.put(`/api/action_items/${id}`, data);
      showToast('Action item updated.');
    } else {
      await API.post(`/api/meetings/${_currentMeeting.id}/action_items`, data);
      showToast('Action item added.');
    }
    closeModal();
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    renderActionItems(items);
  } catch (e) { showToast('Save failed.'); }
}

async function toggleActionItem(id) {
  try {
    const r = await fetch(`/api/action_items/${id}/toggle`, { method: 'PATCH' });
    if (!r.ok) throw new Error(await r.text());
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    renderActionItems(items);
  } catch (e) { showToast('Failed to update.'); }
}

function deleteActionItem(id) {
  confirmDelete('Delete this action item?', async () => {
    try {
      await API.del(`/api/action_items/${id}`);
      showToast('Action item deleted.');
      const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
      renderActionItems(items);
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Companies List ─────────────────────────────────────────────────────────

let _companySearchTimer = null;

function initCompanies() {
  wireCompanyLogoInputs();
  loadCompanies();
}

async function loadCompanies(search = '') {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  try {
    const companies = await API.get('/api/companies?' + params);
    renderCompanies(companies);
  } catch (e) {
    document.getElementById('companiesBody').innerHTML =
      `<tr><td colspan="4" class="empty-state">Error loading companies.</td></tr>`;
  }
}

function renderCompanies(companies) {
  const tbody = document.getElementById('companiesBody');
  if (!companies.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No companies yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = companies.map(co => `
    <tr>
      <td><a href="/companies/${co.id}" class="table-link">${esc(co.name)}</a></td>
      <td>${esc(co.industry) || '—'}</td>
      <td>${safeUrl(co.website) ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : esc(co.website) || '—'}</td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditCompany(${co.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCompany(${co.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function debounceCompanySearch(val) {
  clearTimeout(_companySearchTimer);
  _companySearchTimer = setTimeout(() => loadCompanies(val), 300);
}

function openAddCompany() {
  document.getElementById('companyModalTitle').textContent = 'Add Company';
  document.getElementById('companyId').value = '';
  document.getElementById('companyForm').reset();
  setCoLogoPreview('');
  openModal('companyModal');
}

async function openEditCompany(id) {
  try {
    const co = await API.get(`/api/companies/${id}`);
    document.getElementById('companyModalTitle').textContent = 'Edit Company';
    document.getElementById('companyId').value  = co.id;
    document.getElementById('coName').value     = co.name     || '';
    document.getElementById('coIndustry').value = co.industry || '';
    document.getElementById('coWebsite').value  = co.website  || '';
    document.getElementById('coAddress').value  = co.address  || '';
    document.getElementById('coNotes').value    = co.notes    || '';
    setCoLogoPreview(co.logo || '');
    openModal('companyModal');
  } catch (e) { showToast('Failed to load company.'); }
}

async function submitCompany(e) {
  e.preventDefault();
  const id   = document.getElementById('companyId').value;
  const data = {
    name:     document.getElementById('coName').value.trim(),
    industry: document.getElementById('coIndustry').value.trim(),
    website:  document.getElementById('coWebsite').value.trim(),
    address:  document.getElementById('coAddress').value.trim(),
    notes:    document.getElementById('coNotes').value.trim(),
    logo:     _coLogo || '',
  };
  try {
    if (id) {
      await API.put(`/api/companies/${id}`, data);
      showToast('Company updated.');
    } else {
      await API.post('/api/companies', data);
      showToast('Company added.');
    }
    closeModal();
    loadCompanies(document.getElementById('companySearchInput')?.value || '');
  } catch (e) { showToast('Save failed.'); }
}

function deleteCompany(id) {
  confirmDelete('Delete this company?', async () => {
    try {
      await API.del(`/api/companies/${id}`);
      showToast('Company deleted.');
      loadCompanies(document.getElementById('companySearchInput')?.value || '');
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Company Detail ─────────────────────────────────────────────────────────

let _currentCompany = null;
let _coLogo = '';

function setCoLogoPreview(uri) {
  _coLogo = uri || '';
  const img = document.getElementById('coLogoPreview');
  const ph  = document.getElementById('coLogoPlaceholder');
  if (!img || !ph) return;
  if (_coLogo) { img.src = _coLogo; img.hidden = false; ph.hidden = true; }
  else { img.removeAttribute('src'); img.hidden = true; ph.hidden = false; }
}

function wireCompanyLogoInputs() {
  const input = document.getElementById('coLogo');
  const remove = document.getElementById('coLogoRemove');
  if (input && !input._wired) {
    input._wired = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        setCoLogoPreview(await readImageAsDataUri(file));
      } catch (err) {
        showToast(err.message === 'too-large'
          ? 'Logo too large — try a smaller image.'
          : 'Could not read that image.');
      }
      input.value = '';
    });
  }
  if (remove && !remove._wired) {
    remove._wired = true;
    remove.addEventListener('click', () => setCoLogoPreview(''));
  }
}

function initCompanyDetail(companyId) {
  wireCompanyLogoInputs();
  loadCompanyDetail(companyId);
}

async function loadCompanyDetail(companyId) {
  try {
    const [company, contacts, meetings, actionItems, notes, timeline] = await Promise.all([
      API.get(`/api/companies/${companyId}`),
      API.get(`/api/companies/${companyId}/contacts`),
      API.get(`/api/companies/${companyId}/meetings`),
      API.get(`/api/companies/${companyId}/action-items`),
      API.get(`/api/companies/${companyId}/notes`),
      API.get(`/api/companies/${companyId}/timeline`)
    ]);
    _currentCompany = company;
    renderCompanyDetail(company);
    renderCompanyContacts(contacts);
    renderCompanyMeetings(meetings);
    renderCompanyActionItems(actionItems);
    renderCompanyNotes(notes);
    renderCompanyTimeline(timeline);
  } catch (e) {
    document.getElementById('companyDetailRoot').innerHTML =
      '<p class="empty-state">Company not found.</p>';
  }
}

function renderCompanyDetail(co) {
  const logoHtml = co.logo
    ? `<img src="${esc(co.logo)}" class="company-logo" alt="">`
    : `<div class="company-logo company-logo-mono">${esc((co.name[0] || '?').toUpperCase())}</div>`;
  document.getElementById('companyDetailRoot').innerHTML = `
    <a href="/companies" class="back-link">${icon('arrow_back')} All Companies</a>
    <div class="card">
      <div class="contact-header">
        <div style="display:flex;gap:14px;align-items:flex-start">
          ${logoHtml}
          <div>
            <div class="contact-name">${esc(co.name)}</div>
            <div class="contact-meta">${esc(co.industry) || ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditCompanyDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCompanyDetail(${co.id})">Delete</button>
        </div>
      </div>
      <div class="contact-fields">
        <div class="field-row"><span class="field-label">Website</span>
          <span class="field-value">${safeUrl(co.website) ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : esc(co.website) || '—'}</span></div>
        <div class="field-row"><span class="field-label">Address</span>
          <span class="field-value">${esc(co.address) || '—'}</span></div>
        ${co.notes ? `<div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(co.notes)}</span></div>` : ''}
      </div>
    </div>
  `;
}

function renderCompanyContacts(contacts) {
  const el = document.getElementById('companyContactsList');
  if (!el) return;
  if (!contacts.length) {
    el.innerHTML = '<p class="empty-state">No contacts linked to this company.</p>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th></tr></thead>
    <tbody>
    ${contacts.map(c => `
      <tr>
        <td><a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a></td>
        <td>${esc(c.title) || '—'}</td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
        <td>${esc(c.phone) || '—'}</td>
      </tr>
    `).join('')}
    </tbody>
  </table></div>`;
}

function renderCompanyMeetings(meetings) {
  const el = document.getElementById('companyMeetingsList');
  if (!el) return;
  if (!meetings.length) { el.innerHTML = '<p class="empty-state">No meetings for this company.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Title</th><th>Date</th><th>Attendees</th></tr></thead>
    <tbody>
    ${meetings.map(m => `
      <tr>
        <td><a href="/meetings/${m.id}" class="table-link">${esc(m.title)}</a></td>
        <td>${fmtDate(m.meeting_date)}</td>
        <td>${m.attendee_count}</td>
      </tr>
    `).join('')}
    </tbody>
  </table></div>`;
}

function renderCompanyActionItems(items) {
  const el = document.getElementById('companyActionItemsList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="empty-state">No action items for this company.</p>'; return; }
  el.innerHTML = items.map(a => `
    <div class="action-item-row${a.completed ? ' done' : ''}" id="ai-row-${a.id}">
      <input type="checkbox" ${a.completed ? 'checked' : ''}
             onchange="toggleActionItem(${a.id})" style="margin-right:10px;cursor:pointer">
      <div style="flex:1">
        <div class="ai-description">${esc(a.description)}</div>
        <div class="ai-meta">
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : (a.due_date_text ? `<span>${esc(a.due_date_text)}</span>` : '')}
          ${a.first_name ? `<span>${icon('person', '13px')} <a href="/contacts/${a.contact_id}" class="table-link">${esc(a.first_name)} ${esc(a.last_name)}</a></span>` : ''}
          <span>${icon('calendar_today', '13px')} <a href="/meetings/${a.meeting_id}" class="table-link">${esc(a.meeting_title)}</a></span>
        </div>
      </div>
    </div>
  `).join('');
}

function openEditCompanyDetail() {
  const co = _currentCompany;
  document.getElementById('companyModalTitle').textContent = 'Edit Company';
  document.getElementById('companyId').value  = co.id;
  document.getElementById('coName').value     = co.name     || '';
  document.getElementById('coIndustry').value = co.industry || '';
  document.getElementById('coWebsite').value  = co.website  || '';
  document.getElementById('coAddress').value  = co.address  || '';
  document.getElementById('coNotes').value    = co.notes    || '';
  setCoLogoPreview(co.logo || '');
  openModal('companyModal');
}

async function submitCompanyDetail(e) {
  e.preventDefault();
  const id   = document.getElementById('companyId').value;
  const data = {
    name:     document.getElementById('coName').value.trim(),
    industry: document.getElementById('coIndustry').value.trim(),
    website:  document.getElementById('coWebsite').value.trim(),
    address:  document.getElementById('coAddress').value.trim(),
    notes:    document.getElementById('coNotes').value.trim(),
    logo:     _coLogo || '',
  };
  try {
    const updated = await API.put(`/api/companies/${id}`, data);
    _currentCompany = updated;
    renderCompanyDetail(updated);
    closeModal();
    showToast('Company updated.');
  } catch (e) { showToast('Save failed.'); }
}

function deleteCompanyDetail(id) {
  confirmDelete('Delete this company?', async () => {
    try {
      await API.del(`/api/companies/${id}`);
      window.location.href = '/companies';
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Company Notes ─────────────────────────────────────────────────────────

async function refreshCompanyFeeds() {
  const [notes, timeline] = await Promise.all([
    API.get(`/api/companies/${_currentCompany.id}/notes`),
    API.get(`/api/companies/${_currentCompany.id}/timeline`)
  ]);
  renderCompanyNotes(notes);
  renderCompanyTimeline(timeline);
}

function renderCompanyNotes(notes) {
  const el = document.getElementById('companyNotesList');
  if (!el) return;
  if (!notes.length) { el.innerHTML = '<p class="empty-state">No notes yet.</p>'; return; }
  el.innerHTML = notes.map(n => `
    <div class="interaction-item">
      <div style="flex:1">
        <div class="interaction-date" title="${fmtDate(n.created_at)}">${timeAgo(n.created_at)}</div>
        <div class="interaction-summary" style="white-space:pre-wrap">${esc(n.body)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditCompanyNote(${n.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCompanyNote(${n.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>
  `).join('');
}

function openAddCompanyNote() {
  document.getElementById('companyNoteModalTitle').textContent = 'Add Note';
  document.getElementById('cnId').value = '';
  document.getElementById('companyNoteForm').reset();
  openModal('companyNoteModal');
}

async function openEditCompanyNote(id) {
  try {
    const notes = await API.get(`/api/companies/${_currentCompany.id}/notes`);
    const n = notes.find(x => x.id === id);
    if (!n) return;
    document.getElementById('companyNoteModalTitle').textContent = 'Edit Note';
    document.getElementById('cnId').value = n.id;
    document.getElementById('cnBody').value = n.body;
    openModal('companyNoteModal');
  } catch (e) { showToast('Failed to load note.'); }
}

async function submitCompanyNote(e) {
  e.preventDefault();
  const id   = document.getElementById('cnId').value;
  const body = document.getElementById('cnBody').value.trim();
  try {
    if (id) {
      await API.put(`/api/notes/${id}`, { body });
      showToast('Note updated.');
    } else {
      await API.post(`/api/companies/${_currentCompany.id}/notes`, { body });
      showToast('Note added.');
    }
    closeModal();
    await refreshCompanyFeeds();
  } catch (e) { showToast('Save failed.'); }
}

function deleteCompanyNote(id) {
  confirmDelete('Delete this note?', async () => {
    try {
      await API.del(`/api/notes/${id}`);
      showToast('Note deleted.');
      await refreshCompanyFeeds();
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Company Timeline ─────────────────────────────────────────────────────

function renderCompanyTimeline(items) {
  const el = document.getElementById('companyTimelineList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="empty-state">Nothing on the timeline yet.</p>'; return; }
  el.innerHTML = items.map(i => {
    const badge = i.category
      ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
      : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source);
    const titleHtml = i.link
      ? `<a href="${i.link}" class="table-link">${esc(i.title)}</a>`
      : esc(i.title);
    const actions = i.source === 'event'
      ? `<div style="display:flex;gap:6px">
           <button class="btn btn-secondary btn-sm" onclick="openEditTimelineEvent(${i.id})">Edit</button>
           <button class="btn btn-danger btn-sm" onclick="deleteTimelineEvent(${i.id})" title="Delete">${icon('close')}</button>
         </div>`
      : '';
    return `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badge}
          <span class="interaction-date">${fmtDate(i.date)}</span>
        </div>
        <div class="interaction-summary">${titleHtml}</div>
        ${i.detail ? `<div class="interaction-summary" style="color:var(--text-muted)">${esc(i.detail)}</div>` : ''}
      </div>
      ${actions}
    </div>`;
  }).join('');
}

function openAddTimelineEvent() {
  document.getElementById('timelineEventModalTitle').textContent = 'Add Event';
  document.getElementById('teId').value = '';
  document.getElementById('timelineEventForm').reset();
  document.getElementById('teCategory').value = 'milestone';
  document.getElementById('teDate').value = new Date().toISOString().slice(0,10);
  openModal('timelineEventModal');
}

async function openEditTimelineEvent(id) {
  try {
    const items = await API.get(`/api/companies/${_currentCompany.id}/timeline`);
    const ev = items.find(x => x.source === 'event' && x.id === id);
    if (!ev) return;
    document.getElementById('timelineEventModalTitle').textContent = 'Edit Event';
    document.getElementById('teId').value = ev.id;
    document.getElementById('teCategory').value = ev.category || 'other';
    document.getElementById('teDate').value = ev.date;
    document.getElementById('teTitle').value = ev.title;
    document.getElementById('teDescription').value = ev.detail || '';
    openModal('timelineEventModal');
  } catch (e) { showToast('Failed to load event.'); }
}

async function submitTimelineEvent(e) {
  e.preventDefault();
  const id   = document.getElementById('teId').value;
  const data = {
    category:    document.getElementById('teCategory').value,
    title:       document.getElementById('teTitle').value.trim(),
    description: document.getElementById('teDescription').value.trim(),
    event_date:  document.getElementById('teDate').value,
  };
  try {
    if (id) {
      await API.put(`/api/timeline_events/${id}`, data);
      showToast('Event updated.');
    } else {
      await API.post(`/api/companies/${_currentCompany.id}/timeline_events`, data);
      showToast('Event added.');
    }
    closeModal();
    await refreshCompanyFeeds();
  } catch (e) { showToast('Save failed.'); }
}

function deleteTimelineEvent(id) {
  confirmDelete('Delete this event?', async () => {
    try {
      await API.del(`/api/timeline_events/${id}`);
      showToast('Event deleted.');
      await refreshCompanyFeeds();
    } catch (e) { showToast('Delete failed.'); }
  });
}

// ── Dashboard ──────────────────────────────────────────────────────────────

function initDashboard() {
  loadDashboard();
}

async function loadDashboard() {
  try {
    const data = await API.get('/api/dashboard');
    renderDashboard(data);
  } catch (e) {
    document.getElementById('dashRoot').innerHTML = '<p class="empty-state">Error loading dashboard.</p>';
    const c = document.getElementById('dashCompanies');
    if (c) c.innerHTML = '<p class="empty-state">Error loading companies.</p>';
  }
}

function renderDashboard(data) {
  document.getElementById('statContacts').textContent    = data.total_contacts;
  document.getElementById('statMeetings').textContent    = data.total_meetings;
  document.getElementById('statActionItems').textContent = data.open_action_items;

  const coEl = document.getElementById('dashCompanies');
  if (coEl) {
    const companies = data.companies || [];
    coEl.innerHTML = companies.length
      ? companies.map(c => {
          const logo = c.logo
            ? `<img src="${esc(c.logo)}" alt="">`
            : `<span class="company-card-mono">${esc((c.name[0] || '?').toUpperCase())}</span>`;
          return `
        <a href="/companies/${c.id}" class="company-card">
          <div class="company-card-logo">${logo}</div>
          <div class="company-card-body">
            <div class="company-card-name">${esc(c.name)}</div>
            <div class="company-card-stats">
              <span>${icon('people', '13px')} ${c.contact_count}</span>
              <span>${icon('calendar_today', '13px')} ${c.meeting_count}</span>
            </div>
          </div>
        </a>`;
        }).join('')
      : '<p class="empty-state">No companies yet.</p>';
  }

  const aiEl = document.getElementById('dashActionItems');
  if (aiEl) {
    if (!data.action_items.length) {
      aiEl.innerHTML = '<p class="empty-state">No open action items.</p>';
    } else {
      aiEl.innerHTML = data.action_items.map(a => `
        <div class="action-item-row">
          <div style="flex:1">
            <div class="ai-description">${esc(a.description)}</div>
            <div class="ai-meta">
              <a href="/meetings/${a.meeting_id}" class="table-link">${esc(a.meeting_title)}</a>
              ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : ''}
              ${a.first_name ? `<span>${icon('person', '13px')} ${esc(a.first_name)} ${esc(a.last_name)}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  const el = document.getElementById('recentList');
  if (!data.recent_interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions yet.</p>';
  } else {
    el.innerHTML = data.recent_interactions.map(i => `
      <div class="interaction-item">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px">
            ${badgeHtml(i.type, TYPE_LABELS[i.type] || i.type)}
            <a href="/contacts/${i.contact_id}" class="table-link">${esc(i.first_name)} ${esc(i.last_name)}</a>
            <span class="interaction-date">${fmtDate(i.interaction_date)}</span>
          </div>
          <div class="interaction-summary">${esc(i.summary)}</div>
        </div>
      </div>
    `).join('');
  }

  const raEl = document.getElementById('dashRecentActivity');
  if (raEl) {
    const items = data.recent_activity || [];
    raEl.innerHTML = items.length
      ? items.map(i => `
        <div class="interaction-item">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              ${i.category ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
                            : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source)}
              <a href="${i.link}" class="table-link">${esc(i.company_name)}</a>
              <span class="interaction-date">${fmtDate(i.date)}</span>
            </div>
            <div class="interaction-summary">${esc(i.title)}</div>
          </div>
        </div>`).join('')
      : '<p class="empty-state">No recent activity.</p>';
  }

  const upEl = document.getElementById('dashUpcoming');
  if (upEl) {
    const items = data.upcoming || [];
    upEl.innerHTML = items.length
      ? items.map(i => `
        <div class="interaction-item">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              ${i.category ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
                            : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source)}
              <a href="${i.link}" class="table-link">${esc(i.company_name)}</a>
              <span class="interaction-date">${fmtDate(i.date)}</span>
            </div>
            <div class="interaction-summary">${esc(i.title)}</div>
          </div>
        </div>`).join('')
      : '<p class="empty-state">Nothing upcoming.</p>';
  }
}

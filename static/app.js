// ── Utilities ──────────────────────────────────────────────────────────────

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

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function badgeHtml(cls, text) {
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

const TYPE_LABELS  = { call:'Call', email:'Email', meeting:'Meeting', note:'Note' };

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
  tbody.innerHTML = contacts.map(c => `
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
    </tr>
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
    el.textContent = _sortCol === col ? (_sortDir === 'asc' ? '↑' : '↓') : '';
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

async function deleteContact(id) {
  if (!confirm('Delete this contact? This will also remove their interactions.')) return;
  try {
    await API.del(`/api/contacts/${id}`);
    showToast('Contact deleted.');
    loadContacts(document.getElementById('searchInput')?.value || '');
  } catch (e) { showToast('Delete failed.'); }
}

// ── Contact Detail ─────────────────────────────────────────────────────────

let _currentContact = null;

function initContactDetail(contactId) {
  loadContactDetail(contactId);
}

async function loadContactDetail(contactId) {
  try {
    const [contact, interactions] = await Promise.all([
      API.get(`/api/contacts/${contactId}`),
      API.get(`/api/contacts/${contactId}/interactions`)
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
    <a href="/contacts" class="back-link">← All Contacts</a>
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

async function deleteContactDetail(id) {
  if (!confirm('Delete this contact and all their interactions?')) return;
  try {
    await API.del(`/api/contacts/${id}`);
    window.location.href = '/contacts';
  } catch (e) { showToast('Delete failed.'); }
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
      <button class="btn btn-danger btn-sm" onclick="deleteInteraction(${i.id})">✕</button>
    </div>
  `).join('');
}

function openLogInteraction() {
  document.getElementById('interactionForm').reset();
  document.getElementById('iDate').value = new Date().toISOString().slice(0,10);
  openModal('interactionModal');
}

async function submitInteraction(e) {
  e.preventDefault();
  const data = {
    contact_id:       _currentContact.id,
    type:             document.getElementById('iType').value,
    summary:          document.getElementById('iSummary').value.trim(),
    interaction_date: document.getElementById('iDate').value,
  };
  try {
    await API.post('/api/interactions', data);
    closeModal();
    showToast('Interaction logged.');
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Failed to log interaction.'); }
}

async function deleteInteraction(id) {
  if (!confirm('Delete this interaction?')) return;
  try {
    await API.del(`/api/interactions/${id}`);
    showToast('Interaction deleted.');
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Delete failed.'); }
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
  tbody.innerHTML = meetings.map(m => `
    <tr>
      <td><a href="/meetings/${m.id}" class="table-link">${esc(m.title)}</a></td>
      <td>${fmtDate(m.meeting_date)}</td>
      <td>${m.company_name ? esc(m.company_name) : '—'}</td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditMeeting(${m.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteMeeting(${m.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function openAddMeeting() {
  document.getElementById('meetingModalTitle').textContent = 'Add Meeting';
  document.getElementById('meetingId').value = '';
  document.getElementById('meetingForm').reset();
  document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  await populateCompanyDropdown('mCompanyId', null);
  openModal('meetingModal');
}

async function openEditMeeting(id) {
  try {
    const m = await API.get(`/api/meetings/${id}`);
    document.getElementById('meetingModalTitle').textContent = 'Edit Meeting';
    document.getElementById('meetingId').value  = m.id;
    document.getElementById('mTitle').value     = m.title        || '';
    document.getElementById('mDate').value      = m.meeting_date || '';
    document.getElementById('mNotes').value     = m.notes        || '';
    await populateCompanyDropdown('mCompanyId', m.company_id);
    openModal('meetingModal');
  } catch (e) { showToast('Failed to load meeting.'); }
}

async function submitMeeting(e) {
  e.preventDefault();
  const id   = document.getElementById('meetingId').value;
  const data = {
    title:        document.getElementById('mTitle').value.trim(),
    meeting_date: document.getElementById('mDate').value,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  try {
    if (id) {
      await API.put(`/api/meetings/${id}`, data);
      showToast('Meeting updated.');
    } else {
      await API.post('/api/meetings', data);
      showToast('Meeting added.');
    }
    closeModal();
    loadMeetings();
  } catch (e) { showToast('Save failed.'); }
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting and all its action items?')) return;
  try {
    await API.del(`/api/meetings/${id}`);
    showToast('Meeting deleted.');
    loadMeetings();
  } catch (e) { showToast('Delete failed.'); }
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
    await renderAttendeesWithDropdown(meetingId, attendees);
    renderActionItems(actionItems);
  } catch (e) {
    document.getElementById('meetingDetailRoot').innerHTML =
      '<p class="empty-state">Meeting not found.</p>';
  }
}

function renderMeetingDetail(m) {
  document.getElementById('meetingDetailRoot').innerHTML = `
    <a href="/meetings" class="back-link">← All Meetings</a>
    <div class="card">
      <div class="contact-header">
        <div>
          <div class="contact-name">${esc(m.title)}</div>
          <div class="contact-meta">${fmtDate(m.meeting_date)}${m.company_name ? ' · ' + esc(m.company_name) : ''}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditMeetingDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMeetingDetail(${m.id})">Delete</button>
        </div>
      </div>
      ${m.summary ? `<div class="contact-fields">
        <div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Summary</span>
          <div class="field-value md-content">${marked.parse(m.summary)}</div>
        </div>
      </div>` : ''}
      ${m.notes ? `<div class="contact-fields">
        <div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(m.notes)}</span>
        </div>
      </div>` : ''}
      <div style="padding:12px 16px 8px;text-align:right">
        <a href="/sanitize?meeting_id=${m.id}" class="btn btn-secondary btn-sm">🔒 Sanitize Notes</a>
      </div>
    </div>
  `;
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
      <button class="btn btn-danger btn-sm" onclick="removeAttendee(${c.id})">✕</button>
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

async function removeAttendee(contactId) {
  try {
    await API.del(`/api/meetings/${_currentMeeting.id}/attendees/${contactId}`);
    showToast('Attendee removed.');
    const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
    await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
  } catch (e) { showToast('Failed to remove attendee.'); }
}

async function openEditMeetingDetail() {
  const m = _currentMeeting;
  document.getElementById('meetingModalTitle').textContent = 'Edit Meeting';
  document.getElementById('meetingId').value  = m.id;
  document.getElementById('mTitle').value     = m.title        || '';
  document.getElementById('mDate').value      = m.meeting_date || '';
  document.getElementById('mNotes').value     = m.notes        || '';
  await populateCompanyDropdown('mCompanyId', m.company_id);
  openModal('meetingModal');
}

async function submitMeetingDetail(e) {
  e.preventDefault();
  const id   = document.getElementById('meetingId').value;
  const data = {
    title:        document.getElementById('mTitle').value.trim(),
    meeting_date: document.getElementById('mDate').value,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  try {
    const updated = await API.put(`/api/meetings/${id}`, data);
    _currentMeeting = updated;
    renderMeetingDetail(updated);
    closeModal();
    showToast('Meeting updated.');
  } catch (e) { showToast('Save failed.'); }
}

async function deleteMeetingDetail(id) {
  if (!confirm('Delete this meeting and all its action items?')) return;
  try {
    await API.del(`/api/meetings/${id}`);
    window.location.href = '/meetings';
  } catch (e) { showToast('Delete failed.'); }
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
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : ''}
          ${a.first_name ? `<span>→ ${esc(a.first_name)} ${esc(a.last_name)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditActionItem(${a.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteActionItem(${a.id})">✕</button>
      </div>
    </div>
  `).join('');
}

async function openAddActionItem() {
  document.getElementById('actionItemModalTitle').textContent = 'Add Action Item';
  document.getElementById('actionItemId').value = '';
  document.getElementById('actionItemForm').reset();
  await populateContactDropdown('aiAssignedTo', null, null);
  openModal('actionItemModal');
}

async function openEditActionItem(id) {
  try {
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    const a = items.find(x => x.id === id);
    if (!a) return;
    document.getElementById('actionItemModalTitle').textContent = 'Edit Action Item';
    document.getElementById('actionItemId').value  = a.id;
    document.getElementById('aiDescription').value = a.description || '';
    document.getElementById('aiDueDate').value      = a.due_date    || '';
    await populateContactDropdown('aiAssignedTo', a.assigned_to, null);
    openModal('actionItemModal');
  } catch (e) { showToast('Failed to load action item.'); }
}

async function submitActionItem(e) {
  e.preventDefault();
  const id   = document.getElementById('actionItemId').value;
  const data = {
    description:  document.getElementById('aiDescription').value.trim(),
    due_date:     document.getElementById('aiDueDate').value || null,
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

async function deleteActionItem(id) {
  if (!confirm('Delete this action item?')) return;
  try {
    await API.del(`/api/action_items/${id}`);
    showToast('Action item deleted.');
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    renderActionItems(items);
  } catch (e) { showToast('Delete failed.'); }
}

// ── Companies List ─────────────────────────────────────────────────────────

let _companySearchTimer = null;

function initCompanies() {
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
      <td>${co.website ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : '—'}</td>
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

async function deleteCompany(id) {
  if (!confirm('Delete this company?')) return;
  try {
    await API.del(`/api/companies/${id}`);
    showToast('Company deleted.');
    loadCompanies(document.getElementById('companySearchInput')?.value || '');
  } catch (e) { showToast('Delete failed.'); }
}

// ── Company Detail ─────────────────────────────────────────────────────────

let _currentCompany = null;

function initCompanyDetail(companyId) {
  loadCompanyDetail(companyId);
}

async function loadCompanyDetail(companyId) {
  try {
    const [company, contacts] = await Promise.all([
      API.get(`/api/companies/${companyId}`),
      API.get(`/api/companies/${companyId}/contacts`)
    ]);
    _currentCompany = company;
    renderCompanyDetail(company);
    renderCompanyContacts(contacts);
  } catch (e) {
    document.getElementById('companyDetailRoot').innerHTML =
      '<p class="empty-state">Company not found.</p>';
  }
}

function renderCompanyDetail(co) {
  document.getElementById('companyDetailRoot').innerHTML = `
    <a href="/companies" class="back-link">← All Companies</a>
    <div class="card">
      <div class="contact-header">
        <div>
          <div class="contact-name">${esc(co.name)}</div>
          <div class="contact-meta">${esc(co.industry) || ''}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditCompanyDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCompanyDetail(${co.id})">Delete</button>
        </div>
      </div>
      <div class="contact-fields">
        <div class="field-row"><span class="field-label">Website</span>
          <span class="field-value">${co.website ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : '—'}</span></div>
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

function openEditCompanyDetail() {
  const co = _currentCompany;
  document.getElementById('companyModalTitle').textContent = 'Edit Company';
  document.getElementById('companyId').value  = co.id;
  document.getElementById('coName').value     = co.name     || '';
  document.getElementById('coIndustry').value = co.industry || '';
  document.getElementById('coWebsite').value  = co.website  || '';
  document.getElementById('coAddress').value  = co.address  || '';
  document.getElementById('coNotes').value    = co.notes    || '';
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
  };
  try {
    const updated = await API.put(`/api/companies/${id}`, data);
    _currentCompany = updated;
    renderCompanyDetail(updated);
    closeModal();
    showToast('Company updated.');
  } catch (e) { showToast('Save failed.'); }
}

async function deleteCompanyDetail(id) {
  if (!confirm('Delete this company?')) return;
  try {
    await API.del(`/api/companies/${id}`);
    window.location.href = '/companies';
  } catch (e) { showToast('Delete failed.'); }
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
  }
}

function renderDashboard(data) {
  document.getElementById('statContacts').textContent    = data.total_contacts;
  document.getElementById('statMeetings').textContent    = data.total_meetings;
  document.getElementById('statActionItems').textContent = data.open_action_items;

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
              ${a.first_name ? `<span>→ ${esc(a.first_name)} ${esc(a.last_name)}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  const el = document.getElementById('recentList');
  if (!data.recent_interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions yet.</p>';
    return;
  }
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
